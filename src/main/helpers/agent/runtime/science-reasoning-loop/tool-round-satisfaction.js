'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');

function createScienceToolRoundSatisfactionRuntime(deps = {}) {
  const { asArray, cleanText } = createAgentLlmRuntimeHelpers(deps);

  function buildToolRoundDecisionQuestion() {
    return [
      'The latest tool round just completed. Pick exactly one next step and respond accordingly:',
      '- If more evidence is still needed, emit your next tool call (one call, or a tightly scoped parallel batch). Do not also write prose; the runtime will execute the calls and return their outputs.',
      '- Otherwise, if the current evidence is enough to answer the user, write your synthesis-ready draft answer as plain assistant text and do not call any tool.',
      'Choose only one path. The runtime will execute any tool calls you emit, or hand the assistant text off to final synthesis.'
    ].join('\n');
  }

  async function checkCurrentToolRoundSatisfaction(input = {}) {
    const askMainAgentToolRoundSatisfaction = typeof input.askMainAgentToolRoundSatisfaction === 'function'
      ? input.askMainAgentToolRoundSatisfaction
      : null;
    const continueAgentSessionWithUserMessage = typeof input.continueAgentSessionWithUserMessage === 'function'
      ? input.continueAgentSessionWithUserMessage
      : (async (session) => session);
    const extractAgentSessionText = typeof input.extractAgentSessionText === 'function'
      ? input.extractAgentSessionText
      : (() => '');
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

    const decisionSession = await continueAgentSessionWithUserMessage(
      session,
      buildToolRoundDecisionQuestion(),
      traceContext
    );
    const decisionText = cleanText(extractAgentSessionText(decisionSession), 12000);
    const pendingToolCalls = asArray(extractAgentSessionFunctionCalls(decisionSession)).map(normalizeToolCall);
    const pendingValidToolCalls = pendingToolCalls.filter((call) => toolSchemaMap.has(call.name));

    if (pendingToolCalls.length > 0) {
      return {
        satisfied: false,
        reason: 'Main agent committed to another tool round.',
        trace_sentence: 'I am running another tool round before synthesizing.',
        session: decisionSession,
        latestAssistantText: decisionText,
        pendingToolCalls,
        pendingValidToolCalls
      };
    }

    return {
      satisfied: true,
      reason: decisionText
        ? 'Main agent committed to a synthesis-ready answer.'
        : 'Main agent emitted no further tool call; treating as ready for synthesis.',
      trace_sentence: 'I am moving to final synthesis with the current evidence.',
      session: decisionSession,
      latestAssistantText: decisionText || assistantTextForRound,
      pendingToolCalls: [],
      pendingValidToolCalls: []
    };
  }

  return {
    buildToolRoundDecisionQuestion,
    checkCurrentToolRoundSatisfaction
  };
}

module.exports = {
  createScienceToolRoundSatisfactionRuntime
};
