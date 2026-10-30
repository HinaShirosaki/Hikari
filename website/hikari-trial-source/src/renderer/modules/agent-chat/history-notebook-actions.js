import { asArray, trimText } from './shared.js';
import { collectNotebookDrafts, findNotebookDraft } from './notebook-draft-list.js';

function updateAssistantNotebookDraftMessage(messages, messageId, nextDraft, notebookDraftAdapter, draftId = '') {
  const normalizedMessageId = trimText(messageId, 120);
  if (!normalizedMessageId || !nextDraft || typeof nextDraft !== 'object') {
    return null;
  }
  const message = asArray(messages).find((item) => trimText(item?.id, 120) === normalizedMessageId);
  if (!message || message.role !== 'assistant' || !message.meta || typeof message.meta !== 'object') {
    return null;
  }
  const normalizedDraft = notebookDraftAdapter?.normalizeDraft?.(nextDraft) || null;
  if (!normalizedDraft) {
    return null;
  }
  const items = collectNotebookDrafts(message.meta, notebookDraftAdapter);
  const selected = findNotebookDraft(message.meta, notebookDraftAdapter, draftId);
  if (!selected) return null;
  const drafts = items.map((item) => item.draftId === selected.draftId ? normalizedDraft : item.draft);
  message.meta = {
    ...message.meta,
    notebookDraft: drafts[0] || normalizedDraft,
    notebookDrafts: drafts
  };
  return normalizedDraft;
}

export function createNotebookHistoryActions({
  state,
  persist,
  setStatus,
  renderContextSummary,
  renderHistoryView,
  notebookDraftAdapter,
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

  function openNotebookPage(messageId = '', draftId = '') {
    const message = findMessage(messageId);
    const draft = findNotebookDraft(message?.meta, notebookDraftAdapter, draftId)?.draft;
    const existingEntry = notebookDraftAdapter?.findEntryForDraft?.(draft) || null;
    if (!draft || !existingEntry) {
      setStatus('Notebook page is unavailable for opening.');
      return;
    }
    openExistingEntry(existingEntry);
    setStatus(
      notebookDraftAdapter?.normalizeState?.(existingEntry?.notebookState) === 'planned'
        ? 'Opened planned notebook page.'
        : 'Opened notebook page.'
    );
  }

  function createPlannedPage(messageId = '', draftId = '') {
    const message = findMessage(messageId);
    const draft = findNotebookDraft(message?.meta, notebookDraftAdapter, draftId)?.draft;
    if (!draft || draft.save.mode !== 'confirm_before_save') {
      setStatus('Planned notebook draft is unavailable for creation.');
      return false;
    }
    if (draft.save.status === 'rejected') return false;
    const result = notebookDraftAdapter?.createPlannedPage?.(
      draft,
      trimText(message?.meta?.requestText, 3000)
    );
    if (!result?.ok && result?.reason === 'missing_binding') {
      setStatus('Planned notebook draft is missing a project or protocol binding.');
      return false;
    }
    if (!result?.ok || !result.entry || !result.draft) {
      setStatus('Planned notebook draft is unavailable for creation.');
      return false;
    }
    updateAssistantNotebookDraftMessage(
      state.agentChat.messages,
      messageId,
      result.draft,
      notebookDraftAdapter,
      draftId
    );
    persist();
    if (result.created) {
      renderContextSummary();
    }
    renderHistoryView({ forceScroll: true });
    openExistingEntry(result.entry);
    setStatus(result.created ? 'Planned notebook page created.' : 'Opened planned notebook page.');
    return true;
  }

  function rejectPlannedPage(messageId = '', draftId = '') {
    const message = findMessage(messageId);
    const draft = findNotebookDraft(message?.meta, notebookDraftAdapter, draftId)?.draft;
    if (!draft || draft.save.mode !== 'confirm_before_save') {
      setStatus('Planned notebook draft is unavailable for rejection.');
      return;
    }
    if (draft.save.applied || notebookDraftAdapter?.findEntryForDraft?.(draft)) return false;
    updateAssistantNotebookDraftMessage(state.agentChat.messages, messageId, {
      ...draft,
      save: {
        ...draft.save,
        applied: false,
        status: 'rejected',
        reason: 'Planned page rejected by user.'
      }
    }, notebookDraftAdapter, draftId);
    persist();
    renderHistoryView({ forceScroll: true });
    setStatus('Planned notebook draft rejected.');
    return true;
  }

  return {
    createPlannedPage,
    openNotebookPage,
    rejectPlannedPage
  };
}
