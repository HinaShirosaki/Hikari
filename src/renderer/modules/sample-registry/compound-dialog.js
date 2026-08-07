import {
  emptyCompoundStructureDraft,
  formatCompoundStructureSummary,
  isChemicalStructureSampleType
} from './compound-model.js';
import { showTransientNotice } from '../../lib/notify.js';

export function setCompoundStatus(ctx, message, isError) {
  if (isError && message) {
    showTransientNotice(message, { type: 'error' });
  }
  const { sampleCompoundStatus } = ctx.dom;
  if (!sampleCompoundStatus) {
    return;
  }
  sampleCompoundStatus.textContent = String(message || '');
  sampleCompoundStatus.style.color = isError ? '#982a38' : '';
}

export function renderCompoundFields(ctx) {
  const {
    sampleCompoundFields,
    sampleCompoundPreview,
    sampleCompoundPreviewImage,
    sampleCompoundSmilesInput,
    sampleTypeInput
  } = ctx.dom;
  if (!sampleCompoundFields) {
    return;
  }
  const isChemicalStructureSample = isChemicalStructureSampleType(sampleTypeInput?.value);
  sampleCompoundFields.hidden = !isChemicalStructureSample;
  if (!isChemicalStructureSample) {
    setCompoundStatus(ctx, '', false);
    if (sampleCompoundPreview) {
      sampleCompoundPreview.hidden = true;
    }
    return;
  }

  if (sampleCompoundSmilesInput) {
    const summary = formatCompoundStructureSummary(ctx.compoundStructureDraft);
    sampleCompoundSmilesInput.value = summary === '-' ? '' : summary;
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
    renderCompoundFields(ctx);
    return;
  }
  setCompoundStatus(ctx, 'Chemical structure mode enabled. Paste SMILES or MOL/SDF structure data.', false);
  renderCompoundFields(ctx);
}
