import {
  getContainerLayout,
  getWellName,
  isMultiWellContainer
} from '../../../lib/inventory-containers.js';
import { getEditableSampleTypeEntries } from '../../../lib/inventory-settings.js';
import {
  buildLocationFromInventoryLink,
  getContainerWellName
} from '../../sample-registry/inventory-links.js';
import {
  makeDefaultCode,
  normalizeCode
} from '../../sample-registry/sample-utils.js';
import { buildNotebookSampleCapture } from '../../sample-registry/notebook-capture-record.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function listContainers(inventory = {}) {
  return Object.entries(inventory || {}).flatMap(([section, containers]) => (
    asArray(containers).map((container) => ({
      section,
      container,
      key: `${section}::${container?.id || ''}`
    }))
  )).filter((item) => item.container?.id);
}

function findContainer(containers, key) {
  return asArray(containers).find((item) => item.key === String(key || '')) || null;
}

function linkedSamplesAt(state, selectedContainer, wellIndex) {
  if (!selectedContainer) {
    return [];
  }
  return asArray(state?.samples).filter((sample) => {
    const link = sample?.inventoryLink;
    if (link?.section !== selectedContainer.section || link?.containerId !== selectedContainer.container.id) {
      return false;
    }
    if (wellIndex === null) {
      return link.wellIndex === null || link.wellIndex === undefined;
    }
    return Number(link.wellIndex) === wellIndex;
  });
}

