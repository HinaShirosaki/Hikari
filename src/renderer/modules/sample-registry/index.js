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
import { ensureSampleState, renderSampleTypeOptions } from './sample-utils.js';

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
    setCompoundStatus: null
  };

  ctx.renderCellPassageFields = () => renderCellPassageFields(ctx);
  ctx.setCompoundStatus = (message, isError) => setCompoundStatus(ctx, message, isError);

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
  }

  return {
    render,
    renderList: () => renderList(ctx),
    startNotebookSampleCapture: (context) => startNotebookSampleCapture(ctx, context)
  };
}
