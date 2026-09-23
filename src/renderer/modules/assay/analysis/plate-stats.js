import {
  adjustFdr,
  formatNumber,
  significanceStars,
  summarizeNumeric,
  summarizeRobust,
  welchTTest
} from './shared.js';
import { collectBuckets, statsCells } from './grouped-summary.js';

// The plate-based analyses that need no X axis: everything is referenced to the
// control wells instead of to a dose. A plate has no control flag, so controls are
// named — the spec's highControl / lowControl match a group label or a sample ID.

const HIGH_CONVENTIONS = /^(pos|positive|high|hi|hc|max|total|untreated|vehicle|dmso|100%?|ctrl\+?|control)$/i;
const LOW_CONVENTIONS = /^(neg|negative|low|lo|lc|min|blank|bkg|background|empty|media|0%?|ctrl-)$/i;

function labelsOf(bucket) {
  return bucket.values.map((value) => String(value).trim());
}

// Matching on the group label covers custom row/column groups named "Control"; the
// sample ID fallback covers a plate that names its controls per well but is grouped
// by something else.
function findControl(buckets, name, convention) {
  const needle = String(name || '').trim().toLowerCase();
  const matches = needle
    ? buckets.filter((bucket) => labelsOf(bucket).some((label) => label.toLowerCase() === needle)
      || bucket.items.some((item) => item.rawSampleId.trim().toLowerCase() === needle))
    : buckets.filter((bucket) => labelsOf(bucket).some((label) => convention.test(label)));
  if (!matches.length) {
    return null;
  }
  const responses = matches.flatMap((bucket) => bucket.responses);
  return {
    label: labelsOf(matches[0]).join(' · '),
    buckets: new Set(matches),
    stats: summarizeNumeric(responses),
    auto: !needle
  };
}

function resolveControls(buckets, spec, warnings) {
  const high = findControl(buckets, spec.highControl, HIGH_CONVENTIONS);
  const low = findControl(buckets, spec.lowControl, LOW_CONVENTIONS);
  if (spec.highControl && !high) {
    warnings.push(`No group or sample matches high control "${spec.highControl}".`);
  }
  if (spec.lowControl && !low) {
    warnings.push(`No group or sample matches low control "${spec.lowControl}".`);
  }
  if (high?.auto) {
    warnings.push(`High control auto-detected as "${high.label}".`);
  }
  if (low?.auto) {
    warnings.push(`Low control auto-detected as "${low.label}".`);
  }
  return { high, low };
}

function missingControlResult(role, grouping) {
  return {
    summary: `Name the ${role} control group to run this analysis. It matches a `
      + `${grouping.seriesHeader} label or a sample ID (case-insensitive), or leave it blank to `
      + 'auto-detect the usual names (Pos/Neg, High/Low, Max/Min, Blank, DMSO).',
    headers: [grouping.seriesHeader],
    rows: []
  };
}

function notes(warnings) {
  return warnings.length ? ` Notes: ${warnings.slice(0, 4).join(' ')}` : '';
}

// --- Percent of control ---------------------------------------------------------
// % activity = (x - low) / (high - low) * 100, the plate-assay normalization. With no
// low control the blank is taken as zero and it degrades to percent of control.
export function analyzePercentControl(observations, grouping, spec) {
  const warnings = [...grouping.warnings];
  const buckets = collectBuckets(observations, grouping);
  const { high, low } = resolveControls(buckets, spec, warnings);
  if (!high?.stats) {
    return missingControlResult('high (100%)', grouping);
  }

  const baseline = low?.stats ? low.stats.mean : 0;
  const span = high.stats.mean - baseline;
  if (!Number.isFinite(span) || span === 0) {
    return {
      summary: `The high and low controls have the same mean (${formatNumber(high.stats.mean)}), `
        + `so there is no window to normalize against.${notes(warnings)}`,
      headers: [grouping.seriesHeader],
      rows: []
    };
  }

  const showErrorBars = spec.errorBars !== false;
  const rows = [];
  const points = [];
  buckets.forEach((bucket) => {
    const activity = ((bucket.stats.mean - baseline) / span) * 100;
    const role = (high.buckets.has(bucket) && 'high') || (low?.buckets.has(bucket) && 'low') || '';
    rows.push([
      ...bucket.values,
      role || 'sample',
      ...statsCells(bucket.stats),
      formatNumber(activity, 2),
      formatNumber(100 - activity, 2)
    ]);
    const point = { x: labelsOf(bucket).join(' · '), y: activity };
    // The SD rides through the same denominator as the mean, so the bar stays in
    // percent units rather than raw response units.
    if (showErrorBars && bucket.stats.n > 1 && bucket.stats.sd > 0) {
      point.yVariance = (bucket.stats.sd / Math.abs(span)) * 100;
    }
    points.push(point);
  });

  return {
    summary: `Normalized to high control "${high.label}" (mean ${formatNumber(high.stats.mean)})`
      + `${low?.stats ? ` and low control "${low.label}" (mean ${formatNumber(low.stats.mean)})` : ' with no low control (blank treated as 0)'}`
      + ` for ${rows.length} group(s) grouped by ${grouping.seriesHeader}.${notes(warnings)}`,
    headers: [
      ...grouping.keys.map((key) => key.header),
      'Role', 'N', 'Mean', 'SD', 'Min', 'Max', '% of Control', '% Inhibition'
    ],
    rows,
    chartModel: points.length
      ? {
        chartType: 'bar',
        xLabel: grouping.seriesHeader,
        yLabel: '% of control',
        showErrorBars,
        series: [{ label: '% of Control', data: points }]
      }
      : null
  };
}

