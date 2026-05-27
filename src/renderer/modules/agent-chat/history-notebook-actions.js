import {
  buildNotebookEntryFromDraft,
  findNotebookEntryForDraft,
  normalizeNotebookDraft,
  normalizeNotebookState,
  updateAssistantNotebookDraftMessage
} from './notebook-drafts.js';
import { asArray, trimText } from './shared.js';

export function createNotebookHistoryActions({
  state,
  persist,
  createId,
  setStatus,
  renderContextSummary,
  renderHistoryView,
  onNotebookEntriesChanged,
  onOpenNotebookEntry
}) {
  function findMessage(messageId = '') {
    const targetId = trimText(messageId, 120);
    return asArray(state.agentChat.messages).find((item) => trimText(item?.id, 120) === targetId) || null;
  }

  function openExistingEntry(existingEntry) {
    try {
      onOpenNotebookEntry(existingEntry.id);
    } catch {
      // Keep chat responsiveness even if notebook navigation fails.
    }
  }

  function openNotebookPage(messageId = '') {
    const message = findMessage(messageId);
    const draft = normalizeNotebookDraft(message?.meta?.notebookDraft);
    const existingEntry = findNotebookEntryForDraft(state.notebookEntries, draft);
    if (!draft || !existingEntry) {
      setStatus('Notebook page is unavailable for opening.');
      return;
    }
    openExistingEntry(existingEntry);
    setStatus(
      normalizeNotebookState(existingEntry?.notebookState) === 'planned'
        ? 'Opened planned notebook page.'
        : 'Opened notebook page.'
    );
  }

  function markExistingPlannedPage(messageId, existingEntry) {
    updateAssistantNotebookDraftMessage(state.agentChat.messages, messageId, (currentDraft) => ({
      ...currentDraft,
      save: {
        ...currentDraft.save,
        applied: true,
        status: 'already_created',
        reason: 'Planned page already exists for this proposal.'
      }
    }));
    persist();
    renderHistoryView({ forceScroll: true });
    openExistingEntry(existingEntry);
    setStatus('Opened planned notebook page.');
  }

  function createPlannedPage(messageId = '') {
    const message = findMessage(messageId);
    const draft = normalizeNotebookDraft(message?.meta?.notebookDraft);
    if (!draft || draft.save.mode !== 'confirm_before_save') {
      setStatus('Planned notebook draft is unavailable for creation.');
      return;
    }
    const existingEntry = findNotebookEntryForDraft(state.notebookEntries, draft);
    if (existingEntry) {
      markExistingPlannedPage(messageId, existingEntry);
      return;
    }
    const entry = buildNotebookEntryFromDraft(draft, trimText(message?.meta?.requestText, 3000), { createId });
    if (!entry.projectId || !entry.protocolId) {
      setStatus('Planned notebook draft is missing a project or protocol binding.');
      return;
    }
    state.notebookEntries = asArray(state.notebookEntries);
    state.notebookEntries.push(entry);
    updateAssistantNotebookDraftMessage(state.agentChat.messages, messageId, (currentDraft) => ({
      ...currentDraft,
      save: {
        ...currentDraft.save,
        applied: true,
        status: 'planned_page_created',
        reason: 'Planned page created from assistant proposal.'
      },
      entry_template: {
        ...currentDraft.entry_template,
        ...entry
      }
    }));
    persist();
    renderContextSummary();
    renderHistoryView({ forceScroll: true });
    try {
      onNotebookEntriesChanged?.();
    } catch {
      // Keep chat actions resilient even if downstream render hooks fail.
    }
    openExistingEntry(entry);
    setStatus('Planned notebook page created.');
  }

  function rejectPlannedPage(messageId = '') {
    const message = findMessage(messageId);
    const draft = normalizeNotebookDraft(message?.meta?.notebookDraft);
    if (!draft || draft.save.mode !== 'confirm_before_save') {
      setStatus('Planned notebook draft is unavailable for rejection.');
      return;
    }
    updateAssistantNotebookDraftMessage(state.agentChat.messages, messageId, (currentDraft) => ({
      ...currentDraft,
      save: {
        ...currentDraft.save,
        applied: false,
        status: 'rejected',
        reason: 'Planned page rejected by user.'
      }
    }));
    persist();
    renderHistoryView({ forceScroll: true });
    setStatus('Planned notebook draft rejected.');
  }

  return {
    createPlannedPage,
    openNotebookPage,
    rejectPlannedPage
  };
}
