import {
  collectCurvePoints,
  formatNumber,
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

// One runner for every curve analysis. The model table is the only thing that varies;
// grouping, point collection, X transform, fit statistics and the fitted-line chart
// series are shared. Line / semilog line / 4PL / 5PL / quadratic / cubic used to be
// separate menu entries that differed only by the rows of this table.

const FITTED_LINE_SAMPLES = 120;

function resolveModel(spec) {
  if (spec.analysis === 'linear') {
    return {
      label: 'Linear',
      minPoints: 2,
      fit: (points) => fitLineCurve(points, 'Linear')
    };
  }
  if (spec.analysis === 'sigmoidal') {
    return {
      label: spec.asymmetric ? 'Asymmetric Sigmoidal 5PL' : 'Sigmoidal 4PL',
      minPoints: spec.asymmetric ? 5 : 4,
      fit: (points) => fitSigmoidCurve(points, { asymmetric: spec.asymmetric }),
      extraHeaders: ['Potency', 'x50'],
      extraCells: (fit) => {
        const params = fit.params || {};
        if (!Number.isFinite(params.mid) || !Number.isFinite(params.hill)) {
          return ['-', '-'];
        }
        const potency = params.hill >= 0 ? 'EC50' : 'IC50';
        return [potency, formatNumber(params.mid, 6)];
      }
    };
  }
  if (spec.analysis === 'hyperbola') {
    return {
      label: 'Hyperbola',
      minPoints: 3,
      requireNonNegativeX: true,
      fit: (points) => fitHyperbolaCurve(points)
    };
  }
  if (spec.analysis === 'polynomial') {
    return {
      label: `Polynomial (order ${spec.polyOrder})`,
      minPoints: spec.polyOrder + 1,
      fit: (points) => fitPolynomialCurve(points, spec.polyOrder)
    };
  }
  return {
    label: 'Pade (1,1)',
    minPoints: 3,
    fit: (points) => fitPade11Curve(points)
  };
}

function sampleFittedLine(points, predict) {
  const xMin = points[0].x;
  const xMax = points[points.length - 1].x;
  const span = xMax - xMin;
  if (!Number.isFinite(span) || span <= 0) {
    return [];
  }
  const line = [];
  for (let step = 0; step <= FITTED_LINE_SAMPLES; step += 1) {
    const x = xMin + ((span * step) / FITTED_LINE_SAMPLES);
    const y = predict(x);
    if (Number.isFinite(y)) {
      line.push({ x, y });
    }
  }
  return line;
}

export function analyzeCurveFit(observations, grouping, xAxis, spec) {
  const model = resolveModel(spec);
  const seriesGroups = groupBy(observations, (item) => grouping.seriesOf(item));
  const rows = [];
  const showErrorBars = spec.errorBars !== false;
  const chartSeries = [];
  let skipped = 0;

  Array.from(seriesGroups.entries())
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .forEach(([seriesLabel, items]) => {
      const points = collectCurvePoints(items, xAxis.valueOf, {
        requireNonNegativeX: model.requireNonNegativeX
      });
      if (points.length < model.minPoints) {
        skipped += 1;
        return;
      }

      const fit = model.fit(points);
      if (!fit || typeof fit.predict !== 'function') {
        skipped += 1;
        return;
      }
      const stats = summarizeModelFit(points, fit.predict);
      if (!stats) {
        skipped += 1;
        return;
      }

      const label = String(seriesLabel || 'Series');
      rows.push([
        label,
        points.length,
        // model.label is built from the spec, so it is the one that knows the real
        // polynomial order; fitPolynomialCurve only ever says "second"/"third".
        model.label,
        ...(model.extraCells ? model.extraCells(fit) : []),
        formatNumber(stats.r2, 5),
        formatNumber(stats.rmse, 5),
        fit.equation || '-',
        fit.parameters || '-'
      ]);

      const fittedLine = sampleFittedLine(points, fit.predict);
      // The fitted line is a sampled model and has no spread; the observed markers do.
      const markers = points.map((point) => (showErrorBars && point.n > 1 && point.sd > 0
        ? { x: point.x, y: point.y, yVariance: point.sd }
        : { x: point.x, y: point.y }));
      if (fittedLine.length >= 2 || markers.length) {
        chartSeries.push({ label, data: fittedLine, markers });
      }
    });

  const skippedNote = skipped
    ? ` ${skipped} series skipped (need at least ${model.minPoints} valid points).`
    : '';
  const warningNote = grouping.warnings.length
    ? ` Grouping notes: ${grouping.warnings.slice(0, 3).join(' ')}`
    : '';

  return {
    summary: `${model.label} fitted for ${rows.length} series (grouped by ${grouping.seriesHeader}) using ${xAxis.label} as X.${skippedNote}${warningNote}`,
    headers: [
      grouping.seriesHeader,
      'Points',
      'Model',
      ...(model.extraHeaders || []),
      'R²',
      'RMSE',
      'Equation',
      'Parameters'
    ],
    rows,
    chartModel: chartSeries.length
      ? {
        chartType: 'line',
        xLabel: xAxis.label,
        yLabel: 'Response',
        showErrorBars,
        series: chartSeries
      }
      : null
  };
}
