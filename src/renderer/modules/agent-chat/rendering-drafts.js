import { asArray, trimText } from './shared.js';
import { renderAgentChatIcon } from './icons.js';
import { getProtocolReviewStatus, resolveNotebookAppendReviewState } from './review-overlay/review-status.js';
import { renderNotebookAppendPreview, renderNotebookPreview, renderProtocolPreview } from './review-overlay/review-previews.js';

function renderCard({ key, title, kind, status, preview, className = '' }, safeText) {
  return `<details class="agent-output-card agent-draft-card ${className}" data-agent-card-key="${safeText(key)}">
    <summary class="agent-output-summary">
      <span class="agent-output-icon" aria-hidden="true">${renderAgentChatIcon('draft', { className: 'agent-output-icon-glyph' })}</span>
      <span class="agent-output-copy"><strong>${safeText(title)}</strong><span>${safeText(kind)} · ${safeText(status)}</span></span>
      <span class="agent-output-toggle"><span class="agent-output-show">Review draft</span><span class="agent-output-hide">Close preview</span><span class="agent-output-disclosure" aria-hidden="true">${renderAgentChatIcon('chevron-right')}</span></span>
    </summary>
    ${preview}
  </details>`;
}

function action(attribute, id, label, safeText, primary = false) {
  return `<button type="button" class="${primary ? 'primary-btn' : 'ghost-btn'}" ${attribute}="${safeText(id)}">${safeText(label)}</button>`;
}

export function renderDraftCards(meta, messageId, { safeText, notebookDraftAdapter, protocolReviewAdapter, notebookEntries = [] }) {
  const id = trimText(messageId, 120);
  if (!id) return '';
  const sections = [];
  const draft = notebookDraftAdapter?.normalizeDraft?.(meta.notebookDraft) || null;
  const entry = notebookDraftAdapter?.findEntryForDraft?.(draft) || null;
  if (draft && (draft.save?.mode === 'confirm_before_save' || entry)) {
    const rejected = draft.save?.status === 'rejected';
    const saved = Boolean(entry) || draft.save?.applied === true;
    const pending = !saved && !rejected;
    const openLabel = notebookDraftAdapter?.normalizeState?.(entry?.notebookState) === 'planned' ? 'Open Planned Page' : 'Open Notebook Page';
    const actions = entry ? action('data-agent-open-notebook-page', id, openLabel, safeText)
      : pending ? action('data-agent-reject-planned-page', id, 'Reject', safeText)
        + action('data-agent-create-planned-page', id, 'Create Planned Page', safeText, true) : '';
    sections.push(renderCard({
      key: `notebook:${id}`,
      title: trimText(draft.proposal?.title || draft.entry_template?.result, 220) || 'Notebook draft',
      kind: 'Notebook page', status: saved ? 'Created' : rejected ? 'Rejected' : 'Review required',
      preview: renderNotebookPreview({ id: `notebook:${id}`, draft }, safeText, { inline: true, actions })
    }, safeText));
  }
  const appendState = resolveNotebookAppendReviewState(meta, notebookEntries);
  const append = appendState.append;
  if (append?.proposal?.content_markdown && append.save?.mode === 'confirm_before_append') {
    const pending = !appendState.applied && !['rejected', 'applying'].includes(appendState.status);
    const status = appendState.applied ? 'Appended to page' : appendState.status === 'rejected' ? 'Rejected'
      : appendState.status === 'applying' ? 'Appending to page…' : 'Review before appending';
    const actions = pending ? action('data-agent-reject-notebook-append', id, 'Reject', safeText)
      + action('data-agent-append-notebook', id, 'Append to Page', safeText, true) : '';
    sections.push(renderCard({
      key: `append:${id}`, title: trimText(append.proposal.section_title, 220) || 'Suggested notebook enrichment',
      kind: 'Notebook append', status, className: 'agent-notebook-append-card',
      preview: renderNotebookAppendPreview({ id: `append:${id}`, append }, safeText, { inline: true, actions })
    }, safeText));
  }
  asArray(protocolReviewAdapter?.collectReviewProtocols?.(meta)).forEach((protocol, index) => {
    const reviewId = `protocol:${id}:${index + 1}`;
    const status = getProtocolReviewStatus(meta, reviewId);
    const pending = !['approved', 'rejected'].includes(status);
    const actions = pending ? `<div class="agent-inline-protocol-actions" data-agent-review-message-id="${safeText(id)}">
      ${action('data-agent-inline-reject', reviewId, 'Reject', safeText)}
      ${action('data-agent-inline-approve', reviewId, 'Add to protocols', safeText, true)}
    </div>` : '';
    sections.push(renderCard({
      key: reviewId, title: protocol.name || 'Protocol draft', kind: 'Protocol',
      status: status === 'approved' ? 'Added to protocols' : status === 'rejected' ? 'Rejected' : 'Review required',
      preview: renderProtocolPreview({ id: reviewId, protocol }, safeText, { inline: true, actions })
    }, safeText));
  });
  return sections.join('');
}
