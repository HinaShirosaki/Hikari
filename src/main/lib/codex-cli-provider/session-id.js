'use strict';

const { getCodexJsonEventDescriptor } = require('./event-descriptor');
const { cleanText } = require('./utils');

function normalizeCodexSessionId(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.slice(0, 240);
}

function extractCodexJsonEventSessionId(event = {}) {
  const { source, envelope } = getCodexJsonEventDescriptor(event);
  const type = cleanText(source.type || source.event || source.kind || envelope.type || envelope.event || envelope.kind, 120).toLowerCase();
  const candidates = [
    source.session_id,
    source.sessionId,
    source.conversation_id,
    source.conversationId,
    source.thread_id,
    source.threadId,
    source.session?.id,
    source.session?.session_id,
    source.session?.sessionId,
    source.conversation?.id,
    source.thread?.id,
    source.item?.session_id,
    source.item?.sessionId,
    source.item?.conversation_id,
    source.item?.conversationId,
    source.message?.session_id,
    source.message?.sessionId,
    source.message?.conversation_id,
    source.message?.conversationId,
    source.response?.session_id,
    source.response?.sessionId,
    source.metadata?.session_id,
    source.metadata?.sessionId,
    source.metadata?.conversation_id,
    source.metadata?.conversationId,
    source.payload?.id,
    source.payload?.session_id,
    source.payload?.sessionId,
    source.payload?.conversation_id,
    source.payload?.conversationId,
    envelope.session_id,
    envelope.sessionId,
    envelope.conversation_id,
    envelope.conversationId,
    envelope.thread_id,
    envelope.threadId,
    envelope.session?.id,
    envelope.session?.session_id,
    envelope.session?.sessionId,
    envelope.conversation?.id,
    envelope.thread?.id,
    envelope.metadata?.session_id,
    envelope.metadata?.sessionId,
    envelope.metadata?.conversation_id,
    envelope.metadata?.conversationId,
    envelope.payload?.id,
    envelope.payload?.session_id,
    envelope.payload?.sessionId,
    envelope.payload?.conversation_id,
    envelope.payload?.conversationId
  ];
  if (/session|conversation|thread/.test(type)) {
    candidates.push(source.id);
    candidates.push(envelope.id);
  }
  for (const candidate of candidates) {
    const sessionId = normalizeCodexSessionId(candidate);
    if (sessionId) {
      return sessionId;
    }
  }
  return '';
}

function extractCodexSessionIdFromText(text = '') {
  const source = String(text || '');
  if (!source) {
    return '';
  }
  const jsonStyle = source.match(/"(?:session_id|sessionId|conversation_id|conversationId|thread_id|threadId)"\s*:\s*"([^"]+)"/);
  if (jsonStyle?.[1]) {
    return normalizeCodexSessionId(jsonStyle[1]);
  }
  const labelStyle = source.match(/\b(?:session_id|sessionId|conversation_id|conversationId|thread_id|threadId)\b\s*[:=]\s*([A-Za-z0-9._:-]+)/);
  return normalizeCodexSessionId(labelStyle?.[1] || '');
}

module.exports = {
  extractCodexJsonEventSessionId,
  extractCodexSessionIdFromText,
  normalizeCodexSessionId
};
