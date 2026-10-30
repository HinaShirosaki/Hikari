import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("tools");
import { calculateMolarityDilution } from '../../lib/bench-calculations.js';
import {
  concentrationFromM,
  concentrationToM,
  massFromG,
  massToG,
  volumeFromL,
  volumeToL
} from '../../lib/molarity.js';
import { formatSigFig } from '../../lib/numbers.js';
import { setToolText } from './localization.js';

// mass(g) = concentration(M) x volume(L) x molecular weight(g/mol)
const SOLVER_FIELDS = [
  { key: 'mass', label: 'Mass', inputId: 'molarity-mass', unitId: 'molarity-mass-unit', toBase: massToG, fromBase: massFromG },
  { key: 'volume', label: 'Volume', inputId: 'molarity-volume', unitId: 'molarity-volume-unit', toBase: volumeToL, fromBase: volumeFromL },
  { key: 'concentration', label: 'Concentration', inputId: 'molarity-concentration', unitId: 'molarity-concentration-unit', toBase: concentrationToM, fromBase: concentrationFromM },
  { key: 'mw', label: 'Formula weight', inputId: 'molarity-mw', unitId: '', unit: 'g/mol', toBase: (value) => Number(value), fromBase: (value) => value }
];

function solveBase(key, { mass, volume, concentration, mw }) {
  switch (key) {
    case 'mass':
      return concentration * volume * mw;
    case 'volume':
      return mass / (concentration * mw);
    case 'concentration':
      return mass / (volume * mw);
    default:
      return mass / (concentration * volume);
  }
}

export function initMolarityTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const solverForm = rootDocument.getElementById('molarity-solver-form');
  const solverResult = rootDocument.getElementById('molarity-solver-result');
  const molarityDilutionForm = rootDocument.getElementById('molarity-dilution-form');
  const dilutionCalcResult = rootDocument.getElementById('dilution-calc-result');
  if (!solverForm || !solverResult || !molarityDilutionForm || !dilutionCalcResult) {
    return;
  }

  function renderMolarityResult(element, { resultText = '', status = '', messageKey = '', params = {} } = {}) {
    element.dataset.state = status === 'warning'
      ? 'warning'
      : (status === 'hint' || (!resultText && !messageKey) ? 'empty' : 'calculated');
    if (messageKey) setToolText(element, messageKey, params);
    else {
      element.removeAttribute?.('data-i18n');
      element.removeAttribute?.('data-i18n-params');
      i18nUi.setText(element, resultText);
    }
  }

  function readSolverField(field) {
    const raw = String(rootDocument.getElementById(field.inputId)?.value ?? '').trim();
    const unit = field.unit || rootDocument.getElementById(field.unitId)?.value || '';
    return { field, raw, unit, value: raw ? Number(raw) : null };
  }

  function renderSolver() {
    const entries = SOLVER_FIELDS.map(readSolverField);
    const blanks = entries.filter((entry) => !entry.raw);
    if (blanks.length > 1) {
      renderMolarityResult(solverResult, { messageKey: 'molarity.enterThree', status: 'hint' });
      return;
    }
    if (!blanks.length) {
      renderMolarityResult(solverResult, { messageKey: 'molarity.clearTarget', status: 'hint' });
      return;
    }
    const target = blanks[0];
    const known = entries.filter((entry) => entry !== target);
    if (known.some((entry) => !(entry.value > 0))) {
      renderMolarityResult(solverResult, { messageKey: 'molarity.positive', status: 'warning' });
      return;
    }
    const base = {};
    known.forEach((entry) => {
      base[entry.field.key] = entry.field.toBase(entry.value, entry.unit);
    });
    const solved = target.field.fromBase(solveBase(target.field.key, base), target.unit);
    if (!Number.isFinite(solved) || solved <= 0) {
      renderMolarityResult(solverResult, { messageKey: 'molarity.unusable', status: 'warning' });
      return;
    }
    renderMolarityResult(solverResult, {
      messageKey: `molarity.${target.field.key}Result`,
      params: { value: formatSigFig(solved), unit: target.unit }
    });
  }

  function renderDilution() {
    const result = calculateMolarityDilution({
      stockConcentrationValue: rootDocument.getElementById('dilution-stock-conc')?.value,
      stockConcentrationUnit: rootDocument.getElementById('dilution-stock-conc-unit')?.value,
      targetConcentrationValue: rootDocument.getElementById('dilution-target-conc')?.value,
      targetConcentrationUnit: rootDocument.getElementById('dilution-target-conc-unit')?.value,
      finalVolumeValue: rootDocument.getElementById('dilution-target-volume')?.value,
      finalVolumeUnit: rootDocument.getElementById('dilution-target-volume-unit')?.value
    });
    renderMolarityResult(dilutionCalcResult, {
      ...result,
      messageKey: result.displayMessage ? `bench.${result.displayMessage.id}` : '',
      params: result.displayMessage?.params || {}
    });
  }

  [[solverForm, renderSolver], [molarityDilutionForm, renderDilution]].forEach(([form, render]) => {
    form.addEventListener('input', render);
    form.addEventListener('change', render);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      render();
    });
  });

  renderSolver();
  renderDilution();
}
