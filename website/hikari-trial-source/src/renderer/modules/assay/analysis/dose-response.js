import {
  formatNumber,
  groupBy,
  summarizeNumeric
} from './shared.js';

// Normalize-to-baseline (the old "Survival %"): every group is expressed as a
// percentage of the lowest X level within its series.

export function analyzeNormalize(observations, grouping, xAxis, spec) {
  const seriesGroups = groupBy(observations, (item) => grouping.seriesOf(item));
  const rows = [];
  const chartSeries = [];
  const showErrorBars = spec.errorBars !== false;

  Array.from(seriesGroups.entries())
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .forEach(([seriesLabel, items]) => {
      const levels = new Map();
      items.forEach((item) => {
        const value = xAxis.valueOf(item);
        if (!Number.isFinite(value)) {
          return;
        }
        const label = xAxis.labelOf(item);
        if (!levels.has(label)) {
          levels.set(label, { label, value, responses: [] });
        }
        levels.get(label).responses.push(item.response);
      });

      const summarized = Array.from(levels.values())
        .map((level) => ({ ...level, stats: summarizeNumeric(level.responses) }))
        .filter((level) => level.stats)
        .sort((a, b) => a.value - b.value);
      if (!summarized.length) {
        return;
      }

      const baseline = summarized[0];
      const baselineMean = baseline.stats.mean;
      const points = [];

      summarized.forEach((level) => {
        const normalized = Number.isFinite(baselineMean) && baselineMean !== 0
          ? (level.stats.mean / baselineMean) * 100
          : null;
        rows.push([
          String(seriesLabel || 'Series'),
          baseline.label,
          formatNumber(baselineMean),
          level.label,
          level.stats.n,
          formatNumber(level.stats.mean),
          formatNumber(normalized, 2)
        ]);
        if (Number.isFinite(normalized)) {
          const point = { x: level.value, y: normalized };
          if (showErrorBars && level.stats.n > 1 && level.stats.sd > 0 && baselineMean) {
            point.yVariance = (level.stats.sd / Math.abs(baselineMean)) * 100;
          }
          points.push(point);
        }
      });

      if (points.length) {
        chartSeries.push({ label: String(seriesLabel || 'Series'), data: points });
      }
    });

  const warningNote = grouping.warnings.length
    ? ` Grouping notes: ${grouping.warnings.slice(0, 3).join(' ')}`
    : '';

  return {
    summary: `Normalized to the lowest ${xAxis.header} per series for ${seriesGroups.size} series (grouped by ${grouping.seriesHeader}).${warningNote}`,
    headers: [
      grouping.seriesHeader,
      `Baseline ${xAxis.header}`,
      'Baseline Mean',
      xAxis.header,
      'N',
      'Mean',
      'Normalized %'
    ],
    rows,
    chartModel: chartSeries.length
      ? {
        chartType: 'line',
        xLabel: xAxis.header,
        yLabel: 'Normalized (%)',
        showErrorBars,
        series: chartSeries
      }
      : null
  };
}
