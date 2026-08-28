import { formatSigFig, toNumber } from '../numbers.js';
import { resolveBufferCompound, bufferConcentrationBaseValue, bufferConcentrationDefaultsFrom, bufferConcentrationsCompatible, bufferDefaultsForForm, findBufferPkaHint, formatBufferMassDual, formatBufferVolumeDual, formatBufferVolumeMl, parseBufferConcentration } from './buffer-concentration.js';
import { BUFFER_PH_ADJUSTMENT_MOLARITY } from './constants.js';
import { buildResult, collectMissing, describeRawValue, withLabel } from './result-format.js';
import { cleanName, isPositive } from './units.js';

function calculateBufferIngredient({
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

function calculateBufferRecipe({
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

export {
  calculateBufferIngredient,
  calculateBufferRecipe,
  resolveBufferCompound
};
