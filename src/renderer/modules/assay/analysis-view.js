import {
  analyzeAssayData,
  describeAnalysisSpec,
  normalizeAnalysisSpec
} from './analysis/index.js';
import {
  isValidWellForDefinition,
  layoutToMap,
  parseWellId,
  toRowLabel,
  wellIdFor
} from './plate-model.js';
import {
  parseFirstNumericToken,
  parseNumericResult,
  sanitizeFilePart
} from './shared.js';
import {
  createDefaultChartStyle,
  normalizeChartStyle
} from './plotly/chart-style-model.js';
import { createChartStyleStore } from './plotly/chart-style-store.js';
import { mountChartControls } from './plotly/chart-controls.js';
import { mountChartToolbar } from './plotly/chart-toolbar.js';
import { createAssayPlotlyRenderer } from './plotly/plotly-renderer.js';
import { applyPrismDefaults } from './plotly/prism-theme.js';
import { buildAnalysisChartModel } from './analysis-chart-model.js';
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
import { showTransientNotice } from '../../lib/notify.js';
import { asArray, cloneJson, ensureObject } from '../../lib/normalize.js';
import { createSpreadsheetReferencePicker } from '../../lib/spreadsheet-reference-picker.js';

function compactObject(value = {}) {
  return Object.entries(ensureObject(value)).reduce((out, [key, entryValue]) => {
    if (entryValue === undefined || entryValue === null) {
      return out;
    }
    if (typeof entryValue === 'string' && !entryValue) {
      return out;
    }
    if (Array.isArray(entryValue) && !entryValue.length) {
      return out;
    }
    if (
      entryValue
      && typeof entryValue === 'object'
      && !Array.isArray(entryValue)
      && !Object.keys(entryValue).length
    ) {
      return out;
    }
    out[key] = entryValue;
    return out;
  }, {});
}

function normalizePlotlyFigure(value = {}) {
  const source = ensureObject(value.figure || value.plotly || value);
  return compactObject({
    data: asArray(source.data || source.traces || value.data || value.traces)
      .map((trace) => ensureObject(trace))
      .filter((trace) => Object.keys(trace).length),
    layout: ensureObject(source.layout || value.layout),
    config: ensureObject(source.config || value.config),
    frames: asArray(source.frames || value.frames)
      .map((frame) => ensureObject(frame))
      .filter((frame) => Object.keys(frame).length)
  });
}

function getPlotlyTitle(layout = {}) {
  const title = ensureObject(layout).title;
  if (typeof title === 'string') {
    return title.trim();
  }
  return String(ensureObject(title).text || '').trim();
}

