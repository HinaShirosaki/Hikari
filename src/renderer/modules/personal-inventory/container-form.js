import { createDefaultWells, isSupportedContainerType, normalizeCustomGridDimensions } from './constants.js';

export function installContainerForm(ctx) {
  const { createId, helpers, persist, safeText, state, uiState } = ctx;
  const {
    addContainerBtn,
    addContainerOverlay,
    addContainerForm,
    addContainerTitle,
    addContainerNote,
    addItemNameLabel,
    addContainerLocationSelect,
    addContainerTypeField,
    addContainerTypeSelect,
    addContainerGridFields,
    addContainerRowsInput,
    addContainerColsInput,
    addContainerNameInput,
    addContainerSubmit
  } = ctx.elements;

  function ensureFolderMap() {
    if (!state.inventoryFolders || typeof state.inventoryFolders !== 'object' || Array.isArray(state.inventoryFolders)) {
      state.inventoryFolders = {};
    }
    return state.inventoryFolders;
  }

  function getAddItemTarget() {
    const target = uiState.addItemTarget;
    if (!target?.section) {
      return null;
    }
    const folder = target.folderId ? helpers.getFolder(target.section, target.folderId) : null;
    if (target.folderId && !folder) {
      uiState.addItemTarget = null;
      return null;
    }
    return { section: target.section, folderId: folder?.id || '', folder };
  }

  function setAddItemTarget(target = null) {
    if (!target?.section) {
      uiState.addItemTarget = null;
      return;
    }
    const folder = target.folderId ? helpers.getFolder(target.section, target.folderId) : null;
    if (target.folderId && !folder) {
      uiState.addItemTarget = null;
      return;
    }
    uiState.addItemTarget = {
      section: target.section,
      folderId: folder?.id || ''
    };
  }

  function renderAddContainerDialogMode() {
    const target = getAddItemTarget();
    const isFolderMode = uiState.addItemMode === 'folder';
    const title = isFolderMode
      ? (target?.folder ? 'New Folder Inside' : 'New Folder')
      : (target?.folder ? 'Add Container to Folder' : 'Add Container');
    const note = target?.folder
      ? (isFolderMode
        ? `Create a folder inside ${target.folder.name || 'this folder'}.`
        : `Place this container in ${target.folder.name || 'this folder'}.`)
      : '';
    if (addContainerTitle) {
      addContainerTitle.textContent = title;
    }
    if (addContainerNote) {
      addContainerNote.hidden = !note;
      addContainerNote.textContent = note;
    }
    if (addItemNameLabel) {
      addItemNameLabel.textContent = isFolderMode ? 'Folder Name' : 'Container Name';
    }
    if (addContainerNameInput) {
      addContainerNameInput.placeholder = isFolderMode ? 'e.g. Project Samples' : 'e.g. Box A';
    }
    if (addContainerTypeField) {
      addContainerTypeField.hidden = isFolderMode;
    }
    if (addContainerTypeSelect) {
      addContainerTypeSelect.disabled = isFolderMode;
    }
    if (addContainerSubmit) {
      addContainerSubmit.textContent = isFolderMode ? 'Create Folder' : 'Save Container';
    }
    if (addContainerLocationSelect) {
      addContainerLocationSelect.disabled = Boolean(target);
      if (target) {
        addContainerLocationSelect.value = target.section;
      }
    }
    ctx.renderAddContainerTypeFields();
  }

  function setAddContainerFormOpen(nextOpen) {
    uiState.isAddContainerFormOpen = Boolean(nextOpen);
    if (addContainerOverlay) {
      addContainerOverlay.hidden = !uiState.isAddContainerFormOpen;
    }
    [addContainerBtn].forEach((button) => {
      button?.setAttribute('aria-expanded', uiState.isAddContainerFormOpen ? 'true' : 'false');
    });
    if (uiState.isAddContainerFormOpen) {
      renderAddContainerDialogMode();
    }
  }

  function renderAddContainerTypeFields() {
    const showCustomGridFields = uiState.addItemMode !== 'folder'
      && addContainerTypeSelect?.value === 'customGrid';
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
    if (!options.keepTarget) {
      uiState.addItemTarget = null;
    }
    if (!options.keepMode) {
      uiState.addItemMode = 'container';
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

  function addItemFromForm() {
    const target = getAddItemTarget();
    const section = target?.section || addContainerLocationSelect?.value || '';
    const name = addContainerNameInput?.value.trim() || '';
    if (!section || !name) {
      return;
    }

    if (uiState.addItemMode === 'folder') {
      const folder = {
        id: createId(),
        name,
        ...(target?.folder ? { parentFolderId: target.folder.id } : {})
      };
      const folderMap = ensureFolderMap();
      folderMap[section] = Array.isArray(folderMap[section]) ? folderMap[section] : [];
      folderMap[section].push(folder);
      persist();
      uiState.selectedSectionName = section;
      ctx.revealFolderPath?.(section, folder.id);
      resetAddContainerForm();
      setAddContainerFormOpen(false);
      ctx.notifyInventoryChanged();
      ctx.renderSections();
      return;
    }

    const type = isSupportedContainerType(addContainerTypeSelect?.value)
      ? addContainerTypeSelect.value
      : 'box81';
    const customGrid = type === 'customGrid'
      ? normalizeCustomGridDimensions(addContainerRowsInput?.value, addContainerColsInput?.value)
      : null;
    const containerShape = type === 'customGrid'
      ? { type, gridRows: customGrid.rows, gridCols: customGrid.cols }
      : { type };
    const container = {
      id: createId(),
      name,
      ...(target?.folder ? { folderId: target.folder.id } : {}),
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
    ctx.revealContainerPath?.(section, container.id);
    resetAddContainerForm();
    setAddContainerFormOpen(false);
    ctx.notifyInventoryChanged();
    ctx.renderSections();
  }

  function beginAddItem(mode, target = null) {
    uiState.addItemMode = mode;
    setAddItemTarget(target);
    renderAddContainerLocationOptions();
    resetAddContainerForm({ keepTarget: true, keepMode: true });
    setAddContainerFormOpen(true);
    addContainerNameInput?.focus();
  }

  function beginAddContainer(target = null) {
    beginAddItem('container', target);
  }

  function beginAddFolder(target = null) {
    beginAddItem('folder', target);
  }

  Object.assign(ctx, {
    setAddContainerFormOpen,
    renderAddContainerTypeFields,
    resetAddContainerForm,
    renderAddContainerLocationOptions,
    addContainerFromForm: addItemFromForm,
    beginAddContainer,
    beginAddFolder
  });
}
