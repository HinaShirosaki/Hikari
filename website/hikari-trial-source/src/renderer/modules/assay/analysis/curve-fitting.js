import { summarizeNumeric } from './analysis-basics.js';

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

// Pools replicate wells: one point per distinct x, y = mean response, with n
// and sd kept for error bars. Fits run on these means, not raw replicates.
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

// Derivative-free fitter for the nonlinear models (4PL/5PL, hyperbola, Pade,
// exponential): coordinate pattern search minimising sum of squared errors.
// Each round nudges every parameter +/- its step and keeps any improvement;
// a round with no improvement halves all steps. Stops after maxRounds or when
// every step falls below minStep. Candidates are clamped to `bounds` and may
// be repaired by normalizeParams (e.g. keep top > bottom).
// ponytail: pattern search, not Levenberg-Marquardt; it can stop short on
// badly scaled data. Raise maxRounds or swap in LM if fits look under-converged.
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

// Gauss-Jordan elimination with partial pivoting; null if the matrix is
// singular (pivot < 1e-12) or holds non-finite values. Used for polynomial
// least-squares normal equations.
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
