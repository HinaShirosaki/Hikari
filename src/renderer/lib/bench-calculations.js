import { BUFFER_COMPOUNDS } from './chemistry/buffer-compounds.js';
import { formatSigFig, toNumber } from './numbers.js';
import {
  concentrationToM,
  massToG,
  volumeFromL,
  volumeToL
} from './molarity.js';

const BUFFER_MASS_FACTORS_G = {
  ng: 1e-9,
  ug: 1e-6,
  mg: 1e-3,
  g: 1,
  kg: 1e3
};

const BUFFER_VOLUME_FACTORS_L = {
  nL: 1e-9,
  uL: 1e-6,
  mL: 1e-3,
  L: 1
};

const BUFFER_PKA_HINTS = [
  { pattern: /\bmes\b/i, pKa: 6.15, label: 'MES' },
  { pattern: /\bpipes\b/i, pKa: 6.8, label: 'PIPES' },
  { pattern: /\bmops\b/i, pKa: 7.2, label: 'MOPS' },
  { pattern: /\b(?:phosphate|hpo4|h2po4|kh2po4|na2hpo4|nah2po4)\b/i, pKa: 7.21, label: 'phosphate' },
  { pattern: /\bhepes\b/i, pKa: 7.55, label: 'HEPES' },
  { pattern: /\b(?:tris|tris-hcl)\b/i, pKa: 8.06, label: 'Tris' },
  { pattern: /\btricine\b/i, pKa: 8.15, label: 'Tricine' },
  { pattern: /\bbicine\b/i, pKa: 8.35, label: 'Bicine' },
  { pattern: /\btaps\b/i, pKa: 8.4, label: 'TAPS' },
  { pattern: /\bglycine\b/i, pKa: 9.78, label: 'Glycine' },
  { pattern: /\bacetate\b/i, pKa: 4.76, label: 'acetate' }
];

const BUFFER_PH_ADJUSTMENT_MOLARITY = 6;
const VOLUME_EPSILON_L = 1e-15;
const ADAPTIVE_VOLUME_UNITS = [
  { unit: 'L', factor: 1 },
  { unit: 'mL', factor: 1e-3 },
  { unit: 'uL', factor: 1e-6 },
  { unit: 'nL', factor: 1e-9 }
];
const ADAPTIVE_MASS_UNITS = [
  { unit: 'kg', factor: 1e3 },
  { unit: 'g', factor: 1 },
  { unit: 'mg', factor: 1e-3 },
  { unit: 'ug', factor: 1e-6 },
  { unit: 'ng', factor: 1e-9 }
];
const ADAPTIVE_CONCENTRATION_UNITS = [
  { unit: 'M', factor: 1 },
  { unit: 'mM', factor: 1e-3 },
  { unit: 'uM', factor: 1e-6 },
  { unit: 'nM', factor: 1e-9 },
  { unit: 'pM', factor: 1e-12 },
  { unit: 'fM', factor: 1e-15 }
];

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

