const SAVED_SAMPLE_DRAG_MIME = 'application/x-hikari-saved-sample-id';

function getDraggedSavedSampleId(event, uiState) {
  const dataTransfer = event?.dataTransfer;
  const explicitId = dataTransfer
    ? dataTransfer.getData(SAVED_SAMPLE_DRAG_MIME) || dataTransfer.getData('text/plain')
    : '';
  return String(explicitId || uiState?.draggingSavedSampleId || '').trim();
}

function clearWellDropTargets(inventorySections) {
  inventorySections.querySelectorAll('[data-well-index]').forEach((button) => {
    button.classList.remove('well-drag-over');
  });
}

export function fillWellWithSavedSample(ctx, sampleId, section, containerId, wellIndex) {
  const { helpers, persist, uiState } = ctx;
  helpers.ensureSamples();
  const index = Number(wellIndex);
  const cleanSampleId = String(sampleId || '').trim();
  if (!cleanSampleId || !section || !containerId || !Number.isInteger(index) || index < 0) {
    return false;
  }

  const sample = helpers.getSampleById(cleanSampleId);
  const container = helpers.getContainer(section, containerId);
  const wells = Array.isArray(container?.wells) ? container.wells : [];
  if (!sample || !container || index >= wells.length) {
    return false;
  }

  sample.inventoryLink = { section, containerId: container.id, wellIndex: index };
  sample.location = helpers.buildAutoLocationFromLink(section, container, index);
  sample.updatedAt = new Date().toISOString();
  uiState.selectedContainer = { section, containerId: container.id };
  uiState.selectedSectionName = section;
  uiState.editingWellIndex = index;
  uiState.editingSampleId = sample.id;
  const wellLabel = typeof helpers.getWellLabel === 'function'
    ? helpers.getWellLabel(container, index)
    : `Cell ${index + 1}`;
  uiState.wellEditorStatus = `Filled ${wellLabel} with ${sample.code || sample.name || sample.id}.`;
  persist();
  ctx.notifySamplesChanged();
  ctx.renderSections();
  return true;
}

