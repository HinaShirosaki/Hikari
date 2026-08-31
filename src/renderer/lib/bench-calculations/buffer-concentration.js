import { BUFFER_COMPOUNDS } from '../chemistry/buffer-compounds.js';
import { formatSigFig } from '../numbers.js';
import { concentrationToM } from '../molarity.js';
import { BUFFER_MASS_FACTORS_G, BUFFER_PKA_HINTS, BUFFER_VOLUME_FACTORS_L } from './constants.js';
import { buildParsedBufferConcentration, formatPercentUnit, inferPercentKind, normalizeBufferUnitText, normalizeMassVolumeUnit, normalizeMolarityUnit, parseBufferNumericPrefix } from './units.js';

function parseBufferConcentration(value, options = {}) {
  const parsed = parseBufferNumericPrefix(value);
  if (!parsed) {
    return {
      raw: String(value ?? '').trim(),
      missing: true,
      text: ''
    };
  }

  const unitText = parsed.unitText;
  const compactUnit = normalizeBufferUnitText(unitText);
  const compactLower = compactUnit.toLowerCase();
  const defaultKind = options.defaultKind || 'molar';
  const explicitUnit = Boolean(compactUnit);

  if (/[x×]$/i.test(compactLower) || compactLower === 'fold') {
    return buildParsedBufferConcentration({
      raw: parsed.source,
      number: parsed.value,
      kind: 'fold',
      unit: 'x',
      value: parsed.value,
      explicitUnit: true
    });
  }

  if (compactLower.includes('%') || /(?:v\/v|m\/v|w\/v|m\/m|w\/w|volume\/volume|mass\/volume|weight\/volume|mass\/mass|weight\/weight)/.test(compactLower)) {
    const percentKind = inferPercentKind(unitText, options.defaultPercentKind || 'volume');
    return buildParsedBufferConcentration({
      raw: parsed.source,
      number: parsed.value,
      kind: 'percent',
      unit: formatPercentUnit(percentKind),
      value: parsed.value,
      percentKind,
      explicitUnit: true
    });
  }

  const massVolumeUnit = normalizeMassVolumeUnit(
    unitText,
    options.defaultMassUnit || 'mg',
    options.defaultVolumeUnit || 'mL'
  );
  if (massVolumeUnit.explicit) {
    const massFactor = BUFFER_MASS_FACTORS_G[massVolumeUnit.massUnit] || 0;
    const volumeFactor = BUFFER_VOLUME_FACTORS_L[massVolumeUnit.volumeUnit] || 0;
    return buildParsedBufferConcentration({
      raw: parsed.source,
      number: parsed.value,
      kind: 'massVolume',
      unit: `${massVolumeUnit.massUnit}/${massVolumeUnit.volumeUnit}`,
      value: volumeFactor ? (parsed.value * massFactor) / volumeFactor : 0,
      massUnit: massVolumeUnit.massUnit,
      volumeUnit: massVolumeUnit.volumeUnit,
      explicitUnit: true
    });
  }

  if (!explicitUnit && defaultKind === 'fold') {
    return buildParsedBufferConcentration({
      raw: parsed.source,
      number: parsed.value,
      kind: 'fold',
      unit: 'x',
      value: parsed.value,
      explicitUnit: false
    });
  }

  if (!explicitUnit && defaultKind === 'massVolume') {
    const unit = normalizeMassVolumeUnit(
      '',
      options.defaultMassUnit || 'mg',
      options.defaultVolumeUnit || 'mL'
    );
    const massFactor = BUFFER_MASS_FACTORS_G[unit.massUnit] || 0;
    const volumeFactor = BUFFER_VOLUME_FACTORS_L[unit.volumeUnit] || 0;
    return buildParsedBufferConcentration({
      raw: parsed.source,
      number: parsed.value,
      kind: 'massVolume',
      unit: `${unit.massUnit}/${unit.volumeUnit}`,
      value: volumeFactor ? (parsed.value * massFactor) / volumeFactor : 0,
      massUnit: unit.massUnit,
      volumeUnit: unit.volumeUnit,
      explicitUnit: false
    });
  }

  if (!explicitUnit && defaultKind === 'percent') {
    const percentKind = options.defaultPercentKind || 'volume';
    return buildParsedBufferConcentration({
      raw: parsed.source,
      number: parsed.value,
      kind: 'percent',
      unit: formatPercentUnit(percentKind),
      value: parsed.value,
      percentKind,
      explicitUnit: false
    });
  }

  const unit = normalizeMolarityUnit(unitText, options.defaultUnit || 'mM');
  return buildParsedBufferConcentration({
    raw: parsed.source,
    number: parsed.value,
    kind: 'molar',
    unit,
    value: concentrationToM(parsed.value, unit),
    explicitUnit
  });
}

