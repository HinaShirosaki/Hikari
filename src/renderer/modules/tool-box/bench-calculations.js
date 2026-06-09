import { BUFFER_COMPOUNDS } from '../buffer-compounds.js';
import { formatSigFig, toNumber } from './common.js';
import {
  concentrationFromM,
  concentrationToM,
  massFromG,
  massToG,
  volumeFromL,
  volumeToL
} from './molarity.js';

const REACTION_CONCENTRATION_FACTORS = {
  fM: 1e-15,
  pM: 1e-12,
  nM: 1e-9,
  uM: 1e-6,
  mM: 1e-3,
  M: 1,
  x: 1
};

const VOLUME_EPSILON_L = 1e-15;

function isPositive(value) {
  return Number.isFinite(value) && value > 0;
}

function cleanUnit(unit, fallback = '') {
  return String(unit || fallback || '').trim();
}

function cleanName(value, fallback) {
  return String(value || '').trim() || fallback;
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

export function calculateMolarityMass({
  concentrationValue,
  concentrationUnit = 'mM',
  molecularWeight,
  volumeValue,
  volumeUnit = 'mL',
  outputUnit = 'mg'
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
    resultText = `Mass needed: ${formatSigFig(massFromG(massG, outputUnit))} ${outputUnit}.`;
  }
  return buildResult({
    type: 'molarity',
    mode: 'mass',
    title: 'Molarity - Mass',
    inputs: { concentrationValue, concentrationUnit, molecularWeight, volumeValue, volumeUnit, outputUnit },
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
  concentrationUnit = 'mM',
  outputUnit = 'mL'
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
    resultText = `Final volume: ${formatSigFig(volumeFromL(volumeL, outputUnit))} ${outputUnit}.`;
  }
  return buildResult({
    type: 'molarity',
    mode: 'volume',
    title: 'Molarity - Volume',
    inputs: { massValue, massUnit, molecularWeight, concentrationValue, concentrationUnit, outputUnit },
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
  volumeUnit = 'mL',
  outputUnit = 'mM'
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
    resultText = `Concentration: ${formatSigFig(concentrationFromM(concentrationM, outputUnit))} ${outputUnit}.`;
  }
  return buildResult({
    type: 'molarity',
    mode: 'concentration',
    title: 'Molarity - Concentration',
    inputs: { massValue, massUnit, molecularWeight, volumeValue, volumeUnit, outputUnit },
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
  finalVolumeUnit = 'mL',
  outputUnit = 'mL'
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
      resultText = `Use ${formatSigFig(volumeFromL(stockL, outputUnit))} ${outputUnit} stock + ${formatSigFig(volumeFromL(diluentL, outputUnit))} ${outputUnit} diluent.`;
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
      finalVolumeUnit,
      outputUnit
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
  concentrationValue,
  volumeMl
} = {}) {
  const compound = resolveBufferCompound(name);
  const resolvedName = cleanName(name === '__custom__' ? '' : name, compound?.name || 'Buffer ingredient');
  const resolvedForm = String(form || compound?.form || 'solid').trim() === 'liquid' ? 'liquid' : 'solid';
  const volume = withLabel(describeRawValue(volumeMl, 'mL', 'buffer volume'), 'buffer volume');
  const concentrationLabel = resolvedForm === 'liquid' ? 'percent v/v' : 'concentration';
  const concentrationUnit = resolvedForm === 'liquid' ? '% v/v' : 'mM';
  const concentration = withLabel(describeRawValue(concentrationValue, concentrationUnit, concentrationLabel), concentrationLabel);
  const mw = withLabel(
    describeRawValue(molecularWeight || compound?.mw, 'g/mol', 'molecular weight'),
    'molecular weight'
  );
  const missing = resolvedForm === 'liquid'
    ? collectMissing(concentration, volume)
    : collectMissing(concentration, volume, mw);
  let formulaText = '';
  let resultText = '';

  if (resolvedForm === 'liquid') {
    formulaText = `${resolvedName} volume = ${concentration.text} x ${volume.text}`;
    if (!missing.length) {
      const requiredMl = (concentration.value / 100) * volume.value;
      resultText = `${resolvedName}: ${formatSigFig(requiredMl)} mL (${formatSigFig(requiredMl * 1000)} uL).`;
    }
  } else {
    const volumeLText = isPositive(volume.value) ? `${formatSigFig(volume.value / 1000)} L` : '[buffer volume L]';
    formulaText = `${resolvedName} mass mg = ${concentration.text} x ${volumeLText} x ${mw.text}`;
    if (!missing.length) {
      const grams = (concentration.value / 1000) * (volume.value / 1000) * mw.value;
      resultText = `${resolvedName}: ${formatSigFig(grams * 1000)} mg (${formatSigFig(grams)} g).`;
    }
  }

  return buildResult({
    type: 'buffer',
    mode: resolvedForm,
    title: `Buffer - ${resolvedName}`,
    inputs: { name: resolvedName, form: resolvedForm, molecularWeight: molecularWeight || compound?.mw || '', concentrationValue, volumeMl },
    resultText,
    formulaText,
    missing
  });
}

export function calculateBufferRecipe({
  volumeMl,
  rows = []
} = {}) {
  const activeRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => (
      String(row.name || '').trim()
      || String(row.customName || '').trim()
      || toNumber(row.concentrationValue) > 0
      || toNumber(row.molecularWeight) > 0
    ));
  const sourceRows = activeRows.length ? activeRows : [{}];
  const details = sourceRows.map((row, index) => {
    const rowName = String(row.name || '').trim() === '__custom__'
      ? String(row.customName || '').trim()
      : String(row.name || '').trim();
    return calculateBufferIngredient({
      name: rowName || `Ingredient ${index + 1}`,
      form: row.form,
      molecularWeight: row.molecularWeight,
      concentrationValue: row.concentrationValue,
      volumeMl
    });
  });
  const resultLines = details.map((detail) => detail.resultText).filter(Boolean);
  const formulaLines = details.map((detail) => detail.formulaText).filter(Boolean);
  const missing = details.flatMap((detail) => detail.missing || []);
  return buildResult({
    type: 'buffer',
    mode: 'recipe',
    title: 'Buffer Preparer',
    inputs: { volumeMl, rows: activeRows },
    resultText: resultLines.join('\n'),
    formulaText: formulaLines.join('\n'),
    details,
    missing
  });
}

function parseReactionConcentration(value, unit) {
  const numericValue = toNumber(value);
  const cleanReactionUnit = cleanUnit(unit, 'mM');
  if (!isPositive(numericValue)) {
    return null;
  }
  if (cleanReactionUnit === 'x') {
    return {
      kind: 'fold',
      value: numericValue
    };
  }
  const factor = REACTION_CONCENTRATION_FACTORS[cleanReactionUnit];
  if (!isPositive(factor)) {
    return null;
  }
  return {
    kind: 'molar',
    value: numericValue * factor
  };
}

function roundNearZero(value) {
  return Math.abs(value) < VOLUME_EPSILON_L ? 0 : value;
}

export function calculateFixedReactionReagent({
  name,
  stockValue,
  stockUnit = 'mM',
  finalValue,
  finalUnit = 'uM',
  manualVolumeValue,
  manualVolumeUnit = 'uL',
  totalVolumeValue,
  totalVolumeUnit = 'uL'
} = {}) {
  const resolvedName = cleanName(name, 'Reagent');
  const total = withLabel(describeRawValue(totalVolumeValue, totalVolumeUnit, 'total volume'), 'total volume');
  const stock = withLabel(describeRawValue(stockValue, stockUnit, 'stock concentration'), 'stock concentration');
  const finalConcentration = withLabel(describeRawValue(finalValue, finalUnit, 'final concentration'), 'final concentration');
  const manualVolume = toNumber(manualVolumeValue);

  if (isPositive(manualVolume)) {
    const volumeL = volumeToL(manualVolume, manualVolumeUnit);
    return buildResult({
      type: 'fixed-reaction',
      mode: 'manual-reagent',
      title: `Fixed Reaction - ${resolvedName}`,
      inputs: { name: resolvedName, manualVolumeValue, manualVolumeUnit },
      resultText: `${resolvedName}: ${formatSigFig(manualVolume)} ${manualVolumeUnit}.`,
      formulaText: `${resolvedName} volume = manual ${formatSigFig(manualVolume)} ${manualVolumeUnit}`,
      details: [{ name: resolvedName, volumeL, knownVolume: true }],
      missing: []
    });
  }

  const missing = collectMissing(total, stock, finalConcentration);
  const formulaText = `${resolvedName} volume = ${finalConcentration.text} x ${total.text} / ${stock.text}`;
  let resultText = '';
  let status = '';
  let volumeL = null;
  if (!missing.length) {
    const parsedStock = parseReactionConcentration(stock.value, stockUnit);
    const parsedFinal = parseReactionConcentration(finalConcentration.value, finalUnit);
    if (!parsedStock || !parsedFinal || parsedStock.kind !== parsedFinal.kind) {
      status = 'warning';
      resultText = `${resolvedName}: stock and final concentration must use matching unit types.`;
    } else if (parsedFinal.value > parsedStock.value) {
      status = 'warning';
      resultText = `${resolvedName}: final concentration cannot be higher than stock.`;
    } else {
      volumeL = roundNearZero(volumeToL(total.value, totalVolumeUnit) * (parsedFinal.value / parsedStock.value));
      resultText = `${resolvedName}: ${formatSigFig(volumeFromL(volumeL, manualVolumeUnit))} ${manualVolumeUnit}.`;
    }
  }

  return buildResult({
    type: 'fixed-reaction',
    mode: 'reagent',
    title: `Fixed Reaction - ${resolvedName}`,
    inputs: { name: resolvedName, stockValue, stockUnit, finalValue, finalUnit, totalVolumeValue, totalVolumeUnit, outputUnit: manualVolumeUnit },
    resultText,
    formulaText,
    details: [{ name: resolvedName, volumeL, knownVolume: volumeL !== null }],
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
      || toNumber(row.stockValue) > 0
      || toNumber(row.finalValue) > 0
      || toNumber(row.manualVolumeValue) > 0
    ));
  const details = activeReagents.map((row, index) => calculateFixedReactionReagent({
    name: row.name || `Reagent ${index + 1}`,
    stockValue: row.stockValue,
    stockUnit: row.stockUnit,
    finalValue: row.finalValue,
    finalUnit: row.finalUnit,
    manualVolumeValue: row.manualVolumeValue,
    manualVolumeUnit: row.manualVolumeUnit || totalVolumeUnit,
    totalVolumeValue,
    totalVolumeUnit
  }));
  const total = withLabel(describeRawValue(totalVolumeValue, totalVolumeUnit, 'total volume'), 'total volume');
  const knownVolumes = details
    .map((detail) => detail.details?.[0])
    .filter((detail) => detail?.knownVolume && Number.isFinite(detail.volumeL));
  const hasUnknownVolumes = knownVolumes.length !== details.length;
  let fillResult = '';
  let fillFormula = `${cleanName(fillName, 'Fill solution')} = ${total.text}`;
  if (details.length) {
    fillFormula += ` - ${details.map((detail) => {
      const rowDetail = detail.details?.[0] || {};
      return rowDetail.knownVolume
        ? `${formatSigFig(volumeFromL(rowDetail.volumeL, totalVolumeUnit))} ${totalVolumeUnit}`
        : `[${rowDetail.name || 'reagent'} volume]`;
    }).join(' - ')}`;
  }

  if (!total.missing && !hasUnknownVolumes) {
    const assignedVolumeL = knownVolumes.reduce((sum, detail) => sum + detail.volumeL, 0);
    const fillVolumeL = roundNearZero(volumeToL(total.value, totalVolumeUnit) - assignedVolumeL);
    fillResult = `${cleanName(fillName, 'Fill solution')}: ${formatSigFig(volumeFromL(fillVolumeL, totalVolumeUnit))} ${totalVolumeUnit}.`;
    if (fillVolumeL < -VOLUME_EPSILON_L) {
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

  return buildResult({
    type: 'fixed-reaction',
    mode: 'reaction',
    title: 'Fixed Volume Reaction',
    inputs: { totalVolumeValue, totalVolumeUnit, fillName, reagents: activeReagents },
    resultText: resultLines.join('\n'),
    formulaText: formulaLines.join('\n'),
    details,
    missing
  });
}
