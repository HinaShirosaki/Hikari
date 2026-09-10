import {
  analyzeAssayData,
  describeAnalysisSpec,
  normalizeAnalysisSpec
} from './analysis/index.js';
import { isValidWellForDefinition } from './plate-model.js';
import { parseNumericResult } from './shared.js';
import {
  createDefaultChartStyle,
  normalizeChartStyle
} from './plotly/chart-style-model.js';
import { createChartStyleStore } from './plotly/chart-style-store.js';
import { mountChartControls } from './plotly/chart-controls.js';
import { mountChartToolbar } from './plotly/chart-toolbar.js';
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
  getResultValueCount,
  buildResultGridSignature,
  buildResultGridColumns,
  buildResultGridData,
  getResultGridHeight,
  onAnalysisRendered,
  onChartStyleChanged,
  onTransformChanged
}) {
  const {
    assayAnalysisAsymmetricInput,
    assayAnalysisColumnGroupsInput,
    assayAnalysisErrorBarsInput,
    assayAnalysisErrorBarsField,
    assayAnalysisGroupByInput,
    assayAnalysisKindInput,
    assayAnalysisPolyOrderField,
    assayAnalysisPolyOrderInput,
    assayAnalysisSubtotalsField,
    assayAnalysisSubtotalsInput,
    assayAnalysisSummary,
    assayAnalysisRowGroupsInput,
    assayAnalysisTable,
    assayAnalysisXAxisField,
    assayAnalysisXAxisInput,
    assayChartStyleMount,
    assayChartToolbarMount,
    assayChartFormatPanel,
    assayTransformSummary,
    assayResultTable,
    assayDerivedPlatePanel,
    assayDerivedPlateTable
  } = elements;
  const hasPlotly = typeof window !== 'undefined' && Boolean(window.Plotly);
  // Only these style fields feed buildAnalysisChartModel; everything else is pure
  // presentation and needs a redraw, not a re-analysis.
  const MODEL_STYLE_KEYS = ['xColumn', 'yColumn', 'seriesColumn'];

  const {
    getTransformFormulas,
    redrawTransformGrid,
    setTransformFormulas,
    setTransformEnabled,
    getTransformSpec,
    clearTransformGrid,
    refreshDerivedPlate,
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
    onTransformChange: () => onTransformChange(),
    assayResultTable,
    assayDerivedPlatePanel,
    assayDerivedPlateTable,
    assayTransformSummary,
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
  const chartControls = assayChartStyleMount
    ? mountChartControls(assayChartStyleMount, {
      store: chartStyleStore,
      safeText
    })
    : null;
  let chartSurface = null;
  const chartToolbar = assayChartToolbarMount
    ? mountChartToolbar(assayChartToolbarMount, {
      store: chartStyleStore,
      // Error bars belong to the analysis spec, so the toolbar drives the existing
      // checkbox rather than holding a second copy of the state.
      errorBars: {
        isApplicable: () => Boolean(assayAnalysisErrorBarsField && !assayAnalysisErrorBarsField.hidden),
        get: () => Boolean(assayAnalysisErrorBarsInput?.checked),
        toggle: () => {
          if (!assayAnalysisErrorBarsInput) {
            return;
          }
          assayAnalysisErrorBarsInput.checked = !assayAnalysisErrorBarsInput.checked;
          onAnalysisConfigChange();
        }
      },
      // Keep this late-bound so constructing the toolbar cannot read chartSurface
      // while it is still in its temporal dead zone.
      onExport: (format) => chartSurface?.exportChartImage(format)
    })
    : null;

  // Every analysis ships its own chartModel, which is what "auto" means. The moment a
  // column is overridden that model no longer answers the question, so it has to be
  // rebuilt from the result table -- otherwise the Data Series mapping does nothing.
  chartSurface = createChartSurface({
    safeText,
    runtime,
    chartStyleStore,
    chartControls,
    chartToolbar,
    plotlyRenderer,
    assayAnalysisSummary,
    assayAnalysisTable,
    assayChartFormatPanel,
    assayChartToolbarMount
  });
  const {
    getAnalysisContext,
    setAnalysisContext,
    setChartContext,
    openChartFormat,
    setToolbarVisible,
    applyChartContext,
    unmountAnalysisChart,
    renderAnalysisChart,
    getChartStyle,
    loadChartStyle,
    refreshChartControls,
    purgeAgentPlotly,
    renderAgentPlotlyGraph
  } = chartSurface;

  function getAnalysisSpec() {
    return normalizeAnalysisSpec({
      groupBy: assayAnalysisGroupByInput?.value,
      xAxis: assayAnalysisXAxisInput?.value,
      analysis: assayAnalysisKindInput?.value,
      polyOrder: Number(assayAnalysisPolyOrderInput?.value),
      asymmetric: Boolean(assayAnalysisAsymmetricInput?.checked),
      subtotals: Boolean(assayAnalysisSubtotalsInput?.checked),
      errorBars: assayAnalysisErrorBarsInput ? assayAnalysisErrorBarsInput.checked : true
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
    toggle(assayAnalysisXAxisField, !isSummary);
    toggle(assayAnalysisSubtotalsField, isSummary);
    toggle(assayAnalysisPolyOrderField, analysis === 'polynomial');
    // Every analysis pools replicates before plotting, so every one of them can show
    // the spread -- a fitted curve carries it on its observed markers.
    toggle(assayAnalysisErrorBarsField, true);
    if (assayAnalysisAsymmetricInput?.closest) {
      toggle(assayAnalysisAsymmetricInput.closest('label'), analysis === 'sigmoidal');
    }
  }

  function clearOutput() {
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
    unmountAnalysisChart();
    purgeAgentPlotly();
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
    if (previewSaveTimer) {
      clearTimeout(previewSaveTimer);
      previewSaveTimer = null;
    }
    lastResult = null;
    lastSpec = null;
    lastModel = null;
    lastRecordedSummary = '';
    setToolbarVisible(false);
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
    if (typeof onAnalysisRendered !== 'function' || !lastResult || !lastSpec) {
      return;
    }
    onAnalysisRendered({
      method: lastSpec.analysis,
      spec: { ...lastSpec },
      methodLabel: describeAnalysisSpec(lastSpec),
      // The rail reserves status text for actionable notices. Keep the complete
      // analysis description in the saved/agent record even when a successful
      // result does not need to repeat it above the table and chart.
      summary: lastRecordedSummary || lastResult.summary || assayAnalysisSummary?.textContent || '',
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
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }

    unmountAnalysisChart();
    purgeAgentPlotly();
    syncCurrentResultsFromGrid();
    refreshDerivedPlate();
    const spec = getAnalysisSpec();
    const { observations, nonNumericCount } = collectNumericObservations();
    if (!observations.length) {
      assayAnalysisSummary.textContent = nonNumericCount
        ? `No numeric values found. Non-numeric result cells: ${nonNumericCount}.`
        : 'No result values to analyze.';
      assayAnalysisTable.innerHTML = '';
      lastResult = null;
      lastSpec = null;
      lastModel = null;
      lastRecordedSummary = '';
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

    // Successful analysis tables and charts already show their model and result
    // rows. Use this compact status target only for information that needs action.
    const notices = [];
    if (!result.rows.length && result.summary) {
      notices.push(result.summary);
    }
    if (nonNumericCount) {
      notices.push(`Non-numeric cells ignored: ${nonNumericCount}.`);
    }
    lastRecordedSummary = [result.summary, ...notices.filter((notice) => notice !== result.summary)].join(' ');
    assayAnalysisSummary.textContent = notices.join(' ');
    if (!result.rows.length) {
      assayAnalysisTable.innerHTML = '<p class="small-note">No analyzable rows for this analysis.</p>';
      setChartContext(getAnalysisContext());
      emitAnalysisRendered();
      return;
    }

    const tableHtml = buildAnalysisTable(result.headers, result.rows);
    assayAnalysisTable.innerHTML = hasPlotly
      ? `
        <div class="assay-analysis-results">
          <div class="assay-analysis-chart" data-assay-analysis-chart></div>
          ${tableHtml}
        </div>
      `
      : tableHtml;
    lastModel = modelForStyle(result, spec.analysis, getChartStyle());
    applyChartContext(renderAnalysisChart(lastModel));
    emitAnalysisRendered();
  }


  function onAnalysisMethodChange() {
    syncAnalysisControls();
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }
    clearOutput();
    syncCurrentResultsFromGrid();
    if (getResultValueCount()) {
      renderAnalysis();
    }
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
    // An empty plate is a saved workspace in its own right. Only user edits or
    // drag-to-fill should populate its cells.
    setTransformEnabled(true);
    if (assayDerivedPlatePanel) {
      assayDerivedPlatePanel.hidden = false;
      assayDerivedPlatePanel.open = true;
    }
    onTransformChange();
    assayDerivedPlatePanel?.scrollIntoView?.({ block: 'nearest' });
    return true;
  }

  function onTransformChange() {
    if (typeof onTransformChanged === 'function') {
      onTransformChanged(getTransformSpec());
    }
    syncCurrentResultsFromGrid();
    if (lastResult && getResultValueCount()) {
      renderAnalysis();
    } else {
      refreshDerivedPlate();
    }
  }

  function clearTransform() {
    setTransformEnabled(false);
    setTransformFormulas({});
    onTransformChange();
  }

  function onSourceResultsChanged() {
    if (isTransformActive(getTransformSpec())) {
      refreshDerivedPlate();
    }
  }

  function onAnalysisConfigChange() {
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }
    syncCurrentResultsFromGrid();
    if (!getResultValueCount()) {
      return;
    }
    renderAnalysis();
  }

  syncAnalysisControls();

  return {
    clearOutput,
    renderAnalysis,
    onAnalysisMethodChange,
    onAnalysisConfigChange,
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
    getChartStyle,
    loadChartStyle,
    refreshChartControls,
    renderAgentPlotlyGraph,
    destroy() {
      if (previewSaveTimer) {
        clearTimeout(previewSaveTimer);
        previewSaveTimer = null;
      }
      chartToolbar?.destroy();
      chartControls?.destroy();
      clearTransformGrid();
      unmountAnalysisChart();
      purgeAgentPlotly();
    }
  };
}

export { normalizeAgentPlotlyGraphArtifact } from './analysis-view/plotly-artifact.js';
