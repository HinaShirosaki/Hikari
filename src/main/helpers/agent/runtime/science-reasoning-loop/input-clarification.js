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
    'follow_up_reason',
    'trace_sentence'
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
    follow_up_reason: { type: 'string' },
    trace_sentence: { type: 'string' }
  }
};

function createScienceInputClarificationRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);

  function findLastAssistantText(conversation) {
    const turns = asArray(conversation);
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (cleanText(turn?.role, 20) === 'assistant') {
        const text = cleanText(turn?.text, 3200);
        if (text) {
          return text;
        }
      }
    }
    return '';
  }

  function isContinuationDirective(message) {
    const text = cleanText(message, 240).toLowerCase();
    if (!text) {
      return false;
    }
    const pattern = /^(think\s+(harder|deeper|more|again)|go\s+(deeper|further|on)|dig\s+deeper|keep\s+going|continue|elaborate|explain\s+(more|further)|more\s+detail(s)?|tell\s+me\s+more|what\s+else|expand|say\s+more)\b[\s.!?]*$/;
    return pattern.test(text);
  }

  function buildFallbackClarification(input = {}) {
    const intent = cleanText(input.intent, 80);
    const message = cleanText(input.message, 3200);
    const parserPayload = input.parserPayload && typeof input.parserPayload === 'object' ? input.parserPayload : {};
    const routing = input.routing && typeof input.routing === 'object' ? input.routing : {};
    const project = input.project && typeof input.project === 'object' ? input.project : null;
    const priorAssistantText = findLastAssistantText(input.conversation);
    const continuationDirective = isContinuationDirective(message) && priorAssistantText;
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

    const continuationAnchored = continuationDirective
      ? `Continue the prior scientific topic with a deeper, more rigorous pass. Prior answer to extend: ${priorAssistantText}. User follow-up directive: ${message}.`
      : '';
    const clarifiedInput = uniqueStrings([
      continuationAnchored,
      message,
      project?.name && intent === 'project_science_question'
        ? `Project: ${cleanText(project.name, 220)}. ${message}`
        : '',
      cleanText(routing?.entities?.requested_output, 220)
        ? `Requested output: ${cleanText(routing.entities.requested_output, 220)}. ${message}`
        : ''
    ], 4)[0] || message;

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
      follow_up_reason: followUpReason || 'The request is specific enough to continue.',
      trace_sentence: shouldAskFollowUp
        ? (intent === 'project_science_question'
          ? 'I need to resolve the project scope before I can continue the science reasoning loop.'
          : 'I need one blocking clarification before I can continue the science reasoning loop.')
        : 'I am clarifying the user request into an execution-ready science question.'
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
        || 'The request is specific enough to continue.',
      trace_sentence: cleanText(source.trace_sentence, 240)
        || cleanText(fallback.trace_sentence, 240)
        || 'I am clarifying the user request before reasoning.'
    };
  }

  function buildTranscriptPreview(conversation) {
    return asArray(conversation)
      .slice(-6)
      .map((turn, index) => {
        const role = cleanText(turn?.role, 20) === 'assistant' ? 'assistant' : 'user';
        const text = cleanText(turn?.text, 1200);
        return text ? `${index + 1}. ${role}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  function buildClarificationPrompt(input = {}) {
    const transcript = buildTranscriptPreview(input.conversation);
    return [
      'Clarify the user request for the science reasoning loop.',
      'Rewrite the request into a self-contained, execution-ready input for the next module.',
      'Ask at most one follow-up question, and only when the missing detail is truly blocking.',
      'Include trace_sentence as one short sentence describing what you are doing at this step.',
      'Preserve the scientific intent, any request for recent/current evidence, and any need for deterministic computation.',
      transcript
        ? 'If the latest user message is a continuation or intensification directive (for example "think harder", "go deeper", "explain more", "continue", "keep going", "what else", "elaborate") without a new scientific topic, anchor clarified_input to the scientific target of the prior assistant answer in the transcript. Preserve the specific entities (organisms, proteins, mechanisms, projects) from that prior answer so downstream stages inherit the real topic. Do not treat the directive itself as the clarified request.'
        : '',
      cleanText(input.intent, 80) === 'project_science_question'
        ? 'If project scope is unresolved, ask a follow-up instead of guessing.'
        : '',
      `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
      transcript ? `Recent conversation:\n${transcript}` : '',
      `User message:\n${cleanText(input.message, 3200)}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function clarifyInput(input = {}) {
    const fallback = buildFallbackClarification(input);
    const result = await requestStructuredJsonPayload({
      stage: 'science_input_clarification',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildClarificationPrompt(input),
      schema: SCIENCE_INPUT_CLARIFICATION_SCHEMA,
      traceContext: input.traceContext || null,
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
    buildClarificationPrompt,
    clarifyInput
  };
}

module.exports = {
  SCIENCE_INPUT_CLARIFICATION_SCHEMA,
  createScienceInputClarificationRuntime
};
