'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, _maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

const FOLLOW_UP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['needs_follow_up', 'question', 'reason'],
  properties: {
    needs_follow_up: { type: 'boolean' },
    question: { type: 'string' },
    reason: { type: 'string' },
    blocking_field: {
      anyOf: [{ type: 'string' }, { type: 'null' }]
    }
  }
};

function buildFallbackFollowUp(input = {}) {
  const parserPayload = input.parserPayload && typeof input.parserPayload === 'object' ? input.parserPayload : {};
  const clarifyResult = input.clarifyResult && typeof input.clarifyResult === 'object' ? input.clarifyResult : {};
  const project = input.project && typeof input.project === 'object' ? input.project : null;
  const intent = cleanText(input.intent, 80);

  if (parserPayload.needs_clarification === true) {
    return {
      needs_follow_up: true,
      question: cleanText(parserPayload.clarification_reason, 320) || 'What is the missing detail you want me to focus on first?',
      reason: 'Intent parser marked the request as underspecified.',
      blocking_field: 'parser_clarification'
    };
  }

  if (intent === 'project_science_question' && !cleanText(project?.id || project?.name, 220)) {
    return {
      needs_follow_up: true,
      question: cleanText(input.projectResolutionQuestion, 320) || 'Which project should I use for this deep research question?',
      reason: 'Project-scoped science research needs a resolved project before execution.',
      blocking_field: 'project'
    };
  }

  const missingConstraint = asArray(clarifyResult.missing_constraints)
    .map((item) => cleanText(item, 240))
    .find(Boolean);
  if (clarifyResult.should_ask_follow_up === true && missingConstraint) {
    return {
      needs_follow_up: true,
      question: `What should I use for ${missingConstraint}?`,
      reason: `A blocking constraint is still missing: ${missingConstraint}.`,
      blocking_field: missingConstraint
    };
  }

  return {
    needs_follow_up: false,
    question: '',
    reason: 'The request is specific enough to begin research.',
    blocking_field: null
  };
}

function normalizeFollowUpPayload(rawPayload, fallback = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  return {
    needs_follow_up: source.needs_follow_up === true || fallback.needs_follow_up === true,
    question: cleanText(source.question, 320) || cleanText(fallback.question, 320),
    reason: cleanText(source.reason, 320) || cleanText(fallback.reason, 320) || 'No follow-up reason was provided.',
    blocking_field: cleanText(source.blocking_field, 160) || cleanText(fallback.blocking_field, 160) || null
  };
}

function buildFollowUpPrompt(input = {}) {
  return [
    'Decide whether the deep research agent must ask one targeted follow-up question before starting work.',
    'Ask only if the missing detail is truly blocking. Return one question at most.',
    `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
    `Clarification JSON:\n${JSON.stringify(input.clarifyResult || {}, null, 2)}`,
    `Parser payload JSON:\n${JSON.stringify(input.parserPayload || {}, null, 2)}`,
    input.project ? `Resolved project JSON:\n${JSON.stringify(input.project, null, 2)}` : '',
    `User message:\n${cleanText(input.message, 3200)}`,
    'Return JSON only.'
  ].filter(Boolean).join('\n\n');
}

async function runStep2AskTargetedFollowUp(input = {}, deps = {}) {
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const fallback = buildFallbackFollowUp(input);
  if (!requestStructuredJsonPayload) {
    return fallback;
  }
  const result = await requestStructuredJsonPayload({
    provider: cleanText(input.provider, 80),
    endpoint: cleanText(input.endpoint, 2000),
    apiKey: cleanText(input.apiKey, 400),
    model: cleanText(input.model, 120),
    stage: 'deep_research_step_2_follow_up',
    systemPrompt: 'Return valid JSON only.',
    userPrompt: buildFollowUpPrompt(input),
    schema: FOLLOW_UP_SCHEMA,
    traceContext: input.traceContext || null,
    maxOutputTokens: 1000,
    openAiStrict: true,
    openAiAsDefaultProvider: true,
    defaultError: 'Deep research follow-up step is not configured.'
  });
  if (!result?.ok || !result.payload) {
    return fallback;
  }
  return normalizeFollowUpPayload(result.payload, fallback);
}

module.exports = {
  buildFollowUpPrompt,
  runStep2AskTargetedFollowUp
};
