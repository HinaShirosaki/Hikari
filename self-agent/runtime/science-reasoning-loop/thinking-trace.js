'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/helpers/agent/shared/agent-llm-utils.js');

const SCIENCE_THINKING_TRACE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent_parse_question',
    'question_clarifier',
    'criteria_generate',
    'tool_rounds',
    'pre_synthesize_answer',
    'judge',
    'final_synthesize',
    'final_synthesized_question'
  ],
  properties: {
    intent_parse_question: { type: 'string' },
    question_clarifier: { type: 'string' },
    criteria_generate: { type: 'string' },
    tool_rounds: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['round', 'tool_selection', 'tool_call', 'tool_results'],
        properties: {
          round: { type: 'integer' },
          tool_selection: { type: 'string' },
          tool_call: { type: 'string' },
          tool_results: { type: 'string' }
        }
      }
    },
    pre_synthesize_answer: { type: 'string' },
    judge: { type: 'string' },
    final_synthesize: { type: 'string' },
    final_synthesized_question: { type: 'string' }
  }
};

function createScienceThinkingTraceRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings
  } = createAgentLlmRuntimeHelpers(deps);

  function humanizeIntent(intent = '') {
    const normalized = cleanText(intent, 80).replace(/_/g, ' ');
    if (!normalized) {
      return 'science question';
    }
    if (normalized === 'result analysis') {
      return 'result analysis request';
    }
    return normalized;
  }

  function getRoundToolCalls(round = {}) {
    const groupedCalls = asArray(round.tool_calls)
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        tool_name: cleanText(entry.tool_name, 120),
        tool_arguments: entry.tool_arguments && typeof entry.tool_arguments === 'object'
          ? entry.tool_arguments
          : {},
        tool_summary: cleanText(entry.tool_summary, 320),
        tool_error: cleanText(entry.tool_error, 320)
      }))
      .filter((entry) => entry.tool_name || entry.tool_summary || entry.tool_error);
    if (groupedCalls.length) {
      return groupedCalls;
    }

    const toolName = cleanText(round.tool_name, 120);
    const toolArguments = round.tool_arguments && typeof round.tool_arguments === 'object'
      ? round.tool_arguments
      : {};
    const toolSummary = cleanText(round.tool_summary, 320);
    const toolError = cleanText(round.tool_error, 320);
    if (!toolName && !toolSummary && !toolError) {
      return [];
    }
    return [{
      tool_name: toolName,
      tool_arguments: toolArguments,
      tool_summary: toolSummary,
      tool_error: toolError
    }];
  }

  function buildToolCallFallback(round = {}) {
    const toolCalls = getRoundToolCalls(round);
    if (toolCalls.length > 1) {
      const toolNames = toolCalls
        .map((entry) => cleanText(entry.tool_name, 120))
        .filter(Boolean);
      const queries = uniqueStrings(toolCalls.map((entry) => cleanText(entry.tool_arguments?.query, 160)), 3);
      if (queries.length) {
        return `I want to use ${toolNames.join(' and ')} in parallel to investigate ${queries.map((query) => `"${query}"`).join(' and ')}.`;
      }
      return `I want to use ${toolNames.join(' and ')} in parallel for the next evidence step.`;
    }

    const toolCall = toolCalls[0] || {};
    const toolName = cleanText(toolCall.tool_name, 120) || 'the next tool';
    const args = toolCall.tool_arguments && typeof toolCall.tool_arguments === 'object'
      ? toolCall.tool_arguments
      : {};
    const query = cleanText(args.query, 320);
    const code = cleanText(args.code, 160);
    if (query) {
      return `I want to use ${toolName} to investigate "${query}".`;
    }
    if (code) {
      return `I want to use ${toolName} to run the required computation.`;
    }
    return `I want to use ${toolName} for the next evidence step.`;
  }

  function buildToolResultFallback(round = {}) {
    const assistantAfter = cleanText(round.assistant_after_tool, 420);
    if (assistantAfter) {
      return assistantAfter;
    }
    const toolCalls = getRoundToolCalls(round);
    const summaries = uniqueStrings(toolCalls.map((entry) => cleanText(entry.tool_summary, 220)), 4);
    const errors = uniqueStrings(toolCalls.map((entry) => cleanText(entry.tool_error, 220)), 4);
    const summary = cleanText(round.tool_summary, 320) || summaries.join(' | ');
    const error = cleanText(round.tool_error, 320) || errors.join(' | ');
    if (summary) {
      return `Based on the tool result, it seems ${summary}`;
    }
    if (error) {
      return `Based on the tool result, it seems there is still a blocker: ${error}`;
    }
    return 'Based on the tool result, I still need to confirm what the evidence supports.';
  }

  function buildFallbackThinkingTrace(input = {}) {
    const clarification = input.clarification && typeof input.clarification === 'object'
      ? input.clarification
      : {};
    const routePlan = input.routePlan && typeof input.routePlan === 'object'
      ? input.routePlan
      : {};
    const exitCriteria = input.exitCriteria && typeof input.exitCriteria === 'object'
      ? input.exitCriteria
      : {};
    const evaluation = input.evaluation && typeof input.evaluation === 'object'
      ? input.evaluation
      : {};
    const preSynthesizedAnswer = input.preSynthesizedAnswer && typeof input.preSynthesizedAnswer === 'object'
      ? input.preSynthesizedAnswer
      : {};
    const finalSynthesis = input.finalSynthesis && typeof input.finalSynthesis === 'object'
      ? input.finalSynthesis
      : {};
    const clarifiedInput = cleanText(input.clarifiedInput || input.message || input.originalMessage, 3200);
    const partial = input.partial === true || cleanText(input.status, 40) === 'partial';
    const criteriaTrace = uniqueStrings([
      cleanText(routePlan.trace_sentence, 240),
      cleanText(exitCriteria.trace_sentence, 240)
    ], 2).join(' ');

    return {
      intent_parse_question: cleanText(input?.parserPayload?.reasoning_summary, 420)
        || `This is a ${humanizeIntent(input.intent)}.`,
      question_clarifier: cleanText(clarification.trace_sentence, 420)
        || cleanText(clarification.analysis_goal, 420)
        || cleanText(clarification.follow_up_reason, 420)
        || (clarifiedInput
          ? `The user wants to understand: ${clarifiedInput}`
          : 'I am clarifying exactly what the user wants to know.'),
      criteria_generate: criteriaTrace
        || cleanText(exitCriteria.reasoning_notes, 420)
        || cleanText(exitCriteria.objective_summary, 420)
        || 'I am defining what evidence would be enough to answer safely.',
      tool_rounds: asArray(input.toolRounds).slice(0, 8).map((round, index) => ({
        round: Math.max(1, Number(round?.round) || index + 1),
        tool_selection: cleanText(round?.assistant_before_tool, 420)
          || `I am looking at the tool list to choose the most targeted next step for round ${index + 1}.`,
        tool_call: buildToolCallFallback(round),
        tool_results: buildToolResultFallback(round)
      })),
      pre_synthesize_answer: cleanText(
        preSynthesizedAnswer?.tentative_answer?.current_best_answer,
        420
      ) || cleanText(input.latestAssistantText, 420)
        || 'Based on the evidence so far, I am drafting a tentative answer.',
      judge: cleanText(evaluation.trace_sentence, 420)
        || cleanText(evaluation.reason, 420)
        || 'I am checking whether the evidence is sufficient or whether a key gap remains.',
      final_synthesize: cleanText(finalSynthesis.trace_sentence, 420)
        || (partial
        ? 'I am synthesizing the best grounded answer I can while naming the remaining gaps.'
        : 'I have gathered enough information and I am ready to synthesize the final answer.'),
      final_synthesized_question: cleanText(input.finalSynthesizedQuestion, 3200)
        || clarifiedInput
        || cleanText(input.originalMessage, 3200)
        || 'What is the best grounded answer to the user request?'
    };
  }

  function normalizeToolRound(rawRound, fallbackRound = {}, index = 0) {
    const source = rawRound && typeof rawRound === 'object' ? rawRound : {};
    const fallback = fallbackRound && typeof fallbackRound === 'object' ? fallbackRound : {};
    return {
      round: Math.max(1, Number(source.round) || Number(fallback.round) || index + 1),
      tool_selection: cleanText(source.tool_selection, 420)
        || cleanText(fallback.tool_selection, 420)
        || `I am looking at the tool list to choose the next step for round ${index + 1}.`,
      tool_call: cleanText(source.tool_call, 420)
        || cleanText(fallback.tool_call, 420)
        || 'I am preparing the next tool call.',
      tool_results: cleanText(source.tool_results, 420)
        || cleanText(fallback.tool_results, 420)
        || 'I am reviewing what the tool returned.'
    };
  }

  function normalizeThinkingTrace(rawPayload, fallback = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
    const sourceRounds = asArray(source.tool_rounds);
    const fallbackRounds = asArray(fallbackSource.tool_rounds);
    const resolvedRounds = (sourceRounds.length ? sourceRounds : fallbackRounds)
      .slice(0, 8)
      .map((round, index) => normalizeToolRound(round, fallbackRounds[index], index));

    return {
      intent_parse_question: cleanText(source.intent_parse_question, 420)
        || cleanText(fallbackSource.intent_parse_question, 420)
        || 'I am classifying the user request.',
      question_clarifier: cleanText(source.question_clarifier, 420)
        || cleanText(fallbackSource.question_clarifier, 420)
        || 'I am clarifying the question before continuing.',
      criteria_generate: cleanText(source.criteria_generate, 420)
        || cleanText(fallbackSource.criteria_generate, 420)
        || 'I am defining the criteria for a grounded answer.',
      tool_rounds: resolvedRounds,
      pre_synthesize_answer: cleanText(source.pre_synthesize_answer, 420)
        || cleanText(fallbackSource.pre_synthesize_answer, 420)
        || 'I am drafting a tentative answer from the evidence collected so far.',
      judge: cleanText(source.judge, 420)
        || cleanText(fallbackSource.judge, 420)
        || 'I am judging whether the current evidence is sufficient.',
      final_synthesize: cleanText(source.final_synthesize, 420)
        || cleanText(fallbackSource.final_synthesize, 420)
        || 'I am synthesizing the final answer.',
      final_synthesized_question: cleanText(source.final_synthesized_question, 3200)
        || cleanText(fallbackSource.final_synthesized_question, 3200)
        || 'What is the best grounded answer to the user request?'
    };
  }

  function buildThinkingTracePrompt(input = {}) {
    const examples = uniqueStrings([
      'This is a general science question.',
      'The user wants to understand the mechanism with grounded evidence.',
      'I am looking at the tool list to pick the most targeted next step.',
      'I want to search for a focused literature source first.',
      'Based on the tool result, it seems I still need one broader source.',
      'I have gathered enough information, and I am ready to synthesize the final answer.'
    ], 8);

    const compactToolRounds = asArray(input.toolRounds).slice(0, 8).map((round) => ({
      round: Number(round?.round) || 0,
      assistant_before_tool: cleanText(round?.assistant_before_tool, 420),
      tool_name: cleanText(round?.tool_name, 120),
      tool_arguments: round?.tool_arguments && typeof round.tool_arguments === 'object'
        ? round.tool_arguments
        : {},
      tool_calls: getRoundToolCalls(round),
      tool_summary: cleanText(round?.tool_summary, 320),
      tool_error: cleanText(round?.tool_error, 320),
      assistant_after_tool: cleanText(round?.assistant_after_tool, 420)
    }));
    const executionRequest = cleanText(input.clarifiedInput || input.message || input.originalMessage, 3200);

    return [
      'Generate short workflow-thinking sentences for this science reasoning run.',
      'Return exactly one concise sentence for each named step.',
      'Use only the supplied trace and do not invent tools, papers, computations, or conclusions.',
      'The tone should sound like an internal working note, for example:',
      ...examples.map((item) => `- ${item}`),
      'For tool_rounds, create one entry per executed round.',
      'final_synthesized_question must be the best single-sentence formulation of the exact question the workflow answered or tried to answer.',
      `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
      `Original user message:\n${cleanText(input.originalMessage, 3200)}`,
      `Clarified request:\n${cleanText(input.clarifiedInput || input.message || input.originalMessage, 3200)}`,
      `Parser payload JSON:\n${JSON.stringify(input.parserPayload || {}, null, 2)}`,
      input.clarification ? `Clarification JSON:\n${JSON.stringify(input.clarification, null, 2)}` : '',
      input.routePlan ? `Route plan JSON:\n${JSON.stringify(input.routePlan, null, 2)}` : '',
      input.exitCriteria ? `Exit criteria JSON:\n${JSON.stringify(input.exitCriteria, null, 2)}` : '',
      compactToolRounds.length ? `Tool rounds JSON:\n${JSON.stringify(compactToolRounds, null, 2)}` : 'Tool rounds JSON:\n[]',
      input.preSynthesizedAnswer ? `Pre-synthesized answer JSON:\n${JSON.stringify(input.preSynthesizedAnswer, null, 2)}` : '',
      input.evaluation ? `Judge evaluation JSON:\n${JSON.stringify(input.evaluation, null, 2)}` : '',
      `Final status: ${cleanText(input.status, 40) || (input.partial === true ? 'partial' : 'completed')}`,
      `Final answer:\n${cleanText(input.finalAnswer || input.answer, 3200) || '-'}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function generateThinkingTrace(input = {}) {
    const fallback = buildFallbackThinkingTrace(input);
    return normalizeThinkingTrace(input.thinkingTrace, fallback);
  }

  return {
    SCIENCE_THINKING_TRACE_SCHEMA,
    buildFallbackThinkingTrace,
    buildThinkingTracePrompt,
    normalizeThinkingTrace,
    generateThinkingTrace
  };
}

module.exports = {
  SCIENCE_THINKING_TRACE_SCHEMA,
  createScienceThinkingTraceRuntime
};
