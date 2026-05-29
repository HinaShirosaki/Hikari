'use strict';

const { cleanText } = require('./utils');

function buildCodexCliDisplayEvent({
  text = '',
  kind = '',
  eventType = '',
  status = '',
  toolName = '',
  stream = ''
} = {}) {
  const displayText = cleanText(text, 12000);
  if (!displayText) {
    return null;
  }
  return {
    type: 'codex_cli_display',
    event_type: cleanText(eventType, 160),
    display_kind: cleanText(kind, 80) || 'message',
    display_stream: cleanText(stream, 40),
    status: cleanText(status, 40),
    tool_name: cleanText(toolName, 160),
    display_text: displayText
  };
}

function buildCodexCliDisplayEventKey(event = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return '';
  }
  return [
    cleanText(event.type, 80),
    cleanText(event.event_type || event.eventType, 160),
    cleanText(event.display_kind || event.displayKind, 80),
    cleanText(event.display_stream || event.displayStream, 40),
    cleanText(event.status, 40),
    cleanText(event.tool_name || event.toolName, 160),
    cleanText(event.display_text || event.displayText || event.text, 12000)
  ].join('\u0001');
}

function emitCodexCliDisplayEvent(onStream, seenDisplayEvents, event = {}) {
  if (typeof onStream !== 'function') {
    return;
  }
  const displayEvent = event?.type === 'codex_cli_display'
    ? event
    : buildCodexCliDisplayEvent(event);
  if (!displayEvent) {
    return;
  }
  const displayKey = buildCodexCliDisplayEventKey(displayEvent);
  if (displayKey && seenDisplayEvents?.has(displayKey)) {
    return;
  }
  if (displayKey && seenDisplayEvents && typeof seenDisplayEvents.add === 'function') {
    seenDisplayEvents.add(displayKey);
  }
  try {
    onStream(displayEvent);
  } catch {
    // Keep display streaming best-effort; the final Codex response still resolves below.
  }
}

function extractCodexPlainOutputDisplayEvent(event = {}) {
  const source = event && typeof event === 'object' && !Array.isArray(event) ? event : {};
  const type = cleanText(source.type, 120).toLowerCase();
  if (type !== 'codex_cli_output') {
    return null;
  }
  return buildCodexCliDisplayEvent({
    text: source.text,
    kind: source.stream === 'stderr' ? 'stderr' : 'stdout',
    eventType: type,
    stream: source.stream
  });
}

function buildCodexDisplayEventFromProgress(progressEvent = {}) {
  if (!progressEvent || typeof progressEvent !== 'object' || Array.isArray(progressEvent)) {
    return null;
  }
  const eventType = cleanText(progressEvent.event_type || progressEvent.eventType, 160);
  const progressType = cleanText(progressEvent.type, 80);
  if (progressType === 'codex_thinking') {
    return buildCodexCliDisplayEvent({
      text: progressEvent.thinking_text || progressEvent.thinkingText,
      kind: 'thinking',
      eventType
    });
  }
  if (progressType === 'codex_tool_call') {
    return buildCodexCliDisplayEvent({
      text: progressEvent.tool_call_text || progressEvent.toolCallText,
      kind: 'tool',
      eventType,
      status: progressEvent.status,
      toolName: progressEvent.tool_name || progressEvent.toolName
    });
  }
  return null;
}

module.exports = {
  buildCodexCliDisplayEvent,
  buildCodexCliDisplayEventKey,
  buildCodexDisplayEventFromProgress,
  emitCodexCliDisplayEvent,
  extractCodexPlainOutputDisplayEvent
};
