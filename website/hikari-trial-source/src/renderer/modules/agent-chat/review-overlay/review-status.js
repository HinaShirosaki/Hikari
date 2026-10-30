import { asArray, trimText } from '../shared.js';

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

function getNotebookAppend(meta = {}) {
  const source = meta.notebookAppend && typeof meta.notebookAppend === 'object'
    ? meta.notebookAppend
    : (meta.notebook_append && typeof meta.notebook_append === 'object' ? meta.notebook_append : null);
  if (!source?.proposal?.content_markdown) {
    return null;
  }
  return source;
}

// Applying is in-flight UI only. A status persisted into message meta survives a
// reload or a crash mid-append and restores a card with neither an Append nor a
// Reject button, so the in-flight set lives here and is never written to state.
const appendsInFlight = new Set();

function notebookAppendKey(append) {
  return trimText(append?.proposal?.proposal_id || append?.proposal?.proposalId, 200)
    || trimText(append?.proposal?.content_markdown, 500);
}

function setNotebookAppendInFlight(append, inFlight = true) {
  const key = notebookAppendKey(append);
  if (!key) {
    return false;
  }
  if (inFlight) {
    appendsInFlight.add(key);
  } else {
    appendsInFlight.delete(key);
  }
  return true;
}

function resolveNotebookAppendReviewState(meta = {}, notebookEntries = []) {
  const append = getNotebookAppend(meta);
  if (!append) {
    return { append: null, applied: false, status: '' };
  }
  const savedStatus = trimText(append.save?.status, 40);
  const savedApplied = append.save?.applied === true || savedStatus === 'approved';
  if (savedApplied || savedStatus === 'rejected') {
    return {
      append,
      applied: savedApplied,
      status: savedApplied ? 'approved' : 'rejected'
    };
  }
  const proposalId = trimText(append.proposal?.proposal_id || append.proposal?.proposalId, 200);
  const entryId = trimText(append.proposal?.notebook_entry_id || append.proposal?.notebookEntryId, 220);
  const appliedInNotebook = Boolean(proposalId && asArray(notebookEntries).some((entry) => {
    if (entryId && trimText(entry?.id, 220) !== entryId) {
      return false;
    }
    return asArray(entry?.agentAppendProposalIds)
      .some((id) => trimText(id, 200) === proposalId);
  }));
  if (appliedInNotebook) {
    return { append, applied: true, status: 'approved' };
  }
  if (appendsInFlight.has(notebookAppendKey(append))) {
    return { append, applied: false, status: 'applying' };
  }
  return {
    append,
    applied: false,
    status: savedStatus && savedStatus !== 'applying' ? savedStatus : 'pending'
  };
}

function markNotebookAppendReview(messages, messageId, status, reason = '') {
  const normalizedMessageId = trimText(messageId, 120);
  const message = asArray(messages).find((item) => trimText(item?.id, 120) === normalizedMessageId);
  if (!message || message.role !== 'assistant') {
    return false;
  }
  const currentMeta = message.meta && typeof message.meta === 'object' ? message.meta : {};
  const currentAppend = getNotebookAppend(currentMeta);
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
    ...currentMeta,
    notebook_append: nextAppend,
    notebookAppend: nextAppend
  };
  return true;
}

export {
  getNotebookAppend,
  getProtocolReviewStatus,
  markNotebookAppendReview,
  markProtocolReview,
  resolveNotebookAppendReviewState,
  setNotebookAppendInFlight
};