// --- Plate QC -------------------------------------------------------------------
// The standard screening readout for "is this plate usable": Z'-factor (Zhang 1999),
// SSMD, signal window and control %CV.
function verdict(value, thresholds) {
  const hit = thresholds.find(([limit]) => value >= limit);
  return hit ? hit[1] : thresholds[thresholds.length - 1][1];
}

export function analyzePlateQc(observations, grouping, spec) {
  const warnings = [...grouping.warnings];
  const buckets = collectBuckets(observations, grouping);
  const { high, low } = resolveControls(buckets, spec, warnings);
  if (!high?.stats || !low?.stats) {
    return missingControlResult(high?.stats ? 'low (0%)' : 'high (100%)', grouping);
  }
  if (high.stats.n < 2 || low.stats.n < 2) {
    return {
      summary: `Z'-factor needs replicate control wells (high n=${high.stats.n}, low n=${low.stats.n}).${notes(warnings)}`,
      headers: ['Metric', 'Value', 'Detail'],
      rows: []
    };
  }

  const window = high.stats.mean - low.stats.mean;
  const zPrime = 1 - ((3 * (high.stats.sd + low.stats.sd)) / Math.abs(window));
  const ssmd = window / Math.sqrt((high.stats.sd ** 2) + (low.stats.sd ** 2));
  const cv = (stats) => (stats.mean === 0 ? NaN : (stats.sd / Math.abs(stats.mean)) * 100);
  const sampleResponses = buckets
    .filter((bucket) => !high.buckets.has(bucket) && !low.buckets.has(bucket))
    .flatMap((bucket) => bucket.responses);
  const sampleStats = summarizeNumeric(sampleResponses);

  const rows = [
    ["Z'-factor", formatNumber(zPrime, 3), verdict(zPrime, [
      [0.5, 'Excellent (>= 0.5)'],
      [0, 'Marginal (0 - 0.5)'],
      [Number.NEGATIVE_INFINITY, 'Unacceptable (< 0)']
    ])],
    ['SSMD (beta)', formatNumber(Math.abs(ssmd), 3), verdict(Math.abs(ssmd), [
      [3, 'Excellent (>= 3)'],
      [2, 'Good (2 - 3)'],
      [1, 'Moderate (1 - 2)'],
      [Number.NEGATIVE_INFINITY, 'Weak (< 1)']
    ])],
    ['Signal window', formatNumber(window), `${high.label} - ${low.label}`],
    ['Signal / background', low.stats.mean === 0 ? '-' : formatNumber(high.stats.mean / low.stats.mean, 3), 'mean high / mean low'],
    ['Signal / noise', low.stats.sd === 0 ? '-' : formatNumber(window / low.stats.sd, 2), 'window / SD low'],
    ['High control CV%', formatNumber(cv(high.stats), 2), `${high.label}: n=${high.stats.n}, mean=${formatNumber(high.stats.mean)}, SD=${formatNumber(high.stats.sd)}`],
    ['Low control CV%', formatNumber(cv(low.stats), 2), `${low.label}: n=${low.stats.n}, mean=${formatNumber(low.stats.mean)}, SD=${formatNumber(low.stats.sd)}`]
  ];
  if (sampleStats) {
    rows.push(['Sample CV%', formatNumber(cv(sampleStats), 2), `non-control wells: n=${sampleStats.n}, mean=${formatNumber(sampleStats.mean)}`]);
  }

  const showErrorBars = spec.errorBars !== false;
  const controlPoint = (control) => {
    const point = { x: control.label, y: control.stats.mean };
    if (showErrorBars && control.stats.sd > 0) {
      point.yVariance = control.stats.sd;
    }
    point.points = control.stats.n <= 12 ? Array.from(control.buckets).flatMap((bucket) => bucket.responses) : undefined;
    return point;
  };

  return {
    summary: `Z' = ${formatNumber(zPrime, 3)} (${rows[0][2]}), SSMD = ${formatNumber(Math.abs(ssmd), 3)} `
      + `from high control "${high.label}" (n=${high.stats.n}) and low control "${low.label}" (n=${low.stats.n}).${notes(warnings)}`,
    headers: ['Metric', 'Value', 'Detail'],
    rows,
    chartModel: {
      chartType: 'bar',
      xLabel: 'Control',
      yLabel: 'Mean response',
      showErrorBars,
      series: [{ label: 'Control mean', data: [controlPoint(low), controlPoint(high)] }]
    }
  };
}

