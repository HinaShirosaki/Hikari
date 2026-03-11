function toRowLabel(rowIndex) {
  let value = Number(rowIndex) + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function rowLabelToIndex(label) {
  const value = String(label || '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(value)) {
    return -1;
  }
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total * 26) + (value.charCodeAt(index) - 64);
  }
  return total - 1;
}

function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '-';
}

function summarizeNumeric(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const n = values.length;
  const total = values.reduce((sum, item) => sum + item, 0);
  const meanValue = total / n;
  const variance = n > 1
    ? values.reduce((sum, item) => sum + ((item - meanValue) ** 2), 0) / (n - 1)
    : 0;
  const sd = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { n, mean: meanValue, sd, min, max };
}

function groupBy(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
  });
  return map;
}

function sortByConcentration(a, b) {
  const aNumeric = Number.isFinite(a.concentrationValue);
  const bNumeric = Number.isFinite(b.concentrationValue);
  if (aNumeric && bNumeric && a.concentrationValue !== b.concentrationValue) {
    return a.concentrationValue - b.concentrationValue;
  }
  if (aNumeric && !bNumeric) {
    return -1;
  }
  if (!aNumeric && bNumeric) {
    return 1;
  }
  return String(a.concentrationLabel).localeCompare(String(b.concentrationLabel));
}

function describeObservationAxes(observations) {
  const sampleLabels = new Set();
  const concentrationLabels = new Set();
  const numericSampleValues = new Set();
  const numericConcentrationValues = new Set();

  observations.forEach((item) => {
    if (item.rawSampleId) {
      sampleLabels.add(item.rawSampleId);
    }
    if (item.rawConcentration) {
      concentrationLabels.add(item.rawConcentration);
    }
    if (Number.isFinite(item.sampleValue)) {
      numericSampleValues.add(item.sampleValue);
    }
    if (Number.isFinite(item.concentrationValue)) {
      numericConcentrationValues.add(item.concentrationValue);
    }
  });

  return {
    sampleCount: sampleLabels.size,
    concentrationCount: concentrationLabels.size,
    numericSampleCount: numericSampleValues.size,
    numericConcentrationCount: numericConcentrationValues.size,
    hasSampleFactor: sampleLabels.size > 1,
    hasConcentrationFactor: concentrationLabels.size > 1
  };
}

function normalizeDimensionMemberToken(token, dimension) {
  const value = String(token || '').trim().toUpperCase();
  if (!value) {
    return '';
  }
  if (dimension === 'row') {
    return /^[A-Z]+$/.test(value) ? value : '';
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return '';
  }
  return String(numeric);
}

function expandDimensionMemberToken(token, dimension) {
  const value = String(token || '').trim().toUpperCase();
  if (!value) {
    return [];
  }

  if (dimension === 'row') {
    const rangeMatch = value.match(/^([A-Z]+)-([A-Z]+)$/);
    if (rangeMatch) {
      const start = rowLabelToIndex(rangeMatch[1]);
      const end = rowLabelToIndex(rangeMatch[2]);
      if (start < 0 || end < 0) {
        return [];
      }
      const step = start <= end ? 1 : -1;
      const labels = [];
      for (let index = start; step > 0 ? index <= end : index >= end; index += step) {
        labels.push(toRowLabel(index));
      }
      return labels;
    }
    const normalized = normalizeDimensionMemberToken(value, dimension);
    return normalized ? [normalized] : [];
  }

  const rangeMatch = value.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
      return [];
    }
    const step = start <= end ? 1 : -1;
    const labels = [];
    for (let index = start; step > 0 ? index <= end : index >= end; index += step) {
      labels.push(String(index));
    }
    return labels;
  }
  const normalized = normalizeDimensionMemberToken(value, dimension);
  return normalized ? [normalized] : [];
}

