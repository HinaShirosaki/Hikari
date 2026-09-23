import { sanitizeFilePart } from '../shared.js';
import { applyFigureDefaults } from '../plotly/figure-theme.js';
import { showTransientNotice } from '../../../lib/notify.js';
import { asArray, ensureObject } from '../../../lib/normalize.js';
import { getPlotlyTitle, normalizeAgentPlotlyGraphArtifact } from './plotly-artifact.js';
import { normalizePlotElements } from '../../../../shared/assay-plot.mjs';
import { buildPlotElements, plotElementEditPatch, validatePlotElementAxes } from '../plotly/plot-elements.js';

// Owns the Plotly surface: the analysis chart, the agent-supplied graph that can
// replace it, and the context the style store and controls read.
function createChartSurface({
  safeText,
  runtime,
  chartStyleStore,
  chartControls,
  plotlyRenderer,
  assayAnalysisTable,
  assayChartFormatPanel
} = {}) {
  let lastAnalysisContext = {
    headers: [],
    numericHeaders: [],
    seriesLabels: [],
    method: '',
    chartType: '',
    hasErrorBars: false,
    hasFittedCurve: false
  };
  let agentPlotlyTarget = null;
  let agentElements = [];
  let agentReady = Promise.resolve();
  let elementQueue = Promise.resolve();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function getAgentElementStyle() {
    const layout = agentPlotlyTarget?.layout || {};
    return { plotElements: clone(agentElements), xScale: layout.xaxis?.type === 'log' ? 'log10' : 'linear',
      yScale: layout.yaxis?.type === 'log' ? 'log10' : 'linear' };
  }
  function updateAgentElements(input) {
    const target = agentPlotlyTarget;
    const next = normalizePlotElements(input);
    const job = elementQueue.then(async () => {
      await agentReady;
      if (!target || target !== agentPlotlyTarget) throw new Error('The active plot changed.');
      const axes = { x: target._fullLayout?.xaxis || target.layout?.xaxis || {}, y: target._fullLayout?.yaxis || target.layout?.yaxis || {} };
      validatePlotElementAxes(next, axes);
      const previousNames = new Set(agentElements.map((item) => `assay-element-${item.id}`));
      const annotations = clone(target.layout?.annotations || []).filter((item) => !previousNames.has(item.name));
      const shapes = clone(target.layout?.shapes || []).filter((item) => !previousNames.has(item.name));
      const extra = buildPlotElements(next, axes);
      await getPlotlyRuntime().relayout(target, { annotations: [...annotations, ...extra.annotations], shapes: [...shapes, ...extra.shapes] });
      if (target !== agentPlotlyTarget) return;
      agentElements = next;
      chartControls?.refresh();
    });
    elementQueue = job.catch(() => {});
    return job;
  }

  function setChartContext(context) {
    chartStyleStore.setContext(context);
    chartControls?.refresh();
  }

  // Keep a programmatic entry point for callers that need to reveal the existing
  // Chart Format rail section without replacing the rail.
  function openChartFormat() {
    if (!assayChartFormatPanel) {
      return;
    }
    assayChartFormatPanel.open = true;
    chartControls?.refresh();
    assayChartFormatPanel.scrollIntoView({ block: 'nearest' });
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
      hasCategoryX: Boolean(info?.hasCategoryX),
      hasReplicates: Boolean(info?.hasReplicates),
      hasFittedCurve: Boolean(info?.hasFittedCurve)
    };
    // headers drives the column selects, so it has to be part of the comparison or a
    // new analysis with the same series keeps offering the previous analysis's columns.
    const renderedHeaders = chartStyleStore.getContext().headers;
    const unchanged = next.chartType === lastAnalysisContext.chartType
      && next.hasErrorBars === lastAnalysisContext.hasErrorBars
      && next.hasCategoryX === lastAnalysisContext.hasCategoryX
      && next.hasReplicates === lastAnalysisContext.hasReplicates
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
  }

  function unmountAnalysisChart() {
    plotlyRenderer.unmount();
  }

  function hasFittedCurve(model) {
    return Boolean(model?.series?.some((series) => Array.isArray(series.markers)));
  }

  // The chart-type override applies to plain category/series models. A fitted curve is
  // a densely sampled line plus its observed markers, so drawing it as bars would be
  // meaningless and the override is ignored (and disabled in the Data Series tab).
  function applyChartTypeOverride(model, style) {
    if (!model || style.chartType === 'auto' || hasFittedCurve(model)) {
      return model;
    }
    return { ...model, chartType: style.chartType };
  }

  function renderAnalysisChart(model) {
    const target = assayAnalysisTable?.querySelector('[data-assay-analysis-chart]');
    if (!target || !model) {
      return { seriesLabels: [] };
    }
    const style = chartStyleStore.getStyle();
    const info = plotlyRenderer.render(target, applyChartTypeOverride(model, style), style);
    return { ...info, hasFittedCurve: hasFittedCurve(model) };
  }

  async function exportChartImage(format) {
    const extension = format === 'svg' ? 'svg' : 'png';
    try {
      const dataUrl = agentPlotlyTarget
        ? await getPlotlyRuntime().toImage(agentPlotlyTarget, { format: extension, scale: extension === 'svg' ? 1 : 2 })
        : await plotlyRenderer.toImage(extension);
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
    agentElements = [];
    if (lastAnalysisContext.method === 'agent_plotly') {
      lastAnalysisContext = { ...lastAnalysisContext, method: '' };
      setChartContext(lastAnalysisContext);
    }
  }

  function renderAgentPlotlyGraph(artifact = {}) {
    if (!assayAnalysisTable) {
      return false;
    }
    const normalized = normalizeAgentPlotlyGraphArtifact(artifact);
    if (!normalized?.figure?.data?.length) {
      return false;
    }
    const plotly = getPlotlyRuntime();
    if (typeof plotly?.newPlot !== 'function') {
      purgeAgentPlotly();
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
    const graphLabel = title ? `Agent Plotly graph: ${title}` : 'Agent Plotly graph';
    // The graph's own caption carries the inspection count; nothing is written to
    // the controls rail.
    assayAnalysisTable.innerHTML = `
      <div class="assay-analysis-results assay-analysis-agent-results" data-assay-agent-plotly-output>
        <div class="assay-analysis-agent-note">
          ${safeText(graphLabel)}${normalized.id ? ` <span>${safeText(`ID ${normalized.id}`)}</span>` : ''}${issueCount ? ` <span>${safeText(`Inspection issues: ${issueCount}`)}</span>` : ''}
        </div>
        <div class="assay-analysis-chart assay-analysis-agent-chart" data-assay-agent-plotly-chart></div>
      </div>
    `;
    agentPlotlyTarget = assayAnalysisTable.querySelector('[data-assay-agent-plotly-chart]');
    if (!agentPlotlyTarget) {
      return false;
    }

    // Agent figures get the same Figure defaults as the built-in charts; anything the
    // agent stated itself (colours, gridlines, its own frame) still wins.
    const themed = applyFigureDefaults(normalized.figure, getChartStyle());
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
      ...ensureObject(themed.config),
      edits: { ...ensureObject(themed.config?.edits), annotationPosition: true, annotationText: true }
    };
    try {
      const renderResult = plotly.newPlot(
        agentPlotlyTarget,
        themed.data,
        layout,
        config
      );
      const target = agentPlotlyTarget;
      agentReady = Promise.resolve(renderResult).then(() => {
        if (target !== agentPlotlyTarget) return;
        lastAnalysisContext.hasCategoryX = target._fullLayout?.xaxis?.type === 'category';
        setChartContext(lastAnalysisContext);
        target.on?.('plotly_relayout', (event) => {
          if (target !== agentPlotlyTarget) return;
          const patch = plotElementEditPatch(event, target.layout.annotations || [], agentElements,
            { x: target._fullLayout?.xaxis || {}, y: target._fullLayout?.yaxis || {} });
          if (patch.plotElements) { agentElements = patch.plotElements; chartControls?.refresh(); }
        });
      });
      agentReady.catch((error) => {
          if (target !== agentPlotlyTarget) return;
          purgeAgentPlotly();
          lastAnalysisContext = { ...lastAnalysisContext, method: '' };
          setChartContext(lastAnalysisContext);
          showTransientNotice(String(error?.message || error || 'Unable to render Plotly graph.'), { type: 'error' });
        });
      lastAnalysisContext = {
        headers: [],
        numericHeaders: [],
        seriesLabels: traceNames,
        method: 'agent_plotly',
        chartType: '',
        hasErrorBars: false,
        hasFittedCurve: false
      };
      setChartContext(lastAnalysisContext);
      return true;
    } catch (error) {
      purgeAgentPlotly();
      lastAnalysisContext = { ...lastAnalysisContext, method: '' };
      setChartContext(lastAnalysisContext);
      showTransientNotice(String(error?.message || error || 'Unable to render Plotly graph.'), { type: 'error' });
      return false;
    }
  }

  return {
    getAgentElementStyle,
    updateAgentElements,
    getAnalysisContext: () => lastAnalysisContext,
    setAnalysisContext(next) {
      lastAnalysisContext = next;
      setChartContext(lastAnalysisContext);
      return lastAnalysisContext;
    },
    setChartContext,
    openChartFormat,
    applyChartContext,
    unmountAnalysisChart,
    hasFittedCurve,
    applyChartTypeOverride,
    renderAnalysisChart,
    exportChartImage,
    getChartStyle,
    loadChartStyle,
    refreshChartControls,
    getPlotlyRuntime,
    purgeAgentPlotly,
    renderAgentPlotlyGraph
  };
}

export { createChartSurface };
