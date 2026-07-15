import { TOOL_ACTIVITY_LABELS, trimText } from './shared.js';

export function progressBadgeStatus(statusText = '') {
  const normalized = trimText(statusText, 40).toLowerCase();
  if (['ok', 'completed', 'done', 'matched'].includes(normalized)) {
    return 'done';
  }
  if (['aborted', 'stopped', 'canceled', 'cancelled'].includes(normalized)) {
    return 'aborted';
  }
  if (['failed', 'error', 'no_match'].includes(normalized)) {
    return 'error';
  }
  return 'pending';
}

export function progressStatusRank(statusText = '') {
  const normalized = progressBadgeStatus(statusText);
  if (normalized === 'error') {
    return 4;
  }
  if (normalized === 'aborted') {
    return 3;
  }
  if (normalized === 'done') {
    return 2;
  }
  return 1;
}

export function humanizeToken(value) {
  const text = trimText(value, 120);
  if (!text) {
    return '';
  }
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getToolActivityLabel(toolName = '') {
  const normalized = trimText(toolName, 120);
  return TOOL_ACTIVITY_LABELS[normalized] || humanizeToken(normalized) || 'Running tool';
}

export function getProgressRowKey(eventPayload = {}) {
  const stage = trimText(eventPayload?.stage, 80);
  const toolName = trimText(eventPayload?.tool_name, 120);
  if (['tool_call_started', 'tool_call_completed', 'tool_call_failed'].includes(stage)) {
    return `tool:${toolName}`;
  }
  return stage;
}

export function getProgressRowText(eventPayload = {}) {
  const stage = trimText(eventPayload?.stage, 80);
  const toolLabel = getToolActivityLabel(eventPayload?.tool_name);
  const stageLabels = {
    request_received: 'Request received',
    request_aborted: 'Request stopped',
    controller_codex_agent_selected: 'Preparing Codex agent request',
    controller_codex_agent: 'Routing to Codex agent',
    codex_agent_started: 'Codex agent running',
    codex_agent_stream: 'Codex response streaming',
    codex_agent_completed: 'Codex agent completed',
    response_emitted: 'Final answer ready',
    controller_error: 'Request failed'
  };
  if (['tool_call_started', 'tool_call_completed', 'tool_call_failed'].includes(stage)) {
    if (trimText(eventPayload?.routing_intent, 120) === 'codex_agent') {
      const message = trimText(eventPayload?.message, 420);
      if (message) {
        return message;
      }
    }
    return toolLabel;
  }
  return stageLabels[stage] || trimText(eventPayload?.message, 240) || humanizeToken(stage) || 'Working on this';
}

export function extractLiveStreamText(eventPayload = {}) {
  const meta = eventPayload?.meta && typeof eventPayload.meta === 'object' ? eventPayload.meta : {};
  return trimText(
    eventPayload?.stream_text
      || eventPayload?.streamText
      || eventPayload?.accumulated_text
      || eventPayload?.accumulatedText
      || meta.stream_text
      || meta.streamText
      || meta.accumulated_text
      || meta.accumulatedText,
    120000
  );
}

export function extractLiveThinkingTrace(eventPayload = {}) {
  const meta = eventPayload?.meta && typeof eventPayload.meta === 'object' ? eventPayload.meta : {};
  return trimText(
    eventPayload?.thinking_trace
      || eventPayload?.thinkingTrace
      || eventPayload?.tool_call_text
      || eventPayload?.toolCallText
      || eventPayload?.trace_sentence
      || eventPayload?.traceSentence
      || meta.thinking_trace
      || meta.thinkingTrace
      || meta.tool_call_text
      || meta.toolCallText
      || meta.trace_sentence
      || meta.traceSentence,
    420
  );
}

export function extractLiveCodexCliDisplayText(eventPayload = {}) {
  const stage = trimText(eventPayload?.stage, 80);
  const meta = eventPayload?.meta && typeof eventPayload.meta === 'object' ? eventPayload.meta : {};
  if (stage !== 'codex_cli_display' && !meta.codex_display_text && !meta.codexDisplayText) {
    return '';
  }
  return trimText(
    eventPayload?.codex_display_text
      || eventPayload?.codexDisplayText
      || eventPayload?.display_text
      || eventPayload?.displayText
      || meta.codex_display_text
      || meta.codexDisplayText
      || eventPayload?.message,
    1200
  );
}
