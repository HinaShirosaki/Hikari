import {
  findNotebookEntryForDraft,
  normalizeNotebookDraft,
  resolveNotebookDraftProposalId
} from './notebook-drafts.js';
import { asArray, trimText } from './shared.js';

function looksLikeProtocol(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value.protocol || value.name || value.title)
    && (Array.isArray(value.steps) || Array.isArray(value.procedure))
  );
}

function normalizeStepEntries(rawSteps = []) {
  return asArray(rawSteps)
    .map((step, index) => {
      if (typeof step === 'string') {
        const text = trimText(step, 2000);
        return text ? { id: `step-${index + 1}`, text, placeholders: [] } : null;
      }
      const source = step && typeof step === 'object' && !Array.isArray(step) ? step : {};
      const text = trimText(source.text || source.instruction || source.action || source.description, 2000);
      if (!text) {
        return null;
      }
      return {
        id: trimText(source.id, 120) || `step-${index + 1}`,
        text,
        placeholders: asArray(source.placeholders)
          .map((placeholder, placeholderIndex) => {
            const placeholderSource = placeholder && typeof placeholder === 'object' && !Array.isArray(placeholder)
              ? placeholder
              : {};
            const name = trimText(placeholderSource.name || placeholderSource.label, 160);
            if (!name) {
              return null;
            }
            return {
              id: trimText(placeholderSource.id, 120) || `ph-${index + 1}-${placeholderIndex + 1}`,
              name
            };
          })
          .filter(Boolean)
      };
    })
    .filter(Boolean)
    .slice(0, 160);
}

function normalizeMaterials(rawMaterials) {
  if (Array.isArray(rawMaterials)) {
    return rawMaterials.map((item) => trimText(item, 220)).filter(Boolean).slice(0, 80);
  }
  return trimText(rawMaterials, 6000)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 80);
}

function normalizeTroubleshooting(rawTroubleshooting) {
  if (Array.isArray(rawTroubleshooting)) {
    return rawTroubleshooting
      .map((item) => {
        if (typeof item === 'string') {
          return trimText(item, 1200);
        }
        const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
        return [
          trimText(source.problem, 400) ? `Problem: ${trimText(source.problem, 400)}` : '',
          trimText(source.possible_cause || source.possibleCause, 400)
            ? `Possible cause: ${trimText(source.possible_cause || source.possibleCause, 400)}`
            : '',
          trimText(source.solution, 400) ? `Solution: ${trimText(source.solution, 400)}` : ''
        ].filter(Boolean).join('; ');
      })
      .filter(Boolean)
      .join('\n');
  }
  return trimText(rawTroubleshooting, 6000);
}

function normalizeGeneratedProtocol(rawProtocol) {
  const source = rawProtocol && typeof rawProtocol === 'object' && !Array.isArray(rawProtocol)
    ? rawProtocol
    : {};
  const steps = normalizeStepEntries(source.steps || source.procedure);
  const name = trimText(source.name || source.title || source.protocol_name || source.protocolName, 220);
  if (!name || !steps.length) {
    return null;
  }
  return {
    id: trimText(source.id || source.protocol_id || source.protocolId, 220),
    name,
    purpose: trimText(source.purpose || source.description, 1200),
    materials: normalizeMaterials(source.materials),
    steps,
    troubleshooting: normalizeTroubleshooting(source.troubleshooting),
    aliases: asArray(source.aliases).map((alias) => trimText(alias, 120)).filter(Boolean),
    projectId: trimText(source.projectId || source.project_id, 120),
    projectName: trimText(source.projectName || source.project_name, 220),
    createdAt: trimText(source.createdAt, 80),
    updatedAt: trimText(source.updatedAt, 80)
  };
}

function collectProtocolPayloads(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return [];
  }
  const protocols = [];
  const seen = new Set();
  const pushProtocol = (candidate) => {
    const protocol = normalizeGeneratedProtocol(candidate);
    if (protocol) {
      const key = [
        trimText(protocol.id, 220),
        trimText(protocol.name, 220).toLowerCase(),
        protocol.steps.map((step) => trimText(step.text, 220)).join('|')
      ].join(':');
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      protocols.push(protocol);
    }
  };

  if (Array.isArray(source.protocols)) {
    source.protocols.forEach(pushProtocol);
  }
  if (Array.isArray(source.items)) {
    source.items.forEach((item) => {
      if (looksLikeProtocol(item?.protocol)) {
        pushProtocol(item.protocol);
      } else if (looksLikeProtocol(item)) {
        pushProtocol(item);
      }
    });
  }
  if (looksLikeProtocol(source.protocol)) {
    pushProtocol(source.protocol);
  } else if (looksLikeProtocol(source)) {
    pushProtocol(source);
  }
  return protocols;
}

