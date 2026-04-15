'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');

function createScienceToolRoundSatisfactionRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    safeParseJson
  } = createAgentLlmRuntimeHelpers(deps);

  function normalizeToolRoundSatisfactionPayload(rawPayload, fallbackReason = '') {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    return {
      satisfied: source.satisfied === true,
      reason: cleanText(source.reason, 320)
        || cleanText(fallbackReason, 320)
        || 'No tool-round satisfaction rationale was provided.',
      trace_sentence: cleanText(source.trace_sentence, 240)
        || 'I am deciding whether the latest tool round feels sufficient before pre-synthesis.'
    };
  }

  function parseToolRoundSatisfactionResponse(text = '') {
    const rawText = cleanText(text, 12000);
    if (!rawText) {
      return null;
    }
    const xmlSatisfied = rawText.match(/<satisfied>\s*(true|false)\s*<\/satisfied>/i);
    if (xmlSatisfied) {
      const xmlReason = rawText.match(/<reason>\s*([\s\S]*?)\s*<\/reason>/i);
      return {
        satisfied: /^true$/i.test(String(xmlSatisfied[1] || '')),
        reason: cleanText(xmlReason?.[1], 320),
        trace_sentence: 'I am deciding whether the latest tool round feels sufficient before pre-synthesis.'
      };
    }
    const fencedJson = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const parsed = safeParseJson(fencedJson?.[1] || rawText, null);
    if (parsed && typeof parsed === 'object' && typeof parsed.satisfied === 'boolean') {
      return {
        satisfied: parsed.satisfied === true,
        reason: cleanText(parsed.reason, 320),
        trace_sentence: 'I am deciding whether the latest tool round feels sufficient before pre-synthesis.'
      };
    }
    return null;
  }

  function buildToolRoundSatisfactionQuestion() {
    return [
      'Before pre-synthesizing, decide whether the current tool call results are satisfying.',
      'If they are satisfying, reply with only this block and nothing else:',
      '<tool_round_satisfaction><satisfied>true</satisfied><reason>one short sentence</reason></tool_round_satisfaction>',
      'If they are not satisfying, do not reply with a satisfaction block. Continue directly with the next best tool call or tightly scoped parallel tool batch.'
    ].join('\n');
  }

  function buildToolRoundSatisfactionFeedback(satisfaction) {
    return [
      'The latest tool results are not satisfying yet.',
      cleanText(satisfaction?.reason, 320) ? `Reason: ${cleanText(satisfaction.reason, 320)}` : '',
      'Continue with the next best tool call or tightly scoped parallel tool batch. Do not pre-synthesize yet.'
    ].filter(Boolean).join('\n');
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
    const roundsExecuted = Number(input.roundsExecuted) || 0;
    const maxRounds = Number(input.maxRounds) || 0;
    const traceContext = input.traceContext || null;

    if (askMainAgentToolRoundSatisfaction) {
      const overridden = normalizeToolRoundSatisfactionPayload(
        await askMainAgentToolRoundSatisfaction({
          session,
          latestAssistantText: assistantTextForRound,
          roundsExecuted,
          maxRounds,
          traceContext
        }),
        'Main-agent tool-round satisfaction check returned no explicit reason.'
      );
      return {
        ...overridden,
        session,
        latestAssistantText: assistantTextForRound,
        pendingToolCalls: [],
        pendingValidToolCalls: []
      };
    }

    const satisfactionSession = await continueAgentSessionWithUserMessage(
      session,
      buildToolRoundSatisfactionQuestion(),
      traceContext
    );
    const satisfactionText = cleanText(extractAgentSessionText(satisfactionSession), 12000);
    const pendingToolCalls = asArray(extractAgentSessionFunctionCalls(satisfactionSession)).map(normalizeToolCall);
    const pendingValidToolCalls = pendingToolCalls.filter((call) => toolSchemaMap.has(call.name));
    const parsedSatisfaction = normalizeToolRoundSatisfactionPayload(
      parseToolRoundSatisfactionResponse(satisfactionText),
      satisfactionText
    );

    if (pendingValidToolCalls.length) {
      return {
        ...parsedSatisfaction,
        satisfied: false,
        session: satisfactionSession,
        latestAssistantText: satisfactionText,
        pendingToolCalls,
        pendingValidToolCalls
      };
    }

    if (parsedSatisfaction.satisfied === true) {
      return {
        ...parsedSatisfaction,
        session,
        latestAssistantText: assistantTextForRound,
        pendingToolCalls: [],
        pendingValidToolCalls: []
      };
    }

    return {
      ...parsedSatisfaction,
      satisfied: false,
      session: satisfactionSession,
      latestAssistantText: satisfactionText,
      pendingToolCalls,
      pendingValidToolCalls: []
    };
  }

  return {
    normalizeToolRoundSatisfactionPayload,
    parseToolRoundSatisfactionResponse,
    buildToolRoundSatisfactionQuestion,
    buildToolRoundSatisfactionFeedback,
    checkCurrentToolRoundSatisfaction
  };
}

module.exports = {
  createScienceToolRoundSatisfactionRuntime
};
