import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("plate");
import {
  GROUPED_ANALYSES,
  analyzeAssayData,
  describeAnalysisSpec,
  normalizeAnalysisSpec
} from './analysis/index.js';
import { isValidWellForDefinition } from './plate-model.js';
import { parseNumericResult } from './shared.js';
import { plateMessage } from './localization.js';
import {
  createDefaultChartStyle,
  normalizeChartStyle
} from './plotly/chart-style-model.js';
import { createChartStyleStore } from './plotly/chart-style-store.js';
import { mountChartControls } from './plotly/chart-controls.js';
import { createAssayPlotlyRenderer } from './plotly/plotly-renderer.js';
import { buildAnalysisChartModel, numericAnalysisHeaders } from './analysis-chart-model.js';
import {
  applyPlateTransform,
  isTransformActive,
  normalizeTransformSpec
} from './derived-plate.js';

export {
  CHART_STYLE_OPTIONS,
  createDefaultChartStyle,
  normalizeChartStyle
} from './plotly/chart-style-model.js';
import { createChartSurface } from './analysis-view/chart-surface.js';
import { createDerivedPlateGrid } from './analysis-view/derived-plate-grid.js';


export function createAssayAnalysisView({
  runtime,
  elements,
  safeText,
  TabulatorLib,
  getCurrentDefinition,
  syncCurrentResultsFromGrid,
  buildResultGridSignature,
  buildResultGridColumns,
  buildResultGridData,
  getResultGridHeight,
  resultRowVisible,
  onWorkspaceChanged,
  onAnalysisRendered,
  onChartStyleChanged,
  onTransformChanged,
  onAnalysisDataSourceChanged
}) {
  const {
    assayAnalysisAsymmetricInput,
    assayAnalysisColumnGroupsInput,
    assayAnalysisErrorBarsInput,
    assayAnalysisErrorBarsField,
    assayAnalysisControlsField,
    assayAnalysisGroupByInput,
    assayAnalysisDataSourceInput,
    assayAnalysisHighControlInput,
    assayAnalysisKindInput,
    assayAnalysisLowControlInput,
    assayAnalysisPolyOrderField,
    assayAnalysisPolyOrderInput,
    assayAnalysisSubtotalsField,
    assayAnalysisSubtotalsInput,
    assayAnalysisRowGroupsInput,
    assayAnalysisTable,
    assayAnalysisSummaryTable,
    assayAnalysisXAxisField,
    assayAnalysisXAxisInput,
    assayChartStyleMount,
    assayChartFormatPanel,
    assayResultTable,
    assayDerivedPlatePanel,
    assayDerivedPlateTable
  } = elements;
  const hasPlotly = typeof window !== 'undefined' && Boolean(window.Plotly);
  // Only these style fields feed buildAnalysisChartModel; everything else is pure
  // presentation and needs a redraw, not a re-analysis.
  const MODEL_STYLE_KEYS = ['xColumn', 'yColumn', 'seriesColumn'];

  const {
    getDerivedPlate,
    refreshRowVisibility,
    getTransformFormulas,
    redrawTransformGrid,
    setTransformFormulas,
    setTransformEnabled,
    getTransformSpec,
    clearTransformGrid,
    refreshDerivedPlate: refreshDerivedPlateGrid,
    collectNumericObservations,
    buildAnalysisTable,
    getGroupOptions
  } = createDerivedPlateGrid({
    safeText,
    runtime,
    TabulatorLib,
    getCurrentDefinition,
    getResultGridHeight,
    buildResultGridColumns,
    buildResultGridData,
    buildResultGridSignature,
    resultRowVisible,
    onTransformChange: () => onTransformChange(),
    assayResultTable,
    assayDerivedPlatePanel,
    assayDerivedPlateTable,
    assayAnalysisRowGroupsInput,
    assayAnalysisColumnGroupsInput
  });

  // A fitted curve is the analysis's own densely-sampled model. Rebuilding it from the
  // result table would throw the fit away and plot its diagnostics (R2, RMSE, Points)
  // as bars, so column overrides do not apply there; Data Series hides that mapping.
  function modelForStyle(result, analysis, style) {
    const overridden = MODEL_STYLE_KEYS.some((key) => style?.[key] && style[key] !== 'auto');
    return ((!overridden || chartSurface.hasFittedCurve(result.chartModel)) && result.chartModel)
      || buildAnalysisChartModel(result, analysis, style);
  }
  let lastResult = null;
  let lastSpec = null;
  let lastModel = null;
  let lastRecordedSummary = '';
  let previewSaveTimer = null;
  let analysisDataSource = 'raw';

  if (!runtime.chartStyle || typeof runtime.chartStyle !== 'object') {
    runtime.chartStyle = createDefaultChartStyle();
  } else {
    runtime.chartStyle = normalizeChartStyle(runtime.chartStyle);
  }

  // Dragging or renaming a title on the figure is the same edit as typing in the Text
  // tab's boxes, so it lands in the same style fields and the two stay in sync.
  const plotlyRenderer = createAssayPlotlyRenderer({
    onTitleEdit: (patch) => {
      chartStyleStore.setStyle(patch);
      refreshChartControls();
    }
  });
  const chartStyleStore = createChartStyleStore({
    initialStyle: runtime.chartStyle,
    onChange: (style, previous) => {
      runtime.chartStyle = style;
      if (typeof onChartStyleChanged === 'function') {
        onChartStyleChanged(style);
      }
      redrawForStyleChange(style, previous);
      chartControls?.refresh();
    }
  });
  let chartSurface = null;
  const chartControls = assayChartStyleMount
    ? mountChartControls(assayChartStyleMount, {
      store: chartStyleStore,
      agentElements: {
        getStyle: () => chartSurface?.getAgentElementStyle(),
        apply: (patch) => chartSurface?.updateAgentElements(patch.plotElements)
      },
      safeText
    })
    : null;
  // Every analysis ships its own chartModel, which is what "auto" means. The moment a
  // column is overridden that model no longer answers the question, so it has to be
  // rebuilt from the result table -- otherwise the Data Series mapping does nothing.
  chartSurface = createChartSurface({
    runtime,
    chartStyleStore,
    chartControls,
    plotlyRenderer,
    assayAnalysisTable,
    assayChartFormatPanel
  });
  const {
    getAnalysisContext,
    setAnalysisContext,
    setChartContext,
    openChartFormat,
    applyChartContext,
    unmountAnalysisChart,
    renderAnalysisChart,
    exportChartImage,
    getChartStyle,
    loadChartStyle,
    refreshChartControls,
    purgeAgentPlotly,
    renderAgentPlotlyGraph
  } = chartSurface;

  function refreshDerivedPlate() {
    const result = refreshDerivedPlateGrid();
    syncAnalysisDataSource();
    onWorkspaceChanged?.();
    return result;
  }

  function getAnalysisDataSource() {
    return analysisDataSource === 'transformed' && isTransformActive(getTransformSpec())
      ? 'transformed' : 'raw';
  }

  function syncAnalysisDataSource() {
    analysisDataSource = getAnalysisDataSource();
    if (assayAnalysisDataSourceInput) {
      const transformed = assayAnalysisDataSourceInput.querySelector('option[value="transformed"]');
      if (transformed) transformed.disabled = !isTransformActive(getTransformSpec());
      assayAnalysisDataSourceInput.value = analysisDataSource;
    }
  }

  function setAnalysisDataSource(source, notify = false) {
    analysisDataSource = source === 'transformed' ? 'transformed' : 'raw';
    syncAnalysisDataSource();
    if (notify) onAnalysisDataSourceChanged?.(analysisDataSource);
    return analysisDataSource;
  }

  function loadAnalysisDataSource(source) {
    // Older records used Table2 whenever a transformed plate existed.
    return setAnalysisDataSource(source === 'raw' || source === 'transformed'
      ? source : (isTransformActive(getTransformSpec()) ? 'transformed' : 'raw'));
  }

  function onAnalysisDataSourceChange() {
    setAnalysisDataSource(assayAnalysisDataSourceInput?.value, true);
    renderAnalysis();
  }

  function getAnalysisSpec() {
    return normalizeAnalysisSpec({
      groupBy: assayAnalysisGroupByInput?.value,
      xAxis: assayAnalysisXAxisInput?.value,
      analysis: assayAnalysisKindInput?.value,
      polyOrder: Number(assayAnalysisPolyOrderInput?.value),
      asymmetric: Boolean(assayAnalysisAsymmetricInput?.checked),
      subtotals: Boolean(assayAnalysisSubtotalsInput?.checked),
      errorBars: assayAnalysisErrorBarsInput ? assayAnalysisErrorBarsInput.checked : true,
      highControl: assayAnalysisHighControlInput?.value,
      lowControl: assayAnalysisLowControlInput?.value
    });
  }

  // Modifiers only exist for the analysis that owns them; a hidden control is a
  // control that can't silently do nothing.
  function syncAnalysisControls() {
    const analysis = String(assayAnalysisKindInput?.value || 'summary');
    const isSummary = analysis === 'summary';
    const toggle = (element, visible) => {
      if (element) {
        element.hidden = !visible;
      }
    };
    toggle(assayAnalysisXAxisField, !GROUPED_ANALYSES.includes(analysis));
    toggle(assayAnalysisSubtotalsField, isSummary);
    toggle(assayAnalysisPolyOrderField, analysis === 'polynomial');
    toggle(
      assayAnalysisControlsField,
      ['percent_control', 'plate_qc', 'zscore', 'ttest'].includes(analysis)
    );
    // Every analysis pools replicates before plotting, so every one of them can show
    // the spread -- a fitted curve carries it on its observed markers.
    toggle(assayAnalysisErrorBarsField, true);
    if (assayAnalysisAsymmetricInput?.closest) {
      toggle(assayAnalysisAsymmetricInput.closest('label'), analysis === 'sigmoidal');
    }
  }

  function clearOutput() {
    unmountAnalysisChart();
    purgeAgentPlotly();
    if (assayAnalysisTable) {
      i18nUi.setHtml(assayAnalysisTable, '');
    }
    if (assayAnalysisSummaryTable) i18nUi.setHtml(assayAnalysisSummaryTable, '');
    if (previewSaveTimer) {
      clearTimeout(previewSaveTimer);
      previewSaveTimer = null;
    }
    lastResult = null;
    lastSpec = null;
    lastModel = null;
    lastRecordedSummary = '';
    refreshDerivedPlate();
    setAnalysisContext({
      headers: [],
      numericHeaders: [],
      seriesLabels: [],
      method: '',
      chartType: '',
      hasErrorBars: false,
      hasFittedCurve: false
    });
  }

  function emitAnalysisRendered() {
    onWorkspaceChanged?.();
    if (typeof onAnalysisRendered !== 'function' || !lastResult || !lastSpec) {
      return;
    }
    onAnalysisRendered({
      method: lastSpec.analysis,
      dataSource: getAnalysisDataSource(),
      spec: { ...lastSpec },
      methodLabel: describeAnalysisSpec(lastSpec),
      // Keep the complete analysis description in the saved/agent record even
      // though the UI no longer repeats it beside the table and chart.
      summary: lastRecordedSummary || lastResult.summary || '',
      headers: Array.isArray(lastResult.headers) ? lastResult.headers.map((item) => String(item)) : [],
      rows: Array.isArray(lastResult.rows) ? lastResult.rows : [],
      chartDataUrl: plotlyRenderer.captureDataUrl(),
      analyzedAt: new Date().toISOString()
    });
  }

  // Style changes are presentation only: redraw the cached model rather than
  // re-reading the grid and re-fitting the curve. Only the three column-selection
  // fields can invalidate the model itself.
  function redrawForStyleChange(style, previous) {
    if (!lastResult || !lastSpec) {
      return;
    }
    if (!previous || MODEL_STYLE_KEYS.some((key) => previous[key] !== style[key])) {
      lastModel = modelForStyle(lastResult, lastSpec.analysis, style);
    }
    applyChartContext(renderAnalysisChart(lastModel));
    if (previewSaveTimer) {
      clearTimeout(previewSaveTimer);
    }
    previewSaveTimer = setTimeout(() => {
      previewSaveTimer = null;
      emitAnalysisRendered();
    }, 600);
  }

  function renderAnalysis() {
    if (!assayAnalysisTable) {
      return;
    }

    unmountAnalysisChart();
    purgeAgentPlotly();
    syncCurrentResultsFromGrid();
    refreshDerivedPlate();
    const spec = getAnalysisSpec();
    const { observations, nonNumericCount } = collectNumericObservations(getAnalysisDataSource());
    if (!observations.length) {
      // Nothing to plot: say so where the table and chart would have been, not in
      // the rail beside the controls.
      i18nUi.setHtml(assayAnalysisTable, `<p class="small-note">${nonNumericCount
        ? plateMessage('analysis.noNumeric', { count: nonNumericCount })
        : plateMessage('analysis.noValues')}</p>`);
      lastResult = null;
      lastSpec = null;
      lastModel = null;
      lastRecordedSummary = '';
      if (assayAnalysisSummaryTable) i18nUi.setHtml(assayAnalysisSummaryTable, assayAnalysisTable.innerHTML);
      onWorkspaceChanged?.();
      return;
    }

    const result = analyzeAssayData({ spec, observations, options: getGroupOptions() });
    lastResult = result;
    lastSpec = spec;
    lastModel = null;

    setAnalysisContext({
      ...getAnalysisContext(),
      headers: Array.isArray(result?.headers) ? result.headers.map(String) : [],
      numericHeaders: numericAnalysisHeaders(result),
      seriesLabels: [],
      method: spec.analysis
    });

    // The analysis table and chart already show the model and its result rows; the
    // notices below only ride along into the saved record.
    const notices = [];
    if (!result.rows.length && result.summary) {
      notices.push(result.summary);
    }
    if (nonNumericCount) {
      notices.push(`Non-numeric cells ignored: ${nonNumericCount}.`);
    }
    lastRecordedSummary = [result.summary, ...notices.filter((notice) => notice !== result.summary)].join(' ');
    if (!result.rows.length) {
      i18nUi.setHtml(assayAnalysisTable, `<p class="small-note">${plateMessage('analysis.noRows')}</p>`);
      if (assayAnalysisSummaryTable) i18nUi.setHtml(assayAnalysisSummaryTable, assayAnalysisTable.innerHTML);
      setChartContext(getAnalysisContext());
      emitAnalysisRendered();
      return;
    }

    const tableHtml = buildAnalysisTable(result.headers, result.rows);
    if (assayAnalysisSummaryTable) i18nUi.setHtml(assayAnalysisSummaryTable, tableHtml);
    i18nUi.setHtml(assayAnalysisTable, hasPlotly
      ? `
        <div class="assay-analysis-results">
          <div class="assay-analysis-chart" data-assay-analysis-chart></div>
          ${assayAnalysisSummaryTable ? '' : tableHtml}
        </div>
      `
      : (assayAnalysisSummaryTable ? `<p class="small-note">${plateMessage('analysis.chartUnavailable')}</p>` : tableHtml));
    lastModel = modelForStyle(result, spec.analysis, getChartStyle());
    applyChartContext(renderAnalysisChart(lastModel));
    emitAnalysisRendered();
  }


  function onAnalysisMethodChange() {
    syncAnalysisControls();
    if (!assayAnalysisTable) {
      return;
    }
    clearOutput();
    renderAnalysis();
  }

  // Restores the cell formulas without reporting a change, so loading a saved assay
  // does not mark it dirty. Legacy global formulas remain usable by copying that
  // formula into each numeric source cell; legacy guided transforms are preserved as
  // formula constants until the user edits them.
  function loadTransformSpec(spec) {
    const normalized = normalizeTransformSpec(spec);
    setTransformEnabled(isTransformActive(normalized));
    setTransformFormulas({});
    if (normalized.mode === 'cells') {
      setTransformFormulas({ ...normalized.formulas });
    } else if (normalized.mode === 'formula' && normalized.formula.trim()) {
      Object.entries(runtime.currentResults || {}).forEach(([well, raw]) => {
        if (Number.isFinite(parseNumericResult(raw)) && isValidWellForDefinition(well, getCurrentDefinition())) {
          getTransformFormulas()[well] = normalized.formula;
        }
      });
    } else if (isTransformActive(normalized)) {
      const legacy = applyPlateTransform({
        results: runtime.currentResults,
        spec: normalized,
        definition: getCurrentDefinition(),
        rowGroupSpec: String(assayAnalysisRowGroupsInput?.value || ''),
        columnGroupSpec: String(assayAnalysisColumnGroupsInput?.value || '')
      });
      Object.entries(legacy.numericResults || {}).forEach(([well, value]) => {
        getTransformFormulas()[well] = `=${value}`;
      });
    }
    refreshDerivedPlate();
    return getTransformSpec();
  }

  function createTransformPlate() {
    syncCurrentResultsFromGrid();
    const creating = !isTransformActive(getTransformSpec());
    // An empty plate is a saved workspace in its own right. Only user edits or
    // drag-to-fill should populate its cells.
    setTransformEnabled(true);
    if (creating) setAnalysisDataSource('transformed', true);
    if (assayDerivedPlatePanel) {
      assayDerivedPlatePanel.hidden = false;
      assayDerivedPlatePanel.open = true;
    }
    onTransformChange();
    onWorkspaceChanged?.({ tab: 'transformed' });
    assayDerivedPlatePanel?.scrollIntoView?.({ block: 'nearest' });
    return true;
  }

  function onTransformChange() {
    if (typeof onTransformChanged === 'function') {
      onTransformChanged(getTransformSpec());
    }
    renderAnalysis();
  }

  function clearTransform() {
    setTransformEnabled(false);
    setTransformFormulas({});
    setAnalysisDataSource('raw', true);
    onTransformChange();
  }

  function onSourceResultsChanged() {
    if (isTransformActive(getTransformSpec())) {
      refreshDerivedPlate();
    }
  }

  function onAnalysisConfigChange() {
    if (!assayAnalysisTable) {
      return;
    }
    renderAnalysis();
  }

  syncAnalysisControls();
  syncAnalysisDataSource();

  return {
    getPlotSnapshot: () => ({
      available: Boolean(lastModel && assayAnalysisTable?.querySelector('[data-assay-analysis-chart]')),
      style: JSON.parse(JSON.stringify(getChartStyle())),
      context: getAnalysisContext(),
      model: lastModel ? JSON.parse(JSON.stringify(lastModel)) : null
    }),
    plotReady: () => plotlyRenderer.ready(),
    capturePlotImage: () => plotlyRenderer.toImage('svg'),
    replacePlotStyle(style) {
      loadChartStyle(style);
      if (lastModel) applyChartContext(renderAnalysisChart(lastModel));
      onWorkspaceChanged?.();
      return plotlyRenderer.ready();
    },
    refreshRowVisibility,
    getWorkspaceState: () => ({
      transformActive: isTransformActive(getTransformSpec()),
      dataSource: getAnalysisDataSource(),
      errors: Object.entries(getDerivedPlate()?.cells || {}).filter(([, cell]) => cell.error)
        .map(([well, cell]) => ({ well, message: cell.error })),
      methodLabel: describeAnalysisSpec(getAnalysisSpec()),
      ...getAnalysisContext()
    }),
    redrawChart: () => { if (lastModel) renderAnalysisChart(lastModel); },
    clearOutput,
    renderAnalysis,
    onAnalysisMethodChange,
    onAnalysisConfigChange,
    onAnalysisDataSourceChange,
    getAnalysisDataSource,
    loadAnalysisDataSource,
    syncAnalysisControls,
    getAnalysisSpec,
    getTransformSpec,
    loadTransformSpec,
    refreshDerivedPlate,
    createTransformPlate,
    clearTransform,
    redrawTransformGrid,
    onSourceResultsChanged,
    openChartFormat,
    exportChartImage,
    getChartStyle,
    loadChartStyle,
    refreshChartControls,
    renderAgentPlotlyGraph: (artifact) => {
      const rendered = renderAgentPlotlyGraph(artifact);
      if (rendered && assayAnalysisSummaryTable) {
        i18nUi.setHtml(assayAnalysisSummaryTable, `<p class="small-note">${plateMessage('analysis.agentNoSummary')}</p>`);
      }
      onWorkspaceChanged?.();
      return rendered;
    },
    destroy() {
      if (previewSaveTimer) {
        clearTimeout(previewSaveTimer);
        previewSaveTimer = null;
      }
      chartControls?.destroy();
      clearTransformGrid();
      unmountAnalysisChart();
      purgeAgentPlotly();
    }
  };
}

export { normalizeAgentPlotlyGraphArtifact } from './analysis-view/plotly-artifact.js';