function parseDimensionGroupSpec(rawSpec, dimension, maxMemberCount) {
  const warnings = [];
  const groups = [];
  const memberToGroup = new Map();
  const specText = String(rawSpec || '').trim();
  if (!specText) {
    return { groups, memberToGroup, warnings };
  }

  const entries = specText
    .split(/[\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const itemLabel = dimension === 'row' ? 'row' : 'column';

  entries.forEach((entry) => {
    const separatorIndex = entry.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex >= entry.length - 1) {
      warnings.push(`Ignored "${entry}" (use "Group: members").`);
      return;
    }

    const groupLabel = entry.slice(0, separatorIndex).trim();
    if (!groupLabel) {
      warnings.push(`Ignored "${entry}" (missing group name before ":").`);
      return;
    }

    const rawMembers = entry.slice(separatorIndex + 1);
    const tokens = rawMembers.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
    if (!tokens.length) {
      warnings.push(`Ignored "${groupLabel}" (missing ${itemLabel} values).`);
      return;
    }

    const expandedMembers = [];
    tokens.forEach((token) => {
      const expanded = expandDimensionMemberToken(token, dimension);
      if (!expanded.length) {
        warnings.push(`Ignored token "${token}" in "${groupLabel}".`);
        return;
      }
      expandedMembers.push(...expanded);
    });

    if (!expandedMembers.length) {
      return;
    }

    const withinBounds = expandedMembers.filter((member) => {
      if (!Number.isInteger(maxMemberCount) || maxMemberCount <= 0) {
        return true;
      }
      const index = dimension === 'row' ? rowLabelToIndex(member) : Number(member) - 1;
      return index >= 0 && index < maxMemberCount;
    });
    const uniqueMembers = [...new Set(withinBounds)];
    if (uniqueMembers.length < 2) {
      warnings.push(`Group "${groupLabel}" needs at least two valid ${itemLabel}s.`);
      return;
    }

    const acceptedMembers = [];
    uniqueMembers.forEach((member) => {
      if (memberToGroup.has(member)) {
        const existing = memberToGroup.get(member);
        warnings.push(`${itemLabel[0].toUpperCase() + itemLabel.slice(1)} ${member} is already in "${existing.label}".`);
        return;
      }
      acceptedMembers.push(member);
    });
    if (acceptedMembers.length < 2) {
      warnings.push(`Group "${groupLabel}" needs at least two non-overlapping ${itemLabel}s.`);
      return;
    }

    const sortIndex = acceptedMembers.reduce((best, member) => {
      const index = dimension === 'row' ? rowLabelToIndex(member) : Number(member) - 1;
      return Math.min(best, index);
    }, Number.POSITIVE_INFINITY);
    const group = {
      label: groupLabel,
      members: acceptedMembers,
      sortIndex
    };

    groups.push(group);
    acceptedMembers.forEach((member) => {
      memberToGroup.set(member, group);
    });
  });

  return { groups, memberToGroup, warnings };
}

function analyzeGroupedSummary(observations) {
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

function analyzeNestedSummary(observations) {
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

function analyzeDimensionSummary(observations, dimension, options = {}) {
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

function getDoseAxisConfig(observations) {
  const axes = describeObservationAxes(observations);

  if (axes.numericConcentrationCount >= 2) {
    return {
      xSource: 'Concentration',
      xAccessor: (item) => item.concentrationValue,
      xLabelAccessor: (item) => item.concentrationLabel,
      seriesHeader: axes.hasSampleFactor ? 'Sample ID' : 'Series',
      seriesAccessor: axes.hasSampleFactor
        ? (item) => item.sampleId
        : () => 'All Wells'
    };
  }

  if (axes.numericSampleCount >= 2) {
    return {
      xSource: 'Sample ID',
      xAccessor: (item) => item.sampleValue,
      xLabelAccessor: (item) => item.sampleId,
      seriesHeader: axes.hasConcentrationFactor ? 'Concentration' : 'Series',
      seriesAccessor: axes.hasConcentrationFactor
        ? (item) => item.concentrationLabel
        : () => 'All Wells'
    };
  }

  return null;
}

function getRegressionAxisConfig(observations) {
  const doseAxis = getDoseAxisConfig(observations);
  if (doseAxis) {
    return doseAxis;
  }

  const axes = describeObservationAxes(observations);
  return {
    xSource: 'Column',
    xAccessor: (item) => item.columnNumber,
    xLabelAccessor: (item) => String(item.columnNumber),
    seriesHeader: axes.hasSampleFactor ? 'Sample ID' : 'Series',
    seriesAccessor: axes.hasSampleFactor
      ? (item) => item.sampleId
      : () => 'All Wells'
  };
}

function linearRegression(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }
  const xValues = points.map((item) => item.x);
  const yValues = points.map((item) => item.y);
  const xMean = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
  const yMean = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < points.length; index += 1) {
    const dx = points[index].x - xMean;
    numerator += dx * (points[index].y - yMean);
    denominator += dx * dx;
  }
  if (denominator === 0) {
    return null;
  }
  const slope = numerator / denominator;
  const intercept = yMean - (slope * xMean);
  const yPred = points.map((item) => intercept + (slope * item.x));
  const ssRes = yValues.reduce((sum, item, index) => sum + ((item - yPred[index]) ** 2), 0);
  const ssTot = yValues.reduce((sum, item) => sum + ((item - yMean) ** 2), 0);
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
  return { slope, intercept, r2 };
}

function analyzeLinearRegression(observations) {
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

function summarizeModelFit(points, predictFn) {
  if (!Array.isArray(points) || points.length < 2 || typeof predictFn !== 'function') {
    return null;
  }
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const predicted = predictFn(point.x);
    if (!Number.isFinite(predicted)) {
      return null;
    }
    ssRes += (point.y - predicted) ** 2;
    ssTot += (point.y - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
  return {
    r2,
    rmse: Math.sqrt(ssRes / points.length),
    sse: ssRes
  };
}

function getConcentrationAxisConfig(observations) {
  const axes = describeObservationAxes(observations);
  if (axes.numericConcentrationCount < 2) {
    return null;
  }
  return {
    xSource: 'Concentration',
    xAccessor: (item) => item.concentrationValue,
    xLabelAccessor: (item) => item.concentrationLabel,
    seriesHeader: axes.hasSampleFactor ? 'Sample ID' : 'Series',
    seriesAccessor: axes.hasSampleFactor
      ? (item) => item.sampleId
      : () => 'All Wells'
  };
}

function collectCurvePoints(sampleItems, xAccessor, options = {}) {
  const requirePositiveX = Boolean(options.requirePositiveX);
  const requireNonNegativeX = Boolean(options.requireNonNegativeX);
  const transformX = typeof options.transformX === 'function'
    ? options.transformX
    : (value) => value;
  const pointGroups = new Map();

  sampleItems.forEach((item) => {
    const rawX = xAccessor(item);
    if (!Number.isFinite(rawX)) {
      return;
    }
    if (requirePositiveX && rawX <= 0) {
      return;
    }
    if (requireNonNegativeX && rawX < 0) {
      return;
    }
    const xValue = transformX(rawX);
    if (!Number.isFinite(xValue)) {
      return;
    }
    if (!pointGroups.has(xValue)) {
      pointGroups.set(xValue, []);
    }
    pointGroups.get(xValue).push(item.response);
  });

  return Array.from(pointGroups.entries())
    .map(([x, values]) => {
      const stats = summarizeNumeric(values);
      return stats ? { x: Number(x), y: stats.mean, n: stats.n } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);
}

function optimizeModelParameters({
  initial,
  bounds,
  stepSizes,
  evaluateError,
  normalizeParams,
  maxRounds = 36,
  minStep = 1e-6
}) {
  const keys = Object.keys(stepSizes || {});
  if (!keys.length || typeof evaluateError !== 'function') {
    return null;
  }

  const applyBounds = (source) => {
    const normalized = { ...source };
    keys.forEach((key) => {
      const value = normalized[key];
      const bound = bounds?.[key];
      if (!bound || !Number.isFinite(value)) {
        return;
      }
      normalized[key] = clamp(value, bound.min, bound.max);
    });
    return normalized;
  };

  const sanitize = (source) => {
    let candidate = applyBounds(source);
    if (typeof normalizeParams === 'function') {
      candidate = normalizeParams(candidate);
    }
    return applyBounds(candidate);
  };

  let best = sanitize(initial);
  let bestErr = evaluateError(best);
  if (!Number.isFinite(bestErr)) {
    return null;
  }
  const steps = { ...stepSizes };

  for (let round = 0; round < maxRounds; round += 1) {
    let improved = false;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex];
      const step = steps[key];
      if (!Number.isFinite(step) || step <= 0) {
        continue;
      }
      [-1, 1].forEach((direction) => {
        const candidate = sanitize({
          ...best,
          [key]: best[key] + (direction * step)
        });
        const err = evaluateError(candidate);
        if (Number.isFinite(err) && err < bestErr) {
          best = candidate;
          bestErr = err;
          improved = true;
        }
      });
    }
    if (!improved) {
      keys.forEach((key) => {
        steps[key] *= 0.5;
      });
    }
    const maxStep = Math.max(...keys.map((key) => steps[key] || 0));
    if (maxStep < minStep) {
      break;
    }
  }

  return { params: best, error: bestErr };
}

function solveLinearSystem(matrix, vector) {
  const n = Array.isArray(matrix) ? matrix.length : 0;
  if (!n || !Array.isArray(vector) || vector.length !== n) {
    return null;
  }

  const augmented = matrix.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== n || !Number.isFinite(vector[rowIndex])) {
      return null;
    }
    const normalized = row.map((value) => (Number.isFinite(value) ? value : NaN));
    if (normalized.some((value) => !Number.isFinite(value))) {
      return null;
    }
    return [...normalized, vector[rowIndex]];
  });
  if (augmented.some((row) => row === null)) {
    return null;
  }

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) {
      return null;
    }
    if (pivot !== col) {
      const tmp = augmented[col];
      augmented[col] = augmented[pivot];
      augmented[pivot] = tmp;
    }

    const pivotValue = augmented[col][col];
    for (let idx = col; idx <= n; idx += 1) {
      augmented[col][idx] /= pivotValue;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = augmented[row][col];
      if (Math.abs(factor) < 1e-12) {
        continue;
      }
      for (let idx = col; idx <= n; idx += 1) {
        augmented[row][idx] -= factor * augmented[col][idx];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function fitPolynomialCurve(points, degree) {
  if (!Array.isArray(points) || points.length < degree + 1 || degree < 1) {
    return null;
  }
  const size = degree + 1;
  const normal = Array.from({ length: size }, () => Array(size).fill(0));
  const rhs = Array(size).fill(0);

  points.forEach((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }
    const powers = Array((degree * 2) + 1).fill(0);
    powers[0] = 1;
    for (let idx = 1; idx < powers.length; idx += 1) {
      powers[idx] = powers[idx - 1] * point.x;
    }
    for (let row = 0; row < size; row += 1) {
      rhs[row] += powers[row] * point.y;
      for (let col = 0; col < size; col += 1) {
        normal[row][col] += powers[row + col];
      }
    }
  });

  const coefficients = solveLinearSystem(normal, rhs);
  if (!coefficients || coefficients.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const predict = (x) => coefficients.reduce((sum, value, index) => sum + (value * (x ** index)), 0);
  const equation = coefficients.reduce((text, value, index) => {
    if (index === 0) {
      return `y = ${formatNumber(value)}`;
    }
    const sign = value < 0 ? '-' : '+';
    const magnitude = formatNumber(Math.abs(value));
    const term = index === 1 ? 'x' : `x^${index}`;
    return `${text} ${sign} ${magnitude}*${term}`;
  }, '');
  const parameters = coefficients
    .map((value, index) => `a${index}=${formatNumber(value)}`)
    .join('; ');

  return {
    modelLabel: degree === 2 ? 'Second order polynomial' : 'Third order polynomial',
    equation,
    parameters,
    predict
  };
}

function fitLineCurve(points, modelLabel = 'Line', xTerm = 'x') {
  const fit = linearRegression(points);
  if (!fit) {
    return null;
  }
  const slopeSign = fit.slope < 0 ? '-' : '+';
  const slopeMagnitude = formatNumber(Math.abs(fit.slope));
  return {
    modelLabel,
    equation: `y = ${formatNumber(fit.intercept)} ${slopeSign} ${slopeMagnitude}*${xTerm}`,
    parameters: `intercept=${formatNumber(fit.intercept)}; slope=${formatNumber(fit.slope)}`,
    predict: (x) => fit.intercept + (fit.slope * x)
  };
}

function sigmoid4CurvePoint(x, params) {
  const exponent = params.hill * (params.mid - x);
  const denominator = 1 + Math.exp(exponent);
  return params.bottom + ((params.top - params.bottom) / denominator);
}

function sigmoid5CurvePoint(x, params) {
  const exponent = params.hill * (params.mid - x);
  const denominator = (1 + Math.exp(exponent)) ** params.asymmetry;
  return params.bottom + ((params.top - params.bottom) / denominator);
}

function fitSigmoidCurve(points, { asymmetric = false } = {}) {
  if (!Array.isArray(points) || points.length < (asymmetric ? 5 : 4)) {
    return null;
  }
  const xValues = points.map((item) => item.x).filter(Number.isFinite);
  const yValues = points.map((item) => item.y).filter(Number.isFinite);
  if (xValues.length < (asymmetric ? 5 : 4) || yValues.length < (asymmetric ? 5 : 4)) {
    return null;
  }
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xRange = Math.max(1e-6, xMax - xMin);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const yRange = Math.max(1e-9, yMax - yMin);
  const trendSign = yValues[yValues.length - 1] >= yValues[0] ? 1 : -1;

  const initial = {
    bottom: yMin,
    top: yMax,
    mid: (xMin + xMax) / 2,
    hill: trendSign
  };
  if (asymmetric) {
    initial.asymmetry = 1;
  }

  const bounds = {
    bottom: { min: yMin - (yRange * 2), max: yMax + yRange },
    top: { min: yMin - yRange, max: yMax + (yRange * 2) },
    mid: { min: xMin - xRange, max: xMax + xRange },
    hill: { min: -12, max: 12 }
  };
  if (asymmetric) {
    bounds.asymmetry = { min: 0.15, max: 6 };
  }

  const stepSizes = {
    bottom: yRange * 0.6,
    top: yRange * 0.6,
    mid: Math.max(0.1, xRange * 0.4),
    hill: 1.2
  };
  if (asymmetric) {
    stepSizes.asymmetry = 0.5;
  }

  const normalizeParams = (params) => {
    const normalized = { ...params };
    if (normalized.top <= normalized.bottom) {
      const center = (normalized.top + normalized.bottom) / 2;
      normalized.bottom = center - 1e-9;
      normalized.top = center + 1e-9;
    }
    if (Math.abs(normalized.hill) < 0.02) {
      normalized.hill = normalized.hill < 0 ? -0.02 : 0.02;
    }
    if (asymmetric && normalized.asymmetry <= 0.15) {
      normalized.asymmetry = 0.15;
    }
    return normalized;
  };

  const predictor = asymmetric ? sigmoid5CurvePoint : sigmoid4CurvePoint;
  const evaluateError = (params) => points.reduce((sum, point) => {
    const predicted = predictor(point.x, params);
    if (!Number.isFinite(predicted)) {
      return Number.POSITIVE_INFINITY;
    }
    return sum + ((point.y - predicted) ** 2);
  }, 0);

  const optimized = optimizeModelParameters({
    initial,
    bounds,
    stepSizes,
    evaluateError,
    normalizeParams
  });
  if (!optimized?.params) {
    return null;
  }

  const fitted = optimized.params;
  const predict = (x) => predictor(x, fitted);
  const modelLabel = asymmetric ? 'Asymmetric Sigmoidal 5PL' : 'Sigmoidal 4PL';
  const equation = asymmetric
    ? 'y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))^asym'
    : 'y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))';
  const parameters = asymmetric
    ? `top=${formatNumber(fitted.top)}; bottom=${formatNumber(fitted.bottom)}; mid=${formatNumber(fitted.mid)}; hill=${formatNumber(fitted.hill)}; asym=${formatNumber(fitted.asymmetry)}`
    : `top=${formatNumber(fitted.top)}; bottom=${formatNumber(fitted.bottom)}; mid=${formatNumber(fitted.mid)}; hill=${formatNumber(fitted.hill)}`;

  return {
    modelLabel,
    equation,
    parameters,
    predict
  };
}

function hyperbolaCurvePoint(x, params) {
  const denominator = params.kd + x;
  if (denominator <= 0) {
    return NaN;
  }
  return params.bottom + (((params.top - params.bottom) * x) / denominator);
}

function fitHyperbolaCurve(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return null;
  }
  const validPoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (validPoints.length < 3 || !validPoints.some((point) => point.x > 0)) {
    return null;
  }

  const xValues = validPoints.map((point) => point.x);
  const yValues = validPoints.map((point) => point.y);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const yRange = Math.max(1e-9, yMax - yMin);
  const initialKd = Math.max(1e-6, xMax / 2);

  const initial = {
    bottom: yMin,
    top: yMax,
    kd: initialKd
  };
  const bounds = {
    bottom: { min: yMin - (yRange * 2), max: yMax + yRange },
    top: { min: yMin - yRange, max: yMax + (yRange * 2) },
    kd: { min: 1e-9, max: Math.max(1, xMax * 50) }
  };
  const stepSizes = {
    bottom: yRange * 0.6,
    top: yRange * 0.6,
    kd: Math.max(0.05, initialKd * 0.5)
  };

  const normalizeParams = (params) => {
    const normalized = { ...params };
    if (normalized.top <= normalized.bottom) {
      const center = (normalized.top + normalized.bottom) / 2;
      normalized.bottom = center - 1e-9;
      normalized.top = center + 1e-9;
    }
    return normalized;
  };
  const evaluateError = (params) => validPoints.reduce((sum, point) => {
    const predicted = hyperbolaCurvePoint(point.x, params);
    if (!Number.isFinite(predicted)) {
      return Number.POSITIVE_INFINITY;
    }
    return sum + ((point.y - predicted) ** 2);
  }, 0);

  const optimized = optimizeModelParameters({
    initial,
    bounds,
    stepSizes,
    evaluateError,
    normalizeParams
  });
  if (!optimized?.params) {
    return null;
  }

  const fitted = optimized.params;
  return {
    modelLabel: 'Hyperbola',
    equation: 'y = bottom + ((top-bottom)*x)/(Kd + x)',
    parameters: `top=${formatNumber(fitted.top)}; bottom=${formatNumber(fitted.bottom)}; Kd=${formatNumber(fitted.kd)}`,
    predict: (x) => hyperbolaCurvePoint(x, fitted)
  };
}

function pade11Point(x, params) {
  const denominator = 1 + (params.b1 * x);
  if (Math.abs(denominator) < 1e-7) {
    return NaN;
  }
  return (params.a0 + (params.a1 * x)) / denominator;
}

function fitPade11Curve(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return null;
  }
  const validPoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (validPoints.length < 3) {
    return null;
  }
  const xValues = validPoints.map((point) => point.x);
  const yValues = validPoints.map((point) => point.y);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const yRange = Math.max(1e-9, yMax - yMin);
  const maxAbsX = Math.max(...xValues.map((value) => Math.abs(value)));
  const b1Scale = maxAbsX > 0 ? (6 / maxAbsX) : 6;
  const lineFit = linearRegression(validPoints);
  const initial = {
    a0: lineFit ? lineFit.intercept : (yValues.reduce((sum, value) => sum + value, 0) / yValues.length),
    a1: lineFit ? lineFit.slope : 0,
    b1: 0
  };
  const bounds = {
    a0: { min: yMin - (yRange * 4), max: yMax + (yRange * 4) },
    a1: { min: -Math.max(1, yRange * 10), max: Math.max(1, yRange * 10) },
    b1: { min: -b1Scale, max: b1Scale }
  };
  const stepSizes = {
    a0: yRange * 0.6,
    a1: Math.max(0.1, yRange * 0.8),
    b1: Math.max(0.05, b1Scale * 0.25)
  };
  const evaluateError = (params) => validPoints.reduce((sum, point) => {
    const predicted = pade11Point(point.x, params);
    if (!Number.isFinite(predicted)) {
      return Number.POSITIVE_INFINITY;
    }
    return sum + ((point.y - predicted) ** 2);
  }, 0);

  const optimized = optimizeModelParameters({
    initial,
    bounds,
    stepSizes,
    evaluateError
  });
  if (!optimized?.params) {
    return null;
  }

  const fitted = optimized.params;
  return {
    modelLabel: 'Pade (1,1)',
    equation: 'y = (a0 + a1*x)/(1 + b1*x)',
    parameters: `a0=${formatNumber(fitted.a0)}; a1=${formatNumber(fitted.a1)}; b1=${formatNumber(fitted.b1)}`,
    predict: (x) => pade11Point(x, fitted)
  };
}

