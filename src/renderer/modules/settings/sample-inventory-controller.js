import {
  createCustomSampleTypeId,
  getEditableSampleTypeEntries,
  getSampleInventoryLocationNames,
  normalizeSampleInventoryLocations,
  normalizeSampleType,
  normalizeSampleTypeHidden,
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
    sampleTypeAddInput,
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
    state.inventoryFolders = state.inventoryFolders && typeof state.inventoryFolders === 'object'
      ? state.inventoryFolders
      : {};
    const sourceContainers = Array.isArray(state.inventory[source]) ? state.inventory[source] : [];
    if (sourceContainers.length) {
      const targetContainers = Array.isArray(state.inventory[target]) ? state.inventory[target] : [];
      state.inventory[target] = targetContainers.concat(sourceContainers);
      delete state.inventory[source];
    }
    const sourceFolders = Array.isArray(state.inventoryFolders[source]) ? state.inventoryFolders[source] : [];
    if (sourceFolders.length) {
      const targetFolders = Array.isArray(state.inventoryFolders[target]) ? state.inventoryFolders[target] : [];
      state.inventoryFolders[target] = targetFolders.concat(sourceFolders);
      delete state.inventoryFolders[source];
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
        <div class="settings-edit-row settings-sample-inventory-location-row">
          <input value="${escapeHtml(location)}" data-sample-inventory-location-input="${index}" aria-label="Sample inventory location ${index + 1}" />
          <span class="small-note">${escapeHtml(`${count} container${count === 1 ? '' : 's'}`)}</span>
          <button type="button" class="ghost-btn settings-inline-icon" data-sample-inventory-location-save="${index}" aria-label="Save ${escapeHtml(location)}" title="Save location">✓</button>
          <button type="button" class="danger-btn settings-inline-icon settings-inline-icon-danger" data-sample-inventory-location-delete="${index}" aria-label="Delete ${escapeHtml(location)}" title="${count > 0 ? 'Move or rename containers before deleting this location.' : 'Delete location'}"${count > 0 ? ' disabled' : ''}>&times;</button>
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
    const entries = getEditableSampleTypeEntries(state.settings);
    sampleTypeLabelList.innerHTML = entries.map((entry) => {
      const sampleCount = (state.samples || []).filter((sample) => normalizeSampleType(sample?.type) === entry.type).length;
      const cannotDelete = sampleCount > 0 || entries.length <= 1;
      const deleteTitle = sampleCount > 0
        ? 'Reassign samples before removing this type.'
        : (entries.length <= 1 ? 'Keep at least one sample type.' : 'Remove sample type');
      return `
      <li class="settings-sample-type-label-row">
        <span class="settings-sample-type-label-bullet" aria-hidden="true"></span>
        <input class="settings-sample-type-label-input" data-sample-type-label="${escapeHtml(entry.type)}" value="${escapeHtml(entry.label)}" placeholder="${escapeHtml(entry.defaultLabel)}" aria-label="Sample type name: ${escapeHtml(entry.defaultLabel)}" />
        <button type="button" class="ghost-btn settings-sample-type-remove" data-sample-type-delete="${escapeHtml(entry.type)}" aria-label="Remove ${escapeHtml(entry.label)}" title="${deleteTitle}"${cannotDelete ? ' disabled' : ''}>&times;</button>
      </li>
    `;
    }).join('');
    sampleTypeLabelList.querySelectorAll('[data-sample-type-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteSampleType(button.dataset.sampleTypeDelete));
    });
  }

  function onSaveSampleTypeLabels(event) {
    event.preventDefault();
    const nextLabels = normalizeSampleTypeLabels(state.settings.sampleTypeLabels);
    sampleTypeLabelList?.querySelectorAll('[data-sample-type-label]').forEach((input) => {
      const type = String(input.dataset.sampleTypeLabel || '').trim();
      if (type) {
        nextLabels[type] = String(input.value || '').trim().replace(/\s+/g, ' ') || nextLabels[type];
      }
    });
    state.settings.sampleTypeLabels = normalizeSampleTypeLabels(nextLabels);
    persist();
    renderSettings();
    notifyChanged();
  }

  function deleteSampleType(rawType) {
    const type = String(rawType || '').trim().toLowerCase();
    const entries = getEditableSampleTypeEntries(state.settings);
    const sampleCount = (state.samples || []).filter((sample) => normalizeSampleType(sample?.type) === type).length;
    if (!entries.some((entry) => entry.type === type) || sampleCount > 0 || entries.length <= 1) {
      renderSampleTypeLabelList();
      return;
    }
    if (type.startsWith('custom_')) {
      const labels = { ...normalizeSampleTypeLabels(state.settings.sampleTypeLabels) };
      delete labels[type];
      state.settings.sampleTypeLabels = normalizeSampleTypeLabels(labels);
    } else {
      state.settings.sampleTypeHidden = normalizeSampleTypeHidden([
        ...(state.settings.sampleTypeHidden || []),
        type
      ]);
    }
    persist();
    renderSettings();
    notifyChanged();
  }

  function onAddSampleType() {
    const label = String(sampleTypeAddInput?.value || '').trim().replace(/\s+/g, ' ');
    if (!label) {
      return;
    }
    const labels = normalizeSampleTypeLabels(state.settings.sampleTypeLabels);
    const matchingType = Object.keys(labels).find((type) => labels[type].toLowerCase() === label.toLowerCase());
    if (matchingType) {
      const hiddenTypes = normalizeSampleTypeHidden(state.settings.sampleTypeHidden);
      if (!hiddenTypes.includes(matchingType)) {
        sampleTypeAddInput?.setCustomValidity('A sample type with this name already exists.');
        sampleTypeAddInput?.reportValidity();
        return;
      }
      state.settings.sampleTypeHidden = hiddenTypes.filter((type) => type !== matchingType);
    } else {
      const type = createCustomSampleTypeId(label, Object.keys(labels));
      state.settings.sampleTypeLabels = normalizeSampleTypeLabels({ ...labels, [type]: label });
    }
    if (sampleTypeAddInput) {
      sampleTypeAddInput.value = '';
      sampleTypeAddInput.setCustomValidity('');
    }
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
    onAddSampleType,
    onSaveSampleTypeLabels,
    renderLocationList,
    renderSampleInventoryLocationList,
    renderSampleTypeLabelList
  };
}
