export function installStructureState(ctx) {
  const { helpers, pendingStructureDrafts, uiState } = ctx;
  const { inventorySections, sampleCompoundDialogOverlay } = ctx.elements;

function isChemicalSampleType(type) {
  return helpers.normalizeSampleType(type) === 'chemical';
}

function normalizeStructureData(input) {
  const smiles = String(input?.smiles || '').trim();
  const molfile = String(input?.molfile || '').trim();
  const imageDataUrl = String(input?.imageDataUrl || '').trim();
  if (!smiles && !molfile && !imageDataUrl) {
    return null;
  }
  return { smiles, molfile, imageDataUrl };
}

function toStructureDraft(input) {
  return {
    smiles: String(input?.smiles || '').trim(),
    molfile: String(input?.molfile || '').trim(),
    imageDataUrl: String(input?.imageDataUrl || '').trim()
  };
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

function setStructureStatus(message) {
  const status = inventorySections?.querySelector('[data-inventory-sample-structure-status]');
  if (status) {
    status.textContent = String(message || '');
  }
}

function buildStructureClipboardNotFoundMessage(formats = []) {
  const base = 'No CDXML, MOL, SDF, SMILES, InChI, or ChemDraw image found on the clipboard.';
  const visibleFormats = Array.from(new Set((Array.isArray(formats) ? formats : [])
    .map((format) => String(format || '').trim())
    .filter(Boolean)));
  if (!visibleFormats.length) {
    return base;
  }
  return `${base} Clipboard formats seen: ${visibleFormats.slice(0, 8).join(', ')}.`;
}

function syncStructureButtons() {
  inventorySections?.querySelectorAll('[data-inventory-sample-structure-open]').forEach((button) => {
    const mode = String(button.dataset.inventorySampleStructureOpen || '');
    const typeInput = getStructureTypeInput(mode);
    const isChemical = isChemicalSampleType(typeInput?.value);
    button.hidden = !isChemical;
    if (isChemical) {
      const sample = button.dataset.sampleId ? helpers.getSampleById(button.dataset.sampleId) : null;
      const draft = sample
        ? normalizeStructureData(sample.compoundStructure)
        : normalizeStructureData(pendingStructureDrafts.get(getPendingStructureKey(mode)));
      button.textContent = draft ? 'Edit Structure' : 'Add Structure';
    }
  });
  inventorySections?.querySelectorAll('[data-inventory-sample-structure-paste]').forEach((button) => {
    const mode = String(button.dataset.inventorySampleStructurePaste || '');
    const typeInput = getStructureTypeInput(mode);
    button.hidden = !isChemicalSampleType(typeInput?.value);
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

function openStructureDialog() {
  if (sampleCompoundDialogOverlay) {
    sampleCompoundDialogOverlay.hidden = false;
  }
}

function closeStructureDialog() {
  ctx.structureEditorContext = null;
  if (sampleCompoundDialogOverlay) {
    sampleCompoundDialogOverlay.hidden = true;
  }
}

  Object.assign(ctx, {
    isChemicalSampleType,
    normalizeStructureData,
    toStructureDraft,
    getPendingStructureKey,
    getStructureTypeInput,
    setStructureStatus,
    buildStructureClipboardNotFoundMessage,
    syncStructureButtons,
    openStructureDialog,
    closeStructureDialog
  });
}
