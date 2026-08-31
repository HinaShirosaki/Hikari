import { formatSigFig, toNumber } from '../numbers.js';
import { ADAPTIVE_CONCENTRATION_UNITS, ADAPTIVE_MASS_UNITS, ADAPTIVE_VOLUME_UNITS } from './constants.js';
import { cleanName, cleanUnit, isPositive } from './units.js';

function describeInput(value, unit, label) {
  const numericValue = toNumber(value);
  if (isPositive(numericValue)) {
    const suffix = cleanUnit(unit);
    return `${formatSigFig(numericValue)}${suffix ? ` ${suffix}` : ''}`;
  }
  return `[${label}]`;
}

function describeRawValue(value, unit, label) {
  const numericValue = toNumber(value);
  if (isPositive(numericValue)) {
    return {
      text: describeInput(value, unit, label),
      missing: false,
      value: numericValue
    };
  }
  return {
    text: `[${label}]`,
    missing: true,
    value: 0
  };
}

function buildResult({
  type,
  mode = '',
  title,
  inputs = {},
  resultText = '',
  formulaText = '',
  details = [],
  missing = [],
  status = ''
} = {}) {
  const cleanMissing = Array.from(new Set((Array.isArray(missing) ? missing : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
  const cleanResult = String(resultText || '').trim();
  const cleanFormula = String(formulaText || '').trim();
  return {
    type,
    mode,
    title: cleanName(title, 'Bench Calculation'),
    inputs,
    resultText: cleanResult,
    formulaText: cleanFormula,
    details: Array.isArray(details) ? details : [],
    missing: cleanMissing,
    status: status || (cleanMissing.length ? 'formula' : 'calculated'),
    summaryText: cleanResult || cleanFormula
  };
}

function collectMissing(...items) {
  return items
    .filter((item) => item?.missing)
    .map((item) => String(item?.label || '').trim())
    .filter(Boolean);
}

function withLabel(item, label) {
  return {
    ...item,
    label
  };
}

function formatAdaptiveQuantity(value, units, zeroUnit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return `0 ${zeroUnit}`;
  }
  const absoluteValue = Math.abs(numericValue);
  const selected = units.find(({ factor }) => absoluteValue >= factor) || units[units.length - 1];
  return `${formatSigFig(numericValue / selected.factor)} ${selected.unit}`;
}

function formatAdaptiveVolume(valueL) {
  return formatAdaptiveQuantity(valueL, ADAPTIVE_VOLUME_UNITS, 'uL');
}

function formatAdaptiveMass(valueG) {
  return formatAdaptiveQuantity(valueG, ADAPTIVE_MASS_UNITS, 'mg');
}

function formatAdaptiveConcentration(valueM) {
  return formatAdaptiveQuantity(valueM, ADAPTIVE_CONCENTRATION_UNITS, 'mM');
}

export {
  buildResult,
  collectMissing,
  describeRawValue,
  formatAdaptiveConcentration,
  formatAdaptiveMass,
  formatAdaptiveVolume,
  withLabel
};
