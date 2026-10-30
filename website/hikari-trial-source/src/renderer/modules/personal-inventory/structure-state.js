import {
  buildStructureClipboardNotFoundMessage,
  normalizeStructureData,
  toStructureDraft
} from '../../lib/compound-structure.js';

export function installStructureState(ctx) {
  const { helpers, pendingStructureDrafts, uiState } = ctx;
  const { inventorySections } = ctx.elements;

function isChemicalSampleType(type) {
  return helpers.normalizeSampleType(type) === 'chemical';
}

function getPendingStructureKey(mode) {
  const section = uiState.selectedContainer?.section || '';
  const containerId = uiState.selectedContainer?.containerId || '';
  const slot = mode === 'single-new' ? 'single' : `well-${Number(uiState.editingWellIndex)}`;
  return `${section}::${containerId}::${slot}`;
}

function getStructureTypeInput(mode) {
  const selectors = {
    'well-existing': '[data-well-sample-type]',
    'well-new': '[data-well-sample-new-type]',
    'single-existing': '[data-single-sample-type]',
    'single-new': '[data-single-sample-new-type]'
  };
  const selector = selectors[mode];
  return selector ? inventorySections?.querySelector(selector) : null;
}

function setStructureStatus(message, isError = false) {
  const status = inventorySections?.querySelector('[data-inventory-sample-structure-status]');
  if (status) {
    status.textContent = String(message || '');
    status.classList.toggle('is-error', Boolean(isError && message));
  }
}

function syncStructureButtons() {
  inventorySections?.querySelectorAll('[data-inventory-sample-structure-paste]').forEach((button) => {
    const mode = String(button.dataset.inventorySampleStructurePaste || '');
    const typeInput = getStructureTypeInput(mode);
    const isChemical = isChemicalSampleType(typeInput?.value);
    button.hidden = !isChemical;
    if (isChemical) {
      const sample = button.dataset.sampleId ? helpers.getSampleById(button.dataset.sampleId) : null;
      const draft = sample
        ? normalizeStructureData(sample.compoundStructure)
        : normalizeStructureData(pendingStructureDrafts.get(getPendingStructureKey(mode)));
      button.textContent = draft ? 'Replace Structure' : 'Paste Structure';
    }
  });
  inventorySections?.querySelectorAll('[data-inventory-sample-structure-preview]').forEach((preview) => {
    const mode = String(preview.dataset.inventorySampleStructurePreview || '');
    const isChemical = isChemicalSampleType(getStructureTypeInput(mode)?.value);
    const sample = preview.dataset.sampleId ? helpers.getSampleById(preview.dataset.sampleId) : null;
    const structure = sample
      ? normalizeStructureData(sample.compoundStructure)
      : normalizeStructureData(pendingStructureDrafts.get(getPendingStructureKey(mode)));
    const imageDataUrl = String(structure?.imageDataUrl || '').trim();
    const image = preview.querySelector('[data-inventory-sample-structure-preview-image]');
    preview.hidden = !isChemical || !imageDataUrl;
    if (image) {
      if (imageDataUrl) {
        image.src = imageDataUrl;
      } else {
        image.removeAttribute('src');
      }
    }
  });
}

  Object.assign(ctx, {
    isChemicalSampleType,
    normalizeStructureData,
    toStructureDraft,
    getPendingStructureKey,
    getStructureTypeInput,
    setStructureStatus,
    buildStructureClipboardNotFoundMessage,
    syncStructureButtons
  });
}
