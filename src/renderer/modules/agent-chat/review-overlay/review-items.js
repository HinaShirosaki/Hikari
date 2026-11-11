import { trimText } from '../shared.js';
import { normalizeProtocolStepEdits } from '../../../../shared/protocol-step-edits.mjs';
import { collectNotebookDrafts } from '../notebook-draft-list.js';
import {
  getProtocolReviewStatus,
  resolveNotebookAppendReviewState
} from './review-status.js';

function collectProtocolEdits(meta, messageId) {
  if (!Array.isArray(meta.protocol_edits)) return [];
  return meta.protocol_edits.flatMap(proposal => {
    const proposalId = trimText(proposal?.proposal_id, 80);
    const stepEdits = normalizeProtocolStepEdits(proposal?.step_edits);
    if (!proposalId || !stepEdits || !['notebook_page', 'protocol'].includes(proposal.target_type)) return [];
    const id = `protocol-edit:${messageId}:${proposalId}`;
    return [{
      id, type: 'protocol-edit', messageId, proposal: { ...proposal, step_edits: stepEdits },
      status: getProtocolReviewStatus(meta, id)
    }];
  });
}

function collectReviewItemsForMessage(message, {
  notebookDraftAdapter,
  protocolReviewAdapter,
  notebookEntries = []
}) {
  const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
  const messageId = trimText(message?.id, 120);
  if (!messageId) {
    return [];
  }
  const items = collectProtocolEdits(meta, messageId).filter(item => !['approved', 'rejected'].includes(item.status));
  for (const { draft: notebookDraft, draftId } of collectNotebookDrafts(meta, notebookDraftAdapter)) {
    const existingNotebookEntry = notebookDraftAdapter?.findEntryForDraft?.(notebookDraft) || null;
    if (
      notebookDraft
      && notebookDraft.save.mode === 'confirm_before_save'
      && notebookDraft.save.applied !== true
      && trimText(notebookDraft.save.status, 80) !== 'rejected'
      && !existingNotebookEntry
    ) {
      items.push({
        id: `notebook:${messageId}:${draftId}`,
        type: 'notebook',
        messageId,
        draftId,
        draft: notebookDraft
      });
    }
  }

  const notebookAppendState = resolveNotebookAppendReviewState(meta, notebookEntries);
  const notebookAppend = notebookAppendState.append;
  if (
    notebookAppend
    && notebookAppend.save?.mode === 'confirm_before_append'
    && notebookAppendState.applied !== true
    && notebookAppendState.status !== 'rejected'
    && notebookAppendState.status !== 'applying'
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
  return items;
}

export {
  collectProtocolEdits,
  collectReviewItemsForMessage
};
