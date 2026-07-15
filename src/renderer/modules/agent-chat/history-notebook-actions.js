import { asArray, trimText } from './shared.js';

function updateAssistantNotebookDraftMessage(messages, messageId, nextDraft, notebookDraftAdapter) {
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
  message.meta = {
    ...message.meta,
    notebookDraft: normalizedDraft
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

  function openNotebookPage(messageId = '') {
    const message = findMessage(messageId);
    const draft = notebookDraftAdapter?.normalizeDraft?.(message?.meta?.notebookDraft) || null;
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

  function createPlannedPage(messageId = '') {
    const message = findMessage(messageId);
    const draft = notebookDraftAdapter?.normalizeDraft?.(message?.meta?.notebookDraft) || null;
    if (!draft || draft.save.mode !== 'confirm_before_save') {
      setStatus('Planned notebook draft is unavailable for creation.');
      return;
    }
    const result = notebookDraftAdapter?.createPlannedPage?.(
      draft,
      trimText(message?.meta?.requestText, 3000)
    );
    if (!result?.ok && result?.reason === 'missing_binding') {
      setStatus('Planned notebook draft is missing a project or protocol binding.');
      return;
    }
    if (!result?.ok || !result.entry || !result.draft) {
      setStatus('Planned notebook draft is unavailable for creation.');
      return;
    }
    updateAssistantNotebookDraftMessage(
      state.agentChat.messages,
      messageId,
      result.draft,
      notebookDraftAdapter
    );
    persist();
    if (result.created) {
      renderContextSummary();
    }
    renderHistoryView({ forceScroll: true });
    openExistingEntry(result.entry);
    setStatus(result.created ? 'Planned notebook page created.' : 'Opened planned notebook page.');
  }

  function rejectPlannedPage(messageId = '') {
    const message = findMessage(messageId);
    const draft = notebookDraftAdapter?.normalizeDraft?.(message?.meta?.notebookDraft) || null;
    if (!draft || draft.save.mode !== 'confirm_before_save') {
      setStatus('Planned notebook draft is unavailable for rejection.');
      return;
    }
    updateAssistantNotebookDraftMessage(state.agentChat.messages, messageId, {
      ...draft,
      save: {
        ...draft.save,
        applied: false,
        status: 'rejected',
        reason: 'Planned page rejected by user.'
      }
    }, notebookDraftAdapter);
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