function bufferConcentrationDefaultsFrom(parsed, fallback = {}) {
  if (!parsed || parsed.missing) {
    return fallback;
  }
  if (parsed.kind === 'massVolume') {
    return {
      defaultKind: 'massVolume',
      defaultMassUnit: parsed.massUnit || 'mg',
      defaultVolumeUnit: parsed.volumeUnit || 'mL'
    };
  }
  if (parsed.kind === 'percent') {
    return {
      defaultKind: 'percent',
      defaultPercentKind: parsed.percentKind || fallback.defaultPercentKind || 'volume'
    };
  }
  if (parsed.kind === 'fold') {
    return { defaultKind: 'fold' };
  }
  if (parsed.kind === 'molar') {
    return {
      defaultKind: 'molar',
      defaultUnit: parsed.unit || fallback.defaultUnit || 'mM'
    };
  }
  return fallback;
}

function bufferDefaultsForForm(form) {
  return String(form || '').trim() === 'liquid'
    ? { defaultKind: 'percent', defaultPercentKind: 'volume' }
    : { defaultKind: 'molar', defaultUnit: 'mM', defaultPercentKind: 'massVolume' };
}

function bufferConcentrationsCompatible(stock, final) {
  if (!stock || stock.missing || !final || final.missing || stock.kind !== final.kind) {
    return false;
  }
  if (stock.kind !== 'percent') {
    return true;
  }
  return (stock.percentKind || 'volume') === (final.percentKind || 'volume');
}

function bufferConcentrationBaseValue(parsed) {
  if (!parsed || parsed.missing) {
    return 0;
  }
  return parsed.value;
}

function formatBufferVolumeMl(valueMl) {
  const value = Number(valueMl);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 uL';
  }
  if (value < 1) {
    return `${formatSigFig(value * 1000)} uL`;
  }
  return `${formatSigFig(value)} mL`;
}

function formatBufferVolumeDual(valueMl) {
  const value = Number(valueMl);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 mL (0 uL)';
  }
  return `${formatSigFig(value)} mL (${formatSigFig(value * 1000)} uL)`;
}

function formatBufferMassDual(valueG) {
  const grams = Number(valueG);
  if (!Number.isFinite(grams) || grams <= 0) {
    return '0 mg (0 g)';
  }
  const milligrams = grams * 1000;
  if (milligrams >= 0.001) {
    return `${formatSigFig(milligrams)} mg (${formatSigFig(grams)} g)`;
  }
  const micrograms = grams * 1e6;
  if (micrograms >= 0.001) {
    return `${formatSigFig(micrograms)} ug`;
  }
  return `${formatSigFig(grams * 1e9)} ng`;
}

function resolveBufferCompound(name) {
  const clean = String(name || '').trim();
  return BUFFER_COMPOUNDS.find((compound) => compound.name === clean) || null;
}

function findBufferPkaHint(name) {
  const source = String(name || '').trim();
  const compound = resolveBufferCompound(source);
  const pKa = Number(compound?.pKa);
  if (Number.isFinite(pKa)) {
    return { pKa, label: compound.name };
  }
  return BUFFER_PKA_HINTS.find((hint) => hint.pattern.test(source)) || null;
}

export {
  resolveBufferCompound,
  bufferConcentrationBaseValue,
  bufferConcentrationDefaultsFrom,
  bufferConcentrationsCompatible,
  bufferDefaultsForForm,
  findBufferPkaHint,
  formatBufferMassDual,
  formatBufferVolumeDual,
  formatBufferVolumeMl,
  parseBufferConcentration
};