export function parseBufferConcentration(value, options = {}) {
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

function findBufferPkaHint(name) {
  const source = String(name || '').trim();
  return BUFFER_PKA_HINTS.find((hint) => hint.pattern.test(source)) || null;
}

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

export function calculateMolarityMass({
  concentrationValue,
  concentrationUnit = 'mM',
  molecularWeight,
  volumeValue,
  volumeUnit = 'mL'
} = {}) {
  const concentration = withLabel(describeRawValue(concentrationValue, concentrationUnit, 'concentration'), 'concentration');
  const volume = withLabel(describeRawValue(volumeValue, volumeUnit, 'volume'), 'volume');
  const mw = withLabel(describeRawValue(molecularWeight, 'g/mol', 'molecular weight'), 'molecular weight');
  const missing = collectMissing(concentration, volume, mw);
  const formulaText = `mass = ${concentration.text} x ${volume.text} x ${mw.text}`;
  let resultText = '';
  if (!missing.length) {
    const moles = concentrationToM(concentration.value, concentrationUnit) * volumeToL(volume.value, volumeUnit);
    const massG = moles * mw.value;
    resultText = `Mass needed: ${formatAdaptiveMass(massG)}.`;
  }
  return buildResult({
    type: 'molarity',
    mode: 'mass',
    title: 'Molarity - Mass',
    inputs: { concentrationValue, concentrationUnit, molecularWeight, volumeValue, volumeUnit },
    resultText,
    formulaText,
    missing
  });
}

export function calculateMolarityVolume({
  massValue,
  massUnit = 'mg',
  molecularWeight,
  concentrationValue,
  concentrationUnit = 'mM'
} = {}) {
  const mass = withLabel(describeRawValue(massValue, massUnit, 'mass'), 'mass');
  const mw = withLabel(describeRawValue(molecularWeight, 'g/mol', 'molecular weight'), 'molecular weight');
  const concentration = withLabel(describeRawValue(concentrationValue, concentrationUnit, 'concentration'), 'concentration');
  const missing = collectMissing(mass, mw, concentration);
  const formulaText = `volume = ${mass.text} / (${concentration.text} x ${mw.text})`;
  let resultText = '';
  if (!missing.length) {
    const massG = massToG(mass.value, massUnit);
    const moles = massG / mw.value;
    const volumeL = moles / concentrationToM(concentration.value, concentrationUnit);
    resultText = `Final volume: ${formatAdaptiveVolume(volumeL)}.`;
  }
  return buildResult({
    type: 'molarity',
    mode: 'volume',
    title: 'Molarity - Volume',
    inputs: { massValue, massUnit, molecularWeight, concentrationValue, concentrationUnit },
    resultText,
    formulaText,
    missing
  });
}

export function calculateMolarityConcentration({
  massValue,
  massUnit = 'mg',
  molecularWeight,
  volumeValue,
  volumeUnit = 'mL'
} = {}) {
  const mass = withLabel(describeRawValue(massValue, massUnit, 'mass'), 'mass');
  const mw = withLabel(describeRawValue(molecularWeight, 'g/mol', 'molecular weight'), 'molecular weight');
  const volume = withLabel(describeRawValue(volumeValue, volumeUnit, 'volume'), 'volume');
  const missing = collectMissing(mass, mw, volume);
  const formulaText = `concentration = ${mass.text} / (${volume.text} x ${mw.text})`;
  let resultText = '';
  if (!missing.length) {
    const moles = massToG(mass.value, massUnit) / mw.value;
    const concentrationM = moles / volumeToL(volume.value, volumeUnit);
    resultText = `Concentration: ${formatAdaptiveConcentration(concentrationM)}.`;
  }
  return buildResult({
    type: 'molarity',
    mode: 'concentration',
    title: 'Molarity - Concentration',
    inputs: { massValue, massUnit, molecularWeight, volumeValue, volumeUnit },
    resultText,
    formulaText,
    missing
  });
}

export function calculateMolarityDilution({
  stockConcentrationValue,
  stockConcentrationUnit = 'mM',
  targetConcentrationValue,
  targetConcentrationUnit = 'mM',
  finalVolumeValue,
  finalVolumeUnit = 'mL'
} = {}) {
  const stock = withLabel(describeRawValue(stockConcentrationValue, stockConcentrationUnit, 'stock concentration'), 'stock concentration');
  const target = withLabel(describeRawValue(targetConcentrationValue, targetConcentrationUnit, 'desired concentration'), 'desired concentration');
  const finalVolume = withLabel(describeRawValue(finalVolumeValue, finalVolumeUnit, 'final volume'), 'final volume');
  const missing = collectMissing(stock, target, finalVolume);
  const formulaText = `V1 = ${target.text} x ${finalVolume.text} / ${stock.text}; diluent = ${finalVolume.text} - V1`;
  let resultText = '';
  let status = '';
  if (!missing.length) {
    const stockM = concentrationToM(stock.value, stockConcentrationUnit);
    const targetM = concentrationToM(target.value, targetConcentrationUnit);
    const finalL = volumeToL(finalVolume.value, finalVolumeUnit);
    if (targetM > stockM) {
      status = 'warning';
      resultText = 'Desired concentration cannot be higher than stock concentration.';
    } else {
      const stockL = (targetM * finalL) / stockM;
      const diluentL = finalL - stockL;
      resultText = `Use ${formatAdaptiveVolume(stockL)} stock + ${formatAdaptiveVolume(diluentL)} diluent.`;
    }
  }
  return buildResult({
    type: 'molarity',
    mode: 'dilution',
    title: 'Molarity - Dilution',
    inputs: {
      stockConcentrationValue,
      stockConcentrationUnit,
      targetConcentrationValue,
      targetConcentrationUnit,
      finalVolumeValue,
      finalVolumeUnit
    },
    resultText,
    formulaText,
    missing,
    status
  });
}

export function calculateMolarity(mode, inputs = {}) {
  switch (mode) {
    case 'volume':
      return calculateMolarityVolume(inputs);
    case 'concentration':
      return calculateMolarityConcentration(inputs);
    case 'dilution':
      return calculateMolarityDilution(inputs);
    case 'mass':
    default:
      return calculateMolarityMass(inputs);
  }
}

export function resolveBufferCompound(name) {
  const clean = String(name || '').trim();
  return BUFFER_COMPOUNDS.find((compound) => compound.name === clean) || null;
}

export function calculateBufferIngredient({
  name,
  form,
  molecularWeight,
  stockConcentration,
  finalConcentration,
  concentrationValue,
  volumeMl
} = {}) {
  const compound = resolveBufferCompound(name);
  const resolvedName = cleanName(name === '__custom__' ? '' : name, compound?.name || 'Buffer ingredient');
  const resolvedForm = String(form || compound?.form || 'solid').trim() === 'liquid' ? 'liquid' : 'solid';
  const volume = withLabel(describeRawValue(volumeMl, 'mL', 'buffer volume'), 'buffer volume');
  const defaults = bufferDefaultsForForm(resolvedForm);
  const stockRaw = String(stockConcentration ?? '').trim();
  const finalRaw = String(finalConcentration ?? concentrationValue ?? '').trim();
  const stock = stockRaw ? parseBufferConcentration(stockRaw, defaults) : null;
  const final = parseBufferConcentration(
    finalRaw,
    stock && !stock.missing ? bufferConcentrationDefaultsFrom(stock, defaults) : defaults
  );
  const mw = withLabel(
    describeRawValue(molecularWeight || compound?.mw, 'g/mol', 'molecular weight'),
    'molecular weight'
  );
  const missing = collectMissing(volume);
  let formulaText = '';
  let resultText = '';
  let quantityText = '';
  let addVolumeMl = 0;
  let massG = 0;
  let status = '';

  if (final.missing) {
    formulaText = stock && !stock.missing
      ? `${resolvedName} stock volume = [final concentration] x ${volume.text} / ${stock.text}`
      : `${resolvedName} amount = [final concentration] x ${volume.text}`;
    missing.push('final concentration');
  } else if (stock && !stock.missing) {
    formulaText = `${resolvedName} stock volume = ${final.text} x ${volume.text} / ${stock.text}`;
    if (!bufferConcentrationsCompatible(stock, final)) {
      status = 'warning';
      resultText = `${resolvedName}: stock and final concentration units are not compatible.`;
    } else if (!missing.length) {
      const stockBaseValue = bufferConcentrationBaseValue(stock);
      const finalBaseValue = bufferConcentrationBaseValue(final);
      if (isPositive(stockBaseValue) && isPositive(finalBaseValue)) {
        addVolumeMl = (finalBaseValue * volume.value) / stockBaseValue;
        if (addVolumeMl > volume.value) {
          status = 'warning';
          resultText = `${resolvedName}: final concentration is higher than stock concentration.`;
        } else {
          quantityText = formatBufferVolumeDual(addVolumeMl);
          resultText = `${resolvedName}: ${quantityText} stock.`;
        }
      } else {
        missing.push('stock concentration');
      }
    }
  } else if (final.kind === 'molar') {
    missing.push(...collectMissing(mw));
    const volumeLText = isPositive(volume.value) ? `${formatSigFig(volume.value / 1000)} L` : '[buffer volume L]';
    formulaText = `${resolvedName} mass = ${final.text} x ${volumeLText} x ${mw.text}`;
    if (!missing.length) {
      massG = final.value * (volume.value / 1000) * mw.value;
      quantityText = formatBufferMassDual(massG);
      resultText = `${resolvedName}: ${quantityText}.`;
    }
  } else if (final.kind === 'massVolume') {
    const volumeLText = isPositive(volume.value) ? `${formatSigFig(volume.value / 1000)} L` : '[buffer volume L]';
    formulaText = `${resolvedName} mass = ${final.text} x ${volumeLText}`;
    if (!missing.length) {
      massG = final.value * (volume.value / 1000);
      quantityText = formatBufferMassDual(massG);
      resultText = `${resolvedName}: ${quantityText}.`;
    }
  } else if (final.kind === 'percent' && final.percentKind === 'volume') {
    formulaText = `${resolvedName} volume = ${final.text} x ${volume.text}`;
    if (!missing.length) {
      addVolumeMl = (final.value / 100) * volume.value;
      quantityText = formatBufferVolumeDual(addVolumeMl);
      resultText = `${resolvedName}: ${quantityText}.`;
    }
  } else if (final.kind === 'percent' && final.percentKind === 'massVolume') {
    formulaText = `${resolvedName} mass = ${final.text} x ${volume.text}`;
    if (!missing.length) {
      massG = (final.value * volume.value) / 100;
      quantityText = formatBufferMassDual(massG);
      resultText = `${resolvedName}: ${quantityText}.`;
    }
  } else if (final.kind === 'percent' && final.percentKind === 'massMass') {
    formulaText = `${resolvedName} mass = ${final.text} x total solution mass; density required for volume-based buffer prep`;
    missing.push('solution density');
  } else if (final.kind === 'fold') {
    formulaText = `${resolvedName} stock volume = ${final.text} x ${volume.text} / [stock concentration]`;
    missing.push('stock concentration');
  }

  return buildResult({
    type: 'buffer',
    mode: resolvedForm,
    title: `Buffer - ${resolvedName}`,
    inputs: {
      name: resolvedName,
      form: resolvedForm,
      molecularWeight: molecularWeight || compound?.mw || '',
      stockConcentration: stockRaw,
      finalConcentration: finalRaw,
      concentrationValue,
      volumeMl
    },
    resultText,
    formulaText,
    missing,
    status,
    details: [{
      name: resolvedName,
      form: resolvedForm,
      stockConcentration: stock,
      finalConcentration: final,
      quantityText,
      addVolumeMl,
      massG
    }]
  });
}

export function calculateBufferRecipe({
  volumeMl,
  pH,
  rows = [],
  solventName = 'Solvent'
} = {}) {
  const activeRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => (
      String(row.name || '').trim()
      || String(row.customName || '').trim()
      || String(row.stockConcentration || row.stockConcentrationValue || '').trim()
      || String(row.finalConcentration || row.finalConcentrationValue || row.concentrationValue || '').trim()
      || toNumber(row.molecularWeight) > 0
    ));
  const sourceRows = activeRows.length ? activeRows : [{}];
  const details = sourceRows.map((row, index) => {
    const rowName = String(row.name || '').trim() === '__custom__'
      ? String(row.customName || '').trim()
      : String(row.name || '').trim();
    const detail = calculateBufferIngredient({
      name: rowName || `Ingredient ${index + 1}`,
      form: row.form,
      molecularWeight: row.molecularWeight,
      stockConcentration: row.stockConcentration ?? row.stockConcentrationValue,
      finalConcentration: row.finalConcentration ?? row.finalConcentrationValue,
      concentrationValue: row.concentrationValue,
      volumeMl
    });
    detail.rowIndex = row.rowIndex || index + 1;
    return detail;
  });
  const targetVolumeMl = toNumber(volumeMl);
  const additiveVolumeMl = details.reduce((sum, detail) => {
    const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
    return sum + (Number(rowDetail?.addVolumeMl) || 0);
  }, 0);
  const phAdjustment = estimateBufferPhAdjustment({ details, pH, volumeMl: targetVolumeMl });
  const solventMl = isPositive(targetVolumeMl)
    ? Math.max(0, targetVolumeMl - additiveVolumeMl - phAdjustment.naohMl - phAdjustment.hclMl)
    : 0;
  const solventLabel = cleanName(solventName, 'Solvent');
  const solventText = isPositive(targetVolumeMl)
    ? `${solventLabel} to add: ${formatBufferVolumeDual(solventMl)}.`
    : '';
  const naohText = phAdjustment.naohText ? `6 M NaOH: ${phAdjustment.naohText}.` : '';
  const hclText = phAdjustment.hclText ? `6 M HCl: ${phAdjustment.hclText}.` : '';
  const resultLines = details.map((detail) => detail.resultText).filter(Boolean);
  const formulaLines = details.map((detail) => detail.formulaText).filter(Boolean);
  const missing = details.flatMap((detail) => detail.missing || []);
  if (phAdjustment.missing) {
    missing.push(phAdjustment.missing);
  }
  const result = buildResult({
    type: 'buffer',
    mode: 'recipe',
    title: 'Buffer Preparer',
    inputs: { volumeMl, pH, solventName: solventLabel, rows: activeRows },
    resultText: [...resultLines, solventText, naohText, hclText].filter(Boolean).join('\n'),
    formulaText: [
      ...formulaLines,
      isPositive(targetVolumeMl) ? `${solventLabel} = final volume - stock/liquid additions - pH adjustment` : '',
      phAdjustment.formulaText
    ].filter(Boolean).join('\n'),
    details,
    missing,
    status: details.some((detail) => detail.status === 'warning') ? 'warning' : ''
  });
  result.solvent = {
    name: solventLabel,
    volumeMl: solventMl,
    text: isPositive(targetVolumeMl) ? formatBufferVolumeDual(solventMl) : ''
  };
  result.phAdjustment = phAdjustment;
  return result;
}

