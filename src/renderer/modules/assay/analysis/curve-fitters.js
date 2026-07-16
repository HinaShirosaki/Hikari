import {
  formatNumber,
  linearRegression,
  optimizeModelParameters,
  solveLinearSystem
} from './shared.js';

export function fitPolynomialCurve(points, degree) {
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

export function fitLineCurve(points, modelLabel = 'Line', xTerm = 'x') {
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

export function sigmoid4CurvePoint(x, params) {
  const exponent = params.hill * (params.mid - x);
  const denominator = 1 + Math.exp(exponent);
  return params.bottom + ((params.top - params.bottom) / denominator);
}

export function sigmoid5CurvePoint(x, params) {
  const exponent = params.hill * (params.mid - x);
  const denominator = (1 + Math.exp(exponent)) ** params.asymmetry;
  return params.bottom + ((params.top - params.bottom) / denominator);
}

export function fitSigmoidCurve(points, { asymmetric = false } = {}) {
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

export function hyperbolaCurvePoint(x, params) {
  const denominator = params.kd + x;
  if (denominator <= 0) {
    return NaN;
  }
  return params.bottom + (((params.top - params.bottom) * x) / denominator);
}

export function fitHyperbolaCurve(points) {
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

export function pade11Point(x, params) {
  const denominator = 1 + (params.b1 * x);
  if (Math.abs(denominator) < 1e-7) {
    return NaN;
  }
  return (params.a0 + (params.a1 * x)) / denominator;
}

export function fitPade11Curve(points) {
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
