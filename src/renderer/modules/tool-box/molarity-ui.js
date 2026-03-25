import { toNumber } from './common.js';
import {
  concentrationToM,
  concentrationFromM,
  volumeToL,
  volumeFromL,
  massToG,
  massFromG
} from './molarity.js';

export function initMolarityTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const molarityMassForm = rootDocument.getElementById('molarity-mass-form');
  const massCalcResult = rootDocument.getElementById('mass-calc-result');
  const molarityVolumeForm = rootDocument.getElementById('molarity-volume-form');
  const volumeCalcResult = rootDocument.getElementById('volume-calc-result');
  const molarityConcentrationForm = rootDocument.getElementById('molarity-concentration-form');
  const concCalcResult = rootDocument.getElementById('conc-calc-result');
  const molarityDilutionForm = rootDocument.getElementById('molarity-dilution-form');
  const dilutionCalcResult = rootDocument.getElementById('dilution-calc-result');

  const forms = [
    molarityMassForm,
    molarityVolumeForm,
    molarityConcentrationForm,
    molarityDilutionForm
  ];
  if (!forms.every(Boolean) || !massCalcResult || !volumeCalcResult || !concCalcResult || !dilutionCalcResult) {
    return;
  }

  function renderMolarity() {
    const massConcValue = toNumber(rootDocument.getElementById('mass-calc-concentration')?.value);
    const massConcUnit = rootDocument.getElementById('mass-calc-concentration-unit')?.value;
    const massMw = toNumber(rootDocument.getElementById('mass-calc-mw')?.value);
    const massVolumeValue = toNumber(rootDocument.getElementById('mass-calc-volume')?.value);
    const massVolumeUnit = rootDocument.getElementById('mass-calc-volume-unit')?.value;
    const massOutputUnit = rootDocument.getElementById('mass-calc-output-unit')?.value;

    const massM = concentrationToM(massConcValue, massConcUnit);
    const massL = volumeToL(massVolumeValue, massVolumeUnit);
    const massMoles = massM * massL;
    const massG = massMoles * massMw;
    const massOutput = massFromG(massG, massOutputUnit);

    if (massM > 0 && massL > 0 && massMw > 0) {
      massCalcResult.textContent = `Mass needed: ${massOutput.toFixed(6)} ${massOutputUnit} (${massG.toExponential(6)} g, ${massMoles.toExponential(6)} mol).`;
    } else {
      massCalcResult.textContent = 'Enter concentration, formula weight, and volume to calculate mass.';
    }

    const volumeMassValue = toNumber(rootDocument.getElementById('volume-calc-mass')?.value);
    const volumeMassUnit = rootDocument.getElementById('volume-calc-mass-unit')?.value;
    const volumeMw = toNumber(rootDocument.getElementById('volume-calc-mw')?.value);
    const volumeConcValue = toNumber(rootDocument.getElementById('volume-calc-concentration')?.value);
    const volumeConcUnit = rootDocument.getElementById('volume-calc-concentration-unit')?.value;
    const volumeOutputUnit = rootDocument.getElementById('volume-calc-output-unit')?.value;

    const volumeG = massToG(volumeMassValue, volumeMassUnit);
    const volumeM = concentrationToM(volumeConcValue, volumeConcUnit);
    const volumeMoles = volumeMw > 0 ? volumeG / volumeMw : 0;
    const volumeL = volumeM > 0 ? volumeMoles / volumeM : 0;
    const volumeOutput = volumeFromL(volumeL, volumeOutputUnit);

    if (volumeG > 0 && volumeMw > 0 && volumeM > 0) {
      volumeCalcResult.textContent = `Final volume: ${volumeOutput.toFixed(6)} ${volumeOutputUnit} (${volumeL.toExponential(6)} L).`;
    } else {
      volumeCalcResult.textContent = 'Enter mass, formula weight, and concentration to calculate volume.';
    }

    const concMassValue = toNumber(rootDocument.getElementById('conc-calc-mass')?.value);
    const concMassUnit = rootDocument.getElementById('conc-calc-mass-unit')?.value;
    const concMw = toNumber(rootDocument.getElementById('conc-calc-mw')?.value);
    const concVolumeValue = toNumber(rootDocument.getElementById('conc-calc-volume')?.value);
    const concVolumeUnit = rootDocument.getElementById('conc-calc-volume-unit')?.value;
    const concOutputUnit = rootDocument.getElementById('conc-calc-output-unit')?.value;

    const concMassG = massToG(concMassValue, concMassUnit);
    const concVolumeL = volumeToL(concVolumeValue, concVolumeUnit);
    const concMoles = concMw > 0 ? concMassG / concMw : 0;
    const concM = concVolumeL > 0 ? concMoles / concVolumeL : 0;
    const concOutput = concentrationFromM(concM, concOutputUnit);

    if (concMassG > 0 && concMw > 0 && concVolumeL > 0) {
      concCalcResult.textContent = `Concentration: ${concOutput.toFixed(6)} ${concOutputUnit} (${concM.toExponential(6)} M).`;
    } else {
      concCalcResult.textContent = 'Enter mass, formula weight, and volume to calculate concentration.';
    }

    const stockConcValue = toNumber(rootDocument.getElementById('dilution-stock-conc')?.value);
    const stockConcUnit = rootDocument.getElementById('dilution-stock-conc-unit')?.value;
    const targetConcValue = toNumber(rootDocument.getElementById('dilution-target-conc')?.value);
    const targetConcUnit = rootDocument.getElementById('dilution-target-conc-unit')?.value;
    const targetVolumeValue = toNumber(rootDocument.getElementById('dilution-target-volume')?.value);
    const targetVolumeUnit = rootDocument.getElementById('dilution-target-volume-unit')?.value;
    const dilutionOutputUnit = rootDocument.getElementById('dilution-output-unit')?.value;

    const stockM = concentrationToM(stockConcValue, stockConcUnit);
    const targetM = concentrationToM(targetConcValue, targetConcUnit);
    const targetVL = volumeToL(targetVolumeValue, targetVolumeUnit);
    const stockVL = stockM > 0 ? (targetM * targetVL) / stockM : 0;
    const diluentVL = targetVL - stockVL;
    const stockOutput = volumeFromL(stockVL, dilutionOutputUnit);
    const diluentOutput = volumeFromL(diluentVL, dilutionOutputUnit);

    if (stockM > 0 && targetM > 0 && targetVL > 0 && stockM >= targetM && diluentVL >= 0) {
      dilutionCalcResult.textContent = `Use ${stockOutput.toFixed(6)} ${dilutionOutputUnit} stock + ${diluentOutput.toFixed(6)} ${dilutionOutputUnit} diluent.`;
    } else if (stockM > 0 && targetM > stockM) {
      dilutionCalcResult.textContent = 'Desired concentration cannot be higher than stock concentration.';
    } else {
      dilutionCalcResult.textContent = 'Enter stock concentration, desired concentration, and final volume to calculate dilution.';
    }
  }

  forms.forEach((form) => {
    form.addEventListener('input', renderMolarity);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      renderMolarity();
    });
  });

  renderMolarity();
}