function estimateBufferPhAdjustment({ details = [], pH, volumeMl } = {}) {
  const targetPh = toNumber(pH);
  if (!isPositive(targetPh)) {
    return {
      naohMl: 0,
      hclMl: 0,
      naohText: '',
      hclText: '',
      formulaText: ''
    };
  }

  const volumeL = toNumber(volumeMl) / 1000;
  const candidate = (Array.isArray(details) ? details : []).map((detail) => {
    const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
    const concentration = rowDetail?.finalConcentration;
    const pkaHint = findBufferPkaHint(rowDetail?.name || detail?.inputs?.name || detail?.title);
    if (!pkaHint || concentration?.kind !== 'molar' || !isPositive(concentration.value)) {
      return null;
    }
    return {
      name: rowDetail?.name || pkaHint.label,
      pkaHint,
      concentrationM: concentration.value
    };
  }).find(Boolean);

  if (!candidate || !isPositive(volumeL)) {
    return {
      naohMl: 0,
      hclMl: 0,
      naohText: 'estimate needs a buffer with known pKa',
      hclText: 'estimate needs a buffer with known pKa',
      formulaText: 'pH adjustment estimate needs a recognized buffering ingredient and target pH',
      missing: 'buffer pKa'
    };
  }

  const targetBaseFraction = 1 / (1 + (10 ** (candidate.pkaHint.pKa - targetPh)));
  const baseFractionAtPka = 0.5;
  const deltaMoles = (targetBaseFraction - baseFractionAtPka) * candidate.concentrationM * volumeL;
  const adjustmentMl = Math.abs(deltaMoles / BUFFER_PH_ADJUSTMENT_MOLARITY) * 1000;
  const label = `${formatBufferVolumeMl(adjustmentMl)} estimated from ${candidate.pkaHint.label} pKa ${candidate.pkaHint.pKa}`;
  return {
    naohMl: deltaMoles > 0 ? adjustmentMl : 0,
    hclMl: deltaMoles < 0 ? adjustmentMl : 0,
    naohText: deltaMoles > 0 ? label : '0 uL',
    hclText: deltaMoles < 0 ? label : '0 uL',
    formulaText: `pH adjustment estimate uses ${candidate.pkaHint.label} pKa ${candidate.pkaHint.pKa} and 6 M acid/base`
  };
}

