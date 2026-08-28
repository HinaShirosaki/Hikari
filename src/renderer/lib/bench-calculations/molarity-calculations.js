import { concentrationToM, massToG, volumeToL } from '../molarity.js';
import { buildResult, collectMissing, describeRawValue, formatAdaptiveConcentration, formatAdaptiveMass, formatAdaptiveVolume, withLabel } from './result-format.js';

function calculateMolarityMass({
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

function calculateMolarityVolume({
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

function calculateMolarityConcentration({
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

function calculateMolarityDilution({
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

function calculateMolarity(mode, inputs = {}) {
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

export {
  calculateMolarity,
  calculateMolarityConcentration,
  calculateMolarityDilution,
  calculateMolarityMass,
  calculateMolarityVolume
};
