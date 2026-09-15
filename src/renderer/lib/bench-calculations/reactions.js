import { formatSigFig, toNumber } from '../numbers.js';
import { volumeFromL, volumeToL } from '../molarity.js';
import { bufferConcentrationBaseValue, bufferConcentrationDefaultsFrom, bufferConcentrationsCompatible, parseBufferConcentration } from './buffer-concentration.js';
import { VOLUME_EPSILON_L } from './constants.js';
import { buildResult, collectMissing, withLabel } from './result-format.js';
import { cleanName, cleanUnit, isPositive, normalizeBufferUnitText, parseBufferNumericPrefix } from './units.js';

function roundNearZero(value) {
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

function calculateFixedReactionReagent({
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
  const describeStock = (defaults = {}) => withLabel(describeReactionConcentration({
    concentration: stockConcentration,
    value: stockValue,
    unit: stockUnit,
    label: 'stock concentration',
    defaults
  }), 'stock concentration');
  let stock = describeStock();
  const final = withLabel(describeReactionConcentration({
    concentration: finalConcentration,
    value: finalValue,
    unit: finalUnit,
    label: 'final concentration',
    defaults: stock.missing ? {} : bufferConcentrationDefaultsFrom(stock, { defaultKind: 'molar', defaultUnit: finalUnit })
  }), 'final concentration');
  // Whichever side carries the unit sets it for both: a bare "50" typed against
  // a 0.2 ng/uL template is 50 ng/uL, not 50 mM.
  if (!stock.missing && !stock.explicitUnit && !final.missing && final.explicitUnit) {
    stock = describeStock(bufferConcentrationDefaultsFrom(final));
  }
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

function calculateFixedReaction({
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
    // What the fill volume is, when a reagent volume is still unknown and the
    // number cannot be worked out yet.
    formula: fillFormula,
    resultText: fillResult,
    status: fillStatus
  };
  return result;
}

export {
  calculateFixedReaction,
  calculateFixedReactionReagent,
  roundNearZero
};
