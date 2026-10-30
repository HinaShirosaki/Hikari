import { asArray, trimText } from './shared.js';
import { collectNotebookDrafts } from './notebook-draft-list.js';
import { renderAgentChatIcon } from './icons.js';
import { agentMessage } from './localization.js';
import { getProtocolReviewStatus, resolveNotebookAppendReviewState } from './review-overlay/review-status.js';
import { renderNotebookAppendPreview, renderNotebookPreview, renderProtocolPreview } from './review-overlay/review-previews.js';

// kind/status are agent catalog keys; titles come from the draft and stay literal.
function renderCard({ key, title, titleKey = '', kind, status, preview, className = '', reviewMessageId = '' }, safeText) {
  const reviewTrigger = reviewMessageId
    ? ` data-agent-review-message="${safeText(reviewMessageId)}" aria-haspopup="dialog"`
    : '';
  return `<details class="agent-output-card agent-draft-card ${className}" data-agent-card-key="${safeText(key)}">
    <summary class="agent-output-summary"${reviewTrigger}>
      <span class="agent-output-icon" aria-hidden="true">${renderAgentChatIcon('draft', { className: 'agent-output-icon-glyph' })}</span>
      <span class="agent-output-copy"><strong>${title ? safeText(title) : agentMessage(titleKey)}</strong><span>${agentMessage(kind)} · ${agentMessage(status)}</span></span>
      <span class="agent-output-toggle"><span class="agent-output-show">${agentMessage('draft.review')}</span><span class="agent-output-hide">${agentMessage('draft.close')}</span><span class="agent-output-disclosure" aria-hidden="true">${renderAgentChatIcon('chevron-right')}</span></span>
    </summary>
    ${preview}
  </details>`;
}

function action(attribute, id, labelKey, safeText, primary = false, draftId = '') {
  return `<button type="button" class="${primary ? 'primary-btn' : 'ghost-btn'}" ${attribute}="${safeText(id)}"${draftId ? ` data-agent-draft-id="${safeText(draftId)}"` : ''}>${agentMessage(labelKey)}</button>`;
}

export function renderDraftCards(meta, messageId, { safeText, notebookDraftAdapter, protocolReviewAdapter, notebookEntries = [] }) {
  const id = trimText(messageId, 120);
  if (!id) return '';
  const sections = [];
  for (const { draft, draftId } of collectNotebookDrafts(meta, notebookDraftAdapter)) {
    const entry = notebookDraftAdapter?.findEntryForDraft?.(draft) || null;
    if (draft && (draft.save?.mode === 'confirm_before_save' || entry)) {
      const rejected = draft.save?.status === 'rejected';
      const saved = Boolean(entry) || draft.save?.applied === true;
      const pending = !saved && !rejected;
      const openLabel = notebookDraftAdapter?.normalizeState?.(entry?.notebookState) === 'planned' ? 'draft.openPlanned' : 'draft.openPage';
      const actions = entry ? action('data-agent-open-notebook-page', id, openLabel, safeText, false, draftId)
        : pending ? action('data-agent-reject-planned-page', id, 'draft.reject', safeText, false, draftId)
          + action('data-agent-create-planned-page', id, 'draft.createPlanned', safeText, true, draftId) : '';
      sections.push(renderCard({
        key: `notebook:${id}:${draftId}`,
        title: trimText(draft.proposal?.title || draft.entry_template?.result, 220), titleKey: 'draft.notebookTitle',
        kind: 'draft.notebookKind', status: saved ? 'draft.created' : rejected ? 'draft.rejected' : 'draft.reviewRequired',
        preview: renderNotebookPreview({ id: `notebook:${id}:${draftId}`, draft }, safeText, { inline: true, actions }),
        reviewMessageId: pending ? id : ''
      }, safeText));
    }
  }
  const appendState = resolveNotebookAppendReviewState(meta, notebookEntries);
  const append = appendState.append;
  if (append?.proposal?.content_markdown && append.save?.mode === 'confirm_before_append') {
    const pending = !appendState.applied && !['rejected', 'applying'].includes(appendState.status);
    const status = appendState.applied ? 'draft.appended' : appendState.status === 'rejected' ? 'draft.rejected'
      : appendState.status === 'applying' ? 'draft.appending' : 'draft.reviewAppend';
    const actions = pending ? action('data-agent-reject-notebook-append', id, 'draft.reject', safeText)
      + action('data-agent-append-notebook', id, 'draft.appendToPage', safeText, true) : '';
    sections.push(renderCard({
      key: `append:${id}`, title: trimText(append.proposal.section_title, 220), titleKey: 'draft.appendTitle',
      kind: 'draft.appendKind', status, className: 'agent-notebook-append-card',
      preview: renderNotebookAppendPreview({ id: `append:${id}`, append }, safeText, { inline: true, actions }),
      reviewMessageId: pending ? id : ''
    }, safeText));
  }
  asArray(protocolReviewAdapter?.collectReviewProtocols?.(meta)).forEach((protocol, index) => {
    const reviewId = `protocol:${id}:${index + 1}`;
    const status = getProtocolReviewStatus(meta, reviewId);
    const pending = !['approved', 'rejected'].includes(status);
    const actions = pending ? `<div class="agent-inline-protocol-actions" data-agent-review-message-id="${safeText(id)}">
      ${action('data-agent-inline-reject', reviewId, 'draft.reject', safeText)}
      ${action('data-agent-inline-approve', reviewId, 'draft.addProtocol', safeText, true)}
    </div>` : '';
    sections.push(renderCard({
      key: reviewId, title: protocol.name || '', titleKey: 'draft.protocolTitle', kind: 'draft.protocolKind',
      status: status === 'approved' ? 'draft.protocolAdded' : status === 'rejected' ? 'draft.rejected' : 'draft.reviewRequired',
      preview: renderProtocolPreview({ id: reviewId, protocol }, safeText, { inline: true, actions }),
      reviewMessageId: pending ? id : ''
    }, safeText));
  });
  return sections.join('');
}
