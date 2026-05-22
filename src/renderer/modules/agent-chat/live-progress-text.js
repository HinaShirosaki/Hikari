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
  const round = trimText(eventPayload?.meta?.round, 40);
  const step = trimText(eventPayload?.meta?.step, 40);
  if (['tool_call_started', 'tool_call_completed', 'tool_call_failed'].includes(stage)) {
    return `tool:${toolName}`;
  }
  if (stage === 'science_round_started') {
    return `science-round:${round || '0'}:${toolName}`;
  }
  if (stage === 'science_evaluator_continue' || stage === 'science_evaluator_satisfied') {
    return `science-evaluator:${round || '0'}`;
  }
  if (stage === 'deep_research_step_started' || stage === 'deep_research_step_completed') {
    return `deep-research-step:${step || '0'}`;
  }
  return stage;
}

export function getProgressRowText(eventPayload = {}) {
  const stage = trimText(eventPayload?.stage, 80);
  const round = trimText(eventPayload?.meta?.round, 40);
  const step = trimText(eventPayload?.meta?.step, 40);
  const stepTitle = trimText(eventPayload?.meta?.title, 160);
  const toolLabel = getToolActivityLabel(eventPayload?.tool_name);
  const stageLabels = {
    request_received: 'Request received',
    request_aborted: 'Request stopped',
    controller_intent_only_selected: 'Preparing parser-first request',
    controller_intent_only: 'Running parser-first controller',
    controller_codex_agent_selected: 'Preparing Codex agent request',
    controller_codex_agent: 'Routing to Codex agent',
    codex_agent_started: 'Codex agent running',
    codex_agent_stream: 'Codex response streaming',
    codex_agent_completed: 'Codex agent completed',
    parser_completed: 'Intent parsed',
    protocol_to_notebook_followup: 'Continuing notebook follow-up',
    protocol_to_notebook_completed: 'Notebook draft status updated',
    purchase_recommendation_started: 'Finding products to buy',
    purchase_recommendation_completed: 'Purchase recommendations updated',
    inventory_lookup_started: 'Checking inventory records',
    inventory_lookup_completed: 'Inventory lookup updated',
    record_lookup_started: 'Checking lab records',
    record_lookup_completed: 'Record lookup updated',
    notebook_draft_started: getToolActivityLabel('notebook-draft'),
    notebook_draft_completed: 'Notebook draft updated',
    science_intent_start: 'Starting reasoning loop',
    science_intent_started: 'Reasoning loop ready',
    science_clarification_started: 'Clarifying the request',
    science_clarification_completed: 'Request clarified',
    science_route_planner_started: 'Drafting route plan',
    science_route_planner_completed: 'Route plan ready',
    science_exit_criteria_started: 'Defining stopping criteria',
    science_exit_criteria_completed: 'Stopping criteria ready',
    science_evaluator_continue: round ? `Round ${round}: More evidence needed` : 'More evidence needed',
    science_evaluator_satisfied: round ? `Round ${round}: Evidence is sufficient` : 'Evidence is sufficient',
    science_budget_exhausted: round ? `Round ${round}: Reasoning budget exhausted` : 'Reasoning budget exhausted',
    science_intent_completed: 'Reasoning completed',
    deep_research_started: 'Starting deep research',
    deep_research_completed: 'Deep research completed',
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
  if (stage === 'science_round_started') {
    return round ? `Round ${round}: ${toolLabel}` : toolLabel;
  }
  if (stage === 'deep_research_step_started' || stage === 'deep_research_step_completed') {
    if (step && stepTitle) {
      return `Step ${step}: ${stepTitle}`;
    }
    if (step) {
      return `Step ${step}`;
    }
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
