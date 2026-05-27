import { resetForm } from './sample-form.js';
import { renderList } from './sample-list.js';

export function startNotebookSampleCapture(ctx, context = {}) {
  ctx.state.settings = ctx.state.settings && typeof ctx.state.settings === 'object' ? ctx.state.settings : {};
  const existingCapture = ctx.state.settings.pendingNotebookSampleCapture || {};
  ctx.state.settings.pendingNotebookSampleCapture = {
    ...existingCapture,
    notebookEntryId: String(context.notebookEntryId || existingCapture.notebookEntryId || '').trim(),
    notebookType: String(context.notebookType || existingCapture.notebookType || 'biology').trim(),
    projectId: String(context.projectId || existingCapture.projectId || '').trim(),
    projectName: String(context.projectName || existingCapture.projectName || '').trim(),
    protocolName: String(context.protocolName || existingCapture.protocolName || '').trim(),
    experimentName: String(context.experimentName || existingCapture.experimentName || '').trim(),
    requestedAt: String(context.requestedAt || existingCapture.requestedAt || new Date().toISOString()).trim()
  };
  ctx.clearSearchOnReset = true;
  resetForm(ctx);
  ctx.clearSearchOnReset = false;
  const notebookLabel = ctx.state.settings.pendingNotebookSampleCapture.experimentName
    || ctx.state.settings.pendingNotebookSampleCapture.protocolName
    || 'current notebook page';
  if (ctx.dom.sampleNotesInput) {
    ctx.dom.sampleNotesInput.placeholder = `Optional notes for ${notebookLabel}`;
  }
  renderList(ctx);
  ctx.dom.sampleForm?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  ctx.dom.sampleNameInput?.focus();
}
