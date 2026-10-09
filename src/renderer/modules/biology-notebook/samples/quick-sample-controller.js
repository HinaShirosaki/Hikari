import { showTransientNotice } from '../../../lib/notify.js';
import {
  getContainerLayout,
  getContainerWellName,
  isMultiWellContainer
} from '../../../lib/inventory-containers.js';
import {
  getEditableSampleTypeEntries,
  getSampleInventoryLocationDisplay,
  getSampleInventoryLocationNames
} from '../../../lib/inventory-settings.js';
import { buildSampleLocation, makeDefaultSampleCode, normalizeSampleCode } from '../../../lib/sample-records.js';
import { buildNotebookSampleCapture } from './notebook-capture-record.js';
import { asArray } from '../../../lib/normalize.js';

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

// "Add samples" dialog on a notebook page: create a sample in a container slot
// and link it to the page in one step (the page is saved first via ensureEntry
// if it is new). A sample only exists inside a container, so one is required.
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
  const locationList = doc?.getElementById?.('biology-notebook-quick-sample-location-list');
  const containerSelect = doc?.getElementById?.('biology-notebook-quick-sample-container');
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
  let locationNames = [];
  let selectedLocation = '';
  let selectedContainer = null;
  let selectedWellIndex = null;

  function setStatus(message, isError = false) {
    if (isError && message) {
      showTransientNotice(String(message), { type: 'error' });
    }
    if (!status) {
      return;
    }
    status.textContent = String(message || '');
    status.classList?.toggle?.('is-error', Boolean(isError));
  }

  function setBusy(isBusy) {
    if (submitBtn) {
      submitBtn.disabled = Boolean(isBusy);
      const label = isBusy ? 'Adding sample' : 'Add Sample';
      submitBtn.setAttribute?.('aria-label', label);
      submitBtn.setAttribute?.('title', label);
      if (isBusy) {
        submitBtn.setAttribute?.('aria-busy', 'true');
      } else {
        submitBtn.removeAttribute?.('aria-busy');
      }
      const screenReaderLabel = submitBtn.querySelector?.('.sr-only');
      if (screenReaderLabel) {
        screenReaderLabel.textContent = label;
      }
    }
  }

  function getWellCount(container) {
    if (!container || !isMultiWellContainer(container)) {
      return 1;
    }
    const layout = getContainerLayout(container);
    return layout.rows * layout.cols;
  }

  // First empty well, falling back to well 0 when the box is full.
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

  function renderLocationList() {
    if (!locationList) {
      return;
    }
    locationList.innerHTML = locationNames.map((locationName) => {
      const display = getSampleInventoryLocationDisplay(locationName);
      const containerCount = asArray(state?.inventory?.[locationName]).length;
      const sampleCount = asArray(state?.samples).filter((sample) => sample?.inventoryLink?.section === locationName).length;
      const selected = locationName === selectedLocation;
      return `
        <button type="button" class="biology-notebook-quick-sample-location${selected ? ' is-selected' : ''}" data-quick-sample-location="${safeText(locationName)}" role="option" aria-selected="${selected ? 'true' : 'false'}">
          <span class="biology-notebook-quick-sample-location-badge">${safeText(display.short)}</span>
          <span class="biology-notebook-quick-sample-location-copy">
            <strong>${safeText(display.title)}</strong>
            <small>${safeText(`${containerCount} container${containerCount === 1 ? '' : 's'}`)}</small>
          </span>
          <span class="biology-notebook-quick-sample-location-count" aria-label="${safeText(`${sampleCount} sample${sampleCount === 1 ? '' : 's'}`)}">${safeText(String(sampleCount))}</span>
        </button>
      `;
    }).join('');
  }

  function renderGridLabel() {
    if (!gridLabel || !selectedContainer) {
      return;
    }
    const containerName = selectedContainer.container.name || 'Container';
    const positionLabel = isMultiWellContainer(selectedContainer.container)
      ? (Number.isInteger(selectedWellIndex) ? getContainerWellName(selectedContainer.container, selectedWellIndex) : 'Select position')
      : 'Single position';
    gridLabel.textContent = `${containerName} · ${positionLabel}`;
  }

  function renderGrid() {
    if (!grid || !gridLabel) {
      return;
    }
    if (!selectedContainer) {
      gridLabel.textContent = selectedLocation ? 'Choose a container' : 'Grid box';
      grid.className = 'biology-notebook-quick-sample-grid is-empty';
      grid.removeAttribute?.('style');
      grid.innerHTML = '<p class="small-note">No containers in this location.</p>';
      return;
    }

    const container = selectedContainer.container;
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
      renderGridLabel();
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
      const label = getContainerWellName(container, index);
      const occupied = linkedSamplesAt(state, selectedContainer, index).length;
      const selected = index === selectedWellIndex;
      return `
        <button type="button" class="biology-notebook-quick-sample-well${selected ? ' is-selected' : ''}${occupied ? ' is-occupied' : ''}" data-quick-sample-well="${index}" aria-label="${safeText(`${label}${occupied ? `, ${occupied} sample${occupied === 1 ? '' : 's'}` : ', empty'}`)}" aria-pressed="${selected ? 'true' : 'false'}">
          ${safeText(label)}
          ${occupied ? `<span>${safeText(String(occupied))}</span>` : ''}
        </button>
      `;
    }).join('');
    renderGridLabel();
  }

  function selectContainer(key) {
    selectedContainer = findContainer(containers, key);
    selectedWellIndex = firstAvailableWell(selectedContainer);
    if (containerSelect) {
      containerSelect.value = selectedContainer?.key || '';
    }
    renderGrid();
  }

  function renderContainerOptions(previousKey = '') {
    const locationContainers = containers.filter((item) => item.section === selectedLocation);
    if (containerSelect) {
      containerSelect.innerHTML = locationContainers
        .map((item) => `<option value="${safeText(item.key)}">${safeText(item.container.name || 'Container')}</option>`)
        .join('');
    }
    const next = findContainer(locationContainers, previousKey) || locationContainers[0] || null;
    selectContainer(next?.key || '');
  }

  function selectLocation(locationName) {
    selectedLocation = locationNames.includes(locationName) ? locationName : '';
    const previousKey = selectedContainer?.section === selectedLocation ? selectedContainer.key : '';
    renderLocationList();
    renderContainerOptions(previousKey);
  }

  function renderLocationOptions() {
    containers = listContainers(state?.inventory);
    locationNames = getSampleInventoryLocationNames(state?.settings, state?.inventory);
    const nextLocation = (selectedLocation && locationNames.includes(selectedLocation) ? selectedLocation : '')
      || locationNames.find((locationName) => containers.some((item) => item.section === locationName))
      || locationNames[0]
      || '';
    selectLocation(nextLocation);
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
    renderLocationOptions();
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
    let code = makeDefaultSampleCode();
    let attempt = 1;
    while (asArray(state?.samples).some((sample) => sample?.code === code)) {
      code = `${makeDefaultSampleCode()}-${attempt}`;
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
    if (!selectedContainer) {
      setStatus('Choose a container for this sample.', true);
      return null;
    }
    const requestedCode = normalizeSampleCode(codeInput?.value);
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
      const wellIndex = isMultiWellContainer(selectedContainer.container) ? selectedWellIndex : null;
      const record = {
        id: String(createId?.() || `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`),
        code: requestedCode || uniqueGeneratedCode(),
        name,
        type: String(typeInput?.value || 'plasmid').trim() || 'plasmid',
        lot: String(lotInput?.value || '').trim(),
        concentration: String(concentrationInput?.value || '').trim(),
        notes: '',
        cellPassage: null,
        location: buildSampleLocation(selectedContainer.section, selectedContainer.container, wellIndex),
        inventoryLink: { section: selectedContainer.section, containerId: selectedContainer.container.id, wellIndex },
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
      // onCreated writes the page link and persists; if it fails, take the
      // sample back out so no unlinked sample is left behind.
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

  locationList?.addEventListener?.('click', (event) => {
    const location = event?.target?.closest?.('[data-quick-sample-location]');
    if (!location) {
      return;
    }
    selectLocation(String(location.dataset?.quickSampleLocation || ''));
  });
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
