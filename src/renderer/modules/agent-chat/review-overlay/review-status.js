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

function getSequenceEditReviewStatus(meta = {}, token = '') {
  const review = meta.sequenceEditReview && typeof meta.sequenceEditReview === 'object'
    ? meta.sequenceEditReview
    : {};
  return trimText(review[token]?.status || review[token], 40);
}

function markSequenceEditReview(messages, messageId, token, status, reason = '') {
  const normalizedMessageId = trimText(messageId, 120);
  const message = asArray(messages).find((item) => trimText(item?.id, 120) === normalizedMessageId);
  if (!message || message.role !== 'assistant') {
    return false;
  }
  const currentMeta = message.meta && typeof message.meta === 'object' ? message.meta : {};
  message.meta = {
    ...currentMeta,
    sequenceEditReview: {
      ...(currentMeta.sequenceEditReview && typeof currentMeta.sequenceEditReview === 'object' ? currentMeta.sequenceEditReview : {}),
      [token]: {
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
  getSequenceEditReviewStatus,
  markNotebookAppendReview,
  markProtocolReview,
  markSequenceEditReview
};
