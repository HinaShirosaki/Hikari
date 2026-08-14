import {
  describeObservationAxes,
  parseDimensionGroupSpec
} from './shared.js';

// The analysis spec separates the two decisions the old flat method menu fused:
// how wells are pooled (groupBy) and what model is applied (analysis). The X axis
// is its own choice so it stops being guessed from the data shape.

export const GROUP_BY_VALUES = Object.freeze([
  'auto', 'sample', 'concentration', 'sample_concentration', 'row', 'column', 'custom'
]);
export const X_AXIS_VALUES = Object.freeze(['auto', 'concentration', 'sample', 'column']);
export const ANALYSIS_VALUES = Object.freeze([
  'summary', 'linear', 'sigmoidal', 'hyperbola', 'polynomial', 'pade11', 'normalize'
]);
export const X_TRANSFORM_VALUES = Object.freeze(['none', 'log10']);

export const ANALYSIS_LABELS = Object.freeze({
  summary: 'Summary statistics',
  linear: 'Linear fit',
  sigmoidal: 'Sigmoidal fit',
  hyperbola: 'Hyperbola',
  polynomial: 'Polynomial',
  pade11: 'Pade (1,1)',
  normalize: 'Normalize to baseline'
});

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function normalizeAnalysisSpec(input) {
  const source = input && typeof input === 'object' ? input : {};
  const order = Number(source.polyOrder);
  return {
    groupBy: pick(source.groupBy, GROUP_BY_VALUES, 'auto'),
    xAxis: pick(source.xAxis, X_AXIS_VALUES, 'auto'),
    analysis: pick(source.analysis, ANALYSIS_VALUES, 'summary'),
    xTransform: pick(source.xTransform, X_TRANSFORM_VALUES, 'none'),
    polyOrder: Number.isInteger(order) && order >= 2 && order <= 4 ? order : 2,
    asymmetric: Boolean(source.asymmetric),
    subtotals: Boolean(source.subtotals),
    errorBars: source.errorBars !== false
  };
}

// Saved analyses (and any old assay records) carry a flat method string. Every one of
// them is a point in the new spec space.
const LEGACY_METHODS = Object.freeze({
  grouped_summary: { analysis: 'summary' },
  nested_summary: { analysis: 'summary', groupBy: 'sample_concentration', subtotals: true },
  row_summary: { analysis: 'summary', groupBy: 'row' },
  column_summary: { analysis: 'summary', groupBy: 'column' },
  linear_regression: { analysis: 'linear' },
  ec50: { analysis: 'sigmoidal', xAxis: 'concentration', xTransform: 'log10' },
  ic50: { analysis: 'sigmoidal', xAxis: 'concentration', xTransform: 'log10' },
  survival: { analysis: 'normalize' },
  standard_curve_line: { analysis: 'linear', xAxis: 'concentration' },
  standard_curve_semilog_line: { analysis: 'linear', xAxis: 'concentration', xTransform: 'log10' },
  standard_curve_4pl_log_concentration: { analysis: 'sigmoidal', xAxis: 'concentration', xTransform: 'log10' },
  standard_curve_4pl_concentration: { analysis: 'sigmoidal', xAxis: 'concentration' },
  standard_curve_5pl_log_concentration: {
    analysis: 'sigmoidal', xAxis: 'concentration', xTransform: 'log10', asymmetric: true
  },
  standard_curve_5pl_concentration: { analysis: 'sigmoidal', xAxis: 'concentration', asymmetric: true },
  standard_curve_hyperbola: { analysis: 'hyperbola', xAxis: 'concentration' },
  standard_curve_quadratic: { analysis: 'polynomial', xAxis: 'concentration', polyOrder: 2 },
  standard_curve_cubic: { analysis: 'polynomial', xAxis: 'concentration', polyOrder: 3 },
  standard_curve_pade_11: { analysis: 'pade11', xAxis: 'concentration' }
});

export function specFromLegacyMethod(method) {
  return normalizeAnalysisSpec(LEGACY_METHODS[String(method || '')] || {});
}

export function describeAnalysisSpec(spec) {
  const normalized = normalizeAnalysisSpec(spec);
  const parts = [ANALYSIS_LABELS[normalized.analysis]];
  if (normalized.analysis === 'sigmoidal') {
    parts[0] = normalized.asymmetric ? 'Asymmetric sigmoidal fit (5PL)' : 'Sigmoidal fit (4PL)';
  }
  if (normalized.analysis === 'polynomial') {
    parts[0] = `Polynomial fit (order ${normalized.polyOrder})`;
  }
  parts.push(`grouped by ${normalized.groupBy}`);
  if (normalized.analysis !== 'summary') {
    const transform = normalized.xTransform === 'log10' ? 'log10 ' : '';
    parts.push(`X = ${transform}${normalized.xAxis}`);
  }
  return parts.join(' · ');
}

const ALL_WELLS_KEY = Object.freeze({
  header: 'Series',
  factor: null,
  keyOf: () => 'All Wells',
  sortOf: () => 0
});

const SAMPLE_KEY = Object.freeze({
  header: 'Sample ID',
  factor: 'sample',
  keyOf: (item) => item.sampleId,
  sortOf: (item) => (Number.isFinite(item.sampleValue) ? item.sampleValue : Number.POSITIVE_INFINITY)
});

const CONCENTRATION_KEY = Object.freeze({
  header: 'Concentration',
  factor: 'concentration',
  keyOf: (item) => item.concentrationLabel,
  sortOf: (item) => (
    Number.isFinite(item.concentrationValue) ? item.concentrationValue : Number.POSITIVE_INFINITY
  )
});

