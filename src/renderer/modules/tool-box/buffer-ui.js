import { BUFFER_COMPOUNDS } from '../buffer-compounds.js';
import { formatSigFig, toNumber } from './common.js';
import { makeBufferRow } from './buffer.js';

export function initBufferTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const bufferVolumeInput = rootDocument.getElementById('buffer-volume-ml');
  const bufferRows = rootDocument.getElementById('buffer-rows');
  const addBufferChemicalBtn = rootDocument.getElementById('add-buffer-chemical-btn');
  const bufferTotalResult = rootDocument.getElementById('buffer-total-result');
  if (!bufferVolumeInput || !bufferRows || !addBufferChemicalBtn || !bufferTotalResult) {
    return;
  }

  function getSelectedCompound(row) {
    const select = row.querySelector('.buffer-chemical-select');
    if (!select || select.value === '__custom__') {
      return null;
    }
    return BUFFER_COMPOUNDS.find((item) => item.name === select.value) || null;
  }

  function getBufferRowForm(row) {
    const select = row.querySelector('.buffer-chemical-select');
    if (select?.value === '__custom__') {
      return row.querySelector('.buffer-custom-form')?.value;
    }

    const compound = getSelectedCompound(row);
    return compound?.form === 'liquid' ? 'liquid' : 'solid';
  }

  function applyBufferRowMode(row) {
    const form = getBufferRowForm(row);
    const mwInput = row.querySelector('.buffer-mw');
    const concentrationLabel = row.querySelector('.buffer-concentration-label');
    const concentrationInput = row.querySelector('.buffer-concentration');
    if (!mwInput || !concentrationLabel || !concentrationInput) {
      return;
    }

    if (form === 'liquid') {
      concentrationLabel.textContent = 'Volume (% v/v)';
      concentrationInput.placeholder = 'e.g. 0.1';
      concentrationInput.step = '0.0001';
      mwInput.disabled = true;
      return;
    }

    concentrationLabel.textContent = 'Concentration (mM)';
    concentrationInput.placeholder = 'e.g. 150';
    concentrationInput.step = '0.001';
    mwInput.disabled = false;
  }

  function resolveChemicalName(row) {
    const select = row.querySelector('.buffer-chemical-select');
    if (select?.value !== '__custom__') {
      return select?.value;
    }
    return row.querySelector('.buffer-custom-name')?.value.trim() || 'Custom Chemical';
  }

  function renderBuffer() {
    const volumeMl = toNumber(bufferVolumeInput.value);
    const volumeL = volumeMl / 1000;

    let totalSolidMg = 0;
    let totalLiquidMl = 0;

    [...bufferRows.querySelectorAll('.buffer-row')].forEach((row) => {
      const name = resolveChemicalName(row);
      const form = getBufferRowForm(row);
      const concentrationValue = toNumber(row.querySelector('.buffer-concentration')?.value);
      const rowWeight = row.querySelector('.buffer-weight');
      if (!rowWeight) {
        return;
      }

      if (form === 'liquid') {
        const requiredMl = (concentrationValue / 100) * volumeMl;
        const requiredUl = requiredMl * 1000;
        const outputText = `${name}: ${formatSigFig(requiredMl)} mL (${formatSigFig(requiredUl)} uL) at ${formatSigFig(concentrationValue)}% v/v`;
        totalLiquidMl += requiredMl;
        rowWeight.textContent = outputText;
        rowWeight.title = outputText;
        return;
      }

      const mw = toNumber(row.querySelector('.buffer-mw')?.value);
      const concentrationMm = concentrationValue;
      const grams = (concentrationMm / 1000) * volumeL * mw;
      const mg = grams * 1000;
      const outputText = `${name}: ${formatSigFig(mg)} mg (${formatSigFig(grams)} g) at ${formatSigFig(concentrationMm)} mM`;
      totalSolidMg += mg;
      rowWeight.textContent = outputText;
      rowWeight.title = outputText;
    });

    bufferTotalResult.textContent = `Total solids: ${formatSigFig(totalSolidMg)} mg (${formatSigFig(totalSolidMg / 1000)} g) | Total liquids: ${formatSigFig(totalLiquidMl)} mL (${formatSigFig(totalLiquidMl * 1000)} uL)`;
  }

  function addRow() {
    const row = makeBufferRow();
    applyBufferRowMode(row);
    bufferRows.appendChild(row);
    renderBuffer();
  }

  addBufferChemicalBtn.addEventListener('click', addRow);
  bufferVolumeInput.addEventListener('input', renderBuffer);

  bufferRows.addEventListener('input', (event) => {
    const row = event.target.closest('.buffer-row');
    if (!row) {
      return;
    }

    if (event.target.classList.contains('buffer-custom-form')) {
      applyBufferRowMode(row);
    }

    renderBuffer();
  });

  bufferRows.addEventListener('click', (event) => {
    if (!event.target.classList.contains('buffer-remove-btn')) {
      return;
    }

    const row = event.target.closest('.buffer-row');
    if (!row) {
      return;
    }

    row.remove();
    if (!bufferRows.children.length) {
      addRow();
    }
    renderBuffer();
  });

  bufferRows.addEventListener('change', (event) => {
    const customForm = event.target.closest('.buffer-custom-form');
    if (customForm) {
      const row = customForm.closest('.buffer-row');
      if (row) {
        applyBufferRowMode(row);
        renderBuffer();
      }
      return;
    }

    const select = event.target.closest('.buffer-chemical-select');
    if (!select) {
      return;
    }

    const row = select.closest('.buffer-row');
    const customNameInput = row?.querySelector('.buffer-custom-name');
    const customPanel = row?.querySelector('.buffer-custom-panel');
    const customFormSelect = row?.querySelector('.buffer-custom-form');
    const mwInput = row?.querySelector('.buffer-mw');
    if (!row || !customNameInput || !customPanel || !customFormSelect || !mwInput) {
      return;
    }

    if (select.value === '__custom__') {
      customNameInput.disabled = false;
      customNameInput.focus();
      customPanel.hidden = false;
      customFormSelect.disabled = false;
      mwInput.disabled = customFormSelect.value !== 'solid';
      if (customFormSelect.value === 'solid') {
        mwInput.value = '';
      }
      applyBufferRowMode(row);
      renderBuffer();
      return;
    }

    customNameInput.disabled = true;
    customNameInput.value = '';
    customPanel.hidden = true;
    customFormSelect.disabled = true;
    customFormSelect.value = 'solid';

    const chemical = BUFFER_COMPOUNDS.find((item) => item.name === select.value);
    mwInput.value = chemical ? chemical.mw : '';
    applyBufferRowMode(row);
    renderBuffer();
  });

  addRow();
  renderBuffer();
}
