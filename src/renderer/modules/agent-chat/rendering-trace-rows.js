import { asArray, trimText } from './shared.js';
import {
  filterGeneratedTraceRows,
  normalizeActivityTraceRows,
  normalizeCodexCliDisplayRows,
  normalizeThinkingTraceRows
} from './rendering-trace-normalizers.js';

function buildStructuredThinkingTraceRows(trace) {
  const source = trace && typeof trace === 'object' ? trace : null;
  if (!source) {
    return [];
  }
  const rows = [
    trimText(source.intent_parse_question, 420)
      ? `Intent parse: ${trimText(source.intent_parse_question, 420)}`
      : '',
    trimText(source.question_clarifier, 420)
      ? `Clarify: ${trimText(source.question_clarifier, 420)}`
      : '',
    trimText(source.criteria_generate, 420)
      ? `Criteria: ${trimText(source.criteria_generate, 420)}`
      : ''
  ].filter(Boolean);

  asArray(source.tool_rounds).slice(0, 8).forEach((round, index) => {
    const roundNumber = Math.max(1, Number(round?.round) || index + 1);
    const toolSelection = trimText(round?.tool_selection, 420);
    const toolCall = trimText(round?.tool_call, 420);
    const toolResults = trimText(round?.tool_results, 420);
    if (toolSelection) {
      rows.push(`Round ${roundNumber} selection: ${toolSelection}`);
    }
    if (toolCall) {
      rows.push(`Round ${roundNumber} call: ${toolCall}`);
    }
    if (toolResults) {
      rows.push(`Round ${roundNumber} results: ${toolResults}`);
    }
  });

  [
    ['Pre-synthesis', source.pre_synthesize_answer],
    ['Judge', source.judge],
    ['Final synthesis', source.final_synthesize],
    ['Answered question', source.final_synthesized_question]
  ].forEach(([label, value]) => {
    const clean = trimText(value, 420);
    if (clean) {
      rows.push(`${label}: ${clean}`);
    }
  });
  return rows.slice(0, 32);
}

function collectAssistantThinkingTraceRows(meta) {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  const liveThinkingRows = normalizeThinkingTraceRows(liveProgress?.thinking_rows);
  if (liveThinkingRows.length) {
    return liveThinkingRows;
  }
  const structuredThinkingRows = buildStructuredThinkingTraceRows(meta.thinking_trace);
  if (structuredThinkingRows.length) {
    return structuredThinkingRows;
  }
  return normalizeThinkingTraceRows(meta.thinking_trace_rows || meta.thinkingTraceRows);
}

function collectAssistantActivityRows(meta) {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  const liveActivityRows = normalizeActivityTraceRows(liveProgress?.activity_rows);
  if (liveActivityRows.length) {
    return liveActivityRows;
  }
  return normalizeActivityTraceRows(meta.activity_trace_rows || meta.activityTraceRows);
}

function collectAssistantCodexCliDisplayRows(meta) {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  const liveDisplayRows = normalizeCodexCliDisplayRows(liveProgress?.codex_cli_display_rows);
  if (liveDisplayRows.length) {
    return liveDisplayRows;
  }
  return normalizeCodexCliDisplayRows(
    meta.codex_cli_display_rows
      || meta.codexCliDisplayRows
      || meta.codex_display_rows
      || meta.codexDisplayRows
  );
}

function isCodexAgentTraceMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return false;
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  const routingIntent = trimText(
    liveProgress?.routing_intent
      || meta.routing_intent
      || meta.routingIntent
      || meta.parser?.primary_intent
      || meta.parser?.primaryIntent,
    120
  );
  return routingIntent === 'codex_agent' || Boolean(meta.codex_agent || meta.codexAgent);
}

export function collectAssistantGeneratedTraceRows(meta, finalText = '') {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const codexCliRows = collectAssistantCodexCliDisplayRows(meta);
  if (codexCliRows.length && isCodexAgentTraceMeta(meta)) {
    return filterGeneratedTraceRows(codexCliRows, finalText);
  }
  return filterGeneratedTraceRows([
    ...collectAssistantThinkingTraceRows(meta),
    ...collectAssistantActivityRows(meta)
  ], finalText);
}
