import { normalizeProtocolStepEdits, protocolStepText } from '../../shared/protocol-step-edits.mjs';
import { cloneProtocolSnapshot, resolveEntryExperimentName, resolveEntryProtocol } from '../modules/biology-notebook/entry/entry-helpers.js';

const queues = new WeakMap();
const failure = error => ({ ok: false, error });

// Both chats use the same queue and normal Markdown autosave. The target and
// original step text are checked again when the user approves the proposal.
export function createAgentProtocolEdit({ state, persist, modules, rendererServices }) {
  async function apply(proposal) {
    const { target_type: type, target_id: id, target_title: title, storage_path: root } = proposal;
    if (!root || root !== state.settings?.storagePath?.trim()) {
      return failure('Open the original workspace and ask the Agent to prepare the edit again.');
    }
    if (!['notebook_page', 'protocol'].includes(type)) return failure('Invalid protocol edit target.');
    const edits = normalizeProtocolStepEdits(proposal.step_edits);
    if (!edits) return failure('This proposal contains invalid protocol step replacements.');

    const isPage = type === 'notebook_page';
    const key = isPage ? 'notebookEntries' : 'protocols';
    const records = state[key];
    const index = records.findIndex(record => record.id === id);
    const record = records[index];
    if (!record) return failure('The target record is no longer available.');
    const protocol = isPage
      ? record.protocolSnapshot || resolveEntryProtocol(record, state.protocols)
      : record;
    const currentTitle = isPage ? resolveEntryExperimentName(record, protocol) : protocol.name;
    const isOpenPage = isPage && modules.biologyNotebook?.getOpenEntryId?.() === id;
    const editor = isPage ? (isOpenPage ? modules.biologyNotebook : null) : modules.protocol;
    if (editor?.hasUnsavedChanges?.()) return failure('Save or discard the open editor changes before applying the protocol edit.');
    if (String(currentTitle || '').trim() !== title
      || (proposal.expected_updated_at && record.updatedAt !== proposal.expected_updated_at)) {
      return failure('The target record changed. Ask the Agent to prepare a new edit.');
    }
    if (!Array.isArray(protocol?.steps) || edits.some(edit =>
      protocolStepText(protocol.steps[edit.step_number - 1]) !== edit.expected_text)) {
      return failure('The current protocol steps differ from the proposal. Ask the Agent to read them again.');
    }
    const steps = [...protocol.steps];
    for (const { step_number, replacement_text } of edits) {
      const step = steps[step_number - 1];
      steps[step_number - 1] = typeof step === 'string' ? replacement_text : { ...step, text: replacement_text };
    }
    const updatedAt = new Date().toISOString();
    const next = isPage
      ? { ...record, updatedAt, protocolSnapshot: { ...(record.protocolSnapshot || cloneProtocolSnapshot(protocol)), steps } }
      : { ...record, updatedAt, steps };
    records[index] = next;
    let error;
    try {
      const saved = await persist();
      const skipped = saved?.sidecarPaths?.skippedRecords?.find(item =>
        item.kind === (isPage ? 'notebook' : 'protocol') && item.id === id);
      error = skipped?.message || (saved?.ok !== true && (saved?.error || 'Hikari could not save the protocol edit.'));
    } catch (saveError) {
      error = String(saveError?.message || saveError || 'Hikari could not save the protocol edit.');
    }
    if (error) {
      // Autosave normalizes notebook paths by shallow-copying entries.
      // Roll back only the edit that is still in this workspace.
      const liveRecords = state[key];
      const liveIndex = liveRecords.findIndex(item => item.id === id);
      const live = liveRecords[liveIndex];
      const field = isPage ? 'protocolSnapshot' : 'steps';
      if (root === state.settings?.storagePath?.trim()
        && live?.updatedAt === updatedAt && live[field] === next[field]) {
        liveRecords[liveIndex] = { ...live, [field]: record[field], updatedAt: record.updatedAt };
        await persist({ external: true });
      }
      return failure(error);
    }
    if (root !== state.settings?.storagePath?.trim()) return { ok: true };
    if (isPage) {
      if (isOpenPage && editor.getOpenEntryId() === id
        && !editor?.hasUnsavedChanges?.()) editor.openEntry(id);
      rendererServices.notebook.handleAgentNotebookEntriesChanged();
    } else {
      rendererServices.protocol.handleProtocolsChanged();
      if (!editor?.hasUnsavedChanges?.()) editor?.restoreHistory?.();
      else editor?.renderList?.();
    }
    return { ok: true };
  }

  return proposal => {
    const pending = (queues.get(state) || Promise.resolve()).then(() => apply(proposal));
    queues.set(state, pending.catch(() => {}));
    return pending;
  };
}
