import { analyzeAssayData } from './analysis/index.js';
import {
  layoutToMap,
  parseWellId,
  toRowLabel
} from './plate-model.js';
import {
  parseFirstNumericToken,
  parseNumericResult
} from './shared.js';
import {
  createChartEngine,
  createDefaultChartStyle,
  normalizeChartStyle
} from '../../lib/chart-engine/index.js';
import { buildAnalysisChartModel } from './analysis-chart-renderer.js';

export {
  CHART_STYLE_OPTIONS,
  createDefaultChartStyle,
  normalizeChartStyle
} from '../../lib/chart-engine/index.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

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
  getCurrentDefinition,
  syncCurrentResultsFromGrid,
  getResultValueCount,
  onAnalysisRendered,
  onChartStyleChanged
}) {
  const {
    assayAnalysisColumnGroupsInput,
    assayAnalysisErrorBarsInput,
    assayAnalysisMethodInput,
    assayAnalysisSummary,
    assayAnalysisRowGroupsInput,
    assayAnalysisTable,
    assayChartStyleMount
  } = elements;
  const hasPlotly = typeof window !== 'undefined' && Boolean(window.Plotly);
  let lastAnalysisContext = {
    headers: [],
    seriesLabels: [],
    method: ''
  };
  let agentPlotlyTarget = null;

  if (!runtime.chartStyle || typeof runtime.chartStyle !== 'object') {
    runtime.chartStyle = createDefaultChartStyle();
  } else {
    runtime.chartStyle = normalizeChartStyle(runtime.chartStyle);
  }

  const chartEngine = createChartEngine({
    getChartTarget: () => assayAnalysisTable?.querySelector('[data-assay-analysis-chart]'),
    controlsTarget: assayChartStyleMount,
    initialStyle: runtime.chartStyle,
    safeText,
    onChange: (style) => {
      runtime.chartStyle = style;
      if (typeof onChartStyleChanged === 'function') {
        onChartStyleChanged(style);
      }
      onAnalysisConfigChange();
    }
  });

  function getChartStyle() {
    return chartEngine.getStyle();
  }

  function loadChartStyle(style) {
    runtime.chartStyle = chartEngine.loadStyle(style);
    return runtime.chartStyle;
  }

  function refreshChartControls() {
    chartEngine.refreshControls();
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

  function collectNumericObservations() {
    const layoutMap = layoutToMap(runtime.currentLayout);
    const observations = [];
    let nonNumericCount = 0;

    Object.entries(runtime.currentResults || {}).forEach(([well, raw]) => {
      const response = parseNumericResult(raw);
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

  function getDimensionAnalysisOptions(dimension) {
    const plate = getCurrentDefinition();
    const maxMemberCount = dimension === 'row' ? plate.rows : plate.columns;
    const groupSpec = dimension === 'row'
      ? assayAnalysisRowGroupsInput?.value
      : assayAnalysisColumnGroupsInput?.value;
    return {
      groupSpec: String(groupSpec || ''),
      maxMemberCount,
      includeErrorBars: Boolean(assayAnalysisErrorBarsInput?.checked)
    };
  }

  function clearOutput() {
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
    chartEngine.unmount();
    purgeAgentPlotly();
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
    lastAnalysisContext = { headers: [], seriesLabels: [], method: '' };
    chartEngine.setContext(lastAnalysisContext);
  }

  function renderAnalysis() {
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }

    chartEngine.unmount();
    purgeAgentPlotly();
    syncCurrentResultsFromGrid();
    const method = String(assayAnalysisMethodInput?.value || 'grouped_summary');
    const { observations, nonNumericCount } = collectNumericObservations();
    if (!observations.length) {
      assayAnalysisSummary.textContent = nonNumericCount
        ? `No numeric values found. Non-numeric result cells: ${nonNumericCount}.`
        : 'No result values to analyze.';
      assayAnalysisTable.innerHTML = '';
      return;
    }

    const result = analyzeAssayData({
      method,
      observations,
      options: {
        rowSummary: getDimensionAnalysisOptions('row'),
        columnSummary: getDimensionAnalysisOptions('column')
      }
    });

    lastAnalysisContext = {
      headers: Array.isArray(result?.headers) ? result.headers.map(String) : [],
      seriesLabels: [],
      method
    };

    const ignoredNote = nonNumericCount ? ` Non-numeric cells ignored: ${nonNumericCount}.` : '';
    const rowCountNote = ` Rows: ${result.rows.length}.`;
    assayAnalysisSummary.textContent = `${result.summary}${rowCountNote}${ignoredNote}`;
    if (!result.rows.length) {
      assayAnalysisTable.innerHTML = '<p class="small-note">No analyzable rows for this method.</p>';
      onAnalysisRendered?.({
        method,
        summary: assayAnalysisSummary.textContent,
        headers: Array.isArray(result.headers) ? result.headers.map((item) => String(item)) : [],
        rows: Array.isArray(result.rows) ? result.rows : [],
        chartDataUrl: '',
        analyzedAt: new Date().toISOString()
      });
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
    const model = result.chartModel || buildAnalysisChartModel(result, method, chartEngine.getStyle());
    chartEngine.setData(model);
    const chartInfo = chartEngine.render();
    lastAnalysisContext = {
      ...lastAnalysisContext,
      seriesLabels: chartInfo.seriesLabels
    };
    chartEngine.setContext(lastAnalysisContext);
    onAnalysisRendered?.({
      method,
      summary: assayAnalysisSummary.textContent,
      headers: Array.isArray(result.headers) ? result.headers.map((item) => String(item)) : [],
      rows: Array.isArray(result.rows) ? result.rows : [],
      chartDataUrl: chartEngine.toDataUrl(),
      analyzedAt: new Date().toISOString()
    });
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
      assayAnalysisTable.innerHTML = '<p class="small-note">Plotly is unavailable in this workspace.</p>';
      return false;
    }

    chartEngine.unmount();
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

    const layout = {
      autosize: true,
      height: Number(normalized.figure.layout?.height) || 360,
      margin: {
        l: 56,
        r: 24,
        t: 56,
        b: 52,
        ...ensureObject(normalized.figure.layout?.margin)
      },
      ...ensureObject(normalized.figure.layout)
    };
    const config = {
      responsive: true,
      displayModeBar: true,
      ...ensureObject(normalized.figure.config)
    };
    try {
      const renderResult = plotly.newPlot(
        agentPlotlyTarget,
        normalized.figure.data,
        layout,
        config
      );
      if (renderResult && typeof renderResult.then === 'function') {
        renderResult.catch((error) => {
          assayAnalysisSummary.textContent = String(error?.message || error || 'Unable to render Plotly graph.');
        });
      }
      lastAnalysisContext = {
        headers: [],
        seriesLabels: traceNames,
        method: 'agent_plotly'
      };
      chartEngine.setContext(lastAnalysisContext);
      return true;
    } catch (error) {
      assayAnalysisSummary.textContent = String(error?.message || error || 'Unable to render Plotly graph.');
      return false;
    }
  }

  function onAnalysisMethodChange() {
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }
    clearOutput();
    syncCurrentResultsFromGrid();
    if (getResultValueCount()) {
      renderAnalysis();
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

  function onAnalyzeResults() {
    renderAnalysis();
  }

  return {
    clearOutput,
    renderAnalysis,
    onAnalysisMethodChange,
    onAnalysisConfigChange,
    onAnalyzeResults,
    getChartStyle,
    loadChartStyle,
    refreshChartControls,
    renderAgentPlotlyGraph,
    destroy: () => chartEngine.destroy()
  };
}
