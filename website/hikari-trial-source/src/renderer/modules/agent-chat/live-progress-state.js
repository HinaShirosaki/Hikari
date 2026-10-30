import { mergeAgentHtmlArtifacts } from './html-artifacts.js';
import { mergeAgentImageArtifacts } from './image-artifacts.js';
import { mergeSequenceActions } from '../sequence-viewer/mcp/action-rendering.js';
import { asArray, trimText } from './shared.js';
import {
  extractLiveCodexCliDisplayText,
  extractLiveStreamText,
  extractLiveThinkingTrace,
  getProgressRowKey,
  getProgressRowText,
  getToolActivityLabel,
  progressBadgeStatus,
  progressStatusRank
} from './live-progress-text.js';

// Codex sometimes emits a tool result as `tool_name: {json}` (or `[...]`). That is
// tool activity, not assistant prose, and must never surface as the live message text.
function looksLikeToolDisplayJson(value = '') {
  return /^[a-z][a-z0-9_]*\s*:\s*[{[]/i.test(trimText(value, 120));
}

function buildLiveProgressSummary(eventPayload = {}) {
  const streamText = extractLiveStreamText(eventPayload);
  if (streamText) {
    return streamText;
  }
  const thinkingTrace = extractLiveThinkingTrace(eventPayload);
  if (thinkingTrace) {
    return thinkingTrace;
  }
  const stage = trimText(eventPayload?.stage, 80);
  const toolName = trimText(eventPayload?.tool_name, 120);
  if (stage === 'codex_cli_display') {
    const meta = eventPayload?.meta && typeof eventPayload.meta === 'object' ? eventPayload.meta : {};
    const displayKind = trimText(meta.codex_display_kind || meta.codexDisplayKind, 80);
    const displayText = extractLiveCodexCliDisplayText(eventPayload);
    // Tool-display payloads (explicit tool kind, or Codex prefixing the JSON with a tool
    // name like `literature_search: {...}`) are activity, never user-facing prose.
    if ((displayKind && displayKind !== 'assistant' && displayKind !== 'message')
      || looksLikeToolDisplayJson(displayText)) {
      return 'Working on this...';
    }
    return displayText || 'Working on this...';
  }
  if (stage === 'tool_call_started') {
    return `${getToolActivityLabel(toolName)}...`;
  }
  if (stage === 'request_aborted') {
    return trimText(eventPayload?.message, 600) || 'Agent request stopped.';
  }
  if (stage === 'tool_call_completed') {
    return trimText(eventPayload?.message, 600) || `${getToolActivityLabel(toolName)} complete.`;
  }
  if (stage === 'tool_call_failed') {
    return trimText(eventPayload?.message, 600) || `${getToolActivityLabel(toolName)} failed.`;
  }
  return trimText(eventPayload?.message, 600) || getProgressRowText(eventPayload) || 'Working on this...';
}
function upsertLiveProgressRows(rows = [], eventPayload = {}) {
  const nextRows = asArray(rows).map((row) => ({ ...row }));
  const key = getProgressRowKey(eventPayload);
  const stage = trimText(eventPayload?.stage, 80);
  if (stage === 'codex_cli_display' || stage === 'codex_agent_stream' || stage === 'codex_agent_thinking') {
    return nextRows;
  }
  const nextStatus = progressBadgeStatus(eventPayload?.status);
  const nextText = getProgressRowText(eventPayload);
  if (!key || !nextText) {
    return nextRows;
  }
  const existingIndex = nextRows.findIndex((row) => trimText(row?.key, 160) === key);
  if (existingIndex === -1) {
    nextRows.push({
      key,
      status: nextStatus,
      text: nextText,
      stage,
      routing_intent: trimText(eventPayload?.routing_intent, 120),
      tool_name: trimText(eventPayload?.tool_name, 120)
    });
    return nextRows.slice(-12);
  }
  const existingRow = nextRows[existingIndex];
  nextRows[existingIndex] = {
    ...existingRow,
    status: progressStatusRank(nextStatus) >= progressStatusRank(existingRow?.status)
      ? nextStatus
      : existingRow?.status,
    text: nextText || existingRow?.text,
    stage: stage || existingRow?.stage,
    routing_intent: trimText(eventPayload?.routing_intent, 120) || existingRow?.routing_intent,
    tool_name: trimText(eventPayload?.tool_name, 120) || existingRow?.tool_name
  };
  return nextRows.slice(-12);
}

function appendLiveCodexCliDisplayRows(rows = [], eventPayload = {}) {
  const text = extractLiveCodexCliDisplayText(eventPayload);
  if (!text) {
    return asArray(rows).map((row) => ({ ...row }));
  }
  const meta = eventPayload?.meta && typeof eventPayload.meta === 'object' ? eventPayload.meta : {};
  const nextRows = asArray(rows).map((row) => ({ ...row }));
  const key = [
    trimText(eventPayload?.stage, 80),
    trimText(eventPayload?.timestamp, 80),
    trimText(meta.codex_display_kind || meta.codexDisplayKind, 80),
    text.toLowerCase()
  ].filter(Boolean).join(':') || text.toLowerCase();
  if (nextRows.some((row) => trimText(row?.key, 1500) === key || trimText(row?.text || row, 1200) === text)) {
    return nextRows.slice(-80);
  }
  nextRows.push({
    key,
    text,
    stage: trimText(eventPayload?.stage, 80),
    routing_intent: trimText(eventPayload?.routing_intent, 120),
    kind: trimText(meta.codex_display_kind || meta.codexDisplayKind, 80),
    stream: trimText(meta.codex_display_stream || meta.codexDisplayStream, 40)
  });
  return nextRows.slice(-80);
}

function isInternalCodexPromptText(value = '') {
  return /^#\s*Hikari Codex Chat Turn\b/u.test(trimText(value, 200));
}

function isGenericToolProgressText(value = '') {
  const text = trimText(value, 240).toLowerCase();
  return text === 'running tool...'
    || text === 'running tool'
    || text === 'tool call completed.'
    || text === 'tool call completed'
    || text === 'request received';
}

function extractLiveResponseCandidate(eventPayload = {}) {
  const stage = trimText(eventPayload?.stage, 80);
  if (stage === 'codex_cli_display') {
    const displayText = extractLiveCodexCliDisplayText(eventPayload);
    const meta = eventPayload?.meta && typeof eventPayload.meta === 'object' ? eventPayload.meta : {};
    const displayKind = trimText(meta.codex_display_kind || meta.codexDisplayKind, 80);
    if (displayKind && displayKind !== 'assistant' && displayKind !== 'message') {
      return '';
    }
    if (!displayText || isInternalCodexPromptText(displayText) || isGenericToolProgressText(displayText)) {
      return '';
    }
    return displayText;
  }
  if (stage === 'codex_agent_thinking') {
    const thinkingTrace = extractLiveThinkingTrace(eventPayload);
    if (!thinkingTrace || isGenericToolProgressText(thinkingTrace)) {
      return '';
    }
    return thinkingTrace;
  }
  return '';
}

function normalizeLiveResponseSegments(source) {
  return asArray(source).map((row) => {
    const text = trimText(row?.text || row, 120000);
    if (!text || isInternalCodexPromptText(text) || isGenericToolProgressText(text)) {
      return '';
    }
    return text;
  }).filter(Boolean).slice(-24);
}

function appendLiveResponseSegment(segments = [], value = '') {
  const text = trimText(value, 120000);
  const nextSegments = normalizeLiveResponseSegments(segments);
  if (!text || isInternalCodexPromptText(text) || isGenericToolProgressText(text)) {
    return nextSegments;
  }
  const lastIndex = nextSegments.length - 1;
  const lastText = lastIndex >= 0 ? nextSegments[lastIndex] : '';
  if (lastText === text || lastText.startsWith(text)) {
    return nextSegments;
  }
  if (lastText && text.startsWith(lastText)) {
    nextSegments[lastIndex] = text;
    return nextSegments.slice(-24);
  }
  if (nextSegments.some((row) => row === text)) {
    return nextSegments;
  }
  nextSegments.push(text);
  return nextSegments.slice(-24);
}

function joinLiveResponseSegments(segments = []) {
  return normalizeLiveResponseSegments(segments).join('\n\n');
}

function extractLiveResponseSegment(eventPayload = {}) {
  return extractLiveStreamText(eventPayload) || extractLiveResponseCandidate(eventPayload);
}

function upsertLiveThinkingRows(rows = [], eventPayload = {}) {
  const nextRows = asArray(rows).map((row) => ({ ...row }));
  const text = extractLiveThinkingTrace(eventPayload);
  if (!text) {
    return nextRows;
  }
  const stage = trimText(eventPayload?.stage, 80);
  const toolName = trimText(eventPayload?.tool_name, 120);
  const round = trimText(eventPayload?.meta?.round, 40);
  const key = [stage, round, toolName, text.toLowerCase()].filter(Boolean).join(':') || text.toLowerCase();
  if (nextRows.some((row) => trimText(row?.key, 620) === key)) {
    return nextRows.slice(-12);
  }
  nextRows.push({ key, text });
  return nextRows.slice(-12);
}

export function buildLiveAssistantPlaceholder(clientRequestId, requestText, createId) {
  return {
    id: `live-${trimText(clientRequestId, 120) || createId()}`,
    role: 'assistant',
    text: 'Working on this...',
    createdAt: new Date().toISOString(),
    meta: {
      live_progress: {
        client_request_id: trimText(clientRequestId, 120),
        request_text: trimText(requestText, 3000),
        activity_rows: [{ key: 'request_received', status: 'pending', text: 'Request received' }],
        thinking_rows: [],
        codex_cli_display_rows: [],
        stage: 'request_received',
        status: 'started',
        message: 'Working on this...'
      }
    }
  };
}
export function createLocalStopError(message = 'Agent request stopped.') {
  const error = new Error(message);
  error.code = 'AGENT_STOP_REQUESTED';
  return error;
}

export function isLocalStopError(error) {
  return error?.code === 'AGENT_STOP_REQUESTED';
}

export function buildStoppedAssistantMessage(requestText, message, createId) {
  return {
    id: createId(),
    role: 'assistant',
    text: 'Agent stopped.',
    createdAt: new Date().toISOString(),
    meta: {
      cancellation: { stopped: true, message: trimText(message, 600) || 'Agent request stopped.' },
      requestText: trimText(requestText, 3000)
    }
  };
}

export function applyLiveProgressEvent(liveAssistantMessage, eventPayload = {}) {
  if (!liveAssistantMessage) {
    return liveAssistantMessage;
  }
  const currentMeta = liveAssistantMessage.meta?.live_progress || {};
  const eventStreamText = extractLiveStreamText(eventPayload);
  const streamText = eventStreamText || currentMeta.stream_text || '';
  const currentResponseSegments = normalizeLiveResponseSegments(
    currentMeta.response_segments || currentMeta.responseSegments
  );
  const eventResponseSegment = extractLiveResponseSegment(eventPayload);
  const responseSegments = eventResponseSegment
    ? appendLiveResponseSegment(currentResponseSegments, eventResponseSegment)
    : currentResponseSegments;
  const responseText = joinLiveResponseSegments(responseSegments);
  const summaryText = responseText || buildLiveProgressSummary(eventPayload);
  return {
    ...liveAssistantMessage,
    text: summaryText,
    meta: {
      ...liveAssistantMessage.meta,
      html_artifacts: mergeAgentHtmlArtifacts(liveAssistantMessage.meta?.html_artifacts, [eventPayload.meta?.html_artifact || eventPayload.html_artifact]),
      image_artifacts: mergeAgentImageArtifacts(liveAssistantMessage.meta?.image_artifacts, [eventPayload.meta?.image_artifact || eventPayload.image_artifact]),
      sequence_actions: mergeSequenceActions(liveAssistantMessage.meta?.sequence_actions, eventPayload.meta?.sequence_actions),
      live_progress: {
        ...currentMeta,
        client_request_id: trimText(eventPayload?.client_request_id, 120) || currentMeta.client_request_id,
        request_id: trimText(eventPayload?.request_id, 120) || currentMeta.request_id,
        chat_session_id: trimText(eventPayload?.chat_session_id, 120) || currentMeta.chat_session_id,
        routing_intent: trimText(eventPayload?.routing_intent, 120) || currentMeta.routing_intent,
        stage: trimText(eventPayload?.stage, 80) || currentMeta.stage,
        status: trimText(eventPayload?.status, 40) || currentMeta.status,
        message: summaryText,
        stream_text: streamText,
        response_text: responseText,
        response_segments: responseSegments,
        meta: eventPayload?.meta && typeof eventPayload.meta === 'object' ? eventPayload.meta : currentMeta.meta,
        activity_rows: upsertLiveProgressRows(currentMeta.activity_rows, eventPayload),
        thinking_rows: upsertLiveThinkingRows(currentMeta.thinking_rows, eventPayload),
        codex_cli_display_rows: appendLiveCodexCliDisplayRows(currentMeta.codex_cli_display_rows, eventPayload),
        updated_at: trimText(eventPayload?.timestamp, 80) || new Date().toISOString()
      }
    }
  };
}
