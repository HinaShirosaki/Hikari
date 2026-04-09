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

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 240);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key) || out.length >= max) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

const CLARIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'research_goal',
    'scope_boundaries',
    'missing_constraints',
    'expected_output_style',
    'request_type',
    'should_ask_follow_up',
    'follow_up_focus',
    'time_sensitive'
  ],
  properties: {
    research_goal: { type: 'string' },
    scope_boundaries: {
      type: 'array',
      items: { type: 'string' }
    },
    missing_constraints: {
      type: 'array',
      items: { type: 'string' }
    },
    expected_output_style: { type: 'string' },
    request_type: { type: 'string' },
    should_ask_follow_up: { type: 'boolean' },
    follow_up_focus: {
      type: 'array',
      items: { type: 'string' }
    },
    time_sensitive: { type: 'boolean' }
  }
};

function inferRequestType(message, intent) {
  const text = cleanText(message, 3200).toLowerCase();
  if (/\b(compare|versus|vs\.?|difference|tradeoff)\b/.test(text)) {
    return 'comparative';
  }
  if (/\b(recommend|choose|best|should|decision)\b/.test(text)) {
    return 'decision';
  }
  if (intent === 'result_analysis' || /\b(why|how|explain|interpret|analysis|analyze)\b/.test(text)) {
    return 'analytical';
  }
  return 'exploratory';
}

function buildFallbackClarification(input = {}) {
  const message = cleanText(input.message, 3200);
  const intent = cleanText(input.intent, 80);
  const parserPayload = input.parserPayload && typeof input.parserPayload === 'object' ? input.parserPayload : {};
  const project = input.project && typeof input.project === 'object' ? input.project : null;
  const requestType = inferRequestType(message, intent);
  const missingConstraints = [];
  if (intent === 'project_science_question' && !cleanText(project?.id || project?.name, 220)) {
    missingConstraints.push('project scope');
  }
  if (requestType === 'comparative' && !/\b(criteria|cost|speed|accuracy|risk|yield|potency)\b/i.test(message)) {
    missingConstraints.push('comparison criteria');
  }
  if (parserPayload.needs_clarification === true) {
    missingConstraints.push(cleanText(parserPayload.clarification_reason, 240) || 'clarifying constraint');
  }
  return {
    research_goal: message || cleanText(parserPayload.reasoning_summary, 600) || 'Clarify the user request into a research objective.',
    scope_boundaries: uniqueStrings([
      intent ? `Intent: ${intent}` : '',
      project?.name ? `Project: ${cleanText(project.name, 220)}` : '',
      cleanText(parserPayload?.entities?.requested_output, 120)
        ? `Requested output: ${cleanText(parserPayload.entities.requested_output, 120)}`
        : ''
    ], 6),
    missing_constraints: uniqueStrings(missingConstraints, 4),
    expected_output_style: requestType === 'decision'
      ? 'Grounded recommendation with evidence and caveats.'
      : 'Grounded research answer with evidence, uncertainty, and follow-up notes.',
    request_type: requestType,
    should_ask_follow_up: missingConstraints.length > 0,
    follow_up_focus: uniqueStrings(missingConstraints, 4),
    time_sensitive: /\b(latest|recent|current|today|newest)\b/i.test(message)
  };
}

function normalizeClarificationPayload(rawPayload, fallback = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  return {
    research_goal: cleanText(source.research_goal, 1200) || cleanText(fallback.research_goal, 1200) || 'Clarify the user request into a research objective.',
    scope_boundaries: uniqueStrings([
      ...asArray(source.scope_boundaries),
      ...asArray(fallback.scope_boundaries)
    ], 8),
    missing_constraints: uniqueStrings([
      ...asArray(source.missing_constraints),
      ...asArray(fallback.missing_constraints)
    ], 6),
    expected_output_style: cleanText(source.expected_output_style, 320) || cleanText(fallback.expected_output_style, 320) || 'Grounded research answer.',
    request_type: cleanText(source.request_type, 80) || cleanText(fallback.request_type, 80) || 'exploratory',
    should_ask_follow_up: source.should_ask_follow_up === true || fallback.should_ask_follow_up === true,
    follow_up_focus: uniqueStrings([
      ...asArray(source.follow_up_focus),
      ...asArray(fallback.follow_up_focus)
    ], 6),
    time_sensitive: source.time_sensitive === true || fallback.time_sensitive === true
  };
}

function buildClarifyPrompt(input = {}) {
  return [
    'Clarify the user request into a research objective for the deep research agent.',
    'Identify the core goal, the scope boundaries, any missing constraints, and the expected answer style.',
    'Ask for follow-up only if the missing detail is truly blocking.',
    `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
    input.project ? `Resolved project JSON:\n${JSON.stringify(input.project, null, 2)}` : '',
    `Parser payload JSON:\n${JSON.stringify(input.parserPayload || {}, null, 2)}`,
    `Routing JSON:\n${JSON.stringify(input.routing || {}, null, 2)}`,
    `User message:\n${cleanText(input.message, 3200)}`,
    'Return JSON only.'
  ].filter(Boolean).join('\n\n');
}

async function runStep1ClarifyQuestion(input = {}, deps = {}) {
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const fallback = buildFallbackClarification(input);
  if (!requestStructuredJsonPayload) {
    return fallback;
  }
  const result = await requestStructuredJsonPayload({
    provider: cleanText(input.provider, 80),
    endpoint: cleanText(input.endpoint, 2000),
    apiKey: cleanText(input.apiKey, 400),
    model: cleanText(input.model, 120),
    stage: 'deep_research_step_1_clarify',
    systemPrompt: 'Return valid JSON only.',
    userPrompt: buildClarifyPrompt(input),
    schema: CLARIFY_SCHEMA,
    traceContext: input.traceContext || null,
    maxOutputTokens: 1400,
    openAiStrict: true,
    openAiAsDefaultProvider: true,
    defaultError: 'Deep research clarification step is not configured.'
  });
  if (!result?.ok || !result.payload) {
    return fallback;
  }
  return normalizeClarificationPayload(result.payload, fallback);
}

module.exports = {
  buildClarifyPrompt,
  runStep1ClarifyQuestion
};
