import { analyzeAssayData } from './analysis/index.js';
import { summarizeNumeric } from './analysis/shared.js';
import {
  layoutToMap,
  parseWellId,
  toRowLabel
} from './plate-model.js';
import {
  parseFirstNumericToken,
  parseNumericResult
} from './shared.js';

export function createAssayAnalysisView({
  runtime,
  elements,
  ReactLib,
  ReactDOMLib,
  ReactVisLib,
  safeText,
  getCurrentDefinition,
  syncCurrentResultsFromGrid,
  getResultValueCount
}) {
  const {
    assayAnalysisColumnGroupsInput,
    assayAnalysisErrorBarsInput,
    assayAnalysisMethodInput,
    assayAnalysisSummary,
    assayAnalysisRowGroupsInput,
    assayAnalysisTable
  } = elements;
  const hasReactVis = Boolean(ReactLib && ReactDOMLib && ReactVisLib);
  let analysisChartHost = null;

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

  function unmountAnalysisChart() {
    if (analysisChartHost && ReactDOMLib?.unmountComponentAtNode) {
      ReactDOMLib.unmountComponentAtNode(analysisChartHost);
    }
    analysisChartHost = null;
  }

  function parseAnalysisCellNumber(value) {
    return parseFirstNumericToken(value);
  }

  function pickChartMetricIndex(method, headers, numericIndexes) {
    const methodPriority = {
      grouped_summary: ['mean'],
      nested_summary: ['mean'],
      row_summary: ['mean'],
      column_summary: ['mean'],
      linear_regression: ['r²', 'r2', 'intercept', 'points'],
      ec50: ['ec50'],
      ic50: ['ic50'],
      survival: ['survival', 'mean'],
      standard_curve_line: ['r²', 'rmse'],
      standard_curve_4pl_log_concentration: ['r²', 'rmse'],
      standard_curve_4pl_concentration: ['r²', 'rmse'],
      standard_curve_5pl_log_concentration: ['r²', 'rmse'],
      standard_curve_5pl_concentration: ['r²', 'rmse'],
      standard_curve_semilog_line: ['r²', 'rmse'],
      standard_curve_hyperbola: ['r²', 'rmse'],
      standard_curve_quadratic: ['r²', 'rmse'],
      standard_curve_cubic: ['r²', 'rmse'],
      standard_curve_pade_11: ['r²', 'rmse']
    };
    const priorities = methodPriority[method] || ['mean', 'value'];
    for (let keywordIndex = 0; keywordIndex < priorities.length; keywordIndex += 1) {
      const keyword = priorities[keywordIndex];
      const match = numericIndexes.find((index) => String(headers[index] || '').toLowerCase().includes(keyword));
      if (Number.isInteger(match)) {
        return match;
      }
    }
    return numericIndexes[0];
  }

  function buildAnalysisChartModel(result, method) {
    const headers = Array.isArray(result?.headers) ? result.headers : [];
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    if (!headers.length || !rows.length) {
      return null;
    }

    const numericIndexes = headers
      .map((_, index) => index)
      .filter((index) => rows.some((row) => Number.isFinite(parseAnalysisCellNumber(row[index]))));
    if (!numericIndexes.length) {
      return null;
    }

    const yIndex = pickChartMetricIndex(method, headers, numericIndexes);
    const otherNumeric = numericIndexes.filter((index) => index !== yIndex);
    const nonNumericIndexes = headers
      .map((_, index) => index)
      .filter((index) => !numericIndexes.includes(index));
    const xIndex = nonNumericIndexes[0] ?? otherNumeric[0] ?? null;
    const seriesIndex = nonNumericIndexes.find((index) => index !== xIndex) ?? null;
    const seriesMap = new Map();
    let numericXCount = 0;
    let totalCount = 0;

    rows.forEach((row, rowIndex) => {
      const y = parseAnalysisCellNumber(row[yIndex]);
      if (!Number.isFinite(y)) {
        return;
      }
      const rawX = xIndex === null ? rowIndex + 1 : row[xIndex];
      const xLabel = String(rawX ?? '').trim() || `Row ${rowIndex + 1}`;
      const xNumeric = parseAnalysisCellNumber(rawX);
      if (Number.isFinite(xNumeric)) {
        numericXCount += 1;
      }
      const seriesLabel = seriesIndex === null
        ? 'Series'
        : (String(row[seriesIndex] ?? '').trim() || 'Series');
      if (!seriesMap.has(seriesLabel)) {
        seriesMap.set(seriesLabel, []);
      }
      seriesMap.get(seriesLabel).push({ xLabel, xNumeric, y });
      totalCount += 1;
    });

    if (!totalCount || !seriesMap.size) {
      return null;
    }

    const numericXAxis = numericXCount / totalCount >= 0.75;
    const prefersLineMethod = method === 'linear_regression'
      || method === 'ec50'
      || method === 'ic50'
      || method === 'survival'
      || method === 'standard_curve_line'
      || method === 'standard_curve_4pl_log_concentration'
      || method === 'standard_curve_4pl_concentration'
      || method === 'standard_curve_5pl_log_concentration'
      || method === 'standard_curve_5pl_concentration'
      || method === 'standard_curve_semilog_line'
      || method === 'standard_curve_hyperbola'
      || method === 'standard_curve_quadratic'
      || method === 'standard_curve_cubic'
      || method === 'standard_curve_pade_11';
    const chartType = numericXAxis && prefersLineMethod ? 'line' : 'bar';

    if (chartType === 'line') {
      const series = Array.from(seriesMap.entries())
        .map(([label, points]) => {
          const xBuckets = new Map();
          points.forEach((point) => {
            if (!Number.isFinite(point.xNumeric)) {
              return;
            }
            if (!xBuckets.has(point.xNumeric)) {
              xBuckets.set(point.xNumeric, []);
            }
            xBuckets.get(point.xNumeric).push(point.y);
          });
          const data = Array.from(xBuckets.entries())
            .map(([x, values]) => {
              const stats = summarizeNumeric(values);
              return stats ? { x: Number(x), y: stats.mean } : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.x - b.x);
          return { label, data };
        })
        .filter((item) => item.data.length);

      if (!series.length) {
        return null;
      }

      return {
        chartType,
        xLabel: xIndex === null ? 'Row' : String(headers[xIndex] || 'X'),
        yLabel: String(headers[yIndex] || 'Y'),
        series
      };
    }

    const categories = [];
    const categorySet = new Set();
    seriesMap.forEach((points) => {
      points.forEach((point) => {
        if (!categorySet.has(point.xLabel)) {
          categorySet.add(point.xLabel);
          categories.push(point.xLabel);
        }
      });
    });

    const series = Array.from(seriesMap.entries())
      .map(([label, points]) => {
        const categoryValues = new Map();
        points.forEach((point) => {
          if (!categoryValues.has(point.xLabel)) {
            categoryValues.set(point.xLabel, []);
          }
          categoryValues.get(point.xLabel).push(point.y);
        });
        const data = categories
          .map((category) => {
            const values = categoryValues.get(category) || [];
            const stats = summarizeNumeric(values);
            return stats ? { x: category, y: stats.mean } : null;
          })
          .filter(Boolean);
        return { label, data };
      })
      .filter((item) => item.data.length);

    if (!series.length) {
      return null;
    }

    return {
      chartType,
      xLabel: xIndex === null ? 'Row' : String(headers[xIndex] || 'Group'),
      yLabel: String(headers[yIndex] || 'Value'),
      series
    };
  }

  function renderAnalysisChart(result, method) {
    unmountAnalysisChart();
    if (!hasReactVis || !assayAnalysisTable) {
      return;
    }

    const chartModel = result?.chartModel || buildAnalysisChartModel(result, method);
    const chartTarget = assayAnalysisTable.querySelector('[data-assay-analysis-chart]');
    if (!chartModel || !chartTarget) {
      return;
    }

    const {
      XYPlot,
      XAxis,
      YAxis,
      VerticalGridLines,
      HorizontalGridLines,
      VerticalBarSeries,
      LineSeries,
      MarkSeries,
      WhiskerSeries,
      DiscreteColorLegend
    } = ReactVisLib;
    if (!XYPlot || !XAxis || !YAxis || !VerticalGridLines || !HorizontalGridLines) {
      return;
    }

    const palette = ['#1f77b4', '#ef6c3e', '#2ca25f', '#9467bd', '#d4a72c', '#8c564b'];
    const longestSeries = chartModel.series.reduce((max, item) => Math.max(max, item.data.length), 0);
    const plotWidth = Math.max(420, Math.min(1280, (longestSeries || 1) * (chartModel.chartType === 'line' ? 60 : 70)));
    const plotHeight = 280;
    const marginBottom = chartModel.chartType === 'bar' ? 108 : 72;
    const plotProps = {
      width: plotWidth,
      height: plotHeight,
      margin: { left: 72, right: 24, top: 20, bottom: marginBottom }
    };
    if (chartModel.chartType === 'bar') {
      plotProps.xType = 'ordinal';
    }

    const plotChildren = [
      ReactLib.createElement(VerticalGridLines, { key: 'v-grid' }),
      ReactLib.createElement(HorizontalGridLines, { key: 'h-grid' }),
      ReactLib.createElement(XAxis, {
        key: 'x-axis',
        title: chartModel.xLabel,
        tickLabelAngle: chartModel.chartType === 'bar' ? -35 : 0
      }),
      ReactLib.createElement(YAxis, {
        key: 'y-axis',
        title: chartModel.yLabel
      })
    ];

    chartModel.series.forEach((series, index) => {
      const color = palette[index % palette.length];
      if (chartModel.chartType === 'line') {
        if (LineSeries) {
          plotChildren.push(ReactLib.createElement(LineSeries, {
            key: `line-${series.label}-${index}`,
            data: series.data,
            color,
            curve: 'curveMonotoneX'
          }));
        }
        if (MarkSeries) {
          plotChildren.push(ReactLib.createElement(MarkSeries, {
            key: `mark-${series.label}-${index}`,
            data: series.data,
            color,
            size: 3
          }));
        }
      } else if (VerticalBarSeries) {
        plotChildren.push(ReactLib.createElement(VerticalBarSeries, {
          key: `bar-${series.label}-${index}`,
          data: series.data,
          color,
          cluster: 'assay-analysis'
        }));
      }

      if (chartModel.showErrorBars && WhiskerSeries) {
        const whiskerData = series.data.filter((point) => Number.isFinite(point.yVariance) && point.yVariance > 0);
        if (whiskerData.length) {
          plotChildren.push(ReactLib.createElement(WhiskerSeries, {
            key: `whisker-${series.label}-${index}`,
            data: whiskerData,
            color,
            strokeWidth: 1.2,
            crossBarWidth: 8,
            style: { pointerEvents: 'none' }
          }));
        }
      }
    });

    const legendItems = chartModel.series.map((series, index) => ({
      title: series.label,
      color: palette[index % palette.length]
    }));
    const legendElement = DiscreteColorLegend && legendItems.length > 1
      ? ReactLib.createElement(DiscreteColorLegend, {
        key: 'legend',
        orientation: 'horizontal',
        items: legendItems
      })
      : null;
    const titleText = `${chartModel.yLabel} by ${chartModel.xLabel}`;

    const chartElement = ReactLib.createElement('div', null, [
      ReactLib.createElement('div', { className: 'assay-analysis-chart-head', key: 'head' }, [
        ReactLib.createElement('div', { className: 'assay-analysis-chart-title', key: 'title' }, titleText),
        legendElement
      ]),
      ReactLib.createElement('div', { className: 'assay-analysis-chart-plot', key: 'plot' }, [
        ReactLib.createElement(XYPlot, { ...plotProps, key: 'xy-plot' }, plotChildren)
      ])
    ]);

    ReactDOMLib.render(chartElement, chartTarget);
    analysisChartHost = chartTarget;
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
    unmountAnalysisChart();
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
  }

  function renderAnalysis() {
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }

    unmountAnalysisChart();
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

    const ignoredNote = nonNumericCount ? ` Non-numeric cells ignored: ${nonNumericCount}.` : '';
    const rowCountNote = ` Rows: ${result.rows.length}.`;
    assayAnalysisSummary.textContent = `${result.summary}${rowCountNote}${ignoredNote}`;
    if (!result.rows.length) {
      assayAnalysisTable.innerHTML = '<p class="small-note">No analyzable rows for this method.</p>';
      return;
    }

    const tableHtml = buildAnalysisTable(result.headers, result.rows);
    assayAnalysisTable.innerHTML = hasReactVis
      ? `
        <div class="assay-analysis-results">
          <div class="assay-analysis-chart" data-assay-analysis-chart></div>
          ${tableHtml}
        </div>
      `
      : tableHtml;
    renderAnalysisChart(result, method);
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
    onAnalyzeResults
  };
}
