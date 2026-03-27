'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 320);
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

const COMPLETION_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'satisfied',
    'reason',
    'missing_requirements',
    'should_continue',
    'can_answer_with_limitations'
  ],
  properties: {
    satisfied: { type: 'boolean' },
    reason: { type: 'string' },
    missing_requirements: {
      type: 'array',
      items: { type: 'string' }
    },
    should_continue: { type: 'boolean' },
    can_answer_with_limitations: { type: 'boolean' },
    next_action: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            tool_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            query: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reason: { type: 'string' }
          }
        }
      ]
    },
    delegate_sub_agent: { type: 'boolean' }
  }
};

function shouldDelegateSubAgent(input = {}) {
  const remainingRounds = Math.max(0, Number(input.maxRounds) - Number(input.roundsExecuted || 0));
  const subquestionCount = asArray(input.researchPlan?.key_subquestions).length;
  const toolTrace = asArray(input.toolTrace);
  const hasPriorDelegation = toolTrace.some((row) => cleanText(row?.tool_name, 120) === 'sub-agent' && row?.ok === true);
  const allowedTools = asArray(input.allowedToolNames).map((item) => cleanText(item, 120));
  return remainingRounds >= 2
    && subquestionCount >= 3
    && hasPriorDelegation === false
    && allowedTools.includes('sub-agent');
}

function buildSubAgentInstruction(input = {}) {
  return [
    'Review one independent sub-question for the deep research agent.',
    `Research objective: ${cleanText(input.researchObjective, 1200) || 'Not provided.'}`,
    `Assigned sub-question: ${cleanText(input.subquestion, 1200) || 'Not provided.'}`,
    `Context snapshot JSON:\n${JSON.stringify(input.contextSnapshot || {}, null, 2)}`,
    'Return a concise evidence-grounded summary, note any contradictions, and avoid inventing sources.'
  ].filter(Boolean).join('\n\n');
}

function normalizeCompletionCheckPayload(rawPayload, fallback = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const nextAction = source.next_action && typeof source.next_action === 'object'
    ? {
      tool_name: cleanText(source.next_action.tool_name, 120) || null,
      query: cleanText(source.next_action.query, 320) || null,
      reason: cleanText(source.next_action.reason, 320) || 'More evidence is required.'
    }
    : null;
  return {
    satisfied: source.satisfied === true,
    reason: cleanText(source.reason, 320) || cleanText(fallback.reason, 320) || 'Completion check returned no reason.',
    missing_requirements: uniqueStrings([
      ...asArray(source.missing_requirements),
      ...asArray(fallback.missing_requirements)
    ], 6),
    should_continue: source.should_continue === true,
    can_answer_with_limitations: source.can_answer_with_limitations === true,
    next_action: nextAction,
    delegate_sub_agent: source.delegate_sub_agent === true
  };
}

function buildCompletionCheckPrompt(input = {}) {
  return [
    'You are the completion checker for a deep research run.',
    'Decide whether the current evidence satisfies the research plan enough to move to final synthesis.',
    'If evidence is still weak, explain the main missing requirement and suggest one next action.',
    `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
    `Research objective JSON:\n${JSON.stringify(input.researchObjective || {}, null, 2)}`,
    `Research plan JSON:\n${JSON.stringify(input.researchPlan || {}, null, 2)}`,
    `Context snapshot JSON:\n${JSON.stringify(input.contextSnapshot || {}, null, 2)}`,
    `Accuracy snapshot JSON:\n${JSON.stringify(input.accuracySnapshot || {}, null, 2)}`,
    `Tool trace JSON:\n${JSON.stringify(asArray(input.toolTrace).slice(-8), null, 2)}`,
    `Citations JSON:\n${JSON.stringify(asArray(input.citations).slice(0, 12), null, 2)}`,
    `Rounds executed: ${Number(input.roundsExecuted) || 0}/${Number(input.maxRounds) || 0}`,
    'Return JSON only.'
  ].filter(Boolean).join('\n\n');
}

async function runCompletionCheck(input = {}, deps = {}) {
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const fallbackMissing = [];
  const citations = asArray(input.citations);
  const toolTrace = asArray(input.toolTrace);
  const intent = cleanText(input.intent, 80);
  const hasInternalRecord = toolTrace.some((row) => cleanText(row?.tool_name, 120) === 'record-lookup' && row?.ok === true);

  if (!citations.length && !toolTrace.length) {
    fallbackMissing.push('No evidence has been gathered yet.');
  }
  if (intent === 'project_science_question' && hasInternalRecord === false) {
    fallbackMissing.push('Internal project evidence is still missing.');
  }

  if (requestStructuredJsonPayload) {
    const result = await requestStructuredJsonPayload({
      provider: cleanText(input.provider, 80),
      endpoint: cleanText(input.endpoint, 2000),
      apiKey: cleanText(input.apiKey, 400),
      model: cleanText(input.model, 120),
      stage: 'deep_research_completion_check',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildCompletionCheckPrompt(input),
      schema: COMPLETION_CHECK_SCHEMA,
      traceContext: input.traceContext || null,
      maxOutputTokens: 1400,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Deep research completion checker is not configured.'
    });
    if (result?.ok && result.payload) {
      return normalizeCompletionCheckPayload(result.payload, {
        missing_requirements: fallbackMissing
      });
    }
  }

  const roundsExecuted = Number(input.roundsExecuted) || 0;
  const maxRounds = Math.max(1, Number(input.maxRounds) || 4);
  const satisfied = fallbackMissing.length === 0 && citations.length > 0 && roundsExecuted >= 1;
  const shouldContinue = satisfied === false && roundsExecuted < maxRounds;
  const nextTool = asArray(input.researchPlan?.possible_tools_or_sources)
    .map((item) => cleanText(item, 120))
    .find((toolName) => {
      if (!toolName) {
        return false;
      }
      return !toolTrace.some((row) => cleanText(row?.tool_name, 120) === toolName && row?.ok === true);
    });
  return {
    satisfied,
    reason: satisfied
      ? 'Evidence coverage is sufficient for final synthesis.'
      : (fallbackMissing[0]
        || (roundsExecuted >= maxRounds
          ? 'Tool budget is exhausted.'
          : 'Another evidence pass is still needed.')),
    missing_requirements: fallbackMissing,
    should_continue: shouldContinue,
    can_answer_with_limitations: citations.length > 0,
    next_action: shouldContinue
      ? {
        tool_name: nextTool || null,
        query: cleanText(input.researchObjective?.research_goal || input.message, 320) || null,
        reason: fallbackMissing[0] || 'Gather one more targeted evidence pass.'
      }
      : null,
    delegate_sub_agent: shouldDelegateSubAgent(input)
  };
}

module.exports = {
  shouldDelegateSubAgent,
  buildSubAgentInstruction,
  normalizeCompletionCheckPayload,
  runCompletionCheck
};
