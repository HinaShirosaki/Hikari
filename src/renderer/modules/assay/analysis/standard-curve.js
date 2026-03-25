import {
  collectCurvePoints,
  formatNumber,
  getConcentrationAxisConfig,
  groupBy,
  summarizeModelFit
} from './shared.js';
import {
  fitHyperbolaCurve,
  fitLineCurve,
  fitPade11Curve,
  fitPolynomialCurve,
  fitSigmoidCurve
} from './curve-fitters.js';

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

export function isStandardCurveMethod(method) {
  return Boolean(STANDARD_CURVE_METHODS[method]);
}

export function analyzeStandardCurve(observations, method) {
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
