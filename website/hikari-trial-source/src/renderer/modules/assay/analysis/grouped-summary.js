import {
  formatNumber,
  rowLabelToIndex,
  summarizeNumeric
} from './shared.js';

// One summary implementation for every grouping. Which columns lead the table is
// decided by grouping.keys, so sample / concentration / row / column / custom groups
// all share this code path instead of one function each.

// Compare key by key (numeric position first, then label) so the leading key stays
// contiguous — subtotals and the chart series both depend on that.
function compareBuckets(a, b) {
  for (let index = 0; index < a.sort.length; index += 1) {
    if (a.sort[index] !== b.sort[index]) {
      return a.sort[index] - b.sort[index];
    }
    const cmp = String(a.values[index]).localeCompare(String(b.values[index]));
    if (cmp !== 0) {
      return cmp;
    }
  }
  return 0;
}

function sortDetailMembers(members, factor) {
  return members.slice().sort((a, b) => (
    factor === 'row' ? rowLabelToIndex(a) - rowLabelToIndex(b) : Number(a) - Number(b)
  ));
}

export function collectBuckets(observations, grouping) {
  const buckets = new Map();
  observations.forEach((item) => {
    const values = grouping.keys.map((key) => key.keyOf(item));
    const id = values.join('\0');
    if (!buckets.has(id)) {
      buckets.set(id, {
        values,
        sort: grouping.keys.map(() => Number.POSITIVE_INFINITY),
        members: new Set(),
        responses: [],
        items: []
      });
    }
    const bucket = buckets.get(id);
    bucket.responses.push(item.response);
    bucket.items.push(item);
    grouping.keys.forEach((key, index) => {
      bucket.sort[index] = Math.min(bucket.sort[index], key.sortOf(item));
    });
    if (grouping.detail) {
      bucket.members.add(grouping.detail.valueOf(item));
    }
  });

  return Array.from(buckets.values())
    .map((bucket) => ({ ...bucket, stats: summarizeNumeric(bucket.responses) }))
    .filter((bucket) => bucket.stats)
    .sort(compareBuckets);
}

export function statsCells(stats) {
  return [
    stats.n,
    formatNumber(stats.mean),
    formatNumber(stats.sd),
    formatNumber(stats.min),
    formatNumber(stats.max)
  ];
}

export function analyzeSummary(observations, grouping, spec) {
  const buckets = collectBuckets(observations, grouping);
  const detailFactor = grouping.detail ? grouping.keys[0].factor : null;
  const headers = [
    ...grouping.keys.map((key) => key.header),
    ...(grouping.detail ? [grouping.detail.header] : []),
    'N', 'Mean', 'SD', 'Min', 'Max'
  ];

  const useSubtotals = Boolean(spec.subtotals) && grouping.keys.length === 2;
  const rows = [];
  const subtotalled = new Set();

  buckets.forEach((bucket) => {
    if (useSubtotals && !subtotalled.has(bucket.values[0])) {
      subtotalled.add(bucket.values[0]);
      const siblings = buckets.filter((item) => item.values[0] === bucket.values[0]);
      const subtotal = summarizeNumeric(siblings.flatMap((item) => item.responses));
      if (subtotal) {
        rows.push([
          bucket.values[0],
          'All',
          ...(grouping.detail ? ['-'] : []),
          ...statsCells(subtotal)
        ]);
      }
    }
    rows.push([
      ...bucket.values,
      ...(grouping.detail ? [sortDetailMembers(Array.from(bucket.members), detailFactor).join(', ')] : []),
      ...statsCells(bucket.stats)
    ]);
  });

  const showErrorBars = spec.errorBars !== false;
  const hasSeriesKey = grouping.keys.length === 2;
  const seriesMap = new Map();
  buckets.forEach((bucket) => {
    const seriesLabel = hasSeriesKey ? String(bucket.values[0]) : grouping.keys[0].header;
    const point = { x: String(bucket.values[hasSeriesKey ? 1 : 0]), y: bucket.stats.mean };
    if (showErrorBars && bucket.stats.n > 1 && bucket.stats.sd > 0) {
      point.yVariance = bucket.stats.sd;
    }
    // Replicates for the scatter-over-bar overlay. All of them or none: a truncated
    // dot cloud would misread as the whole group, so wide buckets just show the bar.
    if (bucket.stats.n > 1 && bucket.stats.n <= 12) {
      point.points = bucket.responses.slice();
    }
    if (!seriesMap.has(seriesLabel)) {
      seriesMap.set(seriesLabel, []);
    }
    seriesMap.get(seriesLabel).push(point);
  });

  const warningNote = grouping.warnings.length
    ? ` Grouping notes: ${grouping.warnings.slice(0, 3).join(' ')}`
    : '';

  return {
    summary: `Summary statistics for ${buckets.length} group(s), grouped by ${grouping.seriesHeader}.${warningNote}`,
    headers,
    rows,
    chartModel: buckets.length
      ? {
        chartType: 'bar',
        xLabel: grouping.keys[hasSeriesKey ? 1 : 0].header,
        yLabel: 'Mean',
        showErrorBars,
        series: Array.from(seriesMap.entries()).map(([label, data]) => ({ label, data }))
      }
      : null
  };
}
