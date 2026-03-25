import {
  describeObservationAxes,
  formatNumber,
  groupBy,
  parseDimensionGroupSpec,
  rowLabelToIndex,
  sortByConcentration,
  summarizeNumeric
} from './shared.js';

export function analyzeGroupedSummary(observations) {
  const axes = describeObservationAxes(observations);

  if (axes.hasSampleFactor && axes.hasConcentrationFactor) {
    const groups = new Map();
    observations.forEach((item) => {
      const key = `${item.sampleId}__${item.concentrationLabel}`;
      if (!groups.has(key)) {
        groups.set(key, {
          sampleId: item.sampleId,
          concentrationLabel: item.concentrationLabel,
          concentrationValue: item.concentrationValue,
          values: []
        });
      }
      groups.get(key).values.push(item.response);
    });

    const rows = Array.from(groups.values())
      .map((item) => ({ ...item, stats: summarizeNumeric(item.values) }))
      .filter((item) => item.stats)
      .sort((a, b) => {
        const sampleCmp = a.sampleId.localeCompare(b.sampleId);
        if (sampleCmp !== 0) {
          return sampleCmp;
        }
        return sortByConcentration(a, b);
      })
      .map((item) => [
        item.sampleId,
        item.concentrationLabel,
        item.stats.n,
        formatNumber(item.stats.mean),
        formatNumber(item.stats.sd),
        formatNumber(item.stats.min),
        formatNumber(item.stats.max)
      ]);

    return {
      summary: `Grouped summary for ${rows.length} sample/concentration group(s).`,
      headers: ['Sample ID', 'Concentration', 'N', 'Mean', 'SD', 'Min', 'Max'],
      rows
    };
  }

  if (axes.hasSampleFactor) {
    const groups = groupBy(observations, (item) => item.sampleId);
    const rows = Array.from(groups.entries())
      .map(([sampleId, items]) => {
        const stats = summarizeNumeric(items.map((item) => item.response));
        return stats ? [sampleId, stats.n, formatNumber(stats.mean), formatNumber(stats.sd), formatNumber(stats.min), formatNumber(stats.max)] : null;
      })
      .filter(Boolean)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    return {
      summary: `Grouped summary for ${rows.length} sample ID group(s).`,
      headers: ['Sample ID', 'N', 'Mean', 'SD', 'Min', 'Max'],
      rows
    };
  }

  if (axes.hasConcentrationFactor) {
    const groups = new Map();
    observations.forEach((item) => {
      if (!groups.has(item.concentrationLabel)) {
        groups.set(item.concentrationLabel, {
          concentrationLabel: item.concentrationLabel,
          concentrationValue: item.concentrationValue,
          values: []
        });
      }
      groups.get(item.concentrationLabel).values.push(item.response);
    });

    const rows = Array.from(groups.values())
      .map((item) => ({ ...item, stats: summarizeNumeric(item.values) }))
      .filter((item) => item.stats)
      .sort(sortByConcentration)
      .map((item) => [
        item.concentrationLabel,
        item.stats.n,
        formatNumber(item.stats.mean),
        formatNumber(item.stats.sd),
        formatNumber(item.stats.min),
        formatNumber(item.stats.max)
      ]);

    return {
      summary: `Grouped summary for ${rows.length} concentration group(s).`,
      headers: ['Concentration', 'N', 'Mean', 'SD', 'Min', 'Max'],
      rows
    };
  }

  const stats = summarizeNumeric(observations.map((item) => item.response));
  const rows = stats
    ? [['All Wells', stats.n, formatNumber(stats.mean), formatNumber(stats.sd), formatNumber(stats.min), formatNumber(stats.max)]]
    : [];

  return {
    summary: 'Grouped summary across all mapped wells.',
    headers: ['Series', 'N', 'Mean', 'SD', 'Min', 'Max'],
    rows
  };
}

export function analyzeNestedSummary(observations) {
  const axes = describeObservationAxes(observations);
  if (!(axes.hasSampleFactor && axes.hasConcentrationFactor)) {
    return analyzeGroupedSummary(observations);
  }

  const sampleGroups = groupBy(observations, (item) => item.sampleId);
  const rows = [];

  Array.from(sampleGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([sampleId, sampleItems]) => {
      const sampleStats = summarizeNumeric(sampleItems.map((item) => item.response));
      if (sampleStats) {
        rows.push([
          sampleId,
          'Sample Total',
          '-',
          sampleStats.n,
          formatNumber(sampleStats.mean),
          formatNumber(sampleStats.sd),
          formatNumber(sampleStats.min),
          formatNumber(sampleStats.max)
        ]);
      }

      const concentrationGroups = new Map();
      sampleItems.forEach((item) => {
        const key = item.concentrationLabel;
        if (!concentrationGroups.has(key)) {
          concentrationGroups.set(key, {
            concentrationLabel: item.concentrationLabel,
            concentrationValue: item.concentrationValue,
            values: []
          });
        }
        concentrationGroups.get(key).values.push(item.response);
      });

      Array.from(concentrationGroups.values())
        .map((item) => ({ ...item, stats: summarizeNumeric(item.values) }))
        .filter((item) => item.stats)
        .sort(sortByConcentration)
        .forEach((item) => {
          rows.push([
            sampleId,
            'Concentration',
            item.concentrationLabel,
            item.stats.n,
            formatNumber(item.stats.mean),
            formatNumber(item.stats.sd),
            formatNumber(item.stats.min),
            formatNumber(item.stats.max)
          ]);
        });
    });

  return {
    summary: `Nested summary by sample then concentration for ${sampleGroups.size} sample(s).`,
    headers: ['Sample ID', 'Level', 'Group', 'N', 'Mean', 'SD', 'Min', 'Max'],
    rows
  };
}

