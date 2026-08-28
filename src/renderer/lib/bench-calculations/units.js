import { formatSigFig } from '../numbers.js';

function isPositive(value) {
  return Number.isFinite(value) && value > 0;
}

function cleanUnit(unit, fallback = '') {
  return String(unit || fallback || '').trim();
}

function cleanName(value, fallback) {
  return String(value || '').trim() || fallback;
}

function normalizeBufferUnitText(value) {
  return String(value || '')
    .replace(/[µμ]/g, 'u')
    .replace(/\s+/g, '')
    .trim();
}

function parseBufferNumericPrefix(value) {
  const source = String(value ?? '').trim();
  const match = source.match(/([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)/i);
  if (!match) {
    return null;
  }
  const numericValue = Number(match[1]);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return {
    value: numericValue,
    unitText: source.slice(match.index + match[0].length).trim(),
    source
  };
}

function normalizeMolarityUnit(unitText, fallback = 'mM') {
  const clean = normalizeBufferUnitText(unitText);
  if (!clean) {
    return fallback;
  }
  if (/^fm(?:olar)?$/i.test(clean)) {
    return 'fM';
  }
  if (/^pm(?:olar)?$/i.test(clean)) {
    return 'pM';
  }
  if (/^nm(?:olar)?$/i.test(clean)) {
    return 'nM';
  }
  if (/^um(?:olar)?$/i.test(clean)) {
    return 'uM';
  }
  if (/^mm(?:olar)?$/i.test(clean)) {
    return 'mM';
  }
  if (/^(?:m|mol\/l|molar)$/i.test(clean)) {
    return 'M';
  }
  return fallback;
}

function normalizeMassVolumeUnit(unitText, fallbackMassUnit = 'mg', fallbackVolumeUnit = 'mL') {
  const clean = normalizeBufferUnitText(unitText).toLowerCase();
  const match = clean.match(/(ng|ug|mg|g|kg)(?:\/|per)(nl|ul|ml|l)/i);
  if (!match) {
    return {
      massUnit: fallbackMassUnit,
      volumeUnit: fallbackVolumeUnit,
      explicit: false
    };
  }
  const volumeUnit = match[2] === 'nl'
    ? 'nL'
    : (match[2] === 'ul' ? 'uL' : (match[2] === 'ml' ? 'mL' : 'L'));
  return {
    massUnit: match[1] === 'ug' ? 'ug' : match[1],
    volumeUnit,
    explicit: true
  };
}

function inferPercentKind(unitText, fallback = 'volume') {
  const clean = normalizeBufferUnitText(unitText).toLowerCase();
  if (/(?:m\/v|w\/v|mass\/volume|weight\/volume)/.test(clean)) {
    return 'massVolume';
  }
  if (/(?:m\/m|w\/w|mass\/mass|weight\/weight)/.test(clean)) {
    return 'massMass';
  }
  if (/(?:v\/v|volume\/volume)/.test(clean)) {
    return 'volume';
  }
  return fallback;
}

function formatPercentUnit(kind) {
  if (kind === 'massVolume') {
    return '% m/v';
  }
  if (kind === 'massMass') {
    return '% m/m';
  }
  return '% v/v';
}

function buildParsedBufferConcentration({
  raw,
  number,
  kind,
  unit,
  value,
  percentKind = '',
  massUnit = '',
  volumeUnit = '',
  explicitUnit = false
}) {
  const displayUnit = unit || (
    kind === 'percent'
      ? formatPercentUnit(percentKind)
      : (kind === 'fold' ? 'x' : '')
  );
  const text = displayUnit === 'x'
    ? `${formatSigFig(number)}x`
    : `${formatSigFig(number)}${displayUnit ? ` ${displayUnit}` : ''}`;
  return {
    raw: String(raw ?? '').trim(),
    number,
    kind,
    unit: displayUnit,
    value,
    percentKind,
    massUnit,
    volumeUnit,
    explicitUnit,
    missing: false,
    text
  };
}

export {
  buildParsedBufferConcentration,
  cleanName,
  cleanUnit,
  formatPercentUnit,
  inferPercentKind,
  isPositive,
  normalizeBufferUnitText,
  normalizeMassVolumeUnit,
  normalizeMolarityUnit,
  parseBufferNumericPrefix
};
