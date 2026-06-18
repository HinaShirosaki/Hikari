import { createDefaultWells, normalizeCustomGridDimensions } from './constants.js';

export function installContainerForm(ctx) {
  const { createId, helpers, persist, safeText, state, uiState } = ctx;
  const {
    addContainerForm,
    addContainerLocationSelect,
    addContainerTypeSelect,
    addContainerGridFields,
    addContainerRowsInput,
    addContainerColsInput,
    addContainerNameInput
  } = ctx.elements;

function setAddContainerFormOpen(nextOpen) {
  uiState.isAddContainerFormOpen = Boolean(nextOpen);
  if (addContainerForm) {
    addContainerForm.hidden = !uiState.isAddContainerFormOpen;
  }
  if (uiState.isAddContainerFormOpen) {
    ctx.renderAddContainerTypeFields();
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

function resetAddContainerForm() {
  addContainerForm?.reset();
  if (addContainerLocationSelect) {
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
}

function addContainerFromForm() {
  const section = addContainerLocationSelect?.value || '';
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

  Object.assign(ctx, {
    setAddContainerFormOpen,
    renderAddContainerTypeFields,
    resetAddContainerForm,
    renderAddContainerLocationOptions,
    addContainerFromForm
  });
}
