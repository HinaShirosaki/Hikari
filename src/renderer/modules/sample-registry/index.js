import { renderCellPassageFields } from './cell-passage.js';
import { renderCompoundFields, setCompoundStatus } from './compound-dialog.js';
import { emptyCompoundStructureDraft } from './compound-model.js';
import { getSampleRegistryDom } from './dom.js';
import { bindSampleRegistryEvents } from './events.js';
import {
  renderChemicalLinkOptions,
  renderLinkedContainerOptions
} from './inventory-links.js';
import { renderLocationFields } from './location-fields.js';
import { startNotebookSampleCapture } from './notebook-workflow.js';
import { renderList } from './sample-list.js';
import { onSubmit } from './sample-form.js';
import { ensureSampleState, renderSampleTypeOptions } from './sample-utils.js';
import { serializeDraftSnapshot, snapshotFormControls } from '../../lib/unsaved-draft.js';

export function initSampleRegistry({ state, persist, safeText, onNotebookSampleCaptured }) {
  const ctx = {
    state,
    persist,
    safeText,
    onNotebookSampleCaptured,
    dom: getSampleRegistryDom(),
    selectedSampleId: '',
    compoundStructureDraft: emptyCompoundStructureDraft(),
    clearSearchOnReset: false,
    renderCellPassageFields: null,
    setCompoundStatus: null,
    markDraftSaved: null
  };
  let savedDraftSnapshot = '';

  function getCurrentDraftSnapshot() {
    return serializeDraftSnapshot({
      controls: snapshotFormControls(ctx.dom.sampleForm),
      compoundStructureDraft: ctx.compoundStructureDraft
    });
  }

  function markDraftSaved() {
    savedDraftSnapshot = getCurrentDraftSnapshot();
  }

  ctx.renderCellPassageFields = () => renderCellPassageFields(ctx);
  ctx.setCompoundStatus = (message, isError) => setCompoundStatus(ctx, message, isError);
  ctx.markDraftSaved = markDraftSaved;

  bindSampleRegistryEvents(ctx);

  function render() {
    ensureSampleState(ctx);
    renderSampleTypeOptions(ctx);
    renderLinkedContainerOptions(ctx);
    renderChemicalLinkOptions(ctx);
    if (!ctx.dom.sampleLocationFields.innerHTML.trim()) {
      renderLocationFields(ctx);
    }
    renderCellPassageFields(ctx);
    renderCompoundFields(ctx);
    renderList(ctx);
    if (!savedDraftSnapshot) {
      markDraftSaved();
    }
  }

  return {
    hasUnsavedChanges: () => Boolean(savedDraftSnapshot && getCurrentDraftSnapshot() !== savedDraftSnapshot),
    render,
    renderList: () => renderList(ctx),
    saveUnsavedChanges: async () => {
      const record = await onSubmit(ctx, { preventDefault() {} });
      return Boolean(record) && getCurrentDraftSnapshot() === savedDraftSnapshot;
    },
    startNotebookSampleCapture: (context) => startNotebookSampleCapture(ctx, context)
  };
}
