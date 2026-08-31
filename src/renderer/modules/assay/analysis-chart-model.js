import { summarizeNumeric } from './analysis/shared.js';
import { parseFirstNumericToken } from './shared.js';

// Turns an Assay analysis table into the compact model consumed by the local
// Plotly renderer.

function parseAnalysisCellNumber(value) {
  return parseFirstNumericToken(value);
}

// Fallback only: every analysis now returns its own chartModel. This runs when a
// caller hands over a bare headers/rows table (e.g. a restored saved analysis).
function pickChartMetricIndex(method, headers, numericIndexes) {
  const methodPriority = {
    summary: ['mean'],
    normalize: ['normalized', 'survival', 'mean']
  };
  const priorities = methodPriority[method] || ['r²', 'r2', 'rmse', 'x50', 'mean', 'value'];
  for (let keywordIndex = 0; keywordIndex < priorities.length; keywordIndex += 1) {
    const keyword = priorities[keywordIndex];
    const match = numericIndexes.find((index) => String(headers[index] || '').toLowerCase().includes(keyword));
    if (Number.isInteger(match)) {
      return match;
    }
  }
  return numericIndexes[0];
}

// The fallback rebuilds from the rendered table, which has no replicate structure --
// only the summary table's own SD column. An error bar is honest only when the plotted
// Y is the Mean that SD describes, so any other Y column simply gets none.
function findSdIndex(headers, yIndex) {
  if (String(headers[yIndex] || '').trim().toLowerCase() !== 'mean') {
    return -1;
  }
  return headers.findIndex((header) => String(header).trim().toLowerCase() === 'sd');
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

// One table row per plotted point is the normal case, and its SD is the error bar.
// Several rows collapsing into one point would need pooling, which the table no longer
// carries -- that point just gets no bar rather than a wrong one.
function variance(items) {
  const sd = items.length === 1 ? items[0].sd : NaN;
  return Number.isFinite(sd) && sd > 0 ? { yVariance: sd } : null;
}

// Which columns can carry the Y axis. Same test buildAnalysisChartModel applies below,
// so the Y select can never offer a column that would make it return null.
export function numericAnalysisHeaders(result) {
  const headers = Array.isArray(result?.headers) ? result.headers : [];
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  return headers
    .filter((_, index) => rows.some((row) => Number.isFinite(parseAnalysisCellNumber(row[index]))))
    .map(String);
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
  const sdIndex = findSdIndex(headers, yIndex);
  // The analysis already decided whether error bars are wanted; overriding a column
  // changes what is plotted, not that choice.
  const showErrorBars = result?.chartModel?.showErrorBars !== false;
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
    const sd = sdIndex >= 0 ? parseAnalysisCellNumber(row[sdIndex]) : NaN;
    seriesMap.get(seriesLabel).push({ xLabel, xNumeric, y, sd });
    totalCount += 1;
  });

  if (!totalCount || !seriesMap.size) {
    return null;
  }

  const numericXAxis = numericXCount / totalCount >= 0.75;
  // Everything except a summary table is a fit over a continuous X.
  const chartType = numericXAxis && method !== 'summary' ? 'line' : 'bar';

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
          xBuckets.get(point.xNumeric).push(point);
        });
        const data = Array.from(xBuckets.entries())
          .map(([x, items]) => {
            const stats = summarizeNumeric(items.map((item) => item.y));
            return stats ? { x: Number(x), y: stats.mean, ...variance(items) } : null;
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
      showErrorBars,
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
        categoryValues.get(point.xLabel).push(point);
      });
      const data = categories
        .map((category) => {
          const items = categoryValues.get(category) || [];
          const stats = summarizeNumeric(items.map((item) => item.y));
          return stats ? { x: category, y: stats.mean, ...variance(items) } : null;
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
    showErrorBars,
    series
  };
}
