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
    // A one-member group is legitimate (a single control row/column), so only an
    // entirely empty group is rejected.
    const uniqueMembers = [...new Set(withinBounds)];
    if (!uniqueMembers.length) {
      warnings.push(`Group "${groupLabel}" has no valid ${itemLabel}s.`);
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
    if (!acceptedMembers.length) {
      warnings.push(`Group "${groupLabel}" has no non-overlapping ${itemLabel}s.`);
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

export function collectCurvePoints(sampleItems, xAccessor, options = {}) {
  const requireNonNegativeX = Boolean(options.requireNonNegativeX);
  const pointGroups = new Map();

  sampleItems.forEach((item) => {
    const rawX = xAccessor(item);
    if (!Number.isFinite(rawX)) {
      return;
    }
    if (requireNonNegativeX && rawX < 0) {
      return;
    }
    if (!pointGroups.has(rawX)) {
      pointGroups.set(rawX, []);
    }
    pointGroups.get(rawX).push(item.response);
  });

  return Array.from(pointGroups.entries())
    .map(([x, values]) => {
      const stats = summarizeNumeric(values);
      // sd travels with the point: the replicates at this X are already pooled here, so
      // it is the only place a fitted curve can get an error bar from.
      return stats ? { x: Number(x), y: stats.mean, n: stats.n, sd: stats.sd } : null;
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

// --- Student's t p-values -------------------------------------------------------
// A p-value needs the regularized incomplete beta function, which the platform does
// not have. Lanczos log-gamma + the Lentz continued fraction (Numerical Recipes
// betai) is the whole of it; a stats dependency for one function is not worth it.

const LANCZOS_G = Object.freeze([
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
]);

function logGamma(x) {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let sum = LANCZOS_G[0];
  for (let index = 1; index < LANCZOS_G.length; index += 1) {
    sum += LANCZOS_G[index] / (z + index);
  }
  const t = z + 7.5;
  return (0.5 * Math.log(2 * Math.PI)) + ((z + 0.5) * Math.log(t)) - t + Math.log(sum);
}

function betaContinuedFraction(a, b, x) {
  const TINY = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - ((qab * x) / qap);
  if (Math.abs(d) < TINY) {
    d = TINY;
  }
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let numerator = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + (numerator * d);
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = 1 + (numerator / c);
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    h *= d * c;
    numerator = -(((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2)));
    d = 1 + (numerator * d);
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = 1 + (numerator / c);
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-11) {
      break;
    }
  }
  return h;
}

function incompleteBeta(a, b, x) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(x)) {
    return NaN;
  }
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const logFront = logGamma(a + b) - logGamma(a) - logGamma(b)
    + (a * Math.log(x)) + (b * Math.log(1 - x));
  const front = Math.exp(logFront);
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - ((front * betaContinuedFraction(b, a, 1 - x)) / b);
}

// Welch's unequal-variance t-test. Replicate counts differ between plate groups far
// more often than their variances match, so Welch is the default rather than Student.
export function welchTTest(a, b) {
  if (!a || !b || a.n < 2 || b.n < 2) {
    return null;
  }
  const varA = (a.sd ** 2) / a.n;
  const varB = (b.sd ** 2) / b.n;
  const se = Math.sqrt(varA + varB);
  if (!Number.isFinite(se) || se <= 0) {
    return null;
  }
  const t = (a.mean - b.mean) / se;
  const df = ((varA + varB) ** 2)
    / (((varA ** 2) / (a.n - 1)) + ((varB ** 2) / (b.n - 1)));
  if (!Number.isFinite(df) || df <= 0) {
    return null;
  }
  const p = incompleteBeta(df / 2, 0.5, df / (df + (t * t)));
  return {
    t,
    df,
    se,
    difference: a.mean - b.mean,
    p: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : null
  };
}

// Benjamini-Hochberg. Every group on a plate is compared against the same control, so
// the raw p-values are a family; reporting them unadjusted overstates every hit.
export function adjustFdr(pValues) {
  const indexed = pValues
    .map((p, index) => ({ p, index }))
    .filter((item) => Number.isFinite(item.p))
    .sort((a, b) => a.p - b.p);
  const adjusted = pValues.map(() => null);
  let previous = 1;
  for (let rank = indexed.length - 1; rank >= 0; rank -= 1) {
    const { p, index } = indexed[rank];
    previous = Math.min(previous, (p * indexed.length) / (rank + 1));
    adjusted[index] = Math.min(1, previous);
  }
  return adjusted;
}

export function significanceStars(p) {
  if (!Number.isFinite(p)) {
    return '-';
  }
  if (p < 0.001) {
    return '***';
  }
  if (p < 0.01) {
    return '**';
  }
  if (p < 0.05) {
    return '*';
  }
  return 'ns';
}

export function summarizeRobust(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const median = (list) => {
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  };
  const center = median(sorted);
  const deviations = sorted.map((value) => Math.abs(value - center)).sort((a, b) => a - b);
  // 1.4826 rescales the MAD to a normal-consistent SD, which is what makes a robust
  // Z-score comparable to the ordinary one.
  return { median: center, mad: median(deviations) * 1.4826 };
}