export function normalizeAgentPlotlyGraphArtifact(value = {}) {
  const source = ensureObject(value);
  const graph = ensureObject(source.graph);
  const itemWithFigure = asArray(source.items)
    .map((item) => ensureObject(item))
    .find((item) => Object.keys(ensureObject(item.figure)).length || asArray(item.data).length);
  const graphSource = Object.keys(graph).length ? graph : ensureObject(itemWithFigure);
  const figure = normalizePlotlyFigure(
    source.figure
      || graphSource.figure
      || source.plotly
      || (asArray(source.data).length ? source : null)
      || (asArray(graphSource.data).length ? graphSource : null)
      || {}
  );
  if (!asArray(figure.data).length) {
    return null;
  }
  return compactObject({
    type: 'plotly_graph',
    status: String(source.status || 'completed').trim(),
    id: String(source.id || graphSource.id || '').trim(),
    name: String(source.name || graphSource.name || getPlotlyTitle(figure.layout) || '').trim(),
    summary: String(source.summary || source.result_summary || source.resultSummary || '').trim(),
    source: String(source.source || graphSource.source || '').trim(),
    inspection: cloneJson(source.inspection || graphSource.inspection, null),
    figure: cloneJson(figure, {})
  });
}

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
    assayAnalysisXTransformField,
    assayAnalysisXTransformInput,
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

  // Every analysis ships its own chartModel, which is what "auto" means. The moment a
  // column is overridden that model no longer answers the question, so it has to be
  // rebuilt from the result table -- otherwise the Data tab's selects do nothing.
  function modelForStyle(result, analysis, style) {
    const overridden = MODEL_STYLE_KEYS.some((key) => style?.[key] && style[key] !== 'auto');
    return (!overridden && result.chartModel)
      || buildAnalysisChartModel(result, analysis, style);
  }
  let lastAnalysisContext = {
    headers: [],
    seriesLabels: [],
    method: '',
    chartType: '',
    hasErrorBars: false,
    hasFittedCurve: false
  };
  let agentPlotlyTarget = null;
  let lastResult = null;
  let lastSpec = null;
  let lastModel = null;
  let previewSaveTimer = null;
  let derivedPlate = null;
  let transformFormulas = {};
  let transformGrid = null;
  let transformGridSignature = '';

  if (!runtime.chartStyle || typeof runtime.chartStyle !== 'object') {
    runtime.chartStyle = createDefaultChartStyle();
  } else {
    runtime.chartStyle = normalizeChartStyle(runtime.chartStyle);
  }

  const plotlyRenderer = createAssayPlotlyRenderer();
  const chartStyleStore = createChartStyleStore({
    initialStyle: runtime.chartStyle,
    onChange: (style, previous) => {
      runtime.chartStyle = style;
      if (typeof onChartStyleChanged === 'function') {
        onChartStyleChanged(style);
      }
      redrawForStyleChange(style, previous);
    }
  });
  const chartControls = assayChartStyleMount
    ? mountChartControls(assayChartStyleMount, {
      store: chartStyleStore,
      safeText
    })
    : null;
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
      onFormat: openChartFormat,
      onExport: exportChartImage
    })
    : null;

  function setChartContext(context) {
    chartStyleStore.setContext(context);
    chartControls?.refresh();
  }

  // Every rail section is a fold now, so the toolbar's Format button just reveals the
  // Chart Format panel rather than swapping the rail out from under you.
  function openChartFormat() {
    if (!assayChartFormatPanel) {
      return;
    }
    assayChartFormatPanel.open = true;
    chartControls?.refresh();
    assayChartFormatPanel.scrollIntoView({ block: 'nearest' });
  }

  function setToolbarVisible(visible) {
    if (assayChartToolbarMount) {
      assayChartToolbarMount.hidden = !visible;
    }
  }

  // Rebuilding the controls mid-drag tears out the colour input under the cursor, so
  // only push a new context when something the controls actually render changed.
  function applyChartContext(info) {
    const seriesLabels = Array.isArray(info?.seriesLabels) ? info.seriesLabels : [];
    const next = {
      ...lastAnalysisContext,
      seriesLabels,
      chartType: info?.chartType || '',
      hasErrorBars: Boolean(info?.hasErrorBars),
      hasFittedCurve: Boolean(info?.hasFittedCurve)
    };
    // headers drives the column selects, so it has to be part of the comparison or a
    // new analysis with the same series keeps offering the previous analysis's columns.
    const renderedHeaders = chartStyleStore.getContext().headers;
    const unchanged = next.chartType === lastAnalysisContext.chartType
      && next.hasErrorBars === lastAnalysisContext.hasErrorBars
      && next.hasFittedCurve === lastAnalysisContext.hasFittedCurve
      && seriesLabels.length === lastAnalysisContext.seriesLabels.length
      && seriesLabels.every((label, index) => label === lastAnalysisContext.seriesLabels[index])
      && next.headers.length === renderedHeaders.length
      && next.headers.every((header, index) => header === renderedHeaders[index]);
    lastAnalysisContext = next;
    if (unchanged) {
      chartStyleStore.setContext(lastAnalysisContext);
    } else {
      setChartContext(lastAnalysisContext);
    }
    chartToolbar?.refresh();
  }

  function unmountAnalysisChart() {
    plotlyRenderer.unmount();
  }

  function hasFittedCurve(model) {
    return Boolean(model?.series?.some((series) => Array.isArray(series.markers)));
  }

  // The chart-type override applies to plain category/series models. A fitted curve is
  // a densely sampled line plus its observed markers, so drawing it as bars would be
  // meaningless and the override is ignored (and disabled in the toolbar).
  function applyChartTypeOverride(model, style) {
    if (!model || style.chartType === 'auto' || hasFittedCurve(model)) {
      return model;
    }
    return { ...model, chartType: style.chartType };
  }

  function renderAnalysisChart(model) {
    const target = assayAnalysisTable?.querySelector('[data-assay-analysis-chart]');
    if (!target || !model) {
      setToolbarVisible(false);
      return { seriesLabels: [] };
    }
    const style = chartStyleStore.getStyle();
    const info = plotlyRenderer.render(target, applyChartTypeOverride(model, style), style);
    setToolbarVisible(Boolean(info.seriesLabels?.length));
    return { ...info, hasFittedCurve: hasFittedCurve(model) };
  }

  async function exportChartImage(format) {
    const extension = format === 'svg' ? 'svg' : 'png';
    try {
      const dataUrl = await plotlyRenderer.toImage(extension);
      if (!dataUrl) {
        showTransientNotice('Render a chart before exporting.', { type: 'error' });
        return;
      }
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${sanitizeFilePart(chartStyleStore.getStyle().title, 'assay-chart')}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showTransientNotice(`Exported chart as ${extension.toUpperCase()}.`);
    } catch (error) {
      showTransientNotice(String(error?.message || error || 'Chart export failed.'), { type: 'error' });
    }
  }

  function getChartStyle() {
    return chartStyleStore.getStyle();
  }

  function loadChartStyle(style) {
    chartStyleStore.setStyleSilent(style);
    chartControls?.refresh();
    runtime.chartStyle = chartStyleStore.getStyle();
    return runtime.chartStyle;
  }

  function refreshChartControls() {
    chartControls?.refresh();
  }

  function getPlotlyRuntime() {
    return typeof window !== 'undefined' ? window.Plotly : null;
  }

  function purgeAgentPlotly() {
    const plotly = getPlotlyRuntime();
    if (agentPlotlyTarget && typeof plotly?.purge === 'function') {
      try {
        plotly.purge(agentPlotlyTarget);
      } catch {
        // Plotly purge is best-effort during workspace swaps.
      }
    }
    agentPlotlyTarget = null;
  }

  function getTransformSpec() {
    return normalizeTransformSpec({ mode: 'cells', formulas: transformFormulas });
  }

  function setTransformSummary(text) {
    if (assayTransformSummary) {
      assayTransformSummary.textContent = text;
    }
  }

  function clearTransformGrid() {
    transformGrid?.destroy?.();
    transformGrid = null;
    transformGridSignature = '';
    if (assayDerivedPlateTable) {
      assayDerivedPlateTable.innerHTML = '';
    }
  }

  function transformColumnIndex(field) {
    const parsed = Number(String(field || '').replace(/^c/, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : -1;
  }

  function findTransformFormulaEditor() {
    return assayDerivedPlateTable?.querySelector?.('.tabulator-cell input') || null;
  }

  function qualifiedAddressOfPlateCell(cellElement) {
    const tableRoot = assayResultTable?.contains?.(cellElement)
      ? assayResultTable
      : (assayDerivedPlateTable?.contains?.(cellElement) ? assayDerivedPlateTable : null);
    if (!tableRoot) {
      return '';
    }
    const columnIndex = transformColumnIndex(cellElement.getAttribute?.('tabulator-field'));
    // The row's own frozen label, not its position among the rendered rows: Tabulator
    // renders vertically virtual, so a scrolled plate holds only the visible window and
    // a DOM index would name the wrong well. The label is what wellIdFor would build.
    const rowLabel = String(
      cellElement.closest?.('.tabulator-row')?.querySelector?.('[tabulator-field="rowLabel"]')?.textContent || ''
    ).trim().toUpperCase();
    if (columnIndex < 0 || !/^[A-Z]+$/.test(rowLabel)) {
      return '';
    }
    const tableName = tableRoot === assayResultTable ? 'Table1' : 'Table2';
    return `${tableName}:${rowLabel}${columnIndex + 1}`;
  }

  // The same point-mode controller powers Notebook tables. Assay only supplies its
  // plate-shaped Table1/Table2 address mapping.
  createSpreadsheetReferencePicker({
    roots: [assayResultTable, assayDerivedPlateTable],
    findEditor: findTransformFormulaEditor,
    addressOfCell: ({ cellElement }) => qualifiedAddressOfPlateCell(cellElement)
  });

  function formatTransformCell(_cell, { well, mapped, value }) {
    if (!mapped) {
      return value || '—';
    }
    if (!value) {
      return '';
    }
    const computed = derivedPlate?.cells?.[well];
    const element = document.createElement('span');
    element.className = computed?.error
      ? 'assay-transform-cell assay-transform-cell--error'
      : 'assay-transform-cell assay-transform-cell--formula';
    element.textContent = computed?.error ? '#ERROR' : (computed?.text ?? value);
    element.title = computed?.error ? `${value} — ${computed.error}` : value;
    return element;
  }

  function onTransformGridCellEdited(cell) {
    const columnIndex = transformColumnIndex(cell?.getField?.());
    const rowIndex = Number(cell?.getRow?.()?.getData?.()?.__rowIndex);
    if (columnIndex < 0 || !Number.isFinite(rowIndex) || rowIndex < 0) {
      return;
    }
    const well = wellIdFor(rowIndex, columnIndex);
    const formula = String(cell?.getValue?.() ?? '').trim();
    if (formula) {
      transformFormulas[well] = formula;
    } else {
      delete transformFormulas[well];
    }
    onTransformChange();
  }

  function ensureTransformGrid(def) {
    if (!assayDerivedPlateTable || !isTransformActive(getTransformSpec())) {
      return false;
    }
    if (!TabulatorLib) {
      assayDerivedPlateTable.innerHTML = '<p class="small-note">Spreadsheet component failed to load (Tabulator).</p>';
      return false;
    }
    const signature = buildResultGridSignature(def);
    if (!transformGrid || transformGridSignature !== signature) {
      clearTransformGrid();
      const host = document.createElement('div');
      host.className = 'assay-tabulator assay-transform-grid';
      host.tabIndex = 0;
      host.setAttribute('role', 'grid');
      host.setAttribute('aria-label', 'Transformed assay plate spreadsheet');
      assayDerivedPlateTable.append(host);
      const options = {
        data: buildResultGridData(def, transformFormulas),
        columns: buildResultGridColumns(def, { formatter: formatTransformCell }),
        index: '__rowIndex',
        layout: 'fitDataTable',
        reactiveData: false,
        selectableRange: true,
        selectableRangeColumns: true,
        selectableRangeRows: true
      };
      const height = getResultGridHeight(def);
      if (height) {
        options.height = height;
      }
      transformGrid = new TabulatorLib(host, options);
      transformGrid?.on?.('cellEdited', onTransformGridCellEdited);
      transformGridSignature = signature;
      return true;
    }
    transformGrid.replaceData?.(buildResultGridData(def, transformFormulas));
    return true;
  }

  // Recomputes every formula from the original result grid, then updates the formula
  // table and the numeric map used by analysis.
  function refreshDerivedPlate() {
    const spec = getTransformSpec();
    if (!isTransformActive(spec)) {
      derivedPlate = null;
      if (assayDerivedPlatePanel) assayDerivedPlatePanel.hidden = true;
      clearTransformGrid();
      setTransformSummary('');
      return null;
    }

    const result = applyPlateTransform({
      results: runtime.currentResults,
      spec,
      definition: getCurrentDefinition(),
      rowGroupSpec: String(assayAnalysisRowGroupsInput?.value || ''),
      columnGroupSpec: String(assayAnalysisColumnGroupsInput?.value || '')
    });
    derivedPlate = result;

    setTransformSummary(result.errorCount
      ? `${result.errorCount} formula error(s); hover #ERROR for details.`
      : '');

    if (assayDerivedPlatePanel) {
      assayDerivedPlatePanel.hidden = false;
    }
    ensureTransformGrid(getCurrentDefinition());
    return result;
  }

  function collectNumericObservations() {
    const layoutMap = layoutToMap(runtime.currentLayout);
    // A derived plate replaces the raw values wherever a transform is active; its map
    // is already numeric, so nothing is re-parsed.
    const derived = derivedPlate ? derivedPlate.numericResults : null;
    const observations = [];
    let nonNumericCount = 0;

    Object.entries(derived || runtime.currentResults || {}).forEach(([well, raw]) => {
      const response = derived ? raw : parseNumericResult(raw);
      if (!Number.isFinite(response)) {
        nonNumericCount += 1;
        return;
      }
      const parsedWell = parseWellId(well);
      if (!parsedWell) {
        return;
      }
      const mapping = layoutMap[well] || { sampleId: '', concentration: '' };
      const rawSampleId = String(mapping.sampleId || '').trim();
      const rawConcentration = String(mapping.concentration || '').trim();
      const concentrationLabel = rawConcentration || '-';
      observations.push({
        well,
        response,
        rowIndex: parsedWell.rowIndex,
        rowLabel: toRowLabel(parsedWell.rowIndex),
        columnIndex: parsedWell.columnIndex,
        columnNumber: parsedWell.columnIndex + 1,
        rawSampleId,
        sampleId: rawSampleId || '(unmapped)',
        sampleValue: parseFirstNumericToken(rawSampleId),
        rawConcentration,
        concentrationLabel,
        concentrationValue: parseFirstNumericToken(concentrationLabel)
      });
    });

    return { observations, nonNumericCount };
  }

  function buildAnalysisTable(headers, rows) {
    return `
      <table class="assay-plate-table">
        <thead>
          <tr>${headers.map((item) => `<th>${safeText(String(item))}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              ${row.map((cell) => `<td>${safeText(String(cell ?? '-'))}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function getGroupOptions() {
    const plate = getCurrentDefinition();
    return {
      rowGroups: {
        groupSpec: String(assayAnalysisRowGroupsInput?.value || ''),
        maxMemberCount: plate.rows
      },
      columnGroups: {
        groupSpec: String(assayAnalysisColumnGroupsInput?.value || ''),
        maxMemberCount: plate.columns
      }
    };
  }

  function getAnalysisSpec() {
    return normalizeAnalysisSpec({
      groupBy: assayAnalysisGroupByInput?.value,
      xAxis: assayAnalysisXAxisInput?.value,
      analysis: assayAnalysisKindInput?.value,
      xTransform: assayAnalysisXTransformInput?.value,
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
    toggle(assayAnalysisXTransformField, !isSummary);
    toggle(assayAnalysisSubtotalsField, isSummary);
    toggle(assayAnalysisPolyOrderField, analysis === 'polynomial');
    toggle(assayAnalysisErrorBarsField, isSummary || analysis === 'normalize');
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
    setToolbarVisible(false);
    refreshDerivedPlate();
    lastAnalysisContext = {
      headers: [],
      seriesLabels: [],
      method: '',
      chartType: '',
      hasErrorBars: false,
      hasFittedCurve: false
    };
    setChartContext(lastAnalysisContext);
  }

  function emitAnalysisRendered() {
    if (typeof onAnalysisRendered !== 'function' || !lastResult || !lastSpec) {
      return;
    }
    onAnalysisRendered({
      method: lastSpec.analysis,
      spec: { ...lastSpec },
      methodLabel: describeAnalysisSpec(lastSpec),
      summary: assayAnalysisSummary?.textContent || '',
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
      return;
    }

    const result = analyzeAssayData({ spec, observations, options: getGroupOptions() });
    lastResult = result;
    lastSpec = spec;
    lastModel = null;

    lastAnalysisContext = {
      ...lastAnalysisContext,
      headers: Array.isArray(result?.headers) ? result.headers.map(String) : [],
      seriesLabels: [],
      method: spec.analysis
    };

    const ignoredNote = nonNumericCount ? ` Non-numeric cells ignored: ${nonNumericCount}.` : '';
    const rowCountNote = ` Rows: ${result.rows.length}.`;
    assayAnalysisSummary.textContent = `${result.summary}${rowCountNote}${ignoredNote}`;
    if (!result.rows.length) {
      assayAnalysisTable.innerHTML = '<p class="small-note">No analyzable rows for this analysis.</p>';
      setChartContext(lastAnalysisContext);
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

  function renderAgentPlotlyGraph(artifact = {}) {
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return false;
    }
    const normalized = normalizeAgentPlotlyGraphArtifact(artifact);
    if (!normalized?.figure?.data?.length) {
      return false;
    }
    const plotly = getPlotlyRuntime();
    if (typeof plotly?.newPlot !== 'function') {
      assayAnalysisSummary.textContent = 'Plotly is unavailable, so the agent graph could not be rendered.';
      showTransientNotice('Plotly is unavailable, so the agent graph could not be rendered.', { type: 'error' });
      assayAnalysisTable.innerHTML = '<p class="small-note">Plotly is unavailable in this workspace.</p>';
      return false;
    }

    unmountAnalysisChart();
    purgeAgentPlotly();
    const traceNames = normalized.figure.data
      .map((trace, index) => String(trace?.name || `Trace ${index + 1}`).trim())
      .filter(Boolean);
    const title = normalized.name || getPlotlyTitle(normalized.figure.layout);
    const issueCount = asArray(normalized.inspection?.issues).length;
    const issueNote = issueCount ? ` Inspection issues: ${issueCount}.` : '';
    const graphLabel = title ? `Agent Plotly graph: ${title}` : 'Agent Plotly graph';
    const summary = normalized.summary || `${graphLabel} rendered.`;
    assayAnalysisSummary.textContent = `${summary}${issueNote}`;
    assayAnalysisTable.innerHTML = `
      <div class="assay-analysis-results assay-analysis-agent-results" data-assay-agent-plotly-output>
        <div class="assay-analysis-agent-note">
          ${safeText(graphLabel)}${normalized.id ? ` <span>${safeText(`ID ${normalized.id}`)}</span>` : ''}
        </div>
        <div class="assay-analysis-chart assay-analysis-agent-chart" data-assay-agent-plotly-chart></div>
      </div>
    `;
    agentPlotlyTarget = assayAnalysisTable.querySelector('[data-assay-agent-plotly-chart]');
    if (!agentPlotlyTarget) {
      return false;
    }

    // Agent figures get the same Prism defaults as the built-in charts; anything the
    // agent stated itself (colours, gridlines, its own frame) still wins.
    const themed = applyPrismDefaults(normalized.figure, getChartStyle());
    const layout = {
      autosize: true,
      height: Number(themed.layout?.height) || 360,
      margin: {
        l: 56,
        r: 24,
        t: 56,
        b: 52,
        ...ensureObject(themed.layout?.margin)
      },
      ...ensureObject(themed.layout)
    };
    const config = {
      responsive: true,
      displayModeBar: true,
      ...ensureObject(themed.config)
    };
    try {
      const renderResult = plotly.newPlot(
        agentPlotlyTarget,
        themed.data,
        layout,
        config
      );
      if (renderResult && typeof renderResult.then === 'function') {
        renderResult.catch((error) => {
          assayAnalysisSummary.textContent = String(error?.message || error || 'Unable to render Plotly graph.');
          showTransientNotice(assayAnalysisSummary.textContent, { type: 'error' });
        });
      }
      lastAnalysisContext = {
        headers: [],
        seriesLabels: traceNames,
        method: 'agent_plotly',
        chartType: '',
        hasErrorBars: false,
        hasFittedCurve: false
      };
      setChartContext(lastAnalysisContext);
      return true;
    } catch (error) {
      assayAnalysisSummary.textContent = String(error?.message || error || 'Unable to render Plotly graph.');
          showTransientNotice(assayAnalysisSummary.textContent, { type: 'error' });
      return false;
    }
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
    transformFormulas = {};
    if (normalized.mode === 'cells') {
      transformFormulas = { ...normalized.formulas };
    } else if (normalized.mode === 'formula' && normalized.formula.trim()) {
      Object.entries(runtime.currentResults || {}).forEach(([well, raw]) => {
        if (Number.isFinite(parseNumericResult(raw)) && isValidWellForDefinition(well, getCurrentDefinition())) {
          transformFormulas[well] = normalized.formula;
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
        transformFormulas[well] = `=${value}`;
      });
    }
    refreshDerivedPlate();
    return getTransformSpec();
  }

  function createTransformPlate() {
    syncCurrentResultsFromGrid();
    if (!Object.keys(transformFormulas).length) {
      Object.entries(runtime.currentResults || {}).forEach(([well, raw]) => {
        if (Number.isFinite(parseNumericResult(raw)) && isValidWellForDefinition(well, getCurrentDefinition())) {
          transformFormulas[well] = `=Table1:${well}`;
        }
      });
    }
    if (!Object.keys(transformFormulas).length) {
      setTransformSummary('Add at least one numeric result before creating a transformed plate.');
      return false;
    }
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
    transformFormulas = {};
    onTransformChange();
  }

  function redrawTransformGrid() {
    transformGrid?.redraw?.(true);
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
