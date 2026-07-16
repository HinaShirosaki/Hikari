import { summarizeNumeric } from './analysis/shared.js';
import { parseFirstNumericToken } from './shared.js';

// Turns an Assay analysis table into the compact model consumed by the local
// Plotly renderer.

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
    standard_curve_line: ['r²', 'r2', 'rmse'],
    standard_curve_4pl_log_concentration: ['r²', 'r2', 'rmse'],
    standard_curve_4pl_concentration: ['r²', 'r2', 'rmse'],
    standard_curve_5pl_log_concentration: ['r²', 'r2', 'rmse'],
    standard_curve_5pl_concentration: ['r²', 'r2', 'rmse'],
    standard_curve_semilog_line: ['r²', 'r2', 'rmse'],
    standard_curve_hyperbola: ['r²', 'r2', 'rmse'],
    standard_curve_quadratic: ['r²', 'r2', 'rmse'],
    standard_curve_cubic: ['r²', 'r2', 'rmse'],
    standard_curve_pade_11: ['r²', 'r2', 'rmse']
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

function resolveColumnIndex(headers, override, fallbackIndex) {
  if (typeof override === 'string' && override && override !== 'auto') {
    const matched = headers.findIndex((header) => String(header) === override);
    if (matched >= 0) {
      return matched;
    }
  }
  return fallbackIndex;
}

export function buildAnalysisChartModel(result, method, style) {
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

  const autoY = pickChartMetricIndex(method, headers, numericIndexes);
  const yIndex = resolveColumnIndex(headers, style?.yColumn, autoY);
  const otherNumeric = numericIndexes.filter((index) => index !== yIndex);
  const nonNumericIndexes = headers
    .map((_, index) => index)
    .filter((index) => !numericIndexes.includes(index));
  const autoX = nonNumericIndexes[0] ?? otherNumeric[0] ?? null;
  const xIndex = resolveColumnIndex(headers, style?.xColumn, autoX);
  const autoSeries = nonNumericIndexes.find((index) => index !== xIndex) ?? null;
  const seriesIndex = resolveColumnIndex(headers, style?.seriesColumn, autoSeries);
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