// --- Well Z-scores --------------------------------------------------------------
// Single-point screening hit calling. Controls are excluded from the population, so
// the plate's own samples define the null, which is what makes a hit a hit.
const HIT_THRESHOLD = 3;

export function analyzeZScore(observations, grouping, spec) {
  const warnings = [...grouping.warnings];
  const buckets = collectBuckets(observations, grouping);
  const { high, low } = resolveControls(buckets, spec, warnings);
  const controlWells = new Set();
  [high, low].forEach((control) => {
    control?.buckets.forEach((bucket) => bucket.items.forEach((item) => controlWells.add(item.well)));
  });

  const samples = observations.filter((item) => !controlWells.has(item.well));
  const population = samples.length >= 3 ? samples : observations;
  if (population.length < 3) {
    return {
      summary: `A Z-score needs at least 3 sample wells (found ${population.length}).${notes(warnings)}`,
      headers: ['Well'],
      rows: []
    };
  }
  if (samples.length < 3 && controlWells.size) {
    warnings.push('Too few non-control wells; controls were kept in the population.');
  }

  const values = population.map((item) => item.response);
  const stats = summarizeNumeric(values);
  const robust = summarizeRobust(values);
  const scoreOf = (value, center, scale) => (
    Number.isFinite(scale) && scale > 0 ? (value - center) / scale : NaN
  );

  const scored = population
    .map((item) => ({
      item,
      z: scoreOf(item.response, stats.mean, stats.sd),
      robustZ: scoreOf(item.response, robust.median, robust.mad)
    }))
    .sort((a, b) => {
      const left = Number.isFinite(b.robustZ) ? b.robustZ : b.z;
      const right = Number.isFinite(a.robustZ) ? a.robustZ : a.z;
      return (left || 0) - (right || 0);
    });

  const hitOf = (score) => {
    if (!Number.isFinite(score) || Math.abs(score) < HIT_THRESHOLD) {
      return '';
    }
    return score > 0 ? 'up' : 'down';
  };
  const rows = scored.map(({ item, z, robustZ }) => [
    item.well,
    item.sampleId,
    item.concentrationLabel,
    formatNumber(item.response),
    formatNumber(z, 3),
    formatNumber(robustZ, 3),
    hitOf(Number.isFinite(robustZ) ? robustZ : z)
  ]);
  const hits = rows.filter((row) => row[6]).length;

  return {
    summary: `Z-scored ${population.length} well(s) against mean ${formatNumber(stats.mean)} / SD ${formatNumber(stats.sd)} `
      + `and median ${formatNumber(robust.median)} / MAD ${formatNumber(robust.mad)}. `
      + `${hits} hit(s) at |robust Z| >= ${HIT_THRESHOLD}`
      + `${controlWells.size ? `; ${controlWells.size} control well(s) excluded` : ''}.${notes(warnings)}`,
    headers: ['Well', 'Sample ID', 'Concentration', 'Value', 'Z', 'Robust Z', 'Hit'],
    rows,
    chartModel: {
      chartType: 'bar',
      xLabel: 'Well',
      yLabel: `Robust Z (hit at |Z| >= ${HIT_THRESHOLD})`,
      showErrorBars: false,
      series: [{
        label: 'Robust Z',
        data: scored.map(({ item, z, robustZ }) => ({
          x: item.well,
          y: Number.isFinite(robustZ) ? robustZ : z
        }))
      }]
    }
  };
}

