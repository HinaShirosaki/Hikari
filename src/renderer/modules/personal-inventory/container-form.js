import { createDefaultWells, normalizeCustomGridDimensions } from './constants.js';

export function installContainerForm(ctx) {
  const { createId, helpers, persist, safeText, state, uiState } = ctx;
  const {
    addContainerBtn,
    addContainerOverlay,
    addContainerForm,
    addContainerTitle,
    addContainerNote,
    addContainerLocationSelect,
    addContainerTypeSelect,
    addContainerGridFields,
    addContainerRowsInput,
    addContainerColsInput,
    addContainerNameInput
  } = ctx.elements;

function getAddContainerParent() {
  const parent = uiState.addContainerParent;
  if (!parent?.section || !parent?.containerId) {
    return null;
  }
  const container = helpers.getContainer(parent.section, parent.containerId);
  if (!container) {
    uiState.addContainerParent = null;
    return null;
  }
  return { ...parent, container };
}

function setAddContainerParent(parentTarget = null) {
  if (
    parentTarget?.section
    && parentTarget?.containerId
    && helpers.getContainer(parentTarget.section, parentTarget.containerId)
  ) {
    uiState.addContainerParent = {
      section: parentTarget.section,
      containerId: parentTarget.containerId
    };
    return;
  }
  uiState.addContainerParent = null;
}

function renderAddContainerDialogMode() {
  const parent = getAddContainerParent();
  if (addContainerTitle) {
    addContainerTitle.textContent = parent ? 'Add Subcontainer' : 'Add Container';
  }
  if (addContainerNote) {
    addContainerNote.textContent = parent
      ? `Create a container inside ${parent.container.name || 'this container'}.`
      : 'Create a storage box, plate, tube, or custom grid.';
  }
  if (addContainerLocationSelect) {
    addContainerLocationSelect.disabled = Boolean(parent);
    if (parent) {
      addContainerLocationSelect.value = parent.section;
    }
  }
}

function setAddContainerFormOpen(nextOpen) {
  uiState.isAddContainerFormOpen = Boolean(nextOpen);
  if (addContainerOverlay) {
    addContainerOverlay.hidden = !uiState.isAddContainerFormOpen;
  }
  if (addContainerBtn) {
    addContainerBtn.setAttribute('aria-expanded', uiState.isAddContainerFormOpen ? 'true' : 'false');
  }
  if (uiState.isAddContainerFormOpen) {
    ctx.renderAddContainerTypeFields();
    renderAddContainerDialogMode();
  }
}

function renderAddContainerTypeFields() {
  const showCustomGridFields = addContainerTypeSelect?.value === 'customGrid';
  if (addContainerGridFields) {
    addContainerGridFields.hidden = !showCustomGridFields;
  }
  [addContainerRowsInput, addContainerColsInput].forEach((input) => {
    if (!input) {
      return;
    }
    input.disabled = !showCustomGridFields;
    input.required = showCustomGridFields;
    if (showCustomGridFields && !String(input.value || '').trim()) {
      input.value = '9';
    }
  });
}

function resetAddContainerForm(options = {}) {
  if (!options.keepParent) {
    uiState.addContainerParent = null;
  }
  addContainerForm?.reset();
  if (addContainerLocationSelect) {
    addContainerLocationSelect.disabled = false;
    addContainerLocationSelect.value = '';
  }
  if (addContainerTypeSelect) {
    addContainerTypeSelect.value = 'box81';
  }
  if (addContainerRowsInput) {
    addContainerRowsInput.value = '9';
  }
  if (addContainerColsInput) {
    addContainerColsInput.value = '9';
  }
  ctx.renderAddContainerTypeFields();
  renderAddContainerDialogMode();
}

function renderAddContainerLocationOptions() {
  if (!addContainerLocationSelect) {
    return;
  }
  const selectedLocation = addContainerLocationSelect.value;
  const options = ['<option value="">Select location</option>'];
  helpers.getSectionNames().forEach((section) => {
    const isSelected = selectedLocation === section ? ' selected' : '';
    options.push(`<option value="${safeText(section)}"${isSelected}>${safeText(section)}</option>`);
  });
  addContainerLocationSelect.innerHTML = options.join('');
  renderAddContainerDialogMode();
}

function addContainerFromForm() {
  const parent = getAddContainerParent();
  const section = parent?.section || addContainerLocationSelect?.value || '';
  const name = addContainerNameInput?.value.trim() || '';
  if (!section || !name) {
    return;
  }
  const type = ['single', 'plate96', 'customGrid'].includes(addContainerTypeSelect?.value) ? addContainerTypeSelect.value : 'box81';
  const customGrid = type === 'customGrid'
    ? normalizeCustomGridDimensions(addContainerRowsInput?.value, addContainerColsInput?.value)
    : null;
  const containerShape = type === 'customGrid'
    ? { type, gridRows: customGrid.rows, gridCols: customGrid.cols }
    : { type };
  const container = {
    id: createId(),
    name,
    ...(parent ? { parentContainerId: parent.containerId } : {}),
    ...containerShape,
    wells: createDefaultWells(containerShape),
    singleContent: type === 'single' ? '' : undefined
  };
  state.inventory[section] = state.inventory[section] || [];
  state.inventory[section].push(container);
  persist();
  uiState.selectedSectionName = section;
  uiState.selectedContainer = { section, containerId: container.id };
  uiState.editingWellIndex = -1;
  uiState.editingSampleId = '';
  uiState.wellEditorStatus = '';
  uiState.shouldAutoOpenContainer = true;
  ctx.resetAddContainerForm();
  ctx.setAddContainerFormOpen(false);
  ctx.notifyInventoryChanged();
  ctx.renderSections();
}

function beginAddContainer() {
  ctx.renderAddContainerLocationOptions();
  ctx.resetAddContainerForm();
  ctx.setAddContainerFormOpen(true);
}

function beginAddSubcontainer(section, containerId) {
  setAddContainerParent({ section, containerId });
  ctx.renderAddContainerLocationOptions();
  ctx.resetAddContainerForm({ keepParent: true });
  ctx.setAddContainerFormOpen(true);
  addContainerNameInput?.focus();
}

  Object.assign(ctx, {
    setAddContainerFormOpen,
    renderAddContainerTypeFields,
    resetAddContainerForm,
    renderAddContainerLocationOptions,
    addContainerFromForm,
    beginAddContainer,
    beginAddSubcontainer
  });
}