const ROW_KEY = Object.freeze({
  header: 'Row',
  factor: 'row',
  keyOf: (item) => item.rowLabel,
  sortOf: (item) => item.rowIndex
});

const COLUMN_KEY = Object.freeze({
  header: 'Column',
  factor: 'column',
  keyOf: (item) => String(item.columnNumber),
  sortOf: (item) => item.columnIndex
});

function customDimensionKey(dimension, groupSpec) {
  const isRow = dimension === 'row';
  const base = isRow ? ROW_KEY : COLUMN_KEY;
  return {
    header: isRow ? 'Row Group' : 'Column Group',
    factor: isRow ? 'row' : 'column',
    keyOf: (item) => {
      const member = base.keyOf(item);
      return groupSpec.memberToGroup.get(member)?.label || member;
    },
    sortOf: (item) => {
      const member = base.keyOf(item);
      const group = groupSpec.memberToGroup.get(member);
      return group ? group.sortIndex : base.sortOf(item);
    }
  };
}

function resolveCustomKeys(options, warnings) {
  const rowSpec = parseDimensionGroupSpec(
    options.rowGroups?.groupSpec,
    'row',
    Number(options.rowGroups?.maxMemberCount)
  );
  const columnSpec = parseDimensionGroupSpec(
    options.columnGroups?.groupSpec,
    'column',
    Number(options.columnGroups?.maxMemberCount)
  );
  warnings.push(...rowSpec.warnings, ...columnSpec.warnings);

  const keys = [];
  if (rowSpec.groups.length) {
    keys.push(customDimensionKey('row', rowSpec));
  }
  if (columnSpec.groups.length) {
    keys.push(customDimensionKey('column', columnSpec));
  }
  return { keys, groupCount: rowSpec.groups.length + columnSpec.groups.length };
}

export function resolveXAxis(observations, spec) {
  const axes = describeObservationAxes(observations);
  const descriptors = {
    concentration: {
      header: 'Concentration',
      factor: 'concentration',
      valueOf: (item) => item.concentrationValue,
      labelOf: (item) => item.concentrationLabel
    },
    sample: {
      header: 'Sample ID',
      factor: 'sample',
      valueOf: (item) => item.sampleValue,
      labelOf: (item) => item.sampleId
    },
    column: {
      header: 'Column',
      factor: 'column',
      valueOf: (item) => item.columnNumber,
      labelOf: (item) => String(item.columnNumber)
    }
  };

  const chosen = spec.xAxis === 'auto'
    ? (
      // eslint-disable-next-line no-nested-ternary
      axes.numericConcentrationCount >= 2
        ? 'concentration'
        : (axes.numericSampleCount >= 2 ? 'sample' : 'column')
    )
    : spec.xAxis;

  const descriptor = descriptors[chosen] || descriptors.column;
  const numericCount = observations.reduce((count, item) => (
    Number.isFinite(descriptor.valueOf(item)) ? count + 1 : count
  ), 0);
  if (!numericCount) {
    return null;
  }
  return {
    ...descriptor,
    label: spec.xTransform === 'log10' ? `log10(${descriptor.header})` : descriptor.header
  };
}

// Builds the grouping used by every analysis. `xAxis` (null for summary tables) removes
// the factor already spent on the X axis, so "Sample x Concentration" over a
// concentration dose axis correctly leaves one series per sample.
export function resolveGrouping(observations, spec, options = {}, xAxis = null) {
  const warnings = [];
  const axes = describeObservationAxes(observations);
  let groupBy = spec.groupBy;

  if (groupBy === 'auto') {
    if (axes.hasSampleFactor && axes.hasConcentrationFactor) {
      groupBy = 'sample_concentration';
    } else if (axes.hasSampleFactor) {
      groupBy = 'sample';
    } else if (axes.hasConcentrationFactor) {
      groupBy = 'concentration';
    } else {
      groupBy = 'all';
    }
  }

  let keys = [];
  let detail = null;

  if (groupBy === 'custom') {
    const custom = resolveCustomKeys(options, warnings);
    if (!custom.keys.length) {
      warnings.push('No custom groups defined; falling back to automatic grouping.');
      return resolveGrouping(observations, { ...spec, groupBy: 'auto' }, options, xAxis);
    }
    keys = custom.keys;
    detail = custom.keys.length === 1
      ? {
        header: custom.keys[0].factor === 'row' ? 'Rows' : 'Columns',
        valueOf: custom.keys[0].factor === 'row' ? ROW_KEY.keyOf : COLUMN_KEY.keyOf
      }
      : null;
  } else if (groupBy === 'sample') {
    keys = [SAMPLE_KEY];
  } else if (groupBy === 'concentration') {
    keys = [CONCENTRATION_KEY];
  } else if (groupBy === 'sample_concentration') {
    keys = [SAMPLE_KEY, CONCENTRATION_KEY];
  } else if (groupBy === 'row') {
    keys = [ROW_KEY];
  } else if (groupBy === 'column') {
    keys = [COLUMN_KEY];
  } else {
    keys = [ALL_WELLS_KEY];
  }

  if (xAxis) {
    const kept = keys.filter((key) => key.factor !== xAxis.factor);
    if (kept.length !== keys.length && !kept.length) {
      keys = [ALL_WELLS_KEY];
    } else if (kept.length !== keys.length) {
      keys = kept;
    }
  }

  const seriesHeader = keys.map((key) => key.header).join(' x ');
  return {
    groupBy,
    keys,
    detail,
    warnings,
    seriesHeader,
    seriesOf: (item) => keys.map((key) => key.keyOf(item)).join(' · ')
  };
}