// --- Each group against one control ---------------------------------------------
// Welch's t-test plus a Benjamini-Hochberg q, because every group on the plate is
// tested against the same control and the raw p-values are one family.
export function analyzeTTest(observations, grouping, spec) {
  const warnings = [...grouping.warnings];
  const buckets = collectBuckets(observations, grouping);
  if (buckets.length < 2) {
    return {
      summary: `Comparing to a control needs at least two groups (found ${buckets.length}). `
        + `Pick a different Group By.${notes(warnings)}`,
      headers: [grouping.seriesHeader],
      rows: []
    };
  }

  const { high, low } = resolveControls(buckets, spec, warnings);
  // The vehicle / negative control is the usual baseline, so it wins when both are
  // named; with neither, the first group in sort order is the reference.
  const reference = low || high;
  const referenceBuckets = reference ? reference.buckets : new Set([buckets[0]]);
  const referenceStats = reference?.stats || buckets[0].stats;
  const referenceLabel = reference?.label || labelsOf(buckets[0]).join(' · ');
  if (!reference) {
    warnings.push(`No control named; "${referenceLabel}" used as the reference group.`);
  }
  if (referenceStats.n < 2) {
    return {
      summary: `Reference group "${referenceLabel}" has no replicates (n=${referenceStats.n}), so no test is possible.${notes(warnings)}`,
      headers: [grouping.seriesHeader],
      rows: []
    };
  }

  const tested = buckets.map((bucket) => ({
    bucket,
    isReference: referenceBuckets.has(bucket),
    test: referenceBuckets.has(bucket) ? null : welchTTest(bucket.stats, referenceStats)
  }));
  const qValues = adjustFdr(tested.map((entry) => (entry.test ? entry.test.p : null)));

  const showErrorBars = spec.errorBars !== false;
  const rows = [];
  const points = [];
  tested.forEach((entry, index) => {
    const { bucket, isReference, test } = entry;
    const q = qValues[index];
    rows.push([
      ...bucket.values,
      isReference ? 'reference' : 'test',
      bucket.stats.n,
      formatNumber(bucket.stats.mean),
      formatNumber(bucket.stats.sd),
      isReference ? '-' : formatNumber(bucket.stats.mean - referenceStats.mean),
      isReference ? '-' : formatNumber(((bucket.stats.mean / referenceStats.mean) * 100), 2),
      test ? formatNumber(test.t, 3) : '-',
      test ? formatNumber(test.df, 2) : '-',
      test?.p === null || !test ? '-' : test.p.toExponential(3),
      Number.isFinite(q) ? q.toExponential(3) : '-',
      isReference ? '-' : significanceStars(q)
    ]);
    const point = { x: labelsOf(bucket).join(' · '), y: bucket.stats.mean };
    if (showErrorBars && bucket.stats.n > 1 && bucket.stats.sd > 0) {
      point.yVariance = bucket.stats.sd;
    }
    if (bucket.stats.n > 1 && bucket.stats.n <= 12) {
      point.points = bucket.responses.slice();
    }
    points.push(point);
  });

  const significant = rows.filter((row) => ['*', '**', '***'].includes(row[row.length - 1])).length;
  const untestable = tested.filter((entry) => !entry.isReference && !entry.test).length;

  return {
    summary: `Welch t-test of ${tested.length - referenceBuckets.size} group(s) against `
      + `"${referenceLabel}" (n=${referenceStats.n}, mean ${formatNumber(referenceStats.mean)}). `
      + `${significant} significant at BH q < 0.05`
      + `${untestable ? `; ${untestable} group(s) had no replicates to test` : ''}. `
      + `Stars read from q, not p.${notes(warnings)}`,
    headers: [
      ...grouping.keys.map((key) => key.header),
      'Role', 'N', 'Mean', 'SD', 'Diff vs control', '% of control', 't', 'df', 'p', 'q (BH)', 'Signif.'
    ],
    rows,
    chartModel: points.length
      ? {
        chartType: 'bar',
        xLabel: grouping.seriesHeader,
        yLabel: 'Mean',
        showErrorBars,
        series: [{ label: 'Mean', data: points }]
      }
      : null
  };
}