function collectProtocolGenerationPayloads(meta = {}) {
  const sources = [
    meta.protocol_generation,
    meta.protocolGeneration,
    meta.generated_protocol ? { protocol: meta.generated_protocol } : null,
    meta.generatedProtocol ? { protocol: meta.generatedProtocol } : null,
    meta.codex_agent?.protocol_generation,
    meta.codex_agent?.protocolGeneration
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  return sources.flatMap(collectProtocolPayloads);
}

function getProtocolReviewStatus(meta = {}, reviewId = '') {
  const review = meta.protocolReview && typeof meta.protocolReview === 'object'
    ? meta.protocolReview
    : {};
  return trimText(review[reviewId]?.status || review[reviewId], 40);
}

function buildUniqueProtocolName(baseName = '', protocols = []) {
  const takenNames = new Set(
    asArray(protocols)
      .map((item) => trimText(item?.name, 220).toLowerCase())
      .filter(Boolean)
  );
  const base = trimText(baseName, 220) || 'Generated protocol';
  if (!takenNames.has(base.toLowerCase())) {
    return base;
  }
  const suffixedBase = `${base} (Agent Generated)`;
  let candidate = suffixedBase;
  let suffix = 2;
  while (takenNames.has(candidate.toLowerCase())) {
    candidate = `${suffixedBase} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function normalizeIsoTimestamp(rawValue, fallback = '') {
  const candidate = trimText(rawValue, 120);
  if (!candidate) {
    return fallback;
  }
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) {
    return fallback;
  }
  return new Date(timestamp).toISOString();
}

function buildProtocolRecord(protocol, { state, createId }) {
  const nowIso = new Date().toISOString();
  const existingIds = new Set(asArray(state.protocols).map((item) => trimText(item?.id, 220)).filter(Boolean));
  const requestedId = trimText(protocol.id, 220);
  const id = requestedId && !existingIds.has(requestedId)
    ? requestedId
    : trimText(createId?.(), 220) || `agent-protocol-${Date.now().toString(36)}`;
  const createdAt = normalizeIsoTimestamp(protocol.createdAt, nowIso) || nowIso;
  const updatedAt = normalizeIsoTimestamp(protocol.updatedAt, nowIso) || nowIso;
  return {
    id,
    name: buildUniqueProtocolName(protocol.name, state.protocols),
    createdAt,
    updatedAt,
    purpose: protocol.purpose,
    materials: protocol.materials,
    steps: protocol.steps,
    troubleshooting: protocol.troubleshooting,
    ...(protocol.aliases.length ? { aliases: protocol.aliases } : {}),
    ...(protocol.projectId ? { projectId: protocol.projectId } : {}),
    ...(protocol.projectName ? { projectName: protocol.projectName } : {})
  };
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

function collectReviewItemsForMessage(message, { state }) {
  const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
  const messageId = trimText(message?.id, 120);
  if (!messageId) {
    return [];
  }
  const items = [];
  const notebookDraft = normalizeNotebookDraft(meta.notebookDraft);
  const existingNotebookEntry = findNotebookEntryForDraft(state.notebookEntries, notebookDraft);
  if (
    notebookDraft
    && notebookDraft.save.mode === 'confirm_before_save'
    && notebookDraft.save.applied !== true
    && trimText(notebookDraft.save.status, 80) !== 'rejected'
    && !existingNotebookEntry
  ) {
    const proposalId = resolveNotebookDraftProposalId(notebookDraft);
    items.push({
      id: `notebook:${messageId}:${proposalId || 'draft'}`,
      type: 'notebook',
      messageId,
      draft: notebookDraft
    });
  }

  collectProtocolGenerationPayloads(meta).forEach((protocol, index) => {
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
  createId,
  safeText,
  setStatus,
  renderContextSummary,
  renderHistoryView,
  notebookActions,
  onProtocolsChanged
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
    const protocol = buildProtocolRecord(item.protocol, { state, createId });
    state.protocols = asArray(state.protocols);
    state.protocols.push(protocol);
    markProtocolReview(state.agentChat?.messages, item.messageId, item.id, 'approved', 'Generated protocol approved by user.');
    persist();
    renderContextSummary?.();
    renderHistoryView?.({ forceScroll: true });
    try {
      onProtocolsChanged?.();
    } catch {
      // Keep review dialog responsive if a downstream module is not mounted.
    }
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
    const nextItems = collectReviewItemsForMessage(message, { state });
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
    collectReviewItemsForMessage: (message) => collectReviewItemsForMessage(message, { state })
  };
}
