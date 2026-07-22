import { oppositeAxis } from '../shared.js';
import { buildDilutionSeries, buildInterpolatedSeries } from '../concentration-utils.js';

// Auto-fill of the concentration axis: serial-dilution (factor) and
// interpolated (linear/log) range modes.
export function createConcentrationFill({
  runtime,
  assayFillModeInput,
  assayDilutionFactorInput,
  assayPlatePreview,
  serialDilution,
  getSampleAxis,
  getConcentrationUnit,
  getAxisTemplateValues,
  syncAxisTemplateValues,
  setLayoutFromAxisAndOverrides,
  renderPlatePreview,
  renderResultTable,
  setLayoutStatus
}) {
  function getFillMode() {
    const mode = String(assayFillModeInput?.value || 'factor');
    return mode === 'linear' || mode === 'log' ? mode : 'factor';
  }

  // Show the factor input only for 'factor' mode. Range modes read their start/end
  // straight from the first and last filled concentration cells in the plate.
  function syncFillModeInputs() {
    const isRange = getFillMode() !== 'factor';
    if (assayDilutionFactorInput) assayDilutionFactorInput.hidden = isRange;
  }

  function commitConcentrationValues(sampleValues, concentrationValues, statusMessage) {
    const concentrationAxis = oppositeAxis(getSampleAxis());
    concentrationValues.forEach((value, axisIndex) => {
      const input = assayPlatePreview?.querySelector(
        `[data-axis-dimension="${concentrationAxis}"][data-axis-index="${axisIndex}"]`
      );
      if (input) {
        input.value = value;
      }
    });
    syncAxisTemplateValues({ sampleValues, concentrationValues });
    setLayoutFromAxisAndOverrides();
    renderPlatePreview();
    renderResultTable();
    if (serialDilution.isOpen()) {
      serialDilution.render();
    }
    setLayoutStatus(statusMessage);
  }

  // Serial dilution: first cell is the start, each following column/row = previous / factor.
  function autoFillConcentrationSeries() {
    const factor = Number(assayDilutionFactorInput?.value);
    if (!(Number.isFinite(factor) && factor > 0)) {
      setLayoutStatus('Enter a positive dilution factor to auto-fill concentrations.');
      return;
    }
    const values = getAxisTemplateValues();
    const concentrationValues = values.concentrationValues.slice();
    if (concentrationValues.length < 2) {
      setLayoutStatus('The concentration axis needs at least two positions to fill a dilution series.');
      return;
    }
    const series = buildDilutionSeries(concentrationValues[0], factor, concentrationValues.length);
    if (!series) {
      setLayoutStatus('Enter a starting concentration in the first concentration cell before auto-filling.');
      return;
    }
    for (let index = 1; index < concentrationValues.length; index += 1) {
      concentrationValues[index] = series[index];
    }
    const steps = concentrationValues.length - 1;
    commitConcentrationValues(
      values.sampleValues,
      concentrationValues,
      `Auto-filled ${steps} concentration step${steps === 1 ? '' : 's'} at a 1:${factor} dilution.`
    );
  }

  // Interpolate the empty cells between the first and last filled concentration
  // cells in the plate. The user types the start and end straight into the plate.
  function autoFillConcentrationRange(mode, { silent = false } = {}) {
    const values = getAxisTemplateValues();
    const concentrationValues = values.concentrationValues.slice();
    const firstIndex = concentrationValues.findIndex((value) => String(value || '').trim());
    let lastIndex = -1;
    for (let index = concentrationValues.length - 1; index >= 0; index -= 1) {
      if (String(concentrationValues[index] || '').trim()) {
        lastIndex = index;
        break;
      }
    }
    if (firstIndex < 0 || lastIndex - firstIndex < 1) {
      if (!silent) {
        setLayoutStatus('Type a start and end concentration into two plate cells to fill the range.');
      }
      return;
    }
    const series = buildInterpolatedSeries({
      startValue: concentrationValues[firstIndex],
      endValue: concentrationValues[lastIndex],
      count: lastIndex - firstIndex + 1,
      mode,
      axisUnit: getConcentrationUnit()
    });
    if (!series) {
      if (!silent) {
        setLayoutStatus(mode === 'log'
          ? 'Use positive start and end concentrations (log spacing cannot include 0).'
          : 'Enter a start and end concentration to fill the range.');
      }
      return;
    }
    // Only fill the cells between the endpoints; leave any manual entries in place.
    for (let step = 1; step < series.length - 1; step += 1) {
      const axisIndex = firstIndex + step;
      concentrationValues[axisIndex] = series[step];
    }
    commitConcentrationValues(
      values.sampleValues,
      concentrationValues,
      `Auto-filled ${series.length} concentrations from ${series[0]} to ${series[series.length - 1]} (${mode}).`
    );
  }

  function onFillConcentrations() {
    const mode = getFillMode();
    if (mode === 'factor') {
      autoFillConcentrationSeries();
    } else {
      autoFillConcentrationRange(mode);
    }
  }

  return { getFillMode, syncFillModeInputs, onFillConcentrations, autoFillConcentrationRange };
}