export function createNotebookQuickSampleController({
  doc = (typeof document !== 'undefined' ? document : null),
  state,
  safeText = (value) => String(value || ''),
  createId,
  ensureEntry,
  onCreated
} = {}) {
  const overlay = doc?.getElementById?.('biology-notebook-quick-sample-overlay');
  const form = doc?.getElementById?.('biology-notebook-quick-sample-form');
  const closeBtn = doc?.getElementById?.('biology-notebook-quick-sample-close-btn');
  const cancelBtn = doc?.getElementById?.('biology-notebook-quick-sample-cancel-btn');
  const containerSelect = doc?.getElementById?.('biology-notebook-quick-sample-container');
  const positionOutput = doc?.getElementById?.('biology-notebook-quick-sample-position');
  const positionMeta = doc?.getElementById?.('biology-notebook-quick-sample-position-meta');
  const grid = doc?.getElementById?.('biology-notebook-quick-sample-grid');
  const gridLabel = doc?.getElementById?.('biology-notebook-quick-sample-grid-label');
  const nameInput = doc?.getElementById?.('biology-notebook-quick-sample-name');
  const codeInput = doc?.getElementById?.('biology-notebook-quick-sample-code');
  const typeInput = doc?.getElementById?.('biology-notebook-quick-sample-type');
  const lotInput = doc?.getElementById?.('biology-notebook-quick-sample-lot');
  const concentrationInput = doc?.getElementById?.('biology-notebook-quick-sample-concentration');
  const status = doc?.getElementById?.('biology-notebook-quick-sample-status');
  const submitBtn = doc?.getElementById?.('biology-notebook-quick-sample-submit-btn');
  let containers = [];
  let selectedContainer = null;
  let selectedWellIndex = null;

  function setStatus(message, isError = false) {
    if (!status) {
      return;
    }
    status.textContent = String(message || '');
    status.classList?.toggle?.('is-error', Boolean(isError));
  }

  function setBusy(isBusy) {
    if (submitBtn) {
      submitBtn.disabled = Boolean(isBusy);
      submitBtn.textContent = isBusy ? 'Adding…' : 'Add Sample';
    }
  }

  function getWellCount(container) {
    if (!container || !isMultiWellContainer(container)) {
      return 1;
    }
    const layout = getContainerLayout(container);
    return layout.rows * layout.cols;
  }

  function getWellLabel(container, index) {
    return getContainerWellName(container, index) || getWellName(container, index);
  }

  function firstAvailableWell(containerItem) {
    if (!containerItem || !isMultiWellContainer(containerItem.container)) {
      return null;
    }
    const count = getWellCount(containerItem.container);
    for (let index = 0; index < count; index += 1) {
      if (!linkedSamplesAt(state, containerItem, index).length) {
        return index;
      }
    }
    return count ? 0 : null;
  }

  function renderPosition() {
    if (!positionOutput || !positionMeta) {
      return;
    }
    if (!selectedContainer) {
      positionOutput.textContent = '—';
      positionMeta.textContent = 'No container selected';
      return;
    }
    if (!isMultiWellContainer(selectedContainer.container)) {
      const occupied = linkedSamplesAt(state, selectedContainer, null).length;
      positionOutput.textContent = 'Single';
      positionMeta.textContent = occupied ? `${occupied} sample${occupied === 1 ? '' : 's'} here` : 'Empty position';
      return;
    }
    const label = Number.isInteger(selectedWellIndex)
      ? getWellLabel(selectedContainer.container, selectedWellIndex)
      : '—';
    const occupied = Number.isInteger(selectedWellIndex)
      ? linkedSamplesAt(state, selectedContainer, selectedWellIndex).length
      : 0;
    positionOutput.textContent = label;
    positionMeta.textContent = occupied ? `${occupied} sample${occupied === 1 ? '' : 's'} here` : 'Empty position';
  }

  function renderGrid() {
    if (!grid || !gridLabel) {
      return;
    }
    if (!selectedContainer) {
      gridLabel.textContent = 'Grid box';
      grid.className = 'biology-notebook-quick-sample-grid is-empty';
      grid.removeAttribute?.('style');
      grid.innerHTML = '<p class="small-note">No Personal Inventory containers are available.</p>';
      renderPosition();
      return;
    }

    const container = selectedContainer.container;
    gridLabel.textContent = container.name || 'Container';
    if (!isMultiWellContainer(container)) {
      const occupied = linkedSamplesAt(state, selectedContainer, null).length;
      grid.className = 'biology-notebook-quick-sample-grid is-single';
      grid.removeAttribute?.('style');
      grid.innerHTML = `
        <button type="button" class="biology-notebook-quick-sample-well is-selected${occupied ? ' is-occupied' : ''}" data-quick-sample-well="single" aria-pressed="true">
          Single
          ${occupied ? `<span>${safeText(String(occupied))}</span>` : ''}
        </button>
      `;
      selectedWellIndex = null;
      renderPosition();
      return;
    }

    const layout = getContainerLayout(container);
    const count = layout.rows * layout.cols;
    grid.className = 'biology-notebook-quick-sample-grid';
    grid.style.setProperty('--quick-sample-grid-cols', String(layout.cols));
    grid.style.setProperty('--quick-sample-grid-rows', String(layout.rows));
    grid.style.setProperty('--quick-sample-grid-aspect-x', String(layout.cols));
    grid.style.setProperty('--quick-sample-grid-aspect-y', String(layout.rows));
    grid.innerHTML = Array.from({ length: count }, (_item, index) => {
      const label = getWellLabel(container, index);
      const occupied = linkedSamplesAt(state, selectedContainer, index).length;
      const selected = index === selectedWellIndex;
      return `
        <button type="button" class="biology-notebook-quick-sample-well${selected ? ' is-selected' : ''}${occupied ? ' is-occupied' : ''}" data-quick-sample-well="${index}" aria-label="${safeText(`${label}${occupied ? `, ${occupied} sample${occupied === 1 ? '' : 's'}` : ', empty'}`)}" aria-pressed="${selected ? 'true' : 'false'}">
          ${safeText(label)}
          ${occupied ? `<span>${safeText(String(occupied))}</span>` : ''}
        </button>
      `;
    }).join('');
    renderPosition();
  }

  function selectContainer(key) {
    selectedContainer = findContainer(containers, key);
    selectedWellIndex = firstAvailableWell(selectedContainer);
    if (containerSelect) {
      containerSelect.value = selectedContainer?.key || '';
    }
    renderGrid();
  }

  function renderContainerOptions() {
    containers = listContainers(state?.inventory);
    const previousKey = selectedContainer?.key || containerSelect?.value || '';
    if (containerSelect) {
      containerSelect.innerHTML = [
        '<option value="">No container</option>',
        ...containers.map((item) => `<option value="${safeText(item.key)}">${safeText(`${item.section} / ${item.container.name || 'Container'}`)}</option>`)
      ].join('');
    }
    const next = findContainer(containers, previousKey) || containers[0] || null;
    selectContainer(next?.key || '');
  }

  function renderSampleTypes() {
    if (!typeInput) {
      return;
    }
    const entries = getEditableSampleTypeEntries(state?.settings);
    typeInput.innerHTML = entries.map((entry) => (
      `<option value="${safeText(entry.type)}">${safeText(entry.label)}</option>`
    )).join('');
    typeInput.value = entries.some((entry) => entry.type === 'plasmid') ? 'plasmid' : (entries[0]?.type || '');
  }

  function resetFields() {
    [nameInput, codeInput, lotInput, concentrationInput].forEach((input) => {
      if (input) {
        input.value = '';
      }
    });
    renderSampleTypes();
    setStatus('');
    setBusy(false);
  }

  function open() {
    if (!overlay) {
      return;
    }
    resetFields();
    renderContainerOptions();
    overlay.hidden = false;
    nameInput?.focus?.();
  }

  function close() {
    if (overlay) {
      overlay.hidden = true;
    }
    setStatus('');
    setBusy(false);
  }

  function uniqueGeneratedCode() {
    let code = makeDefaultCode();
    let attempt = 1;
    while (asArray(state?.samples).some((sample) => sample?.code === code)) {
      code = `${makeDefaultCode()}-${attempt}`;
      attempt += 1;
    }
    return code;
  }

  async function submit(event) {
    event?.preventDefault?.();
    const name = String(nameInput?.value || '').trim();
    if (!name) {
      setStatus('Enter a sample name.', true);
      nameInput?.focus?.();
      return null;
    }
    const requestedCode = normalizeCode(codeInput?.value);
    if (requestedCode && asArray(state?.samples).some((sample) => sample?.code === requestedCode)) {
      setStatus(`Sample code ${requestedCode} already exists.`, true);
      codeInput?.focus?.();
      return null;
    }

    setBusy(true);
    setStatus('');
    try {
      const entry = await ensureEntry?.();
      if (!entry) {
        setStatus('Open a notebook page before adding a sample.', true);
        return null;
      }
      const nowIso = new Date().toISOString();
      const linkedPosition = selectedContainer
        ? (isMultiWellContainer(selectedContainer.container) ? String(selectedWellIndex) : 'single')
        : '';
      const record = {
        id: String(createId?.() || `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`),
        code: requestedCode || uniqueGeneratedCode(),
        name,
        type: String(typeInput?.value || 'plasmid').trim() || 'plasmid',
        lot: String(lotInput?.value || '').trim(),
        concentration: String(concentrationInput?.value || '').trim(),
        notes: '',
        cellPassage: null,
        location: selectedContainer ? buildLocationFromInventoryLink(selectedContainer, linkedPosition) : null,
        inventoryLink: selectedContainer
          ? {
            section: selectedContainer.section,
            containerId: selectedContainer.container.id,
            wellIndex: isMultiWellContainer(selectedContainer.container) ? selectedWellIndex : null
          }
          : null,
        chemicalLinks: [],
        compoundStructure: null,
        updatedAt: nowIso
      };
      const capture = buildNotebookSampleCapture({ state }, record, {
        notebookEntryId: entry.id,
        requestedAt: nowIso,
        source: 'notebook-quick-add'
      });
      if (!capture) {
        setStatus('Could not link the sample to this notebook page.', true);
        return null;
      }
      state.samples = asArray(state.samples);
      state.samples.push(record);
      try {
        await onCreated?.({ entry, record, ...capture });
      } catch (error) {
        state.samples = state.samples.filter((sample) => sample !== record);
        throw error;
      }
      close();
      return record;
    } catch (error) {
      setStatus(error?.message || 'Could not add the sample.', true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  containerSelect?.addEventListener?.('change', () => selectContainer(containerSelect.value));
  grid?.addEventListener?.('click', (event) => {
    const well = event?.target?.closest?.('[data-quick-sample-well]');
    if (!well || !selectedContainer) {
      return;
    }
    const rawIndex = String(well.dataset?.quickSampleWell || '');
    selectedWellIndex = rawIndex === 'single' ? null : Number(rawIndex);
    renderGrid();
  });
  form?.addEventListener?.('submit', submit);
  closeBtn?.addEventListener?.('click', close);
  cancelBtn?.addEventListener?.('click', close);
  overlay?.addEventListener?.('click', (event) => {
    if (event?.target === overlay) {
      close();
    }
  });
  overlay?.addEventListener?.('keydown', (event) => {
    if (event?.key === 'Escape') {
      event.preventDefault?.();
      close();
    }
  });

  return {
    open,
    close,
    submit,
    isOpen: () => Boolean(overlay && !overlay.hidden)
  };
}
