const SCALE_MAP = {
  fm: 1e-15,
  pm: 1e-12,
  nm: 1e-9,
  um: 1e-6,
  mm: 1e-3,
  cm: 1e-2,
  m: 1,
  gm: 1,
  mg: 1e-3,
  ug: 1e-6,
  ng: 1e-9,
  pg: 1e-12,
  kg: 1e3
};

// Common molar units offered as type-ahead suggestions for the concentration axis.
export const CONCENTRATION_UNIT_SUGGESTIONS = Object.freeze(['fM', 'pM', 'nM', 'µM', 'mM', 'M']);

function normalizeUnit(rawUnit) {
  return String(rawUnit || '')
    .trim()
    .toLowerCase()
    .replace(/μ/g, 'u')
    .replace(/µ/g, 'u')
    .replace(/\/.*$/, '');
}

function parseConcentrationParts(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const match = text.match(/([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-zA-Zµμ]*)/);
  if (!match) {
    return null;
  }
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return { numeric, unit: normalizeUnit(match[2]) };
}

// Magnitude in base units. A bare number falls back to `defaultUnit` (the axis
// unit) so "100" + axis "nM" reads as 1e-7 M; an inline unit always wins.
export function parseConcentrationMagnitude(value, defaultUnit = '') {
  const parts = parseConcentrationParts(value);
  if (!parts) {
    return null;
  }
  const unit = parts.unit || normalizeUnit(defaultUnit);
  const scale = SCALE_MAP[unit] || 1;
  return parts.numeric * scale;
}

// True when the text already carries its own unit (so the axis unit shouldn't override).
export function hasExplicitUnit(value) {
  const parts = parseConcentrationParts(value);
  return Boolean(parts && parts.unit);
}

// Display label: append the axis unit to a bare-number value, leave labelled values alone.
export function formatConcentrationLabel(value, defaultUnit = '') {
  const text = String(value || '').trim();
  const unit = String(defaultUnit || '').trim();
  if (!text || !unit || hasExplicitUnit(text)) {
    return text;
  }
  return `${text} ${unit}`;
}

// Split "100 nM" into { numeric: 100, unit: 'nM' } keeping the unit's original case.
export function splitConcentrationValue(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const match = text.match(/^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(.*)$/);
  if (!match) {
    return null;
  }
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return { numeric, unit: String(match[2] || '').trim() };
}

// Compact number for filled concentration cells: ~4 significant figures, no trailing zeros.
export function formatConcentrationNumber(value) {
  if (!Number.isFinite(value)) {
    return '';
  }
  if (value === 0) {
    return '0';
  }
  return String(Number(value.toPrecision(4)));
}

// Scale of a unit relative to base units (e.g. 'nM' -> 1e-9); unknown/empty -> 1.
export function unitScale(unit) {
  return SCALE_MAP[normalizeUnit(unit)] || 1;
}

// Interpolated series of length `count` from `startValue` to `endValue` inclusive.
// mode 'log' spaces geometrically (constant ratio, both ends must be > 0); 'linear'
// spaces arithmetically. Values are converted through magnitudes so a different unit
// on each end still interpolates correctly. Returns null on bad input.
export function buildInterpolatedSeries({ startValue, endValue, count, mode, axisUnit = '' }) {
  const startParts = splitConcentrationValue(startValue);
  const endParts = splitConcentrationValue(endValue);
  if (!startParts || !endParts || !(Number.isInteger(count) && count >= 2)) {
    return null;
  }
  const startMagnitude = parseConcentrationMagnitude(startValue, axisUnit);
  const endMagnitude = parseConcentrationMagnitude(endValue, axisUnit);
  if (!Number.isFinite(startMagnitude) || !Number.isFinite(endMagnitude)) {
    return null;
  }
  const isLog = mode === 'log';
  if (isLog && !(startMagnitude > 0 && endMagnitude > 0)) {
    return null;
  }
  const displayUnit = startParts.unit || endParts.unit || String(axisUnit || '').trim();
  const suffix = displayUnit ? ` ${displayUnit}` : '';
  const scale = unitScale(displayUnit);
  const series = [];
  for (let step = 0; step < count; step += 1) {
    const t = step / (count - 1);
    const magnitude = isLog
      ? startMagnitude * ((endMagnitude / startMagnitude) ** t)
      : startMagnitude + (endMagnitude - startMagnitude) * t;
    series.push(`${formatConcentrationNumber(magnitude / scale)}${suffix}`);
  }
  return series;
}

// Serial-dilution series of length `count` starting at `startValue`, dividing by
// `factor` each step. Keeps the start cell's unit suffix. Returns null on bad input.
export function buildDilutionSeries(startValue, factor, count) {
  const parts = splitConcentrationValue(startValue);
  if (!parts || !(Number.isFinite(factor) && factor > 0) || !(Number.isInteger(count) && count > 0)) {
    return null;
  }
  const unitSuffix = parts.unit ? ` ${parts.unit}` : '';
  const series = [];
  for (let step = 0; step < count; step += 1) {
    series.push(`${formatConcentrationNumber(parts.numeric / (factor ** step))}${unitSuffix}`);
  }
  return series;
}

export function formatDecimal(value) {
  if (!Number.isFinite(value)) {
    return '';
  }
  const absolute = Math.abs(value);
  const decimals = absolute >= 100 ? 1 : absolute >= 10 ? 2 : absolute >= 1 ? 3 : 4;
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}

export function formatVolumeText(value) {
  return Number.isFinite(value) ? `${formatDecimal(value)} uL` : '-';
}
