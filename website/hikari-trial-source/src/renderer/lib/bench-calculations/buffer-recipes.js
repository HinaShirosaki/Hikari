import { formatSigFig, toNumber } from '../numbers.js';
import { volumeToL } from '../molarity.js';
import { resolveBufferCompound, bufferConcentrationBaseValue, bufferConcentrationDefaultsFrom, bufferConcentrationsCompatible, bufferDefaultsForForm, formatBufferVolumeDual, parseBufferConcentration } from './buffer-concentration.js';
import { BUFFER_MASS_FACTORS_G } from './constants.js';
import { buildResult, collectMissing, describeRawValue, formatAdaptiveMass, withLabel } from './result-format.js';
import { cleanName, isPositive, normalizeBufferUnitText, parseBufferNumericPrefix } from './units.js';

// What went on the balance or into the tube, typed over the calculated amount.
// A volume still displaces solvent; a mass does not take any.
function describeManualQuantity(value) {
  const source = String(value ?? '').trim();
  const parsed = source ? parseBufferNumericPrefix(source) : null;
  if (!parsed || !isPositive(parsed.value)) {
    return null;
  }
  const unit = normalizeBufferUnitText(parsed.unitText);
  const volumeUnit = ['nL', 'uL', 'mL', 'L'].find((known) => known.toLowerCase() === unit.toLowerCase()) || '';
  const massUnit = Object.keys(BUFFER_MASS_FACTORS_G).find((known) => known === unit.toLowerCase()) || '';
  return {
    text: source,
    addVolumeMl: volumeUnit ? volumeToL(parsed.value, volumeUnit) * 1000 : 0,
    massG: massUnit ? parsed.value * BUFFER_MASS_FACTORS_G[massUnit] : 0
  };
}

// One buffer ingredient. The branch is picked by the final concentration kind:
// - stock given: volume of stock to add (C1V1 = C2V2)
// - molar: mass = M x L x MW
// - mass/volume or % m/v: mass directly; % v/v: volume directly
// - % m/m and fold without a stock cannot be solved and report what is missing
// A manual quantity overrides all of them.
function calculateBufferIngredient({
  name,
  form,
  molecularWeight,
  stockConcentration,
  finalConcentration,
  concentrationValue,
  manualQuantity,
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
  const manual = describeManualQuantity(manualQuantity);
  const missing = manual ? [] : collectMissing(volume);
  let formulaText = '';
  let resultText = '';
  let quantityText = '';
  let addVolumeMl = 0;
  let massG = 0;
  let status = '';

  if (manual) {
    quantityText = manual.text;
    addVolumeMl = manual.addVolumeMl;
    massG = manual.massG;
    formulaText = `${resolvedName} amount = entered ${manual.text}`;
    resultText = `${resolvedName}: ${quantityText}.`;
  } else if (final.missing) {
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
      quantityText = formatAdaptiveMass(massG);
      resultText = `${resolvedName}: ${quantityText}.`;
    }
  } else if (final.kind === 'massVolume') {
    const volumeLText = isPositive(volume.value) ? `${formatSigFig(volume.value / 1000)} L` : '[buffer volume L]';
    formulaText = `${resolvedName} mass = ${final.text} x ${volumeLText}`;
    if (!missing.length) {
      massG = final.value * (volume.value / 1000);
      quantityText = formatAdaptiveMass(massG);
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
      quantityText = formatAdaptiveMass(massG);
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
      manualQuantity: manual ? manual.text : '',
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

// Full buffer recipe: every ingredient, then solvent = target volume minus
// liquid additions (masses are assumed not to add volume). With no rows it
// still returns one blank ingredient so the UI shows the formula template.
function calculateBufferRecipe({
  volumeMl,
  volumeValue,
  volumeUnit = 'mL',
  pH,
  rows = [],
  solventName = 'Solvent'
} = {}) {
  const hasAdjustableVolume = volumeValue !== undefined && volumeValue !== null;
  const sourceVolumeValue = hasAdjustableVolume ? volumeValue : volumeMl;
  const sourceVolumeUnit = hasAdjustableVolume ? volumeUnit : 'mL';
  const targetVolumeMl = volumeToL(sourceVolumeValue, sourceVolumeUnit) * 1000;
  const activeRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => (
      String(row.name || '').trim()
      || String(row.customName || '').trim()
      || String(row.stockConcentration || row.stockConcentrationValue || '').trim()
      || String(row.finalConcentration || row.finalConcentrationValue || row.concentrationValue || '').trim()
      || String(row.manualQuantity || '').trim()
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
      manualQuantity: row.manualQuantity,
      volumeMl: targetVolumeMl
    });
    detail.rowIndex = row.rowIndex || index + 1;
    return detail;
  });
  const additiveVolumeMl = details.reduce((sum, detail) => {
    const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
    return sum + (Number(rowDetail?.addVolumeMl) || 0);
  }, 0);
  const solventMl = isPositive(targetVolumeMl)
    ? Math.max(0, targetVolumeMl - additiveVolumeMl)
    : 0;
  const solventLabel = cleanName(solventName, 'Solvent');
  const solventText = isPositive(targetVolumeMl)
    ? `${solventLabel} to add: ${formatBufferVolumeDual(solventMl)}.`
    : '';
  const resultLines = details.map((detail) => detail.resultText).filter(Boolean);
  const formulaLines = details.map((detail) => detail.formulaText).filter(Boolean);
  const missing = details.flatMap((detail) => detail.missing || []);
  const result = buildResult({
    type: 'buffer',
    mode: 'recipe',
    title: 'Buffer Preparer',
    inputs: {
      volumeMl: targetVolumeMl,
      volumeValue: sourceVolumeValue,
      volumeUnit: sourceVolumeUnit,
      pH,
      solventName: solventLabel,
      rows: activeRows
    },
    resultText: [...resultLines, solventText].filter(Boolean).join('\n'),
    formulaText: [
      ...formulaLines,
      isPositive(targetVolumeMl) ? `${solventLabel} = final volume - stock/liquid additions` : ''
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
  return result;
}

export {
  calculateBufferIngredient,
  calculateBufferRecipe,
  resolveBufferCompound
};