const STANDARD_CURVE_METHODS = {
  standard_curve_line: {
    label: 'Line',
    xLabel: 'Concentration',
    minPoints: 2,
    fit: (points) => fitLineCurve(points, 'Line')
  },
  standard_curve_4pl_log_concentration: {
    label: 'Sigmoidal, 4PL, X is log(concentration)',
    xLabel: 'log10(Concentration)',
    minPoints: 4,
    requirePositiveX: true,
    transformX: (x) => Math.log10(x),
    fit: (points) => fitSigmoidCurve(points, { asymmetric: false })
  },
  standard_curve_4pl_concentration: {
    label: 'Sigmoidal, 4PL, X is concentration',
    xLabel: 'Concentration',
    minPoints: 4,
    fit: (points) => fitSigmoidCurve(points, { asymmetric: false })
  },
  standard_curve_5pl_log_concentration: {
    label: 'Asymmetric Sigmoidal, 5PL, X is log(concentration)',
    xLabel: 'log10(Concentration)',
    minPoints: 5,
    requirePositiveX: true,
    transformX: (x) => Math.log10(x),
    fit: (points) => fitSigmoidCurve(points, { asymmetric: true })
  },
  standard_curve_5pl_concentration: {
    label: 'Asymmetric Sigmoidal, 5PL, X is concentration',
    xLabel: 'Concentration',
    minPoints: 5,
    fit: (points) => fitSigmoidCurve(points, { asymmetric: true })
  },
  standard_curve_semilog_line: {
    label: 'Semilog line',
    xLabel: 'log10(Concentration)',
    minPoints: 2,
    requirePositiveX: true,
    transformX: (x) => Math.log10(x),
    fit: (points) => fitLineCurve(points, 'Semilog line')
  },
  standard_curve_hyperbola: {
    label: 'Hyperbola (X is concentration)',
    xLabel: 'Concentration',
    minPoints: 3,
    requireNonNegativeX: true,
    fit: (points) => fitHyperbolaCurve(points)
  },
  standard_curve_quadratic: {
    label: 'Second order polynomial (quadratic)',
    xLabel: 'Concentration',
    minPoints: 3,
    fit: (points) => fitPolynomialCurve(points, 2)
  },
  standard_curve_cubic: {
    label: 'Third order polynomial (cubic)',
    xLabel: 'Concentration',
    minPoints: 4,
    fit: (points) => fitPolynomialCurve(points, 3)
  },
  standard_curve_pade_11: {
    label: 'Pade (1,1) approximant',
    xLabel: 'Concentration',
    minPoints: 3,
    fit: (points) => fitPade11Curve(points)
  }
};

