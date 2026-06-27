'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/helpers/agent/shared/agent-llm-utils.js');

function createScienceToolRoundSatisfactionRuntime(deps = {}) {
  const { asArray, cleanText } = createAgentLlmRuntimeHelpers(deps);

  async function checkCurrentToolRoundSatisfaction(input = {}) {
    const askMainAgentToolRoundSatisfaction = typeof input.askMainAgentToolRoundSatisfaction === 'function'
      ? input.askMainAgentToolRoundSatisfaction
      : null;
    const extractAgentSessionFunctionCalls = typeof input.extractAgentSessionFunctionCalls === 'function'
      ? input.extractAgentSessionFunctionCalls
      : (() => []);
    const normalizeToolCall = typeof input.normalizeToolCall === 'function'
      ? input.normalizeToolCall
      : ((call) => call);
    const toolSchemaMap = input.toolSchemaMap instanceof Map ? input.toolSchemaMap : new Map();
    const session = input.session || null;
    const assistantTextForRound = cleanText(input.assistantTextForRound, 12000);
    const traceContext = input.traceContext || null;

    const existingToolCalls = asArray(extractAgentSessionFunctionCalls(session)).map(normalizeToolCall);
    const existingValidToolCalls = existingToolCalls.filter((call) => toolSchemaMap.has(call.name));

    if (existingToolCalls.length > 0) {
      return {
        satisfied: false,
        reason: 'Main agent already emitted another tool round.',
        trace_sentence: 'I am running the next tool round already emitted by the main agent.',
        session,
        latestAssistantText: assistantTextForRound,
        pendingToolCalls: existingToolCalls,
        pendingValidToolCalls: existingValidToolCalls
      };
    }

    if (askMainAgentToolRoundSatisfaction) {
      const overridden = await askMainAgentToolRoundSatisfaction({
        session,
        latestAssistantText: assistantTextForRound,
        roundsExecuted: Number(input.roundsExecuted) || 0,
        maxRounds: Number(input.maxRounds) || 0,
        traceContext
      }) || {};
      return {
        satisfied: overridden?.satisfied === true,
        reason: cleanText(overridden?.reason, 320)
          || 'Custom next-step hook returned no explicit reason.',
        trace_sentence: cleanText(overridden?.trace_sentence, 240)
          || 'I am deciding the next step from the custom hook.',
        session,
        latestAssistantText: assistantTextForRound,
        pendingToolCalls: [],
        pendingValidToolCalls: []
      };
    }

    return {
      satisfied: true,
      reason: assistantTextForRound
        ? 'Main agent produced a post-tool response without another tool call.'
        : 'Main agent emitted no further tool call; treating as ready for synthesis.',
      trace_sentence: 'I am moving to final synthesis with the current evidence.',
      session,
      latestAssistantText: assistantTextForRound,
      pendingToolCalls: [],
      pendingValidToolCalls: []
    };
  }

  return {
    checkCurrentToolRoundSatisfaction
  };
}

module.exports = {
  createScienceToolRoundSatisfactionRuntime
};
