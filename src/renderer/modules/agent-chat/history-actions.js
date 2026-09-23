import { createNotebookHistoryActions } from './history-notebook-actions.js';
import { setNotebookAppendInFlight } from './review-overlay/review-status.js';
import { trimText } from './shared.js';

function getNotebookAppendFromMessage(message) {
  const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
  const append = meta.notebookAppend && typeof meta.notebookAppend === 'object'
    ? meta.notebookAppend
    : (meta.notebook_append && typeof meta.notebook_append === 'object' ? meta.notebook_append : null);
  return append?.proposal?.content_markdown ? append : null;
}

function markNotebookAppendMessage(message, status, reason = '') {
  const currentAppend = getNotebookAppendFromMessage(message);
  if (!currentAppend) {
    return false;
  }
  const nextAppend = {
    ...currentAppend,
    save: {
      ...(currentAppend.save && typeof currentAppend.save === 'object' ? currentAppend.save : {}),
      applied: status === 'approved',
      status,
      reason: trimText(reason, 500),
      reviewed_at: new Date().toISOString()
    }
  };
  message.meta = {
    ...message.meta,
    notebook_append: nextAppend,
    notebookAppend: nextAppend
  };
  return true;
}

export function createHistoryActionController({
  api,
  state,
  persist,
  setStatus,
  renderContextSummary,
  renderHistoryView,
  answerAssistantQuestion,
  notebookDraftAdapter,
  onOpenNotebookEntry,
  openReviewForMessage = () => {},
  reviewInline = () => {},
  onAppendNotebookEntry = async () => ({ ok: false, error: 'Notebook append is unavailable.' })
}) {
  const notebookActions = createNotebookHistoryActions({
    state,
    persist,
    setStatus,
    renderContextSummary,
    renderHistoryView,
    notebookDraftAdapter,
    onOpenNotebookEntry
  });

  function findMessage(messageId = '') {
    const normalizedMessageId = trimText(messageId, 120);
    return state.agentChat?.messages?.find?.((item) => trimText(item?.id, 120) === normalizedMessageId) || null;
  }

  async function approveNotebookAppend(messageId = '') {
    const message = findMessage(messageId);
    const append = getNotebookAppendFromMessage(message);
    if (!append || append.save?.mode !== 'confirm_before_append') {
      setStatus('Notebook append proposal is unavailable.');
      return { ok: false, error: 'Notebook append proposal is unavailable.' };
    }
    // Hides both the Append and Reject buttons while the save runs, so the flag
    // has to be cleared on every exit, including a throw, or the card is stuck.
    setNotebookAppendInFlight(append, true);
    renderHistoryView({ forceScroll: true });
    let result = null;
    try {
      result = await onAppendNotebookEntry(append.proposal);
    } catch (error) {
      result = { ok: false, error: trimText(error?.message || error, 500) };
    } finally {
      setNotebookAppendInFlight(append, false);
    }
    if (result?.ok !== true) {
      const error = trimText(result?.error, 500) || 'The notebook append could not be applied.';
      renderHistoryView({ forceScroll: true });
      setStatus(error);
      return result || { ok: false, error: 'The notebook append could not be applied.' };
    }
    // Applying the append can refresh notebook and chat state while this handler
    // is awaiting. Reacquire the live message so approval is not written to an
    // object that is no longer part of state.agentChat.messages.
    markNotebookAppendMessage(
      findMessage(messageId) || message,
      'approved',
      trimText(result?.summary, 500) || 'Notebook append approved by user.'
    );
    persist();
    renderContextSummary();
    renderHistoryView({ forceScroll: true });
    setStatus(trimText(result?.summary, 320) || 'Content appended to notebook page.');
    return result;
  }

  function rejectNotebookAppend(messageId = '') {
    const message = findMessage(messageId);
    const append = getNotebookAppendFromMessage(message);
    if (!append || append.save?.mode !== 'confirm_before_append') {
      setStatus('Notebook append proposal is unavailable.');
      return false;
    }
    markNotebookAppendMessage(message, 'rejected', 'Notebook append rejected by user.');
    persist();
    renderHistoryView({ forceScroll: true });
    setStatus('Notebook append rejected.');
    return true;
  }

  async function onHistoryClick(event) {
    const copyButton = event?.target?.closest?.('[data-agent-copy-message]');
    if (copyButton) {
      const text = findMessage(copyButton.dataset.agentCopyMessage)?.text || '';
      try {
        const result = await api?.writeTextToClipboard?.(text);
        if (result?.ok !== true) throw new Error(result?.error || 'Text clipboard is unavailable.');
        copyButton.setAttribute('aria-label', 'Response copied');
        copyButton.setAttribute('title', 'Response copied');
      } catch (error) {
        setStatus(trimText(error?.message, 320) || 'Could not copy response.');
      }
      return;
    }
    const inlineButton = event?.target?.closest?.('[data-agent-inline-approve], [data-agent-inline-reject]');
    if (inlineButton) {
      const messageId = inlineButton.closest('[data-agent-review-message-id]')?.dataset.agentReviewMessageId;
      const approve = Boolean(inlineButton.dataset.agentInlineApprove);
      reviewInline(messageId, inlineButton.dataset.agentInlineApprove || inlineButton.dataset.agentInlineReject, approve ? 'approve' : 'reject');
      return;
    }
    const rejectDraftButton = event?.target?.closest?.('[data-agent-reject-planned-page]');
    if (rejectDraftButton) {
      notebookActions.rejectPlannedPage(rejectDraftButton.dataset.agentRejectPlannedPage, rejectDraftButton.dataset.agentDraftId);
      return;
    }
    const reviewMessageButton = event?.target?.closest?.('[data-agent-review-message]')
      || (event?.target?.dataset?.agentReviewMessage ? event.target : null);
    if (reviewMessageButton) {
      event?.preventDefault?.();
      const messageId = trimText(reviewMessageButton.dataset.agentReviewMessage, 120);
      const message = state.agentChat?.messages?.find?.((item) => trimText(item?.id, 120) === messageId) || null;
      if (message) {
        openReviewForMessage(message);
      }
      return;
    }

    const appendNotebookButton = event?.target?.closest?.('[data-agent-append-notebook]')
      || (event?.target?.dataset?.agentAppendNotebook ? event.target : null);
    if (appendNotebookButton) {
      await approveNotebookAppend(appendNotebookButton.dataset.agentAppendNotebook);
      return;
    }

    const rejectNotebookAppendButton = event?.target?.closest?.('[data-agent-reject-notebook-append]')
      || (event?.target?.dataset?.agentRejectNotebookAppend ? event.target : null);
    if (rejectNotebookAppendButton) {
      rejectNotebookAppend(rejectNotebookAppendButton.dataset.agentRejectNotebookAppend);
      return;
    }

    const questionOptionButton = event?.target?.closest?.('[data-agent-question-option]')
      || (event?.target?.dataset?.agentQuestionOption ? event.target : null);
    if (questionOptionButton) {
      const messageId = trimText(questionOptionButton.dataset.agentQuestionOption, 120);
      const answer = trimText(questionOptionButton.dataset.agentQuestionAnswer, 3000)
        || trimText(questionOptionButton.textContent, 3000);
      await answerAssistantQuestion(messageId, answer);
      return;
    }

    const questionSubmitButton = event?.target?.closest?.('[data-agent-question-submit]')
      || (event?.target?.dataset?.agentQuestionSubmit ? event.target : null);
    if (questionSubmitButton) {
      const messageId = trimText(questionSubmitButton.dataset.agentQuestionSubmit, 120);
      const card = questionSubmitButton.closest?.('[data-agent-user-question-card]');
      const answerInput = card?.querySelector?.('[data-agent-question-custom-input]');
      await answerAssistantQuestion(messageId, trimText(answerInput?.value, 3000));
      return;
    }

    const externalButton = event?.target?.closest?.('[data-agent-open-external-url]')
      || (event?.target?.dataset?.agentOpenExternalUrl ? event.target : null);
    if (externalButton) {
      const url = trimText(externalButton.dataset.agentOpenExternalUrl, 2000);
      if (!url) {
        return;
      }
      if (!api?.openExternalUrl) {
        setStatus('External link opening is unavailable in this build.');
        return;
      }
      const result = await api.openExternalUrl(url);
      setStatus(result?.ok === true ? 'Opened product page.' : (trimText(result?.error, 320) || 'Failed to open product page.'));
      return;
    }

    const openNotebookButton = event?.target?.closest?.('[data-agent-open-notebook-page]')
      || (event?.target?.dataset?.agentOpenNotebookPage ? event.target : null);
    if (openNotebookButton) {
      notebookActions.openNotebookPage(openNotebookButton.dataset.agentOpenNotebookPage, openNotebookButton.dataset.agentDraftId);
      return;
    }

    const createButton = event?.target?.closest?.('[data-agent-create-planned-page]')
      || (event?.target?.dataset?.agentCreatePlannedPage ? event.target : null);
    if (createButton) {
      notebookActions.createPlannedPage(createButton.dataset.agentCreatePlannedPage, createButton.dataset.agentDraftId);
    }
  }

  return {
    onHistoryClick,
    notebookActions,
    notebookAppendActions: {
      approve: approveNotebookAppend,
      reject: rejectNotebookAppend
    }
  };
}