function analyzeStandardCurve(observations, method) {
  const methodConfig = STANDARD_CURVE_METHODS[method];
  if (!methodConfig) {
    return {
      summary: 'Unsupported standard curve method.',
      headers: ['Method'],
      rows: []
    };
  }
  const axisConfig = getConcentrationAxisConfig(observations);
  if (!axisConfig) {
    return {
      summary: `${methodConfig.label} requires at least 2 numeric concentration values.`,
      headers: [methodConfig.label],
      rows: []
    };
  }

  const sampleGroups = groupBy(observations, (item) => axisConfig.seriesAccessor(item));
  let skipped = 0;
  const rows = [];
  const chartSeries = [];

  Array.from(sampleGroups.entries())
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .forEach(([seriesLabel, sampleItems]) => {
      const points = collectCurvePoints(sampleItems, axisConfig.xAccessor, {
        requirePositiveX: methodConfig.requirePositiveX,
        requireNonNegativeX: methodConfig.requireNonNegativeX,
        transformX: methodConfig.transformX
      });
      if (points.length < methodConfig.minPoints) {
        skipped += 1;
        return;
      }

      const fit = methodConfig.fit(points);
      if (!fit || typeof fit.predict !== 'function') {
        skipped += 1;
        return;
      }
      const fitStats = summarizeModelFit(points, fit.predict);
      if (!fitStats) {
        skipped += 1;
        return;
      }

      const normalizedLabel = String(seriesLabel || 'Series');
      rows.push([
        normalizedLabel,
        points.length,
        fit.modelLabel || methodConfig.label,
        formatNumber(fitStats.r2, 5),
        formatNumber(fitStats.rmse, 5),
        fit.equation || '-',
        fit.parameters || '-'
      ]);

      const fittedLine = points
        .map((point) => ({ x: point.x, y: fit.predict(point.x) }))
        .filter((point) => Number.isFinite(point.y))
        .sort((a, b) => a.x - b.x);
      if (fittedLine.length >= 2) {
        chartSeries.push({
          label: normalizedLabel,
          data: fittedLine
        });
      }
    });

  return {
    summary: `${methodConfig.label} fitted for ${rows.length} series using ${methodConfig.xLabel} as X.${skipped ? ` ${skipped} series skipped (insufficient valid points or fit failure).` : ''}`,
    headers: [axisConfig.seriesHeader, 'Points', 'Model', 'R²', 'RMSE', 'Equation', 'Parameters'],
    rows,
    chartModel: chartSeries.length
      ? {
        chartType: 'line',
        xLabel: methodConfig.xLabel,
        yLabel: 'Response',
        series: chartSeries
      }
      : null
  };
}

