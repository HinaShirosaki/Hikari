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
      chartDataUrl: chartEngine.toDataUrl(),
      analyzedAt: new Date().toISOString()
    });
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
    destroy: () => chartEngine.destroy()
  };
}
