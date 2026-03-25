import {
  clamp,
  formatNumber,
  getDoseAxisConfig,
  groupBy,
  sortByConcentration,
  summarizeNumeric
} from './shared.js';

function logistic4Point(x, params) {
  const exponent = (params.logEC50 - Math.log10(x)) * params.hill;
  return params.bottom + ((params.top - params.bottom) / (1 + (10 ** exponent)));
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

export function analyzeEc50Like(observations, mode) {
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

export function analyzeSurvival(observations) {
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