function logistic4Point(x, params) {
  const exponent = (params.logEC50 - Math.log10(x)) * params.hill;
  return params.bottom + ((params.top - params.bottom) / (1 + (10 ** exponent)));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function fitDoseResponse4PL(points) {
  if (!Array.isArray(points) || points.length < 4) {
    return null;
  }
  const xValues = points.map((item) => item.x).filter((item) => item > 0);
  if (xValues.length < 4) {
    return null;
  }
  const yValues = points.map((item) => item.y);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const yRange = Math.max(1e-9, yMax - yMin);
  const logXValues = xValues.map((item) => Math.log10(item));
  const minLogX = Math.min(...logXValues);
  const maxLogX = Math.max(...logXValues);
  const initial = {
    bottom: yMin,
    top: yMax,
    logEC50: (minLogX + maxLogX) / 2,
    hill: 1
  };
  const bounds = {
    bottom: { min: yMin - (yRange * 2), max: yMax + yRange },
    top: { min: yMin - yRange, max: yMax + (yRange * 2) },
    logEC50: { min: minLogX - 2, max: maxLogX + 2 },
    hill: { min: 0.05, max: 8 }
  };
  const ensureParams = (source) => {
    const params = {
      bottom: clamp(source.bottom, bounds.bottom.min, bounds.bottom.max),
      top: clamp(source.top, bounds.top.min, bounds.top.max),
      logEC50: clamp(source.logEC50, bounds.logEC50.min, bounds.logEC50.max),
      hill: clamp(source.hill, bounds.hill.min, bounds.hill.max)
    };
    if (params.top <= params.bottom) {
      params.top = params.bottom + 1e-9;
    }
    return params;
  };
  const calcSse = (params) => {
    let total = 0;
    for (let index = 0; index < points.length; index += 1) {
      const predicted = logistic4Point(points[index].x, params);
      total += (points[index].y - predicted) ** 2;
    }
    return total;
  };

  let best = ensureParams(initial);
  let bestErr = calcSse(best);
  const steps = {
    bottom: yRange * 0.6,
    top: yRange * 0.6,
    logEC50: Math.max(0.1, (maxLogX - minLogX) * 0.5),
    hill: 0.8
  };
  const paramKeys = ['bottom', 'top', 'logEC50', 'hill'];

  for (let round = 0; round < 12; round += 1) {
    let improved = false;
    for (let keyIndex = 0; keyIndex < paramKeys.length; keyIndex += 1) {
      const key = paramKeys[keyIndex];
      const step = steps[key];
      [-1, 1].forEach((direction) => {
        const candidate = ensureParams({
          ...best,
          [key]: best[key] + (direction * step)
        });
        const err = calcSse(candidate);
        if (err < bestErr) {
          best = candidate;
          bestErr = err;
          improved = true;
        }
      });
    }
    if (!improved) {
      paramKeys.forEach((key) => {
        steps[key] *= 0.5;
      });
    }
    const maxStep = Math.max(...Object.values(steps));
    if (maxStep < 1e-6) {
      break;
    }
  }

  const yMean = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
  const ssTot = yValues.reduce((sum, value) => sum + ((value - yMean) ** 2), 0);
  const ssRes = points.reduce((sum, point) => sum + ((point.y - logistic4Point(point.x, best)) ** 2), 0);
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
  return {
    ...best,
    ec50: 10 ** best.logEC50,
    r2,
    rmse: Math.sqrt(ssRes / points.length)
  };
}

function getMeanDosePoints(sampleItems, requirePositiveX, xAccessor) {
  const groups = new Map();
  sampleItems.forEach((item) => {
    const xValue = xAccessor(item);
    if (!Number.isFinite(xValue)) {
      return;
    }
    if (requirePositiveX && xValue <= 0) {
      return;
    }
    if (!groups.has(xValue)) {
      groups.set(xValue, []);
    }
    groups.get(xValue).push(item.response);
  });
  return Array.from(groups.entries())
    .map(([x, values]) => {
      const stats = summarizeNumeric(values);
      return stats ? { x, y: stats.mean, n: stats.n } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);
}

function analyzeEc50Like(observations, mode) {
  const config = getDoseAxisConfig(observations);
  if (!config) {
    return {
      summary: `${mode.toUpperCase()} fit requires at least 2 numeric concentration or sample ID values.`,
      headers: [mode.toUpperCase()],
      rows: []
    };
  }

  const sampleGroups = groupBy(observations, (item) => config.seriesAccessor(item));
  let skipped = 0;
  const rows = Array.from(sampleGroups.entries())
    .map(([seriesLabel, sampleItems]) => {
      const points = getMeanDosePoints(sampleItems, true, config.xAccessor);
      if (points.length < 4) {
        skipped += 1;
        return null;
      }
      const fit = fitDoseResponse4PL(points);
      if (!fit) {
        skipped += 1;
        return null;
      }
      const trend = points.length >= 2 && points[points.length - 1].y > points[0].y ? 'up' : 'down';
      return [
        seriesLabel,
        points.length,
        formatNumber(fit.ec50),
        formatNumber(fit.hill),
        formatNumber(fit.top),
        formatNumber(fit.bottom),
        formatNumber(fit.r2, 5),
        trend
      ];
    })
    .filter(Boolean)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  return {
    summary: `${mode.toUpperCase()} fit completed for ${rows.length} series using ${config.xSource} as dose axis. ${skipped ? `${skipped} series skipped (need >=4 positive numeric dose values).` : ''}`.trim(),
    headers: [config.seriesHeader, 'Points', mode.toUpperCase(), 'Hill', 'Top', 'Bottom', 'R²', 'Trend'],
    rows
  };
}

function analyzeSurvival(observations) {
  const config = getDoseAxisConfig(observations);
  if (!config) {
    return {
      summary: 'Survival analysis requires numeric concentration or sample ID values.',
      headers: ['Series'],
      rows: []
    };
  }

  const sampleGroups = groupBy(observations, (item) => config.seriesAccessor(item));
  const rows = [];

  Array.from(sampleGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([seriesLabel, sampleItems]) => {
      const concentrationGroups = new Map();
      sampleItems.forEach((item) => {
        const xValue = config.xAccessor(item);
        const xLabel = config.xLabelAccessor(item);
        if (!Number.isFinite(xValue)) {
          return;
        }
        if (!concentrationGroups.has(xLabel)) {
          concentrationGroups.set(xLabel, {
            concentrationLabel: xLabel,
            concentrationValue: xValue,
            values: []
          });
        }
        concentrationGroups.get(xLabel).values.push(item.response);
      });
      const groups = Array.from(concentrationGroups.values())
        .map((item) => ({ ...item, stats: summarizeNumeric(item.values) }))
        .filter((item) => item.stats)
        .sort(sortByConcentration);
      if (!groups.length) {
        return;
      }

      const numericGroups = groups.filter((item) => Number.isFinite(item.concentrationValue));
      let baseline = numericGroups.length
        ? numericGroups.reduce((best, item) => (
          item.concentrationValue < best.concentrationValue ? item : best
        ), numericGroups[0])
        : null;
      if (!baseline) {
        baseline = groups[0];
      }
      const baselineMean = baseline.stats?.mean;

      groups.forEach((item) => {
        const survival = Number.isFinite(baselineMean) && baselineMean !== 0
          ? (item.stats.mean / baselineMean) * 100
          : null;
        rows.push([
          seriesLabel,
          baseline.concentrationLabel,
          formatNumber(baselineMean),
          item.concentrationLabel,
          item.stats.n,
          formatNumber(item.stats.mean),
          formatNumber(survival, 2)
        ]);
      });
    });

  return {
    summary: `Survival analysis computed as (group mean / baseline mean) * 100 for ${sampleGroups.size} series using ${config.xSource} as dose axis.`,
    headers: [config.seriesHeader, `Baseline ${config.xSource}`, 'Baseline Mean', config.xSource, 'N', 'Mean', 'Survival %'],
    rows
  };
}

export function analyzeAssayData({ method, observations, options = {} }) {
  if (!Array.isArray(observations) || !observations.length) {
    return {
      summary: 'No result values to analyze.',
      headers: [],
      rows: []
    };
  }

  if (method === 'nested_summary') {
    return analyzeNestedSummary(observations);
  }
  if (method === 'row_summary') {
    return analyzeDimensionSummary(observations, 'row', options.rowSummary || {});
  }
  if (method === 'column_summary') {
    return analyzeDimensionSummary(observations, 'column', options.columnSummary || {});
  }
  if (method === 'linear_regression') {
    return analyzeLinearRegression(observations);
  }
  if (method === 'ec50') {
    return analyzeEc50Like(observations, 'ec50');
  }
  if (method === 'ic50') {
    return analyzeEc50Like(observations, 'ic50');
  }
  if (method === 'survival') {
    return analyzeSurvival(observations);
  }
  if (STANDARD_CURVE_METHODS[method]) {
    return analyzeStandardCurve(observations, method);
  }
  return analyzeGroupedSummary(observations);
}