export function roundNearZero(value) {
  return Math.abs(value) < VOLUME_EPSILON_L ? 0 : value;
}

function normalizeReactionVolumeUnit(unitText, fallback = 'uL') {
  const clean = normalizeBufferUnitText(unitText);
  if (/^ul$/i.test(clean)) {
    return 'uL';
  }
  if (/^ml$/i.test(clean)) {
    return 'mL';
  }
  if (/^l$/i.test(clean)) {
    return 'L';
  }
  return cleanUnit(fallback, 'uL');
}

function describeReactionVolume(value, unit = 'uL', label = 'volume') {
  const source = String(value ?? '').trim();
  const parsed = parseBufferNumericPrefix(source);
  const numericValue = parsed ? parsed.value : toNumber(value);
  const parsedUnit = parsed?.unitText || '';
  const resolvedUnit = normalizeReactionVolumeUnit(parsedUnit || unit, unit);
  if (isPositive(numericValue)) {
    return {
      text: `${formatSigFig(numericValue)} ${resolvedUnit}`,
      missing: false,
      value: numericValue,
      unit: resolvedUnit,
      valueL: volumeToL(numericValue, resolvedUnit)
    };
  }
  return {
    text: `[${label}]`,
    missing: true,
    value: 0,
    unit: resolvedUnit,
    valueL: 0
  };
}

