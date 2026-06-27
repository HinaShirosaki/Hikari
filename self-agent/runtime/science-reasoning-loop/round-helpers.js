'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/helpers/agent/shared/agent-llm-utils.js');

function createScienceReasoningRoundHelpers(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings
  } = createAgentLlmRuntimeHelpers(deps);
  const normalizeCitations = typeof deps.normalizeCitations === 'function'
    ? deps.normalizeCitations
    : ((citations) => asArray(citations));
  const normalizeLoadedContextBlocks = typeof deps.normalizeLoadedContextBlocks === 'function'
    ? deps.normalizeLoadedContextBlocks
    : ((blocks) => asArray(blocks));

  function normalizeEvaluationPayload(rawPayload, fallbackReason = '') {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const nextToolHint = source.next_tool_hint && typeof source.next_tool_hint === 'object'
      ? {
        tool_name: cleanText(source.next_tool_hint.tool_name, 120) || null,
        query: cleanText(source.next_tool_hint.query, 320) || null,
        reason: cleanText(source.next_tool_hint.reason, 260) || 'More evidence is required.'
      }
      : null;
    return {
      satisfied: source.satisfied === true,
      reason: cleanText(source.reason, 320) || cleanText(fallbackReason, 320) || 'No sufficiency rationale was provided.',
      missing_requirements: uniqueStrings(asArray(source.missing_requirements), 6),
      should_continue: source.should_continue === true,
      next_tool_hint: nextToolHint,
      can_answer_with_limitations: source.can_answer_with_limitations === true,
      trace_sentence: cleanText(source.trace_sentence, 240)
        || 'I am checking whether the current evidence is sufficient.'
    };
  }

  function buildToolCallThinkingTrace(toolName = '', args = {}) {
    const cleanToolName = cleanText(toolName, 120) || 'the next tool';
    const safeArgs = args && typeof args === 'object' ? args : {};
    const query = cleanText(safeArgs.query, 320);
    const code = cleanText(safeArgs.code, 160);
    const targetId = cleanText(
      safeArgs.paper_id
      || safeArgs.record_id
      || safeArgs.project_id
      || safeArgs.protocol_id,
      160
    );
    if (query) {
      return `I want to use ${cleanToolName} to investigate "${query}".`;
    }
    if (code) {
      return `I want to use ${cleanToolName} to run the required computation.`;
    }
    if (targetId) {
      return `I want to use ${cleanToolName} to inspect ${targetId}.`;
    }
    return `I want to use ${cleanToolName} for the next evidence step.`;
  }

  function buildToolRoundThinkingTrace(calls = []) {
    const normalizedCalls = asArray(calls).filter((call) => call && typeof call === 'object');
    if (normalizedCalls.length <= 1) {
      const firstCall = normalizedCalls[0] || {};
      return buildToolCallThinkingTrace(firstCall.name, firstCall.argsObject);
    }
    const toolNames = uniqueStrings(normalizedCalls.map((call) => cleanText(call?.name, 120)), 4);
    const queries = uniqueStrings(normalizedCalls.map((call) => cleanText(call?.argsObject?.query, 160)), 3);
    if (queries.length) {
      return `I want to use ${toolNames.join(' and ')} in parallel to investigate ${queries.map((query) => `"${query}"`).join(' and ')}.`;
    }
    return `I want to use ${toolNames.join(' and ')} in parallel for the next evidence step.`;
  }

  function buildToolRoundSummary(executedCalls = []) {
    const summaries = uniqueStrings(asArray(executedCalls).map((entry) => (
      cleanText(entry?.toolEnvelope?.summary, 220)
      || cleanText(entry?.toolEnvelope?.error || entry?.toolEnvelope?.result?.error, 220)
    )), 6);
    if (!summaries.length) {
      return 'No tool summary was generated for this round.';
    }
    return summaries.join(' | ');
  }

  function buildRoundToolResult(executedCalls = []) {
    const normalizedCalls = asArray(executedCalls).filter((entry) => entry && typeof entry === 'object');
    const toolNames = uniqueStrings(normalizedCalls.map((entry) => cleanText(entry?.selectedCall?.name, 120)), 6);
    const citations = normalizeCitations(normalizedCalls.flatMap((entry) => (
      asArray(entry?.toolEnvelope?.citations).length
        ? asArray(entry?.toolEnvelope?.citations)
        : asArray(entry?.toolEnvelope?.result?.citations)
    )), 12);
    const loadedContextBlocks = normalizeLoadedContextBlocks(
      normalizedCalls.flatMap((entry) => (
        asArray(entry?.toolEnvelope?.loaded_context_blocks).length
          ? asArray(entry?.toolEnvelope?.loaded_context_blocks)
          : asArray(entry?.toolEnvelope?.result?.loaded_context_blocks)
      )),
      6
    );
    const contradictions = uniqueStrings(normalizedCalls.flatMap((entry) => [
      ...asArray(entry?.toolEnvelope?.contradictions),
      ...asArray(entry?.toolEnvelope?.result?.contradictions)
    ]), 8);
    const errors = uniqueStrings(normalizedCalls.map((entry) => (
      cleanText(entry?.toolEnvelope?.error || entry?.toolEnvelope?.result?.error, 320)
    )), 6);
    const items = normalizedCalls.flatMap((entry) => asArray(entry?.toolEnvelope?.items));
    const summary = normalizedCalls.length > 1
      ? `Parallel tool round completed: ${buildToolRoundSummary(normalizedCalls)}`
      : buildToolRoundSummary(normalizedCalls);
    const error = errors.join(' | ');
    return {
      ok: normalizedCalls.every((entry) => entry?.toolEnvelope?.ok === true),
      tool_name: toolNames.join(' + '),
      tool_names: toolNames,
      items,
      citations,
      loaded_context_blocks: loadedContextBlocks,
      contradictions,
      summary,
      error,
      result: {
        items,
        citations,
        loaded_context_blocks: loadedContextBlocks,
        contradictions,
        summary,
        error
      }
    };
  }

  function buildToolTraceRenderOutputs(rawOutputs = []) {
    return asArray(rawOutputs).slice(0, 6).map((output) => {
      const source = output && typeof output === 'object' ? output : {};
      const type = cleanText(source.type, 40).toLowerCase();
      if (type === 'text') {
        return {
          type: 'text',
          title: cleanText(source.title, 160),
          format: cleanText(source.format, 80).toLowerCase() || 'text/plain',
          content: cleanText(source.content, 24000)
        };
      }
      if (type === 'image') {
        const dataBase64 = String(source.data_base64 || '').replace(/\s+/g, '');
        return {
          type: 'image',
          title: cleanText(source.title, 160),
          alt: cleanText(source.alt, 200),
          mime_type: cleanText(source.mime_type, 120).toLowerCase() || 'image/png',
          data_base64: dataBase64.length <= 1024 * 1024 ? dataBase64 : '',
          path: cleanText(source.path, 240)
        };
      }
      return null;
    }).filter((entry) => {
      if (!entry) {
        return false;
      }
      if (entry.type === 'text') {
        return Boolean(entry.content);
      }
      return Boolean(entry.data_base64);
    });
  }

  return {
    normalizeEvaluationPayload,
    buildToolRoundThinkingTrace,
    buildRoundToolResult,
    buildToolTraceRenderOutputs
  };
}

module.exports = {
  createScienceReasoningRoundHelpers
};
