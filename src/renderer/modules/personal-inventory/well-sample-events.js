// CSV columns: well,code,name,type,lot,concentration,notes (header required, "well" matches the well label e.g. A1 or W3)
function importContainerCsv(ctx, section, container, csvText) {
  const { helpers, persist, state } = ctx;
  helpers.ensureSamples();
  const lines = csvText.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return;
  }
  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
  const wellIndex = header.indexOf('well');
  if (wellIndex < 0) {
    ctx.uiState.wellEditorStatus = 'Import CSV needs a "well" column.';
    return;
  }
  lines.slice(1).forEach((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const wellLabel = cells[wellIndex];
    const targetIndex = (container.wells || []).findIndex((_well, index) => (
      helpers.getWellLabel(container, index).toLowerCase() === wellLabel.toLowerCase()
    ));
    const name = header.indexOf('name') >= 0 ? cells[header.indexOf('name')] : '';
    if (targetIndex < 0 || !name) {
      return;
    }
    const code = header.indexOf('code') >= 0 ? helpers.normalizeSampleCode(cells[header.indexOf('code')]) : '';
    const sample = {
      id: `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      code: code || helpers.makeDefaultSampleCode(),
      name,
      type: helpers.normalizeSampleType(header.indexOf('type') >= 0 ? cells[header.indexOf('type')] : 'plasmid'),
      lot: header.indexOf('lot') >= 0 ? cells[header.indexOf('lot')] : '',
      concentration: header.indexOf('concentration') >= 0 ? cells[header.indexOf('concentration')] : '',
      notes: header.indexOf('notes') >= 0 ? cells[header.indexOf('notes')] : '',
      location: helpers.buildAutoLocationFromLink(section, container, targetIndex),
      inventoryLink: { section, containerId: container.id, wellIndex: targetIndex },
      chemicalLinks: [],
      compoundStructure: null,
      updatedAt: new Date().toISOString()
    };
    state.samples.push(sample);
  });
  ctx.uiState.wellEditorStatus = 'Imported samples from CSV.';
  persist();
  ctx.notifySamplesChanged();
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

  inventorySections.querySelectorAll('[data-well-sample-clone]').forEach((button) => {
    button.addEventListener('click', () => {
      helpers.ensureSamples();
      const section = uiState.selectedContainer?.section;
      const containerId = uiState.selectedContainer?.containerId;
      const container = section && containerId ? helpers.getContainer(section, containerId) : null;
      const sample = helpers.getSampleById(button.dataset.wellSampleClone);
      if (!container || !sample) {
        return;
      }
      const targetLabel = window.prompt(`Clone "${sample.code || sample.name}" to which well? (e.g. ${helpers.getWellLabel(container, 0)})`, '');
      if (!targetLabel) {
        return;
      }
      const targetIndex = (container.wells || []).findIndex((_well, wellIndex) => (
        helpers.getWellLabel(container, wellIndex).toLowerCase() === targetLabel.trim().toLowerCase()
      ));
      if (targetIndex < 0) {
        uiState.wellEditorStatus = `No well named "${targetLabel}" in this container.`;
        renderSections();
        return;
      }
      const clone = {
        ...sample,
        id: `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        inventoryLink: { section, containerId, wellIndex: targetIndex },
        location: helpers.buildAutoLocationFromLink(section, container, targetIndex),
        updatedAt: new Date().toISOString()
      };
      state.samples.push(clone);
      uiState.editingWellIndex = targetIndex;
      uiState.editingSampleId = clone.id;
      uiState.wellEditorStatus = `Cloned sample into ${helpers.getWellLabel(container, targetIndex)}.`;
      persist();
      notifySamplesChanged();
      renderSections();
    });
  });

  inventorySections.querySelectorAll('[data-container-import-csv]').forEach((button) => {
    button.addEventListener('click', () => {
      inventorySections.querySelector(`[data-container-import-input="${button.dataset.containerImportCsv}"]`)?.click();
    });
  });

  inventorySections.querySelectorAll('[data-container-import-input]').forEach((input) => {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) {
        return;
      }
      const section = uiState.selectedContainer?.section;
      const containerId = input.dataset.containerImportInput;
      const container = section && containerId ? helpers.getContainer(section, containerId) : null;
      if (!container) {
        return;
      }
      file.text().then((text) => importContainerCsv(ctx, section, container, text)).then(() => {
        renderSections();
      });
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
