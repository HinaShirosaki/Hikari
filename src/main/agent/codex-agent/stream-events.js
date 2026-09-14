'use strict';

const { extractHtmlArtifactFromToolEvent } = require('../runtime/tool-artifacts/html-output.js');
const { extractImageArtifactFromToolEvent } = require('../runtime/tool-artifacts/image-output.js');

const { extractSequenceActions } = require('../../../renderer/modules/sequence-viewer/main-process/mcp/artifact-events');
const {
  extractAskUserPayloadFromToolEvent
} = require('./payloads.js');
const {
  extractNotebookAppendArtifactFromToolEvent,
  extractNotebookDraftArtifactFromToolEvent,
  extractProtocolGenerationArtifactFromToolEvent
} = require('./artifacts.js');
const {
  extractPlotlyGraphArtifactFromToolEvent
} = require('../runtime/tool-artifacts/plotly-graph.js');

const FINAL_ANSWER_TEXT_LIMIT = 120000;
const LIVE_DISPLAY_TEXT_LIMIT = 1200;
const LIVE_FINAL_DISPLAY_TEXT_LIMIT = 8000;

function createCodexStreamProgressHandler({
  cleanText,
  emitAgentProgress = null,
  lifecycleRecorder = null,
  recordLifecycleEvent = () => {}
} = {}) {
  let lastStreamText = '';
  let streamedFinalAnswerText = '';
  let streamedAskUserPayload = null;
  let streamedNotebookDraftPayload = null;
  let streamedNotebookAppendPayload = null;
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
      const notebookAppendArtifact = extractNotebookAppendArtifactFromToolEvent(streamEvent);
      if (notebookAppendArtifact?.proposal?.content_markdown) {
        streamedNotebookAppendPayload = notebookAppendArtifact;
      }
      const protocolGenerationArtifact = extractProtocolGenerationArtifactFromToolEvent(streamEvent);
      if (protocolGenerationArtifact?.protocol) {
        streamedProtocolGenerationPayloads.push(protocolGenerationArtifact);
      }
    }
    if (eventType === 'codex_cli_display') {
      const rawDisplayText = cleanText(
        streamEvent.display_text
          || streamEvent.displayText
          || streamEvent.text
          || streamEvent.message,
        FINAL_ANSWER_TEXT_LIMIT
      );
      if (!rawDisplayText) {
        return;
      }
      const codexEventType = cleanText(streamEvent.event_type || streamEvent.eventType, 120);
      const displayKind = cleanText(streamEvent.display_kind || streamEvent.displayKind, 80);
      const isFinalAnswer = (
        /(?:^|:)final_answer$/u.test(codexEventType)
        && (!displayKind || displayKind === 'assistant' || displayKind === 'message')
      );
      if (isFinalAnswer) {
        streamedFinalAnswerText = rawDisplayText;
      }
      const displayText = cleanText(
        rawDisplayText,
        isFinalAnswer ? LIVE_FINAL_DISPLAY_TEXT_LIMIT : LIVE_DISPLAY_TEXT_LIMIT
      );
      publishCodexProgress({
        stage: 'codex_cli_display',
        status: cleanText(streamEvent.status, 40) || 'streaming',
        routing_intent: 'codex_agent',
        tool_name: cleanText(streamEvent.tool_name || streamEvent.toolName, 160),
        message: displayText,
        meta: {
          codex_display_text: displayText,
          codex_display_kind: displayKind,
          codex_display_stream: cleanText(streamEvent.display_stream || streamEvent.displayStream, 40),
          codex_event_type: codexEventType
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
      const sequenceActions = extractSequenceActions(streamEvent);
      const htmlArtifact = extractHtmlArtifactFromToolEvent(streamEvent);
      const imageArtifact = extractImageArtifactFromToolEvent(streamEvent);
      const plotlyGraphArtifact = extractPlotlyGraphArtifactFromToolEvent(streamEvent);
      const meta = {
        ...(htmlArtifact ? { html_artifact: htmlArtifact } : {}),
        ...(imageArtifact ? { image_artifact: imageArtifact } : {}),
        sequence_actions: sequenceActions,
        tool_call_text: toolCallText,
        thinking_trace: toolCallText,
        codex_event_type: cleanText(streamEvent.event_type || streamEvent.eventType, 120)
      };
      if (plotlyGraphArtifact?.figure?.data?.length) {
        meta.plotly_graph_artifact = plotlyGraphArtifact;
      }
      emitAgentProgress({
        stage: status === 'failed'
          ? 'tool_call_failed'
          : (status === 'completed' ? 'tool_call_completed' : 'tool_call_started'),
        status,
        routing_intent: 'codex_agent',
        tool_name: toolName,
        message: toolCallText,
        meta
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
      streamedFinalAnswerText,
      streamedAskUserPayload,
      streamedNotebookDraftPayload,
      streamedNotebookAppendPayload,
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
