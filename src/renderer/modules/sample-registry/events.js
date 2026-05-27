import {
  onCompoundCaptureClick,
  onCompoundClearClick,
  onCompoundDialogApplyClick,
  onCompoundOpenClick,
  onCompoundPasteClick,
  onCompoundStructurePaste
} from './compound-actions.js';
import {
  onCompoundDialogKeydown,
  onCompoundDialogOverlayClick,
  onSampleTypeChange
} from './compound-dialog.js';
import { renderLinkedPositionOptions } from './inventory-links.js';
import { renderLocationFields } from './location-fields.js';
import {
  deleteSample,
  editSample,
  onSubmit,
  resetForm
} from './sample-form.js';
import { onListClick, renderList } from './sample-list.js';

export function bindSampleRegistryEvents(ctx) {
  const dom = ctx.dom;
  dom.sampleStorageTypeInput?.addEventListener('change', () => renderLocationFields(ctx));
  dom.sampleLinkContainerInput?.addEventListener('change', () => renderLinkedPositionOptions(ctx));
  dom.sampleTypeInput?.addEventListener('change', () => onSampleTypeChange(ctx));
  dom.sampleCompoundOpenBtn?.addEventListener('click', () => onCompoundOpenClick(ctx));
  dom.sampleCompoundPasteBtn?.addEventListener('click', () => onCompoundPasteClick(ctx));
  dom.sampleCompoundCaptureBtn?.addEventListener('click', () => onCompoundCaptureClick(ctx));
  dom.sampleCompoundClearBtn?.addEventListener('click', () => onCompoundClearClick(ctx));
  dom.sampleCompoundDialogCloseBtn?.addEventListener('click', () => ctx.closeCompoundDialog());
  dom.sampleCompoundDialogCancelBtn?.addEventListener('click', () => ctx.closeCompoundDialog());
  dom.sampleCompoundDialogApplyBtn?.addEventListener('click', () => onCompoundDialogApplyClick(ctx));
  dom.sampleCompoundDialogOverlay?.addEventListener('click', (event) => onCompoundDialogOverlayClick(ctx, event));
  dom.sampleCompoundFields?.addEventListener('paste', (event) => onCompoundStructurePaste(ctx, event));
  dom.sampleForm?.addEventListener('submit', (event) => onSubmit(ctx, event));
  dom.sampleCancelBtn?.addEventListener('click', () => resetForm(ctx));
  dom.sampleSearchInput?.addEventListener('input', () => renderList(ctx));
  dom.sampleRegistryList?.addEventListener('click', (event) => onListClick(ctx, event));
  dom.sampleDetailEditBtn?.addEventListener('click', () => {
    if (!ctx.selectedSampleId) {
      return;
    }
    editSample(ctx, ctx.selectedSampleId);
  });
  dom.sampleDetailDeleteBtn?.addEventListener('click', () => {
    if (!ctx.selectedSampleId) {
      return;
    }
    deleteSample(ctx, ctx.selectedSampleId);
  });
  document.addEventListener('keydown', (event) => onCompoundDialogKeydown(ctx, event));
}