function concentrationInputText(concentration, value, unit) {
  const concentrationText = String(concentration ?? '').trim();
  if (concentrationText) {
    return concentrationText;
  }
  const valueText = String(value ?? '').trim();
  if (!valueText) {
    return '';
  }
  const unitText = cleanUnit(unit);
  return unitText ? `${valueText} ${unitText}` : valueText;
}

function describeReactionConcentration({
  concentration,
  value,
  unit,
  label,
  defaults = {}
} = {}) {
  const raw = concentrationInputText(concentration, value, unit);
  const parsed = parseBufferConcentration(raw, {
    defaultKind: 'molar',
    defaultUnit: unit || 'mM',
    ...defaults
  });
  if (parsed.missing) {
    return {
      ...parsed,
      text: `[${label}]`
    };
  }
  return parsed;
}

export function calculateFixedReactionReagent({
  name,
  stockConcentration,
  stockValue,
  stockUnit = 'mM',
  finalConcentration,
  finalValue,
  finalUnit = 'uM',
  manualVolumeValue,
  manualVolumeUnit = 'uL',
  totalVolumeValue,
  totalVolumeUnit = 'uL'
} = {}) {
  const resolvedName = cleanName(name, 'Reagent');
  const total = withLabel(describeReactionVolume(totalVolumeValue, totalVolumeUnit, 'total volume'), 'total volume');
  const stock = withLabel(describeReactionConcentration({
    concentration: stockConcentration,
    value: stockValue,
    unit: stockUnit,
    label: 'stock concentration'
  }), 'stock concentration');
  const final = withLabel(describeReactionConcentration({
    concentration: finalConcentration,
    value: finalValue,
    unit: finalUnit,
    label: 'final concentration',
    defaults: stock.missing ? {} : bufferConcentrationDefaultsFrom(stock, { defaultKind: 'molar', defaultUnit: finalUnit })
  }), 'final concentration');
  const manualVolume = describeReactionVolume(manualVolumeValue, manualVolumeUnit, 'manual volume');

  if (!manualVolume.missing) {
    const volumeL = manualVolume.valueL;
    return buildResult({
      type: 'fixed-reaction',
      mode: 'manual-reagent',
      title: `Fixed Reaction - ${resolvedName}`,
      inputs: { name: resolvedName, manualVolumeValue, manualVolumeUnit },
      resultText: `${resolvedName}: ${manualVolume.text}.`,
      formulaText: `${resolvedName} volume = manual ${manualVolume.text}`,
      details: [{ name: resolvedName, volumeL, knownVolume: true, quantityText: manualVolume.text }],
      missing: []
    });
  }

  const missing = collectMissing(total, stock, final);
  const formulaText = `${resolvedName} volume = ${final.text} x ${total.text} / ${stock.text}`;
  let resultText = '';
  let status = '';
  let volumeL = null;
  let quantityText = '';
  if (!missing.length) {
    if (!bufferConcentrationsCompatible(stock, final)) {
      status = 'warning';
      resultText = `${resolvedName}: stock and final concentration must use matching unit types.`;
    } else if (bufferConcentrationBaseValue(final) > bufferConcentrationBaseValue(stock)) {
      status = 'warning';
      resultText = `${resolvedName}: final concentration cannot be higher than stock.`;
    } else {
      volumeL = roundNearZero(total.valueL * (bufferConcentrationBaseValue(final) / bufferConcentrationBaseValue(stock)));
      const outputUnit = manualVolumeUnit || total.unit || 'uL';
      quantityText = `${formatSigFig(volumeFromL(volumeL, outputUnit))} ${outputUnit}`;
      resultText = `${resolvedName}: ${quantityText}.`;
    }
  }

  return buildResult({
    type: 'fixed-reaction',
    mode: 'reagent',
    title: `Fixed Reaction - ${resolvedName}`,
    inputs: {
      name: resolvedName,
      stockConcentration: concentrationInputText(stockConcentration, stockValue, stockUnit),
      finalConcentration: concentrationInputText(finalConcentration, finalValue, finalUnit),
      stockValue,
      stockUnit,
      finalValue,
      finalUnit,
      totalVolumeValue,
      totalVolumeUnit,
      outputUnit: manualVolumeUnit
    },
    resultText,
    formulaText,
    details: [{
      name: resolvedName,
      volumeL,
      knownVolume: volumeL !== null,
      quantityText,
      stockConcentration: stock,
      finalConcentration: final
    }],
    missing,
    status
  });
}

