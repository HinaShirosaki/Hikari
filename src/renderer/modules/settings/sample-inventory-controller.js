import {
  getEditableSampleTypeEntries,
  getSampleInventoryLocationNames,
  normalizeSampleInventoryLocations,
  normalizeSampleTypeLabels
} from '../../lib/inventory-settings.js';

export function createSampleInventorySettingsController({
  state,
  persist,
  elements,
  escapeHtml,
  renderSettings,
  onSettingsChanged
}) {
  const {
    locationInput,
    locationList,
    sampleInventoryLocationInput,
    sampleInventoryLocationList,
    sampleTypeLabelList
  } = elements;

  function notifyChanged() {
    onSettingsChanged?.();
  }

  function getLocations() {
    state.settings.sampleInventoryLocations = getSampleInventoryLocationNames(state.settings, state.inventory);
    return state.settings.sampleInventoryLocations;
  }

  function containerCount(locationName) {
    const section = String(locationName || '').trim();
    return Array.isArray(state.inventory?.[section]) ? state.inventory[section].length : 0;
  }

  function migrateLocation(oldLocation, nextLocation) {
    const source = String(oldLocation || '').trim();
    const target = String(nextLocation || '').trim();
    if (!source || !target || source === target) {
      return;
    }
    state.inventory = state.inventory && typeof state.inventory === 'object' ? state.inventory : {};
    const sourceContainers = Array.isArray(state.inventory[source]) ? state.inventory[source] : [];
    if (sourceContainers.length) {
      const targetContainers = Array.isArray(state.inventory[target]) ? state.inventory[target] : [];
      state.inventory[target] = targetContainers.concat(sourceContainers);
      delete state.inventory[source];
    }
    (state.samples || []).forEach((sample) => {
      if (sample?.inventoryLink?.section === source) {
        sample.inventoryLink = { ...sample.inventoryLink, section: target };
      }
    });
  }

  function renderLocationList() {
    const locations = state.settings.inventoryLocations || [];
    if (!locations.length) {
      locationList.innerHTML = '<p class="small-note">No locations configured.</p>';
      return;
    }
    locationList.innerHTML = locations.map((location, index) => `
      <div class="card-actions">
        <span>${escapeHtml(location)}</span>
        <button type="button" class="danger-btn" data-location-delete="${index}">Delete</button>
      </div>
    `).join('');
    locationList.querySelectorAll('[data-location-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        state.settings.inventoryLocations.splice(Number(button.dataset.locationDelete), 1);
        persist();
        renderSettings();
      });
    });
  }

  function saveLocation(index, rawValue) {
    const locations = getLocations();
    const nextValue = String(rawValue || '').trim().replace(/\s+/g, ' ');
    if (!nextValue || !Number.isInteger(index) || index < 0 || index >= locations.length) {
      return;
    }
    const duplicate = locations.some((location, locationIndex) => (
      locationIndex !== index && String(location || '').trim().toLowerCase() === nextValue.toLowerCase()
    ));
    if (duplicate) {
      renderSampleInventoryLocationList();
      return;
    }
    const oldValue = locations[index];
    locations[index] = nextValue;
    state.settings.sampleInventoryLocations = normalizeSampleInventoryLocations(locations);
    migrateLocation(oldValue, nextValue);
    persist();
    renderSettings();
    notifyChanged();
  }

  function deleteLocation(index) {
    const locations = getLocations();
    if (!Number.isInteger(index) || index < 0 || index >= locations.length) {
      return;
    }
    if (containerCount(locations[index]) > 0 || locations.length <= 1) {
      renderSampleInventoryLocationList();
      return;
    }
    locations.splice(index, 1);
    state.settings.sampleInventoryLocations = normalizeSampleInventoryLocations(locations);
    persist();
    renderSettings();
    notifyChanged();
  }

  function renderSampleInventoryLocationList() {
    if (!sampleInventoryLocationList) {
      return;
    }
    const locations = getLocations();
    if (!locations.length) {
      sampleInventoryLocationList.innerHTML = '<p class="small-note">No sample inventory locations configured.</p>';
      return;
    }
    sampleInventoryLocationList.innerHTML = locations.map((location, index) => {
      const count = containerCount(location);
      return `
        <div class="settings-edit-row">
          <input value="${escapeHtml(location)}" data-sample-inventory-location-input="${index}" aria-label="Sample inventory location ${index + 1}" />
          <span class="small-note">${escapeHtml(`${count} container${count === 1 ? '' : 's'}`)}</span>
          <button type="button" class="ghost-btn" data-sample-inventory-location-save="${index}">Save</button>
          <button type="button" class="danger-btn" data-sample-inventory-location-delete="${index}"${count > 0 ? ' disabled title="Move or rename containers before deleting this location."' : ''}>Delete</button>
        </div>
      `;
    }).join('');
    sampleInventoryLocationList.querySelectorAll('[data-sample-inventory-location-save]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.sampleInventoryLocationSave);
        const input = sampleInventoryLocationList.querySelector(`[data-sample-inventory-location-input="${index}"]`);
        saveLocation(index, input?.value);
      });
    });
    sampleInventoryLocationList.querySelectorAll('[data-sample-inventory-location-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteLocation(Number(button.dataset.sampleInventoryLocationDelete)));
    });
  }

  function renderSampleTypeLabelList() {
    if (!sampleTypeLabelList) {
      return;
    }
    sampleTypeLabelList.innerHTML = getEditableSampleTypeEntries(state.settings).map((entry) => `
      <label class="settings-sample-type-label-row">
        <span>${escapeHtml(entry.defaultLabel)}</span>
        <input data-sample-type-label="${escapeHtml(entry.type)}" value="${escapeHtml(entry.label)}" placeholder="${escapeHtml(entry.defaultLabel)}" />
      </label>
    `).join('');
  }

  function onSaveSampleTypeLabels(event) {
    event.preventDefault();
    const nextLabels = normalizeSampleTypeLabels(state.settings.sampleTypeLabels);
    sampleTypeLabelList?.querySelectorAll('[data-sample-type-label]').forEach((input) => {
      const type = String(input.dataset.sampleTypeLabel || '').trim();
      if (type) {
        nextLabels[type] = String(input.value || '').trim().replace(/\s+/g, ' ');
      }
    });
    state.settings.sampleTypeLabels = normalizeSampleTypeLabels(nextLabels);
    persist();
    renderSettings();
    notifyChanged();
  }

  function onAddLocation() {
    const value = locationInput.value.trim();
    if (!value) {
      return;
    }
    state.settings.inventoryLocations = Array.isArray(state.settings.inventoryLocations)
      ? state.settings.inventoryLocations
      : [];
    const normalized = value.toLowerCase();
    if (!state.settings.inventoryLocations.some((item) => String(item).trim().toLowerCase() === normalized)) {
      state.settings.inventoryLocations.push(value);
      persist();
      renderSettings();
    }
    locationInput.value = '';
  }

  function onAddSampleInventoryLocation() {
    const value = String(sampleInventoryLocationInput?.value || '').trim().replace(/\s+/g, ' ');
    if (!value) {
      return;
    }
    const locations = getLocations();
    if (!locations.some((location) => String(location || '').trim().toLowerCase() === value.toLowerCase())) {
      locations.push(value);
      state.settings.sampleInventoryLocations = normalizeSampleInventoryLocations(locations);
      persist();
      renderSettings();
      notifyChanged();
    }
    if (sampleInventoryLocationInput) {
      sampleInventoryLocationInput.value = '';
    }
  }

  return {
    onAddLocation,
    onAddSampleInventoryLocation,
    onSaveSampleTypeLabels,
    renderLocationList,
    renderSampleInventoryLocationList,
    renderSampleTypeLabelList
  };
}
