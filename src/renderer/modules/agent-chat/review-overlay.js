import { asArray, trimText } from './shared.js';

function getProtocolReviewStatus(meta = {}, reviewId = '') {
  const review = meta.protocolReview && typeof meta.protocolReview === 'object'
    ? meta.protocolReview
    : {};
  return trimText(review[reviewId]?.status || review[reviewId], 40);
}


function markProtocolReview(messages, messageId, reviewId, status, reason = '') {
  const normalizedMessageId = trimText(messageId, 120);
  const message = asArray(messages).find((item) => trimText(item?.id, 120) === normalizedMessageId);
  if (!message || message.role !== 'assistant') {
    return false;
  }
  const currentMeta = message.meta && typeof message.meta === 'object' ? message.meta : {};
  message.meta = {
    ...currentMeta,
    protocolReview: {
      ...(currentMeta.protocolReview && typeof currentMeta.protocolReview === 'object' ? currentMeta.protocolReview : {}),
      [reviewId]: {
        status,
        reason: trimText(reason, 320),
        reviewed_at: new Date().toISOString()
      }
    }
  };
  return true;
}

function collectReviewItemsForMessage(message, {
  notebookDraftAdapter,
  protocolReviewAdapter
}) {
  const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
  const messageId = trimText(message?.id, 120);
  if (!messageId) {
    return [];
  }
  const items = [];
  const notebookDraft = notebookDraftAdapter?.normalizeDraft?.(meta.notebookDraft) || null;
  const existingNotebookEntry = notebookDraftAdapter?.findEntryForDraft?.(notebookDraft) || null;
  if (
    notebookDraft
    && notebookDraft.save.mode === 'confirm_before_save'
    && notebookDraft.save.applied !== true
    && trimText(notebookDraft.save.status, 80) !== 'rejected'
    && !existingNotebookEntry
  ) {
    const proposalId = notebookDraftAdapter?.resolveProposalId?.(notebookDraft) || '';
    items.push({
      id: `notebook:${messageId}:${proposalId || 'draft'}`,
      type: 'notebook',
      messageId,
      draft: notebookDraft
    });
  }

  const protocols = protocolReviewAdapter?.collectReviewProtocols?.(meta) || [];
  protocols.forEach((protocol, index) => {
    const reviewId = `protocol:${messageId}:${index + 1}`;
    const status = getProtocolReviewStatus(meta, reviewId);
    if (status === 'approved' || status === 'rejected') {
      return;
    }
    items.push({
      id: reviewId,
      type: 'protocol',
      messageId,
      protocol
    });
  });
  return items;
}

function renderList(items, safeText, emptyText = '') {
  const values = asArray(items).map((item) => trimText(item, 260)).filter(Boolean);
  if (!values.length) {
    return emptyText ? `<p class="agent-review-muted">${safeText(emptyText)}</p>` : '';
  }
  return `<ul>${values.map((item) => `<li>${safeText(item)}</li>`).join('')}</ul>`;
}

function renderProtocolPreview(item, safeText) {
  const protocol = item.protocol;
  return `
    <article class="agent-review-card" data-agent-review-card="${safeText(item.id)}">
      <div class="agent-review-card-header">
        <span class="agent-review-type">Protocol</span>
        <h4>${safeText(protocol.name)}</h4>
      </div>
      <div class="agent-review-content">
        ${protocol.purpose ? `
          <section class="agent-review-section">
            <h5>Purpose</h5>
            <p>${safeText(protocol.purpose)}</p>
          </section>
        ` : ''}
        <section class="agent-review-section">
          <h5>Materials</h5>
          ${renderList(protocol.materials, safeText, 'No materials listed.')}
        </section>
        <section class="agent-review-section">
          <h5>Steps</h5>
          <ol>${protocol.steps.map((step) => `<li>${safeText(step.text)}</li>`).join('')}</ol>
        </section>
        ${protocol.troubleshooting ? `
          <section class="agent-review-section">
            <h5>Troubleshooting</h5>
            <p>${safeText(protocol.troubleshooting)}</p>
          </section>
        ` : ''}
      </div>
      <div class="agent-review-actions">
        <button type="button" class="primary-btn" data-agent-review-approve="${safeText(item.id)}">Approve</button>
        <button type="button" class="ghost-btn" data-agent-review-reject="${safeText(item.id)}">Reject</button>
      </div>
    </article>
  `;
}

function renderNotebookPreview(item, safeText) {
  const draft = item.draft;
  const proposal = draft.proposal || {};
  const title = trimText(proposal.title || draft.entry_template?.result || 'Notebook draft', 220);
  const metaParts = [
    trimText(draft.project?.name || draft.entry_template?.projectName, 180),
    trimText(draft.protocol?.name || draft.entry_template?.protocolName, 220)
  ].filter(Boolean);
  return `
    <article class="agent-review-card" data-agent-review-card="${safeText(item.id)}">
      <div class="agent-review-card-header">
        <span class="agent-review-type">Notebook Page</span>
        <h4>${safeText(title)}</h4>
        ${metaParts.length ? `<p>${safeText(metaParts.join(' / '))}</p>` : ''}
      </div>
      <div class="agent-review-content">
        ${proposal.purpose ? `
          <section class="agent-review-section">
            <h5>Purpose</h5>
            <p>${safeText(proposal.purpose)}</p>
          </section>
        ` : ''}
        ${proposal.rationale ? `
          <section class="agent-review-section">
            <h5>Rationale</h5>
            <p>${safeText(proposal.rationale)}</p>
          </section>
        ` : ''}
        <section class="agent-review-section">
          <h5>Materials</h5>
          ${renderList(proposal.planned_materials, safeText, 'No materials listed.')}
        </section>
        <section class="agent-review-section">
          <h5>Planned Steps</h5>
          ${draft.rendered_steps.length
            ? `<ol>${draft.rendered_steps.map((step) => `<li>${safeText(step)}</li>`).join('')}</ol>`
            : '<p class="agent-review-muted">No rendered steps were supplied.</p>'}
        </section>
        ${draft.unresolved_placeholders.length ? `
          <section class="agent-review-section">
            <h5>Needs Attention</h5>
            <ul>${draft.unresolved_placeholders.map((placeholder) => `<li>${safeText(placeholder.display || placeholder.placeholder_key || placeholder.reason)}</li>`).join('')}</ul>
          </section>
        ` : ''}
        ${proposal.checkpoints.length ? `
          <section class="agent-review-section">
            <h5>Checkpoints</h5>
            ${renderList(proposal.checkpoints, safeText)}
          </section>
        ` : ''}
      </div>
      <div class="agent-review-actions">
        <button type="button" class="primary-btn" data-agent-review-approve="${safeText(item.id)}">Approve</button>
        <button type="button" class="ghost-btn" data-agent-review-reject="${safeText(item.id)}">Reject</button>
      </div>
    </article>
  `;
}

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
  protocolReviewAdapter
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
    dom.reviewTrack.innerHTML = reviewItems.map((item) => (
      item.type === 'protocol'
        ? renderProtocolPreview(item, safeText)
        : renderNotebookPreview(item, safeText)
    )).join('');
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