export function analyzeDimensionSummary(observations, dimension, options = {}) {
  const isRow = dimension === 'row';
  const dimensionLabel = isRow ? 'Row' : 'Column';
  const memberCount = Number(options.maxMemberCount);
  const groupSpec = parseDimensionGroupSpec(options.groupSpec, dimension, memberCount);
  const includeErrorBars = Boolean(options.includeErrorBars);

  const grouped = new Map();
  observations.forEach((item) => {
    const memberLabel = isRow ? item.rowLabel : String(item.columnNumber);
    const memberIndex = isRow ? item.rowIndex : item.columnIndex;
    const assignedGroup = groupSpec.memberToGroup.get(memberLabel) || null;
    const groupKey = assignedGroup ? `group:${assignedGroup.label}` : `member:${memberLabel}`;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        label: assignedGroup ? assignedGroup.label : memberLabel,
        members: new Set(),
        values: [],
        sortIndex: assignedGroup ? assignedGroup.sortIndex : memberIndex
      });
    }

    const bucket = grouped.get(groupKey);
    bucket.values.push(item.response);
    bucket.members.add(memberLabel);
    bucket.sortIndex = Math.min(bucket.sortIndex, memberIndex);
  });

  const summarized = Array.from(grouped.values())
    .map((item) => {
      const stats = summarizeNumeric(item.values);
      if (!stats) {
        return null;
      }
      const members = Array.from(item.members).sort((a, b) => {
        if (isRow) {
          return rowLabelToIndex(a) - rowLabelToIndex(b);
        }
        return Number(a) - Number(b);
      });
      return {
        label: item.label,
        members,
        sortIndex: item.sortIndex,
        stats
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.sortIndex !== b.sortIndex) {
        return a.sortIndex - b.sortIndex;
      }
      return String(a.label).localeCompare(String(b.label));
    });

  const hasCustomGroups = groupSpec.groups.length > 0;
  const headers = hasCustomGroups
    ? [`${dimensionLabel} Group`, `${dimensionLabel}s`, 'N', 'Mean', 'SD', 'Min', 'Max']
    : [dimensionLabel, 'N', 'Mean', 'SD', 'Min', 'Max'];
  const rows = summarized.map((item) => {
    const baseCells = [
      item.label,
      item.stats.n,
      formatNumber(item.stats.mean),
      formatNumber(item.stats.sd),
      formatNumber(item.stats.min),
      formatNumber(item.stats.max)
    ];
    if (!hasCustomGroups) {
      return baseCells;
    }
    return [
      item.label,
      item.members.join(', '),
      item.stats.n,
      formatNumber(item.stats.mean),
      formatNumber(item.stats.sd),
      formatNumber(item.stats.min),
      formatNumber(item.stats.max)
    ];
  });

  const warningPreview = groupSpec.warnings.slice(0, 3);
  if (groupSpec.warnings.length > warningPreview.length) {
    warningPreview.push(`+${groupSpec.warnings.length - warningPreview.length} more note(s).`);
  }
  const groupingNote = hasCustomGroups
    ? ` ${groupSpec.groups.length} custom ${isRow ? 'row' : 'column'} group(s) applied.`
    : '';
  const errorBarNote = includeErrorBars
    ? ' Error bars show +-1 SD.'
    : '';
  const warningNote = warningPreview.length
    ? ` Group parser notes: ${warningPreview.join(' ')}`
    : '';

  return {
    summary: `${dimensionLabel} summary for ${rows.length} ${isRow ? 'row(s)' : 'column(s)'}.${groupingNote}${errorBarNote}${warningNote}`,
    headers,
    rows,
    chartModel: summarized.length
      ? {
        chartType: 'bar',
        xLabel: hasCustomGroups ? `${dimensionLabel} Group` : dimensionLabel,
        yLabel: 'Mean',
        showErrorBars: includeErrorBars,
        series: [
          {
            label: hasCustomGroups ? `${dimensionLabel} Group Mean` : `${dimensionLabel} Mean`,
            data: summarized.map((item) => {
              const point = { x: item.label, y: item.stats.mean };
              if (includeErrorBars && item.stats.n > 1 && item.stats.sd > 0) {
                point.yVariance = item.stats.sd * 2;
              }
              return point;
            })
          }
        ]
      }
      : null
  };
}
