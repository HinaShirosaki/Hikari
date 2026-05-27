import {
  emptyCompoundStructureDraft,
  isChemicalStructureSampleType
} from './compound-model.js';

export function setCompoundStatus(ctx, message, isError) {
  const { sampleCompoundStatus } = ctx.dom;
  if (!sampleCompoundStatus) {
    return;
  }
  sampleCompoundStatus.textContent = String(message || '');
  sampleCompoundStatus.style.color = isError ? '#982a38' : '';
}

export function openCompoundDialog(ctx) {
  ctx.compoundEditorOpen = true;
  if (ctx.dom.sampleCompoundDialogOverlay) {
    ctx.dom.sampleCompoundDialogOverlay.hidden = false;
  }
}

export function closeCompoundDialog(ctx) {
  ctx.compoundEditorOpen = false;
  if (ctx.dom.sampleCompoundDialogOverlay) {
    ctx.dom.sampleCompoundDialogOverlay.hidden = true;
  }
}

export function onCompoundDialogOverlayClick(ctx, event) {
  if (event.target === ctx.dom.sampleCompoundDialogOverlay) {
    closeCompoundDialog(ctx);
  }
}

export function onCompoundDialogKeydown(ctx, event) {
  if (event.key === 'Escape' && ctx.compoundEditorOpen) {
    event.preventDefault();
    closeCompoundDialog(ctx);
  }
}

export function renderCompoundFields(ctx) {
  const {
    sampleCompoundFields,
    sampleCompoundOpenBtn,
    sampleCompoundPreview,
    sampleCompoundPreviewImage,
    sampleCompoundSmilesInput,
    sampleTypeInput
  } = ctx.dom;
  if (!sampleCompoundFields) {
    return;
  }
  const isChemicalStructureSample = isChemicalStructureSampleType(sampleTypeInput?.value);
  if (sampleCompoundOpenBtn) {
    sampleCompoundOpenBtn.hidden = !isChemicalStructureSample;
  }
  sampleCompoundFields.hidden = !isChemicalStructureSample;
  if (!isChemicalStructureSample) {
    setCompoundStatus(ctx, '', false);
    if (sampleCompoundPreview) {
      sampleCompoundPreview.hidden = true;
    }
    return;
  }

  if (sampleCompoundSmilesInput) {
    sampleCompoundSmilesInput.value = ctx.compoundStructureDraft.smiles || '';
  }
  if (sampleCompoundOpenBtn) {
    sampleCompoundOpenBtn.textContent = ctx.compoundStructureDraft.smiles ? 'Edit Structure' : 'Add Structure';
  }
  if (sampleCompoundPreview && sampleCompoundPreviewImage) {
    const hasPreview = Boolean(ctx.compoundStructureDraft.imageDataUrl);
    sampleCompoundPreview.hidden = !hasPreview;
    sampleCompoundPreviewImage.src = hasPreview ? ctx.compoundStructureDraft.imageDataUrl : '';
  }
}

export function onSampleTypeChange(ctx) {
  ctx.renderCellPassageFields();
  if (!isChemicalStructureSampleType(ctx.dom.sampleTypeInput?.value)) {
    ctx.compoundStructureDraft = emptyCompoundStructureDraft();
    closeCompoundDialog(ctx);
    renderCompoundFields(ctx);
    return;
  }
  setCompoundStatus(ctx, 'Chemical structure mode enabled. Paste from ChemDraw or open Ketcher.', false);
  renderCompoundFields(ctx);
}
