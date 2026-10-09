import { containerToCsv, mergeContainerCsv, parseContainerCsv } from './csv-io.js';
import { readTypeFieldsFrom } from './type-fields.js';

function importContainerCsv(ctx, section, container, csvText) {
  try {
    const { created, updated, skipped, recoded } = mergeContainerCsv(ctx.state, section, container, parseContainerCsv(csvText));
    const notes = [
      skipped ? ` Skipped ${skipped} row${skipped === 1 ? '' : 's'} whose well is not in this container.` : '',
      recoded.length ? ` Renamed codes that clashed with an earlier row: ${recoded.map(({ from, to }) => `${from} → ${to}`).join(', ')}.` : ''
    ].join('');
    ctx.uiState.wellEditorStatus = `Imported ${created + updated} samples (${created} new, ${updated} updated).${notes}`;
    if (created || updated) {
      ctx.persist();
    }
  } catch (error) {
    ctx.uiState.wellEditorStatus = `Import failed: ${error?.message || 'could not read the CSV file.'}`;
  }
}

function safeFilePart(text, fallback) {
  const cleaned = String(text || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function exportContainerCsv(ctx, section, container) {
  const blob = new Blob([`\uFEFF${containerToCsv(ctx.state.samples, section, container)}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${safeFilePart(section, 'inventory')}-${safeFilePart(container.name, 'container')}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  ctx.uiState.wellEditorStatus = `Exported ${container.name || 'container'} CSV.`;
}

export function bindWellSampleEvents(ctx) {
  const { helpers, persist, state, uiState } = ctx;
  const { inventorySections } = ctx.elements;
  const pendingStructureDrafts = ctx.pendingStructureDrafts;
  const renderSections = () => ctx.renderSections();
  const isChemicalSampleType = (...args) => ctx.isChemicalSampleType(...args);
  const normalizeStructureData = (...args) => ctx.normalizeStructureData(...args);
  const getPendingStructureKey = (...args) => ctx.getPendingStructureKey(...args);
  // Persisted across renders on ctx so the drag-to-clone gesture survives the re-bind that happens after every renderSections().
  const dragClone = ctx._dragClone || (ctx._dragClone = { active: false, visited: new Set(), count: 0, suppressClick: false });

  // Drag-to-clone: with a sample in clone mode, press on a well and drag across
  // others; each well entered gets a copy (once per gesture). All copies are
  // persisted together on mouseup.
  function applyDragClone(button) {
    const index = Number(button.dataset.wellIndex);
    if (dragClone.visited.has(index)) {
      return;
    }
    dragClone.visited.add(index);
    const section = uiState.selectedContainer?.section;
    const containerId = uiState.selectedContainer?.containerId;
    const container = section && containerId ? helpers.getContainer(section, containerId) : null;
    const sample = helpers.getSampleById(uiState.cloningSampleId);
    if (!container || !sample || Number(sample.inventoryLink?.wellIndex) === index) {
      return;
    }
    const clone = {
      ...sample,
      id: `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      inventoryLink: { section, containerId, wellIndex: index },
      location: helpers.buildAutoLocationFromLink(section, container, index),
      updatedAt: new Date().toISOString()
    };
    state.samples.push(clone);
    dragClone.count += 1;
  }

  if (!ctx._dragCloneMouseupBound) {
    ctx._dragCloneMouseupBound = true;
    document?.addEventListener?.('mouseup', () => {
      if (!dragClone.active) {
        return;
      }
      dragClone.active = false;
      dragClone.suppressClick = true;
      setTimeout(() => { dragClone.suppressClick = false; }, 0);
      const sample = helpers.getSampleById(uiState.cloningSampleId);
      uiState.cloningSampleId = null;
      if (dragClone.count > 0) {
        uiState.wellEditorStatus = `Cloned ${sample ? (sample.code || sample.name) : 'sample'} into ${dragClone.count} well${dragClone.count === 1 ? '' : 's'}.`;
        persist();
      }
      renderSections();
    });
  }

  inventorySections.querySelectorAll('[data-well-index]').forEach((button) => {
    button.addEventListener('mousedown', (event) => {
      if (!uiState.cloningSampleId) {
        return;
      }
      const section = button.dataset.section;
      const containerId = button.dataset.containerId;
      if (!uiState.selectedContainer || uiState.selectedContainer.section !== section || uiState.selectedContainer.containerId !== containerId) {
        return;
      }
      event.preventDefault();
      dragClone.active = true;
      dragClone.visited = new Set();
      dragClone.count = 0;
      applyDragClone(button);
    });

    button.addEventListener('mouseenter', () => {
      if (dragClone.active) {
        applyDragClone(button);
      }
    });

    button.addEventListener('click', () => {
      if (dragClone.suppressClick) {
        return;
      }
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
      sample.details = readTypeFieldsFrom(inventorySections.querySelector('[data-sample-type-fields]'), sample.type);
      sample.inventoryLink = { section, containerId, wellIndex: index };
      sample.location = helpers.isLocationEmpty(sample.location) ? helpers.buildAutoLocationFromLink(section, container, index) : sample.location;
      sample.updatedAt = new Date().toISOString();
      uiState.editingSampleId = sample.id;
      uiState.wellEditorStatus = `Saved sample ${sample.code || sample.name}.`;
      persist();
      renderSections();
    });
  });

  // A sample only exists inside a container, so removing it from its slot deletes it.
  inventorySections.querySelectorAll('[data-well-sample-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      helpers.ensureSamples();
      const sample = helpers.getSampleById(button.dataset.wellSampleDelete);
      if (!sample) {
        return;
      }
      state.samples = state.samples.filter((item) => item !== sample);
      uiState.editingSampleId = '';
      uiState.wellEditorStatus = `Deleted sample ${sample.code || sample.name || sample.id}.`;
      persist();
      renderSections();
    });
  });

  inventorySections.querySelectorAll('[data-well-sample-clone]').forEach((button) => {
    button.addEventListener('click', () => {
      const sample = helpers.getSampleById(button.dataset.wellSampleClone);
      if (!sample) {
        return;
      }
      if (uiState.cloningSampleId === sample.id) {
        uiState.cloningSampleId = null;
        uiState.wellEditorStatus = 'Fill wells cancelled.';
      } else {
        helpers.ensureSamples();
        uiState.cloningSampleId = sample.id;
        uiState.wellEditorStatus = `Drag across wells to fill with ${sample.code || sample.name}.`;
      }
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

  inventorySections.querySelectorAll('[data-container-export-csv]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.section || uiState.selectedContainer?.section;
      const containerId = button.dataset.containerExportCsv;
      const container = section && containerId ? helpers.getContainer(section, containerId) : null;
      if (!container) {
        return;
      }
      exportContainerCsv(ctx, section, container);
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
        details: readTypeFieldsFrom(inventorySections.querySelector('[data-sample-type-fields]'), typeInput?.value),
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
      renderSections();
    });
  });
}
