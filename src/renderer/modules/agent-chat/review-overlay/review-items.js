import { trimText } from '../shared.js';
import { getNotebookAppend, getProtocolReviewStatus, getSequenceEditReviewStatus } from './review-status.js';

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


  const notebookAppend = getNotebookAppend(meta);
  if (
    notebookAppend
    && notebookAppend.save?.mode === 'confirm_before_append'
    && notebookAppend.save?.applied !== true
    && trimText(notebookAppend.save?.status, 80) !== 'rejected'
  ) {
    const proposalId = trimText(notebookAppend?.proposal?.proposal_id, 200) || 'append';
    items.push({
      id: `notebook-append:${messageId}:${proposalId}`,
      type: 'notebook-append',
      messageId,
      append: notebookAppend
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

  const sequenceProposals = meta.sequenceEditProposal && typeof meta.sequenceEditProposal === 'object'
    ? meta.sequenceEditProposal
    : {};
  Object.keys(sequenceProposals).forEach((token) => {
    const proposal = sequenceProposals[token];
    if (!proposal || typeof proposal !== 'object') {
      return;
    }
    const status = getSequenceEditReviewStatus(meta, token);
    if (status === 'approved' || status === 'rejected') {
      return;
    }
    items.push({
      id: `sequence-edit:${messageId}:${token}`,
      type: 'sequence-edit',
      messageId,
      token,
      proposal
    });
  });
  return items;
}

export {
  collectReviewItemsForMessage
};
