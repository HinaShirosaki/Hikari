import { fillCellPassage, readCellPassage, renderCellPassageFields } from './cell-passage.js';
import { closeCompoundDialog, renderCompoundFields } from './compound-dialog.js';
import {
  emptyCompoundStructureDraft,
  isChemicalStructureSampleType,
  normalizeCompoundStructureData,
  toCompoundStructureDraft
} from './compound-model.js';
import { captureCompoundStructureFromEditor, clearCompoundCanvas } from './compound-ketcher.js';
import {
  buildLocationFromInventoryLink,
  findLinkedContainer,
  renderChemicalLinkOptions,
  renderLinkedContainerOptions,
  renderLinkedPositionOptions
} from './inventory-links.js';
import { fillLocation, isEmptyLocation, readLocation, renderLocationFields } from './location-fields.js';
import { appendPendingNotebookSampleCapture } from './notebook-capture.js';
import { renderList } from './sample-list.js';
import {
  ensureSampleState,
  makeDefaultCode,
  normalizeCode,
  setMultiSelectValues
} from './sample-utils.js';

export async function onSubmit(ctx, event) {
  event.preventDefault();
  ensureSampleState(ctx);

  const { sampleCodeInput, sampleIdInput, sampleLinkChemicalsInput, sampleLinkContainerInput, sampleLinkPositionInput } = ctx.dom;
  const { sampleNameInput, sampleTypeInput, sampleLotInput, sampleConcentrationInput, sampleNotesInput } = ctx.dom;
  const name = sampleNameInput.value.trim();
  const code = normalizeCode(sampleCodeInput.value) || makeDefaultCode();
  if (!name) {
    return;
  }

  const editingId = sampleIdInput.value;
  const existing = ctx.state.samples.find((item) => item.id === editingId);
  const duplicateCode = ctx.state.samples.find((item) => item.code === code && item.id !== editingId);
  if (duplicateCode) {
    return;
  }

  const linkedContainer = findLinkedContainer(ctx, sampleLinkContainerInput?.value);
  const linkedPosition = String(sampleLinkPositionInput?.value || '').trim();
  const chemicalLinks = Array.from(sampleLinkChemicalsInput?.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean);
  const autoLocation = buildLocationFromInventoryLink(linkedContainer, linkedPosition);
  const manualLocation = readLocation(ctx);
  const sampleType = sampleTypeInput.value;
  const isChemicalStructureSample = isChemicalStructureSampleType(sampleType);
  const isCellLine = sampleType === 'cell_line';

  if (isChemicalStructureSample) {
    try {
      await captureCompoundStructureFromEditor(ctx);
    } catch {
      ctx.setCompoundStatus('Ketcher is not ready. Saving sample with last captured structure.', true);
    }
  } else {
    ctx.compoundStructureDraft = emptyCompoundStructureDraft();
    closeCompoundDialog(ctx);
  }

  const resolvedStructure = isChemicalStructureSample
    ? normalizeCompoundStructureData({
      ...existing?.compoundStructure,
      ...ctx.compoundStructureDraft
    })
    : null;

  const record = {
    id: existing?.id || `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    code,
    name,
    type: sampleType,
    lot: sampleLotInput.value.trim(),
    concentration: sampleConcentrationInput.value.trim(),
    notes: sampleNotesInput.value.trim(),
    cellPassage: isCellLine ? readCellPassage(ctx, existing?.cellPassage) : null,
    location: isEmptyLocation(manualLocation) && autoLocation ? autoLocation : manualLocation,
    inventoryLink: linkedContainer
      ? {
        section: linkedContainer.section,
        containerId: linkedContainer.containerId,
        wellIndex: linkedPosition === '' || linkedPosition === 'single' ? null : Number(linkedPosition)
      }
      : null,
    chemicalLinks,
    compoundStructure: resolvedStructure,
    updatedAt: new Date().toISOString()
  };

  const index = ctx.state.samples.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    ctx.state.samples[index] = record;
  } else {
    ctx.state.samples.push(record);
  }

  const capturedNotebookEntry = appendPendingNotebookSampleCapture(ctx, record);
  ctx.selectedSampleId = record.id;
  ctx.persist();
  if (capturedNotebookEntry && typeof ctx.onNotebookSampleCaptured === 'function') {
    ctx.onNotebookSampleCaptured(capturedNotebookEntry);
  }
  resetForm(ctx);
  renderList(ctx);
}

export function resetForm(ctx) {
  const { sampleForm, sampleIdInput, sampleLinkPositionInput, sampleNotesInput, sampleSearchInput, sampleStorageTypeInput } = ctx.dom;
  sampleIdInput.value = '';
  sampleForm.reset();
  sampleStorageTypeInput.value = 'freezer';
  ctx.compoundStructureDraft = emptyCompoundStructureDraft();
  closeCompoundDialog(ctx);
  if (sampleNotesInput) {
    sampleNotesInput.placeholder = '';
  }
  renderLinkedContainerOptions(ctx);
  renderChemicalLinkOptions(ctx);
  if (sampleLinkPositionInput) {
    sampleLinkPositionInput.value = '';
  }
  renderLocationFields(ctx);
  fillCellPassage(ctx, null);
  renderCellPassageFields(ctx);
  renderCompoundFields(ctx);
  clearCompoundCanvas(ctx).catch(() => {});
  if (sampleSearchInput && ctx.clearSearchOnReset) {
    sampleSearchInput.value = '';
  }
}

export function editSample(ctx, sampleId) {
  const sample = (ctx.state.samples || []).find((item) => item.id === sampleId);
  if (!sample) {
    return;
  }
  const { sampleCodeInput, sampleConcentrationInput, sampleIdInput, sampleLinkContainerInput, sampleLinkPositionInput } = ctx.dom;
  const { sampleLinkChemicalsInput, sampleLotInput, sampleNameInput, sampleNotesInput, sampleTypeInput } = ctx.dom;
  ctx.selectedSampleId = sample.id;
  sampleIdInput.value = sample.id;
  sampleCodeInput.value = sample.code || '';
  sampleNameInput.value = sample.name || '';
  sampleTypeInput.value = isChemicalStructureSampleType(sample.type) ? 'chemical' : (sample.type || 'plasmid');
  sampleLotInput.value = sample.lot || '';
  sampleConcentrationInput.value = sample.concentration || '';
  sampleNotesInput.value = sample.notes || '';
  ctx.compoundStructureDraft = toCompoundStructureDraft(sample.compoundStructure);
  closeCompoundDialog(ctx);
  renderLinkedContainerOptions(ctx);
  renderChemicalLinkOptions(ctx);
  sampleLinkContainerInput.value = sample.inventoryLink
    ? `${sample.inventoryLink.section}::${sample.inventoryLink.containerId}`
    : '';
  renderLinkedPositionOptions(ctx);
  if (sampleLinkPositionInput) {
    sampleLinkPositionInput.value = sample.inventoryLink?.wellIndex === null || sample.inventoryLink?.wellIndex === undefined
      ? (sample.inventoryLink ? 'single' : '')
      : String(sample.inventoryLink.wellIndex);
  }
  setMultiSelectValues(sampleLinkChemicalsInput, sample.chemicalLinks || []);
  fillLocation(ctx, sample.location || {});
  fillCellPassage(ctx, sample.cellPassage);
  renderCellPassageFields(ctx);
  renderCompoundFields(ctx);
  renderList(ctx);
}

export function deleteSample(ctx, sampleId) {
  ctx.state.samples = (ctx.state.samples || []).filter((item) => item.id !== sampleId);
  if (ctx.selectedSampleId === sampleId) {
    ctx.selectedSampleId = '';
  }
  if (ctx.dom.sampleIdInput?.value === sampleId) {
    resetForm(ctx);
  }
  ctx.persist();
  renderList(ctx);
}
