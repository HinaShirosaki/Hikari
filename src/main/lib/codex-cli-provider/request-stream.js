'use strict';

const {
  buildCodexDisplayEventFromProgress,
  emitCodexCliDisplayEvent,
  extractCodexPlainOutputDisplayEvent
} = require('./event-display');
const {
  buildCodexProgressEventKey,
  extractCodexJsonEventProgress
} = require('./event-progress');
const { extractCodexJsonEventText } = require('./event-text');
const { completeCodexProgressText } = require('./event-tool-summary');
const { extractCodexJsonEventSessionId } = require('./session-id');
const { cleanText } = require('./utils');

function createCodexJsonEventHandler({
  onStream = null,
  streamingEnabled = false,
  initialSessionId = ''
} = {}) {
  let codexSessionId = initialSessionId;
  let streamedText = '';
  const seenProgressEvents = new Set();
  const seenDisplayEvents = new Set();
  const activeToolCallsById = new Map();

  function handleJsonStreamEvent(event = {}) {
    const plainDisplayEvent = extractCodexPlainOutputDisplayEvent(event);
    if (plainDisplayEvent) {
      emitCodexCliDisplayEvent(onStream, seenDisplayEvents, plainDisplayEvent);
      return;
    }
    updateAssistantText(event);
    extractCodexJsonEventProgress(event).forEach((progressEvent) => {
      rememberToolCallProgress(progressEvent);
      emitProgressEvent(progressEvent);
    });
  }

  function updateAssistantText(event = {}) {
    const extracted = extractCodexJsonEventText(event);
    if (!extracted) {
      return;
    }
    let deltaText = cleanText(extracted.deltaText, 120000);
    const fullText = cleanText(extracted.fullText, 120000);
    if (fullText) {
      if (fullText.startsWith(streamedText)) {
        deltaText = fullText.slice(streamedText.length);
      } else if (fullText !== streamedText) {
        deltaText = fullText;
      }
      streamedText = fullText;
    } else if (deltaText) {
      streamedText += deltaText;
    }
    if (streamedText || deltaText) {
      emitStreamText(extracted, deltaText, fullText);
    }
  }

  function emitStreamText(extracted, deltaText, fullText) {
    try {
      onStream({
        type: 'codex_stream',
        event_type: cleanText(extracted.eventType, 120),
        text_delta: deltaText,
        accumulated_text: streamedText
      });
    } catch {
      // Keep streaming best-effort; the final Codex response still resolves below.
    }
    emitCodexCliDisplayEvent(onStream, seenDisplayEvents, {
      text: deltaText || fullText,
      kind: 'assistant',
      eventType: extracted.eventType
    });
  }

  function rememberToolCallProgress(progressEvent = {}) {
    if (progressEvent?.type !== 'codex_tool_call') {
      return;
    }
    const callId = cleanText(progressEvent.call_id || progressEvent.callId, 160);
    const status = cleanText(progressEvent.status, 40);
    if (callId && status !== 'completed' && status !== 'failed') {
      activeToolCallsById.set(callId, {
        tool_name: cleanText(progressEvent.tool_name || progressEvent.toolName, 160),
        tool_call_text: cleanText(progressEvent.tool_call_text || progressEvent.toolCallText, 2400)
      });
    } else if (callId && activeToolCallsById.has(callId)) {
      completeRememberedToolCall(progressEvent, activeToolCallsById.get(callId) || {});
      activeToolCallsById.delete(callId);
    }
  }

  function completeRememberedToolCall(progressEvent, previous) {
    if (!cleanText(progressEvent.tool_name, 160) || cleanText(progressEvent.tool_name, 160) === 'codex-tool') {
      progressEvent.tool_name = previous.tool_name || progressEvent.tool_name;
    }
    if (!cleanText(progressEvent.tool_call_text, 2400) || cleanText(progressEvent.tool_call_text, 2400) === 'Tool call completed.') {
      progressEvent.tool_call_text = completeCodexProgressText(previous.tool_call_text, previous.tool_name);
    }
  }

  function emitProgressEvent(progressEvent = {}) {
    const progressKey = buildCodexProgressEventKey(progressEvent);
    if (progressKey && seenProgressEvents.has(progressKey)) {
      return;
    }
    if (progressKey) {
      seenProgressEvents.add(progressKey);
    }
    try {
      onStream(progressEvent);
    } catch {
      // Keep streaming best-effort; the final Codex response still resolves below.
    }
    emitCodexCliDisplayEvent(
      onStream,
      seenDisplayEvents,
      buildCodexDisplayEventFromProgress(progressEvent)
    );
  }

  function handleJsonEvent(event = {}) {
    if (!codexSessionId) {
      const sessionId = extractCodexJsonEventSessionId(event);
      if (sessionId) {
        codexSessionId = sessionId;
      }
    }
    if (streamingEnabled) {
      handleJsonStreamEvent(event);
    }
  }

  return {
    getCodexSessionId: () => codexSessionId,
    getSeenDisplayEvents: () => seenDisplayEvents,
    getSeenProgressEvents: () => seenProgressEvents,
    getStreamedText: () => streamedText,
    handleJsonEvent
  };
}

module.exports = {
  createCodexJsonEventHandler
};
