'use strict';

const {
  extractAskUserPayloadFromToolEvent
} = require('./payloads.js');
const {
  extractNotebookDraftArtifactFromToolEvent,
  extractProtocolGenerationArtifactFromToolEvent
} = require('./artifacts.js');

function createCodexStreamProgressHandler({
  cleanText,
  emitAgentProgress = null,
  lifecycleRecorder = null,
  recordLifecycleEvent = () => {}
} = {}) {
  let lastStreamText = '';
  let streamedAskUserPayload = null;
  let streamedNotebookDraftPayload = null;
  const streamedProtocolGenerationPayloads = [];

  function publishCodexProgress(progressEvent = {}) {
    const recorded = recordLifecycleEvent(lifecycleRecorder, progressEvent);
    if (!recorded && emitAgentProgress) {
      emitAgentProgress(progressEvent);
    }
  }

  function emitStreamProgress(streamEvent = {}, { force = false } = {}) {
    const eventType = cleanText(streamEvent.type || streamEvent.event_type || streamEvent.eventType, 120);
    if (eventType === 'codex_tool_call') {
      const askUserPayload = extractAskUserPayloadFromToolEvent(streamEvent);
      if (askUserPayload?.user_question?.question) {
        streamedAskUserPayload = askUserPayload;
      }
      const notebookDraftArtifact = extractNotebookDraftArtifactFromToolEvent(streamEvent);
      if (notebookDraftArtifact?.notebook) {
        streamedNotebookDraftPayload = notebookDraftArtifact;
      }
      const protocolGenerationArtifact = extractProtocolGenerationArtifactFromToolEvent(streamEvent);
      if (protocolGenerationArtifact?.protocol) {
        streamedProtocolGenerationPayloads.push(protocolGenerationArtifact);
      }
    }
    if (eventType === 'codex_cli_display') {
      const displayText = cleanText(
        streamEvent.display_text
          || streamEvent.displayText
          || streamEvent.text
          || streamEvent.message,
        4000
      );
      if (!displayText) {
        return;
      }
      publishCodexProgress({
        stage: 'codex_cli_display',
        status: cleanText(streamEvent.status, 40) || 'streaming',
        routing_intent: 'codex_agent',
        tool_name: cleanText(streamEvent.tool_name || streamEvent.toolName, 160),
        message: displayText,
        meta: {
          codex_display_text: displayText,
          codex_display_kind: cleanText(streamEvent.display_kind || streamEvent.displayKind, 80),
          codex_display_stream: cleanText(streamEvent.display_stream || streamEvent.displayStream, 40),
          codex_event_type: cleanText(streamEvent.event_type || streamEvent.eventType, 120)
        }
      });
      return;
    }
    if (!emitAgentProgress) {
      return;
    }
    if (eventType === 'codex_thinking') {
      const thinkingText = cleanText(
        streamEvent.thinking_text
          || streamEvent.thinkingText
          || streamEvent.text
          || streamEvent.message,
        4000
      );
      if (!thinkingText) {
        return;
      }
      emitAgentProgress({
        stage: 'codex_agent_thinking',
        status: 'streaming',
        routing_intent: 'codex_agent',
        message: thinkingText,
        meta: {
          thinking_trace: thinkingText,
          codex_event_type: cleanText(streamEvent.event_type || streamEvent.eventType, 120)
        }
      });
      return;
    }
    if (eventType === 'codex_tool_call') {
      const toolName = cleanText(streamEvent.tool_name || streamEvent.toolName, 160) || 'codex-tool';
      const toolCallText = cleanText(
        streamEvent.tool_call_text
          || streamEvent.toolCallText
          || streamEvent.text
          || streamEvent.message
          || toolName,
        2400
      );
      const rawStatus = cleanText(streamEvent.status, 40);
      const status = rawStatus === 'failed' || rawStatus === 'error'
        ? 'failed'
        : (rawStatus === 'completed' || rawStatus === 'done' || rawStatus === 'ok' ? 'completed' : 'started');
      emitAgentProgress({
        stage: status === 'failed'
          ? 'tool_call_failed'
          : (status === 'completed' ? 'tool_call_completed' : 'tool_call_started'),
        status,
        routing_intent: 'codex_agent',
        tool_name: toolName,
        message: toolCallText,
        meta: {
          tool_call_text: toolCallText,
          thinking_trace: toolCallText,
          codex_event_type: cleanText(streamEvent.event_type || streamEvent.eventType, 120)
        }
      });
      return;
    }
    const streamText = cleanText(
      streamEvent.accumulated_text
        || streamEvent.accumulatedText
        || streamEvent.text
        || lastStreamText,
      120000
    );
    if (!streamText || (!force && streamText === lastStreamText)) {
      return;
    }
    lastStreamText = streamText;
    emitAgentProgress({
      stage: 'codex_agent_stream',
      status: 'streaming',
      routing_intent: 'codex_agent',
      message: streamText,
      meta: {
        stream_text: streamText,
        text_delta: cleanText(streamEvent.text_delta || streamEvent.textDelta, 120000),
        event_type: cleanText(streamEvent.event_type || streamEvent.eventType, 120)
      }
    });
  }

  function getStreamState() {
    return {
      lastStreamText,
      streamedAskUserPayload,
      streamedNotebookDraftPayload,
      streamedProtocolGenerationPayloads
    };
  }

  return {
    emitStreamProgress,
    getStreamState,
    publishCodexProgress
  };
}

module.exports = {
  createCodexStreamProgressHandler
};