export function calculateFixedReaction({
  totalVolumeValue,
  totalVolumeUnit = 'uL',
  fillName = 'Water / buffer',
  reagents = []
} = {}) {
  const activeReagents = (Array.isArray(reagents) ? reagents : [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => (
      String(row.name || '').trim()
      || String(row.stockConcentration || row.stockValue || '').trim()
      || String(row.finalConcentration || row.finalValue || '').trim()
      || String(row.manualVolumeValue || '').trim()
    ));
  const details = activeReagents.map((row, index) => {
    const detail = calculateFixedReactionReagent({
      name: row.name || `Reagent ${index + 1}`,
      stockConcentration: row.stockConcentration,
      stockValue: row.stockValue,
      stockUnit: row.stockUnit,
      finalConcentration: row.finalConcentration,
      finalValue: row.finalValue,
      finalUnit: row.finalUnit,
      manualVolumeValue: row.manualVolumeValue,
      manualVolumeUnit: row.manualVolumeUnit || totalVolumeUnit,
      totalVolumeValue,
      totalVolumeUnit
    });
    detail.rowIndex = row.rowIndex || index + 1;
    return detail;
  });
  const total = withLabel(describeReactionVolume(totalVolumeValue, totalVolumeUnit, 'total volume'), 'total volume');
  const knownVolumes = details
    .map((detail) => detail.details?.[0])
    .filter((detail) => detail?.knownVolume && Number.isFinite(detail.volumeL));
  const hasUnknownVolumes = knownVolumes.length !== details.length;
  let fillResult = '';
  let fillFormula = `${cleanName(fillName, 'Fill solution')} = ${total.text}`;
  let fillVolumeL = null;
  let fillText = '';
  let fillStatus = '';
  if (details.length) {
    fillFormula += ` - ${details.map((detail) => {
      const rowDetail = detail.details?.[0] || {};
      return rowDetail.knownVolume
        ? `${formatSigFig(volumeFromL(rowDetail.volumeL, total.unit))} ${total.unit}`
        : `[${rowDetail.name || 'reagent'} volume]`;
    }).join(' - ')}`;
  }

  if (!total.missing && !hasUnknownVolumes) {
    const assignedVolumeL = knownVolumes.reduce((sum, detail) => sum + detail.volumeL, 0);
    fillVolumeL = roundNearZero(total.valueL - assignedVolumeL);
    fillText = `${formatSigFig(volumeFromL(fillVolumeL, total.unit))} ${total.unit}`;
    fillResult = `${cleanName(fillName, 'Fill solution')}: ${fillText}.`;
    if (fillVolumeL < -VOLUME_EPSILON_L) {
      fillStatus = 'warning';
      fillResult = 'Assigned reagent volumes exceed the total volume.';
    }
  }

  const resultLines = details.map((detail) => detail.resultText).filter(Boolean);
  if (fillResult) {
    resultLines.push(fillResult);
  }
  const formulaLines = details.map((detail) => detail.formulaText).filter(Boolean);
  formulaLines.push(fillFormula);
  const missing = details.flatMap((detail) => detail.missing || []);
  if (total.missing) {
    missing.push('total volume');
  }
  if (hasUnknownVolumes && details.length) {
    missing.push('reagent volume');
  }

  const result = buildResult({
    type: 'fixed-reaction',
    mode: 'reaction',
    title: 'Fixed Volume Reaction',
    inputs: { totalVolumeValue, totalVolumeUnit, fillName, reagents: activeReagents },
    resultText: resultLines.join('\n'),
    formulaText: formulaLines.join('\n'),
    details,
    missing,
    status: fillStatus || (details.some((detail) => detail.status === 'warning') ? 'warning' : '')
  });
  result.fill = {
    name: cleanName(fillName, 'Fill solution'),
    volumeL: fillVolumeL,
    text: fillText,
    resultText: fillResult,
    status: fillStatus
  };
  return result;
}