export function bindWellSampleEvents(ctx) {
  const { helpers, persist, state, uiState } = ctx;
  const { inventorySections } = ctx.elements;
  const pendingStructureDrafts = ctx.pendingStructureDrafts;
  const renderSections = () => ctx.renderSections();
  const notifySamplesChanged = () => ctx.notifySamplesChanged();
  const isChemicalSampleType = (...args) => ctx.isChemicalSampleType(...args);
  const normalizeStructureData = (...args) => ctx.normalizeStructureData(...args);
  const getPendingStructureKey = (...args) => ctx.getPendingStructureKey(...args);

  inventorySections.querySelectorAll('[data-well-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.section;
      const containerId = button.dataset.containerId;
      if (!uiState.selectedContainer || uiState.selectedContainer.section !== section || uiState.selectedContainer.containerId !== containerId) {
        return;
      }
      uiState.editingWellIndex = Number(button.dataset.wellIndex);
      const linkedSamples = helpers.getLinkedSamples(section, containerId, uiState.editingWellIndex);
      uiState.editingSampleId = linkedSamples[0]?.id || '';
      uiState.wellEditorStatus = '';
      renderSections();
    });

    button.addEventListener('dragover', (event) => {
      if (!getDraggedSavedSampleId(event, uiState)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      button.classList.add('well-drag-over');
    });

    button.addEventListener('dragleave', () => {
      button.classList.remove('well-drag-over');
    });

    button.addEventListener('drop', (event) => {
      const sampleId = getDraggedSavedSampleId(event, uiState);
      if (!sampleId) {
        return;
      }
      event.preventDefault();
      button.classList.remove('well-drag-over');
      fillWellWithSavedSample(
        ctx,
        sampleId,
        button.dataset.section,
        button.dataset.containerId,
        button.dataset.wellIndex
      );
    });
  });

  inventorySections.querySelectorAll('[data-saved-sample-drag]').forEach((button) => {
    button.addEventListener('dragstart', (event) => {
      const sampleId = String(button.dataset.savedSampleDrag || '').trim();
      if (!sampleId) {
        return;
      }
      uiState.draggingSavedSampleId = sampleId;
      button.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(SAVED_SAMPLE_DRAG_MIME, sampleId);
        event.dataTransfer.setData('text/plain', sampleId);
      }
    });

    button.addEventListener('dragend', () => {
      uiState.draggingSavedSampleId = '';
      button.classList.remove('is-dragging');
      clearWellDropTargets(inventorySections);
    });
  });

  inventorySections.querySelectorAll('[data-well-sample-select]').forEach((select) => {
    select.addEventListener('change', () => {
      uiState.editingSampleId = String(select.value || '');
      uiState.wellEditorStatus = '';
      renderSections();
    });
  });

  inventorySections.querySelectorAll('[data-well-sample-save]').forEach((button) => {
    button.addEventListener('click', () => {
      helpers.ensureSamples();
      const section = uiState.selectedContainer?.section;
      const containerId = uiState.selectedContainer?.containerId;
      const index = uiState.editingWellIndex;
      if (!section || !containerId || !Number.isInteger(index) || index < 0) {
        return;
      }
      const container = helpers.getContainer(section, containerId);
      const sample = helpers.getSampleById(button.dataset.wellSampleSave);
      if (!container || !sample) {
        return;
      }
      const codeInput = inventorySections.querySelector('[data-well-sample-code]');
      const nameInput = inventorySections.querySelector('[data-well-sample-name]');
      const typeInput = inventorySections.querySelector('[data-well-sample-type]');
      const lotInput = inventorySections.querySelector('[data-well-sample-lot]');
      const concentrationInput = inventorySections.querySelector('[data-well-sample-concentration]');
      const notesInput = inventorySections.querySelector('[data-well-sample-notes]');
      const name = String(nameInput?.value || '').trim();
      if (!name) {
        uiState.wellEditorStatus = 'Sample name is required.';
        renderSections();
        return;
      }
      const code = helpers.normalizeSampleCode(codeInput?.value) || sample.code || helpers.makeDefaultSampleCode();
      const duplicate = (state.samples || []).find((item) => item.code === code && item.id !== sample.id);
      if (duplicate) {
        uiState.wellEditorStatus = `Sample code ${code} already exists.`;
        renderSections();
        return;
      }
      sample.code = code;
      sample.name = name;
      sample.type = helpers.normalizeSampleType(typeInput?.value || sample.type || 'plasmid');
      if (!isChemicalSampleType(sample.type)) {
        sample.compoundStructure = null;
      }
      sample.lot = String(lotInput?.value || '').trim();
      sample.concentration = String(concentrationInput?.value || '').trim();
      sample.notes = String(notesInput?.value || '').trim();
      sample.inventoryLink = { section, containerId, wellIndex: index };
      sample.location = helpers.isLocationEmpty(sample.location) ? helpers.buildAutoLocationFromLink(section, container, index) : sample.location;
      sample.updatedAt = new Date().toISOString();
      uiState.editingSampleId = sample.id;
      uiState.wellEditorStatus = `Saved sample ${sample.code || sample.name}.`;
      persist();
      notifySamplesChanged();
      renderSections();
    });
  });

  inventorySections.querySelectorAll('[data-well-sample-unlink]').forEach((button) => {
    button.addEventListener('click', () => {
      helpers.ensureSamples();
      const sample = helpers.getSampleById(button.dataset.wellSampleUnlink);
      if (!sample) {
        return;
      }
      sample.inventoryLink = null;
      sample.updatedAt = new Date().toISOString();
      uiState.editingSampleId = '';
      uiState.wellEditorStatus = `Unlinked sample ${sample.code || sample.name || sample.id}.`;
      persist();
      notifySamplesChanged();
      renderSections();
    });
  });

  inventorySections.querySelectorAll('[data-well-sample-create]').forEach((button) => {
    button.addEventListener('click', () => {
      helpers.ensureSamples();
      const section = uiState.selectedContainer?.section;
      const containerId = uiState.selectedContainer?.containerId;
      const index = Number(button.dataset.wellSampleCreate);
      if (!section || !containerId || !Number.isInteger(index) || index < 0) {
        return;
      }
      const container = helpers.getContainer(section, containerId);
      if (!container) {
        return;
      }
      const codeInput = inventorySections.querySelector('[data-well-sample-new-code]');
      const nameInput = inventorySections.querySelector('[data-well-sample-new-name]');
      const typeInput = inventorySections.querySelector('[data-well-sample-new-type]');
      const lotInput = inventorySections.querySelector('[data-well-sample-new-lot]');
      const concentrationInput = inventorySections.querySelector('[data-well-sample-new-concentration]');
      const notesInput = inventorySections.querySelector('[data-well-sample-new-notes]');
      const name = String(nameInput?.value || '').trim();
      if (!name) {
        uiState.wellEditorStatus = 'Sample name is required.';
        renderSections();
        return;
      }
      const code = helpers.normalizeSampleCode(codeInput?.value) || helpers.makeDefaultSampleCode();
      const duplicate = (state.samples || []).find((item) => item.code === code);
      if (duplicate) {
        uiState.wellEditorStatus = `Sample code ${code} already exists.`;
        renderSections();
        return;
      }
      const sample = {
        id: `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        code,
        name,
        type: helpers.normalizeSampleType(typeInput?.value || 'plasmid'),
        lot: String(lotInput?.value || '').trim(),
        concentration: String(concentrationInput?.value || '').trim(),
        notes: String(notesInput?.value || '').trim(),
        location: helpers.buildAutoLocationFromLink(section, container, index),
        inventoryLink: { section, containerId, wellIndex: index },
        chemicalLinks: [],
        compoundStructure: isChemicalSampleType(typeInput?.value)
          ? normalizeStructureData(pendingStructureDrafts.get(getPendingStructureKey('well-new')))
          : null,
        updatedAt: new Date().toISOString()
      };
      pendingStructureDrafts.delete(getPendingStructureKey('well-new'));
      state.samples.push(sample);
      uiState.editingSampleId = sample.id;
      uiState.wellEditorStatus = `Created sample ${sample.code}.`;
      persist();
      notifySamplesChanged();
      renderSections();
    });
  });
}
