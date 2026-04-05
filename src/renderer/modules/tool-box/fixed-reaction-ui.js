import { formatSigFig, toNumber } from './common.js';
import { volumeFromL, volumeToL } from './molarity.js';

const CONCENTRATION_FACTORS = {
  fM: 1e-15,
  pM: 1e-12,
  nM: 1e-9,
  uM: 1e-6,
  mM: 1e-3,
  M: 1,
  x: 1
};

const CONCENTRATION_OPTIONS = ['fM', 'pM', 'nM', 'uM', 'mM', 'M', 'x'];
const VOLUME_OPTIONS = ['uL', 'mL', 'L'];
const VOLUME_EPSILON_L = 1e-15;

function selectMarkup(options, selectedValue) {
  return options.map((option) => {
    const selected = option === selectedValue ? ' selected' : '';
    return `<option value="${option}"${selected}>${option}</option>`;
  }).join('');
}

function parseConcentration(value, unit) {
  const numericValue = toNumber(value);
  if (!(numericValue > 0)) {
    return null;
  }

  if (unit === 'x') {
    return {
      kind: 'fold',
      value: numericValue
    };
  }

  const factor = CONCENTRATION_FACTORS[unit];
  if (!(factor > 0)) {
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

function describeVolume(valueL, unit) {
  return `${formatSigFig(volumeFromL(valueL, unit))} ${unit}`;
}

function createReactionRow(rootDocument, rowId) {
  const row = rootDocument.createElement('div');
  row.className = 'reaction-mix-row';
  row.dataset.rowId = String(rowId);
  row.innerHTML = `
    <label class="reaction-mix-cell">
      <span class="reaction-mix-cell-label">Name</span>
      <input class="reaction-mix-name" type="text" placeholder="e.g. ATP" />
    </label>
    <label class="reaction-mix-cell">
      <span class="reaction-mix-cell-label">Stock Conc</span>
      <div class="inline-row">
        <input class="reaction-mix-stock-value" type="number" min="0" step="0.000001" placeholder="e.g. 10" />
        <select class="reaction-mix-stock-unit">${selectMarkup(CONCENTRATION_OPTIONS, 'mM')}</select>
      </div>
    </label>
    <label class="reaction-mix-cell">
      <span class="reaction-mix-cell-label">Final Conc</span>
      <div class="inline-row">
        <input class="reaction-mix-final-value" type="number" min="0" step="0.000001" placeholder="e.g. 1" />
        <select class="reaction-mix-final-unit">${selectMarkup(CONCENTRATION_OPTIONS, 'uM')}</select>
      </div>
    </label>
    <label class="reaction-mix-cell reaction-mix-volume-cell">
      <span class="reaction-mix-cell-label">Volume</span>
      <div class="inline-row">
        <input class="reaction-mix-volume-value" type="number" min="0" step="0.000001" placeholder="Leave blank to auto-calc" />
        <select class="reaction-mix-volume-unit">${selectMarkup(VOLUME_OPTIONS, 'uL')}</select>
      </div>
      <div class="reaction-mix-row-note"></div>
    </label>
    <div class="reaction-mix-cell reaction-mix-action-cell">
      <span class="reaction-mix-cell-label">Action</span>
      <button type="button" class="ghost-btn reaction-mix-delete-btn">Delete</button>
    </div>
  `;
  return row;
}

export function initFixedReactionTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const rowsHost = rootDocument.getElementById('fixed-reaction-rows');
  const addRowBtn = rootDocument.getElementById('fixed-reaction-add-row-btn');
  const fillNameInput = rootDocument.getElementById('fixed-reaction-fill-name');
  const fillVolumeOutput = rootDocument.getElementById('fixed-reaction-fill-volume');
  const fillNote = rootDocument.getElementById('fixed-reaction-fill-note');
  const totalVolumeInput = rootDocument.getElementById('fixed-reaction-total-volume');
  const totalUnitSelect = rootDocument.getElementById('fixed-reaction-total-unit');
  if (!rowsHost || !addRowBtn || !fillNameInput || !fillVolumeOutput || !fillNote || !totalVolumeInput || !totalUnitSelect) {
    return;
  }

  let rowIdCounter = 0;

  function addRow() {
    rowIdCounter += 1;
    rowsHost.appendChild(createReactionRow(rootDocument, rowIdCounter));
  }

  function calculateRowVolume(row, totalVolumeL) {
    const name = String(row.querySelector('.reaction-mix-name')?.value || '').trim() || 'Reagent';
    const volumeInput = row.querySelector('.reaction-mix-volume-value');
    const volumeUnit = row.querySelector('.reaction-mix-volume-unit')?.value || 'uL';
    const stockValue = row.querySelector('.reaction-mix-stock-value')?.value;
    const stockUnit = row.querySelector('.reaction-mix-stock-unit')?.value || 'mM';
    const finalValue = row.querySelector('.reaction-mix-final-value')?.value;
    const finalUnit = row.querySelector('.reaction-mix-final-unit')?.value || 'uM';

    const manualVolume = toNumber(volumeInput?.value);
    if (manualVolume > 0) {
      const manualVolumeL = volumeToL(manualVolume, volumeUnit);
      const hasConcentrationInputs = toNumber(stockValue) > 0 || toNumber(finalValue) > 0;
      return {
        liters: manualVolumeL,
        note: hasConcentrationInputs
          ? `Manual: ${formatSigFig(manualVolume)} ${volumeUnit} (overrides stock/final).`
          : `Manual: ${formatSigFig(manualVolume)} ${volumeUnit}.`,
        status: 'ok'
      };
    }

    if (!(totalVolumeL > 0)) {
      return {
        liters: 0,
        note: 'Enter the total volume first.',
        status: 'muted'
      };
    }

    const stock = parseConcentration(stockValue, stockUnit);
    const finalConcentration = parseConcentration(finalValue, finalUnit);
    if (!stock || !finalConcentration) {
      return {
        liters: 0,
        note: 'Enter stock/final concentration or type a volume directly.',
        status: 'muted'
      };
    }

    if (stock.kind !== finalConcentration.kind) {
      return {
        liters: 0,
        note: 'Stock and final concentration must use matching unit types.',
        status: 'warning'
      };
    }

    if (finalConcentration.value > stock.value) {
      return {
        liters: 0,
        note: `${name}: final concentration cannot be higher than stock.`,
        status: 'warning'
      };
    }

    const ratio = finalConcentration.value / stock.value;
    const calculatedVolumeL = roundNearZero(totalVolumeL * ratio);
    return {
      liters: calculatedVolumeL,
      note: `Calculated: ${describeVolume(calculatedVolumeL, volumeUnit)}.`,
      status: 'ok'
    };
  }

  function applyRowFeedback(row, result) {
    const note = row.querySelector('.reaction-mix-row-note');
    if (!note) {
      return;
    }

    note.textContent = result.note;
    note.classList.toggle('is-warning', result.status === 'warning');
    note.classList.toggle('is-ok', result.status === 'ok');
  }

  function renderReaction() {
    const totalVolumeL = volumeToL(totalVolumeInput.value, totalUnitSelect.value);
    const totalUnit = totalUnitSelect.value || 'uL';
    const rows = [...rowsHost.querySelectorAll('.reaction-mix-row')];

    let assignedVolumeL = 0;

    rows.forEach((row) => {
      const result = calculateRowVolume(row, totalVolumeL);
      assignedVolumeL += result.liters;
      applyRowFeedback(row, result);
    });

    const fillVolumeL = roundNearZero(totalVolumeL - assignedVolumeL);
    fillVolumeOutput.textContent = totalVolumeL > 0 ? describeVolume(fillVolumeL, totalUnit) : `0 ${totalUnit}`;
    fillVolumeOutput.classList.toggle('reaction-mix-static-warning', fillVolumeL < -VOLUME_EPSILON_L);

    if (fillVolumeL < -VOLUME_EPSILON_L) {
      fillNote.textContent = 'Assigned reagent volumes exceed the total volume.';
      fillNote.classList.add('is-warning');
      fillNote.classList.remove('is-ok');
    } else {
      fillNote.textContent = `${String(fillNameInput.value || 'Fill solution').trim() || 'Fill solution'} is auto-calculated to reach the total volume.`;
      fillNote.classList.remove('is-warning');
      fillNote.classList.add('is-ok');
    }

  }

  addRowBtn.addEventListener('click', () => {
    addRow();
    renderReaction();
  });

  rowsHost.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('.reaction-mix-delete-btn');
    if (!deleteButton) {
      return;
    }

    const row = deleteButton.closest('.reaction-mix-row');
    if (!row) {
      return;
    }

    row.remove();
    renderReaction();
  });

  rowsHost.addEventListener('input', renderReaction);
  rowsHost.addEventListener('change', renderReaction);
  totalVolumeInput.addEventListener('input', renderReaction);
  totalUnitSelect.addEventListener('change', renderReaction);
  fillNameInput.addEventListener('input', renderReaction);

  addRow();
  renderReaction();
}
