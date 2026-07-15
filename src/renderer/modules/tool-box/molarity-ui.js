import {
  calculateMolarityMass,
  calculateMolarityVolume,
  calculateMolarityConcentration,
  calculateMolarityDilution
} from '../../lib/bench-calculations.js';

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
    const massConcValue = rootDocument.getElementById('mass-calc-concentration')?.value;
    const massConcUnit = rootDocument.getElementById('mass-calc-concentration-unit')?.value;
    const massMw = rootDocument.getElementById('mass-calc-mw')?.value;
    const massVolumeValue = rootDocument.getElementById('mass-calc-volume')?.value;
    const massVolumeUnit = rootDocument.getElementById('mass-calc-volume-unit')?.value;
    const massOutputUnit = rootDocument.getElementById('mass-calc-output-unit')?.value;

    const massResult = calculateMolarityMass({
      concentrationValue: massConcValue,
      concentrationUnit: massConcUnit,
      molecularWeight: massMw,
      volumeValue: massVolumeValue,
      volumeUnit: massVolumeUnit,
      outputUnit: massOutputUnit
    });
    massCalcResult.textContent = massResult.resultText || massResult.formulaText;

    const volumeMassValue = rootDocument.getElementById('volume-calc-mass')?.value;
    const volumeMassUnit = rootDocument.getElementById('volume-calc-mass-unit')?.value;
    const volumeMw = rootDocument.getElementById('volume-calc-mw')?.value;
    const volumeConcValue = rootDocument.getElementById('volume-calc-concentration')?.value;
    const volumeConcUnit = rootDocument.getElementById('volume-calc-concentration-unit')?.value;
    const volumeOutputUnit = rootDocument.getElementById('volume-calc-output-unit')?.value;

    const volumeResult = calculateMolarityVolume({
      massValue: volumeMassValue,
      massUnit: volumeMassUnit,
      molecularWeight: volumeMw,
      concentrationValue: volumeConcValue,
      concentrationUnit: volumeConcUnit,
      outputUnit: volumeOutputUnit
    });
    volumeCalcResult.textContent = volumeResult.resultText || volumeResult.formulaText;

    const concMassValue = rootDocument.getElementById('conc-calc-mass')?.value;
    const concMassUnit = rootDocument.getElementById('conc-calc-mass-unit')?.value;
    const concMw = rootDocument.getElementById('conc-calc-mw')?.value;
    const concVolumeValue = rootDocument.getElementById('conc-calc-volume')?.value;
    const concVolumeUnit = rootDocument.getElementById('conc-calc-volume-unit')?.value;
    const concOutputUnit = rootDocument.getElementById('conc-calc-output-unit')?.value;

    const concentrationResult = calculateMolarityConcentration({
      massValue: concMassValue,
      massUnit: concMassUnit,
      molecularWeight: concMw,
      volumeValue: concVolumeValue,
      volumeUnit: concVolumeUnit,
      outputUnit: concOutputUnit
    });
    concCalcResult.textContent = concentrationResult.resultText || concentrationResult.formulaText;

    const stockConcValue = rootDocument.getElementById('dilution-stock-conc')?.value;
    const stockConcUnit = rootDocument.getElementById('dilution-stock-conc-unit')?.value;
    const targetConcValue = rootDocument.getElementById('dilution-target-conc')?.value;
    const targetConcUnit = rootDocument.getElementById('dilution-target-conc-unit')?.value;
    const targetVolumeValue = rootDocument.getElementById('dilution-target-volume')?.value;
    const targetVolumeUnit = rootDocument.getElementById('dilution-target-volume-unit')?.value;
    const dilutionOutputUnit = rootDocument.getElementById('dilution-output-unit')?.value;

    const dilutionResult = calculateMolarityDilution({
      stockConcentrationValue: stockConcValue,
      stockConcentrationUnit: stockConcUnit,
      targetConcentrationValue: targetConcValue,
      targetConcentrationUnit: targetConcUnit,
      finalVolumeValue: targetVolumeValue,
      finalVolumeUnit: targetVolumeUnit,
      outputUnit: dilutionOutputUnit
    });
    dilutionCalcResult.textContent = dilutionResult.resultText || dilutionResult.formulaText;
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
