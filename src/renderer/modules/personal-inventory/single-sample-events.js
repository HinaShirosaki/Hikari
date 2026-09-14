import { readTypeFieldsFrom } from '../sample-registry/type-fields.js';

export function bindSingleSampleEvents(ctx) {
  const { helpers, persist, state, uiState } = ctx;
  const { inventorySections } = ctx.elements;
  const pendingStructureDrafts = ctx.pendingStructureDrafts;
  const renderSections = () => ctx.renderSections();
  const notifySamplesChanged = () => ctx.notifySamplesChanged();
  const isChemicalSampleType = (...args) => ctx.isChemicalSampleType(...args);
  const normalizeStructureData = (...args) => ctx.normalizeStructureData(...args);
  const getPendingStructureKey = (...args) => ctx.getPendingStructureKey(...args);

  inventorySections.querySelectorAll('[data-single-sample-select]').forEach((select) => {
    select.addEventListener('change', () => {
      uiState.editingSampleId = String(select.value || '');
      uiState.wellEditorStatus = '';
      renderSections();
    });
  });

  inventorySections.querySelectorAll('[data-single-sample-save]').forEach((button) => {
    button.addEventListener('click', () => {
      helpers.ensureSamples();
      const section = uiState.selectedContainer?.section;
      const containerId = uiState.selectedContainer?.containerId;
      if (!section || !containerId) {
        return;
      }
      const container = helpers.getContainer(section, containerId);
      const sample = helpers.getSampleById(button.dataset.singleSampleSave);
      if (!container || !sample) {
        return;
      }
      const codeInput = inventorySections.querySelector('[data-single-sample-code]');
      const nameInput = inventorySections.querySelector('[data-single-sample-name]');
      const typeInput = inventorySections.querySelector('[data-single-sample-type]');
      const lotInput = inventorySections.querySelector('[data-single-sample-lot]');
      const concentrationInput = inventorySections.querySelector('[data-single-sample-concentration]');
      const notesInput = inventorySections.querySelector('[data-single-sample-notes]');
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
      sample.details = readTypeFieldsFrom(inventorySections.querySelector('[data-sample-type-fields]'), sample.type);
      sample.inventoryLink = { section, containerId, wellIndex: null };
      sample.location = helpers.isLocationEmpty(sample.location) ? helpers.buildAutoLocationFromLink(section, container, null) : sample.location;
      sample.updatedAt = new Date().toISOString();
      uiState.editingSampleId = sample.id;
      uiState.wellEditorStatus = `Saved sample ${sample.code || sample.name}.`;
      persist();
      notifySamplesChanged();
      renderSections();
    });
  });

  inventorySections.querySelectorAll('[data-single-sample-unlink]').forEach((button) => {
    button.addEventListener('click', () => {
      helpers.ensureSamples();
      const sample = helpers.getSampleById(button.dataset.singleSampleUnlink);
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

  inventorySections.querySelectorAll('[data-single-sample-create]').forEach((button) => {
    button.addEventListener('click', () => {
      helpers.ensureSamples();
      const section = uiState.selectedContainer?.section;
      const containerId = uiState.selectedContainer?.containerId;
      if (!section || !containerId) {
        return;
      }
      const container = helpers.getContainer(section, containerId);
      if (!container) {
        return;
      }
      const codeInput = inventorySections.querySelector('[data-single-sample-new-code]');
      const nameInput = inventorySections.querySelector('[data-single-sample-new-name]');
      const typeInput = inventorySections.querySelector('[data-single-sample-new-type]');
      const lotInput = inventorySections.querySelector('[data-single-sample-new-lot]');
      const concentrationInput = inventorySections.querySelector('[data-single-sample-new-concentration]');
      const notesInput = inventorySections.querySelector('[data-single-sample-new-notes]');
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
        details: readTypeFieldsFrom(inventorySections.querySelector('[data-sample-type-fields]'), typeInput?.value),
        location: helpers.buildAutoLocationFromLink(section, container, null),
        inventoryLink: { section, containerId, wellIndex: null },
        chemicalLinks: [],
        compoundStructure: isChemicalSampleType(typeInput?.value)
          ? normalizeStructureData(pendingStructureDrafts.get(getPendingStructureKey('single-new')))
          : null,
        updatedAt: new Date().toISOString()
      };
      pendingStructureDrafts.delete(getPendingStructureKey('single-new'));
      state.samples.push(sample);
      uiState.editingSampleId = sample.id;
      uiState.wellEditorStatus = `Created sample ${sample.code}.`;
      // Before persist: this mutates notebookEntries and clears
      // pendingNotebookSampleCapture, and nothing else saves afterwards.
      ctx.notifySampleRecorded(sample);
      persist();
      notifySamplesChanged();
      renderSections();
    });
  });
}
