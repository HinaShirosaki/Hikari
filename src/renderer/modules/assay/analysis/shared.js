import {
  rowLabelToIndex,
  toRowLabel
} from '../plate-model.js';

export {
  rowLabelToIndex,
  toRowLabel
};

export function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '-';
}

export function summarizeNumeric(values) {
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

export function groupBy(items, keyFn) {
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

export function sortByConcentration(a, b) {
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

export function describeObservationAxes(observations) {
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

export function normalizeDimensionMemberToken(token, dimension) {
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

export function expandDimensionMemberToken(token, dimension) {
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

export function parseDimensionGroupSpec(rawSpec, dimension, maxMemberCount) {
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

export function getDoseAxisConfig(observations) {
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

export function getRegressionAxisConfig(observations) {
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

export function linearRegression(points) {
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

export function summarizeModelFit(points, predictFn) {
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

export function getConcentrationAxisConfig(observations) {
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

export function collectCurvePoints(sampleItems, xAccessor, options = {}) {
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

export function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function optimizeModelParameters({
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

export function solveLinearSystem(matrix, vector) {
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
