'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');

const SCIENCE_INPUT_CLARIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'clarified_input',
    'analysis_goal',
    'important_constraints',
    'missing_information',
    'should_ask_follow_up',
    'follow_up_question',
    'follow_up_reason'
  ],
  properties: {
    clarified_input: { type: 'string' },
    analysis_goal: { type: 'string' },
    important_constraints: {
      type: 'array',
      items: { type: 'string' }
    },
    missing_information: {
      type: 'array',
      items: { type: 'string' }
    },
    should_ask_follow_up: { type: 'boolean' },
    follow_up_question: { type: 'string' },
    follow_up_reason: { type: 'string' }
  }
};

function createScienceInputClarificationRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);

  function buildConversationExcerpt(conversation = [], maxTurns = 6) {
    return asArray(conversation)
      .slice(-Math.max(1, Number(maxTurns) || 6))
      .map((entry) => ({
        role: cleanText(entry?.role, 30) || 'user',
        text: cleanText(entry?.text, 1200)
      }))
      .filter((entry) => entry.text);
  }

  function buildFallbackClarification(input = {}) {
    const intent = cleanText(input.intent, 80);
    const message = cleanText(input.message, 3200);
    const parserPayload = input.parserPayload && typeof input.parserPayload === 'object' ? input.parserPayload : {};
    const routing = input.routing && typeof input.routing === 'object' ? input.routing : {};
    const project = input.project && typeof input.project === 'object' ? input.project : null;
    const missingInformation = [];
    let shouldAskFollowUp = false;
    let followUpQuestion = '';
    let followUpReason = '';

    if (parserPayload.needs_clarification === true) {
      shouldAskFollowUp = true;
      followUpQuestion = cleanText(
        parserPayload.clarification_question || parserPayload.clarification_reason,
        320
      ) || 'Could you clarify the missing detail so I can continue safely?';
      followUpReason = cleanText(parserPayload.clarification_reason, 260)
        || 'The parser marked the request as underspecified.';
      missingInformation.push(followUpReason);
    }

    if (intent === 'project_science_question' && !cleanText(project?.id || project?.name, 220)) {
      shouldAskFollowUp = true;
      followUpQuestion = cleanText(input.projectResolutionQuestion, 320) || followUpQuestion;
      followUpReason = followUpReason || 'Project-scoped science reasoning requires a resolved project.';
      missingInformation.push('project scope');
    }

    const clarifiedInput = uniqueStrings([
      message,
      project?.name && intent === 'project_science_question'
        ? `Project: ${cleanText(project.name, 220)}. ${message}`
        : '',
      cleanText(routing?.entities?.requested_output, 220)
        ? `Requested output: ${cleanText(routing.entities.requested_output, 220)}. ${message}`
        : ''
    ], 3)[0] || message;

    return {
      clarified_input: clarifiedInput || 'Clarify the user request before continuing.',
      analysis_goal: message || 'Clarify the user request into an execution-ready science question.',
      important_constraints: uniqueStrings([
        intent ? `Intent: ${intent}` : '',
        project?.name ? `Project: ${cleanText(project.name, 220)}` : '',
        cleanText(parserPayload?.entities?.requested_output, 160)
          ? `Requested output: ${cleanText(parserPayload.entities.requested_output, 160)}`
          : '',
        cleanText(parserPayload?.entities?.assay_name, 160)
          ? `Assay: ${cleanText(parserPayload.entities.assay_name, 160)}`
          : '',
        cleanText(parserPayload?.entities?.protein, 160)
          ? `Protein: ${cleanText(parserPayload.entities.protein, 160)}`
          : ''
      ], 8),
      missing_information: uniqueStrings(missingInformation, 5),
      should_ask_follow_up: shouldAskFollowUp,
      follow_up_question: followUpQuestion,
      follow_up_reason: followUpReason || 'The request is specific enough to continue.'
    };
  }

  function normalizeClarificationPayload(rawPayload, fallback = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    return {
      clarified_input: cleanText(source.clarified_input, 3200)
        || cleanText(fallback.clarified_input, 3200)
        || 'Clarify the user request before continuing.',
      analysis_goal: cleanText(source.analysis_goal, 1200)
        || cleanText(fallback.analysis_goal, 1200)
        || 'Clarify the user request into an execution-ready science question.',
      important_constraints: uniqueStrings([
        ...asArray(source.important_constraints),
        ...asArray(fallback.important_constraints)
      ], 8),
      missing_information: uniqueStrings([
        ...asArray(source.missing_information),
        ...asArray(fallback.missing_information)
      ], 6),
      should_ask_follow_up: source.should_ask_follow_up === true || fallback.should_ask_follow_up === true,
      follow_up_question: cleanText(source.follow_up_question, 320)
        || cleanText(fallback.follow_up_question, 320),
      follow_up_reason: cleanText(source.follow_up_reason, 260)
        || cleanText(fallback.follow_up_reason, 260)
        || 'The request is specific enough to continue.'
    };
  }

  function buildClarificationPrompt(input = {}) {
    const conversationExcerpt = buildConversationExcerpt(input.conversation, 6);
    return [
      'Clarify the user request for the science reasoning loop.',
      'Rewrite the request into a self-contained, execution-ready input for the next module.',
      'Ask at most one follow-up question, and only when the missing detail is truly blocking.',
      'Preserve the scientific intent, any request for recent/current evidence, and any need for deterministic computation.',
      cleanText(input.intent, 80) === 'project_science_question'
        ? 'If project scope is unresolved, ask a follow-up instead of guessing.'
        : '',
      `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
      input.project ? `Resolved project JSON:\n${JSON.stringify(input.project, null, 2)}` : '',
      cleanText(input.projectResolutionQuestion, 320)
        ? `Project resolution hint:\n${cleanText(input.projectResolutionQuestion, 320)}`
        : '',
      `Parser payload JSON:\n${JSON.stringify(input.parserPayload || {}, null, 2)}`,
      `Routing JSON:\n${JSON.stringify(input.routing || {}, null, 2)}`,
      conversationExcerpt.length ? `Recent conversation JSON:\n${JSON.stringify(conversationExcerpt, null, 2)}` : '',
      `User message:\n${cleanText(input.message, 3200)}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function clarifyInput(input = {}) {
    const fallback = buildFallbackClarification(input);
    const result = await requestStructuredJsonPayload({
      provider: cleanText(input.provider, 80),
      endpoint: cleanText(input.endpoint, 2000),
      apiKey: cleanText(input.apiKey, 400),
      model: cleanText(input.model, 120),
      stage: 'science_input_clarification',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildClarificationPrompt(input),
      schema: SCIENCE_INPUT_CLARIFICATION_SCHEMA,
      traceContext: input.traceContext || null,
      maxOutputTokens: 1400,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Science input clarification is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return fallback;
    }
    return normalizeClarificationPayload(result.payload, fallback);
  }

  return {
    SCIENCE_INPUT_CLARIFICATION_SCHEMA,
    buildFallbackClarification,
    clarifyInput
  };
}

module.exports = {
  SCIENCE_INPUT_CLARIFICATION_SCHEMA,
  createScienceInputClarificationRuntime
};
