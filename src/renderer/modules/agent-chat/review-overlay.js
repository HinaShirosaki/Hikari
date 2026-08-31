import { trimText } from './shared.js';
import { verifyAndApplySequenceProposal } from '../sequence-viewer/agent/bridge.js';
import { collectReviewItemsForMessage } from './review-overlay/review-items.js';
import { renderNotebookAppendPreview, renderNotebookPreview, renderProtocolPreview, renderSequenceEditPreview } from './review-overlay/review-previews.js';
import { markNotebookAppendReview, markProtocolReview, markSequenceEditReview } from './review-overlay/review-status.js';

export function createAgentReviewOverlayController({
  dom,
  state,
  persist,
  safeText,
  setStatus,
  renderContextSummary,
  renderHistoryView,
  notebookActions,
  notebookDraftAdapter,
  protocolReviewAdapter,
  onAppendNotebookEntry = async () => ({ ok: false, error: 'Notebook append is unavailable.' })
}) {
  let reviewItems = [];
  let activeIndex = 0;

  function close() {
    reviewItems = [];
    activeIndex = 0;
    if (dom.reviewOverlay) {
      dom.reviewOverlay.hidden = true;
    }
    if (dom.reviewTrack) {
      dom.reviewTrack.innerHTML = '';
    }
    if (dom.reviewPageLabel) {
      dom.reviewPageLabel.textContent = '';
    }
  }

  function syncActiveCard() {
    if (!dom.reviewTrack?.querySelectorAll) {
      return;
    }
    const card = dom.reviewTrack.querySelectorAll('[data-agent-review-card]')?.[activeIndex];
    if (card?.scrollIntoView) {
      card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  function render() {
    if (!dom.reviewOverlay || !dom.reviewTrack) {
      return;
    }
    if (!reviewItems.length) {
      close();
      return;
    }
    activeIndex = Math.min(Math.max(activeIndex, 0), reviewItems.length - 1);
    dom.reviewOverlay.hidden = false;
    dom.reviewTrack.innerHTML = reviewItems.map((item) => {
      if (item.type === 'protocol') {
        return renderProtocolPreview(item, safeText);
      }
      if (item.type === 'sequence-edit') {
        return renderSequenceEditPreview(item, safeText);
      }
      if (item.type === 'notebook-append') {
        return renderNotebookAppendPreview(item, safeText);
      }
      return renderNotebookPreview(item, safeText);
    }).join('');
    if (dom.reviewPageLabel) {
      dom.reviewPageLabel.textContent = `${activeIndex + 1} / ${reviewItems.length}`;
    }
    if (dom.reviewPrevBtn) {
      dom.reviewPrevBtn.disabled = activeIndex <= 0;
    }
    if (dom.reviewNextBtn) {
      dom.reviewNextBtn.disabled = activeIndex >= reviewItems.length - 1;
    }
    syncActiveCard();
  }

  function removeItem(itemId) {
    reviewItems = reviewItems.filter((item) => item.id !== itemId);
    if (activeIndex >= reviewItems.length) {
      activeIndex = Math.max(0, reviewItems.length - 1);
    }
    render();
  }

  function approveProtocol(item) {
    const protocol = protocolReviewAdapter?.approveGeneratedProtocol?.(item.protocol) || null;
    if (!protocol) {
      setStatus?.('Generated protocol could not be added.');
      return;
    }
    markProtocolReview(state.agentChat?.messages, item.messageId, item.id, 'approved', 'Generated protocol approved by user.');
    persist();
    renderContextSummary?.();
    renderHistoryView?.({ forceScroll: true });
    setStatus?.('Generated protocol added to Protocol Module.');
    removeItem(item.id);
  }

  function rejectProtocol(item) {
    markProtocolReview(state.agentChat?.messages, item.messageId, item.id, 'rejected', 'Generated protocol rejected by user.');
    persist();
    renderHistoryView?.({ forceScroll: true });
    setStatus?.('Generated protocol rejected.');
    removeItem(item.id);
  }

  function approveNotebook(item) {
    notebookActions?.createPlannedPage?.(item.messageId);
    removeItem(item.id);
  }

  function rejectNotebook(item) {
    notebookActions?.rejectPlannedPage?.(item.messageId);
    removeItem(item.id);
  }

  async function approveSequenceEdit(item) {
    const result = await verifyAndApplySequenceProposal(item.proposal);
    if (result?.error) {
      const code = trimText(result.error.code, 60);
      if (code === 'TARGET_CHANGED' || code === 'TARGET_NOT_FOUND') {
        setStatus?.('The record changed since this proposal; ask the agent to re-read and re-propose.');
      } else {
        setStatus?.(trimText(result.error.message, 320) || 'The proposed change could not be applied.');
      }
      return;
    }
    markSequenceEditReview(state.agentChat?.messages, item.messageId, item.token, 'approved', 'Sequence change approved by user.');
    persist();
    renderHistoryView?.({ forceScroll: true });
    setStatus?.(trimText(result?.summary, 320) || 'Sequence change applied.');
    removeItem(item.id);
  }

  function rejectSequenceEdit(item) {
    markSequenceEditReview(state.agentChat?.messages, item.messageId, item.token, 'rejected', 'Sequence change rejected by user.');
    persist();
    renderHistoryView?.({ forceScroll: true });
    setStatus?.('Sequence change rejected.');
    removeItem(item.id);
  }

  async function approveNotebookAppend(item) {
    const result = await onAppendNotebookEntry(item.append?.proposal || {});
    if (result?.ok !== true) {
      setStatus?.(trimText(result?.error, 500) || 'The notebook append could not be applied.');
      return;
    }
    markNotebookAppendReview(
      state.agentChat?.messages,
      item.messageId,
      'approved',
      trimText(result?.summary, 500) || 'Notebook append approved by user.'
    );
    persist();
    renderContextSummary?.();
    renderHistoryView?.({ forceScroll: true });
    setStatus?.(trimText(result?.summary, 320) || 'Content appended to notebook page.');
    removeItem(item.id);
  }

  function rejectNotebookAppend(item) {
    markNotebookAppendReview(
      state.agentChat?.messages,
      item.messageId,
      'rejected',
      'Notebook append rejected by user.'
    );
    persist();
    renderHistoryView?.({ forceScroll: true });
    setStatus?.('Notebook append rejected.');
    removeItem(item.id);
  }

  function findItem(itemId = '') {
    const normalizedItemId = trimText(itemId, 180);
    return reviewItems.find((item) => item.id === normalizedItemId) || null;
  }

  function approveItem(itemId = '') {
    const item = findItem(itemId);
    if (!item) {
      return;
    }
    if (item.type === 'protocol') {
      approveProtocol(item);
      return;
    }
    if (item.type === 'sequence-edit') {
      void approveSequenceEdit(item);
      return;
    }
    if (item.type === 'notebook-append') {
      void approveNotebookAppend(item);
      return;
    }
    approveNotebook(item);
  }

  function rejectItem(itemId = '') {
    const item = findItem(itemId);
    if (!item) {
      return;
    }
    if (item.type === 'protocol') {
      rejectProtocol(item);
      return;
    }
    if (item.type === 'sequence-edit') {
      rejectSequenceEdit(item);
      return;
    }
    if (item.type === 'notebook-append') {
      rejectNotebookAppend(item);
      return;
    }
    rejectNotebook(item);
  }

  function onTrackClick(event) {
    const target = event?.target;
    const approveButton = target?.closest?.('[data-agent-review-approve]')
      || (target?.dataset?.agentReviewApprove ? target : null);
    if (approveButton) {
      approveItem(approveButton.dataset.agentReviewApprove);
      return;
    }
    const rejectButton = target?.closest?.('[data-agent-review-reject]')
      || (target?.dataset?.agentReviewReject ? target : null);
    if (rejectButton) {
      rejectItem(rejectButton.dataset.agentReviewReject);
    }
  }

  function openForMessage(message) {
    const nextItems = collectReviewItemsForMessage(message, {
      notebookDraftAdapter,
      protocolReviewAdapter
    });
    if (!nextItems.length) {
      return;
    }
    const knownIds = new Set(reviewItems.map((item) => item.id));
    reviewItems = [
      ...reviewItems,
      ...nextItems.filter((item) => !knownIds.has(item.id))
    ];
    render();
  }

  dom.reviewTrack?.addEventListener?.('click', onTrackClick);
  dom.reviewCloseBtn?.addEventListener?.('click', close);
  dom.reviewOverlay?.addEventListener?.('click', (event) => {
    if (event?.target === dom.reviewOverlay) {
      close();
    }
  });
  dom.reviewPrevBtn?.addEventListener?.('click', () => {
    activeIndex = Math.max(0, activeIndex - 1);
    render();
  });
  dom.reviewNextBtn?.addEventListener?.('click', () => {
    activeIndex = Math.min(reviewItems.length - 1, activeIndex + 1);
    render();
  });

  return {
    close,
    openForMessage,
    render,
    approveItem,
    rejectItem,
    collectReviewItemsForMessage: (message) => collectReviewItemsForMessage(message, {
      notebookDraftAdapter,
      protocolReviewAdapter
    })
  };
}
