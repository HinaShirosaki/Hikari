import { asArray, trimText } from './shared.js';
import { collectNotebookDrafts, findNotebookDraft } from './notebook-draft-list.js';
import { agentUi } from './localization.js';

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
      setStatus(agentUi('status.pageUnavailable'));
      return;
    }
    openExistingEntry(existingEntry);
    setStatus(
      notebookDraftAdapter?.normalizeState?.(existingEntry?.notebookState) === 'planned'
        ? agentUi('status.openedPlanned')
        : agentUi('status.openedPage')
    );
  }

  function createPlannedPage(messageId = '', draftId = '') {
    const message = findMessage(messageId);
    const draft = findNotebookDraft(message?.meta, notebookDraftAdapter, draftId)?.draft;
    if (!draft || draft.save.mode !== 'confirm_before_save') {
      setStatus(agentUi('status.plannedUnavailable'));
      return false;
    }
    if (draft.save.status === 'rejected') return false;
    const result = notebookDraftAdapter?.createPlannedPage?.(
      draft,
      trimText(message?.meta?.requestText, 3000)
    );
    if (!result?.ok && result?.reason === 'missing_binding') {
      setStatus(agentUi('status.plannedMissing'));
      return false;
    }
    if (!result?.ok || !result.entry || !result.draft) {
      setStatus(agentUi('status.plannedUnavailable'));
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
    setStatus(agentUi(result.created ? 'status.plannedCreated' : 'status.openedPlanned'));
    return true;
  }

  function rejectPlannedPage(messageId = '', draftId = '') {
    const message = findMessage(messageId);
    const draft = findNotebookDraft(message?.meta, notebookDraftAdapter, draftId)?.draft;
    if (!draft || draft.save.mode !== 'confirm_before_save') {
      setStatus(agentUi('status.plannedRejectUnavailable'));
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
    setStatus(agentUi('status.plannedRejected'));
    return true;
  }

  return {
    createPlannedPage,
    openNotebookPage,
    rejectPlannedPage
  };
}
