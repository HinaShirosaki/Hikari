import {
  formatNumber,
  getRegressionAxisConfig,
  groupBy,
  linearRegression,
  summarizeNumeric
} from './shared.js';

export function analyzeLinearRegression(observations) {
  const config = getRegressionAxisConfig(observations);
  const seriesGroups = groupBy(observations, (item) => config.seriesAccessor(item));
  const regressionSeries = Array.from(seriesGroups.entries())
    .map(([seriesLabel, items]) => {
      const normalizedLabel = String(seriesLabel || 'Series');
      const pointGroups = new Map();
      items.forEach((item) => {
        const x = config.xAccessor(item);
        if (!Number.isFinite(x)) {
          return;
        }
        if (!pointGroups.has(x)) {
          pointGroups.set(x, []);
        }
        pointGroups.get(x).push(item.response);
      });

      const points = Array.from(pointGroups.entries())
        .map(([x, values]) => {
          const stats = summarizeNumeric(values);
          return stats ? { x, y: stats.mean } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.x - b.x);

      const fit = linearRegression(points);
      if (!fit) {
        return null;
      }

      return {
        label: normalizedLabel,
        row: [
          normalizedLabel,
          config.xSource,
          points.length,
          formatNumber(fit.intercept),
          formatNumber(fit.r2, 5)
        ],
        chart: {
          label: normalizedLabel,
          data: points.map((point) => ({ x: point.x, y: point.y }))
        }
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const rows = regressionSeries.map((item) => item.row);
  const chartSeries = regressionSeries.map((item) => item.chart);

  return {
    summary: `Linear regression fitted for ${rows.length} series using ${config.xSource} as X.`,
    headers: [config.seriesHeader, 'X Source', 'Points', 'Intercept', 'R²'],
    rows,
    chartModel: chartSeries.length
      ? {
        chartType: 'line',
        xLabel: config.xSource,
        yLabel: 'Response',
        series: chartSeries
      }
      : null
  };
}
