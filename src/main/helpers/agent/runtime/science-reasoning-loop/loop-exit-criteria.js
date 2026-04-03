'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');

const SCIENCE_LOOP_EXIT_CRITERIA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'objective_summary',
    'exit_conditions',
    'required_evidence',
    'continue_when',
    'can_exit_with_limitations_when',
    'preferred_next_tools',
    'reasoning_notes'
  ],
  properties: {
    objective_summary: { type: 'string' },
    exit_conditions: {
      type: 'array',
      items: { type: 'string' }
    },
    required_evidence: {
      type: 'array',
      items: { type: 'string' }
    },
    continue_when: {
      type: 'array',
      items: { type: 'string' }
    },
    can_exit_with_limitations_when: {
      type: 'array',
      items: { type: 'string' }
    },
    preferred_next_tools: {
      type: 'array',
      items: { type: 'string' }
    },
    reasoning_notes: { type: 'string' }
  }
};

function createScienceLoopExitCriteriaRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);

  function messageRequestsRecentSources(message) {
    return /\b(latest|recent|current|today|newest|papers|references|citations|study|studies|findings)\b/i
      .test(String(message || ''));
  }

  function messageRequestsComputation(message) {
    return /\b(fit|curve|transform|quantif|outlier|calculate|compute|regression|normalize|analy[sz]e data)\b/i
      .test(String(message || ''));
  }

  function buildFallbackExitCriteria(input = {}) {
    const intent = cleanText(input.intent, 80);
    const policy = input.policy && typeof input.policy === 'object' ? input.policy : {};
    const project = input.project && typeof input.project === 'object' ? input.project : null;
    const clarifiedInput = cleanText(input.clarifiedInput || input.message, 3200);
    const preferredNextTools = asArray(policy.tool_scope)
      .map((item) => cleanText(item, 120))
      .filter(Boolean)
      .slice(0, 6);
    const requiredEvidence = [
      'At least one evidence-gathering round has run before the loop exits.'
    ];
    const continueWhen = [
      'A blocking evidence gap still prevents a grounded answer.'
    ];
    const exitConditions = [
      'The current evidence directly supports the core answer to the clarified request.'
    ];
    const limitationRules = [
      'A best-effort answer is allowed when the main remaining gaps are stated explicitly.'
    ];

    if (intent === 'general_science_question') {
      exitConditions.push('The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support.');
      limitationRules.push('Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated.');
      if (messageRequestsRecentSources(clarifiedInput)) {
        continueWhen.push('Continue when the user specifically needs freshness or explicit references and the current evidence may not satisfy that need yet.');
      }
    }

    if (intent === 'project_science_question') {
      exitConditions.push('The answer is scoped to the project and grounded in the strongest available project context, whether from citations, conversation context, or trusted tool output.');
      continueWhen.push('Project scope or project grounding is still ambiguous.');
      limitationRules.push('A limitation-qualified answer is acceptable when project context is clear from conversation or trusted tool output even without a formal internal citation object.');
    }

    if (intent === 'result_analysis') {
      exitConditions.push('The interpretation is tied to deterministic computation, trusted tool output, or directly provided numeric evidence.');
      if (messageRequestsComputation(clarifiedInput)) {
        continueWhen.push('Continue when the requested numeric step is not yet grounded by computation or trusted provided output.');
      }
      limitationRules.push('Additional computation is optional when the needed numeric result is already provided, trivial to verify, or returned by a trusted tool.');
    }

    if (project?.name) {
      exitConditions.push(`Keep the answer scoped to project "${cleanText(project.name, 220)}".`);
    }

    return {
      objective_summary: clarifiedInput || 'Decide when the science reasoning loop has enough grounded evidence to stop.',
      exit_conditions: uniqueStrings(exitConditions, 8),
      required_evidence: uniqueStrings(requiredEvidence, 8),
      continue_when: uniqueStrings(continueWhen, 8),
      can_exit_with_limitations_when: uniqueStrings(limitationRules, 6),
      preferred_next_tools: uniqueStrings(preferredNextTools, 8),
      reasoning_notes: cleanText(policy.retrieval_priority, 160)
        ? `Follow policy order: ${cleanText(policy.retrieval_priority, 160)}.`
        : 'Use the next most targeted evidence step when the exit conditions are not met.'
    };
  }

  function normalizeExitCriteriaPayload(rawPayload, fallback = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    return {
      objective_summary: cleanText(source.objective_summary, 1200)
        || cleanText(fallback.objective_summary, 1200)
        || 'Decide when the reasoning loop has enough grounded evidence to stop.',
      exit_conditions: uniqueStrings([
        ...asArray(source.exit_conditions),
        ...asArray(fallback.exit_conditions)
      ], 10),
      required_evidence: uniqueStrings([
        ...asArray(source.required_evidence),
        ...asArray(fallback.required_evidence)
      ], 10),
      continue_when: uniqueStrings([
        ...asArray(source.continue_when),
        ...asArray(fallback.continue_when)
      ], 10),
      can_exit_with_limitations_when: uniqueStrings([
        ...asArray(source.can_exit_with_limitations_when),
        ...asArray(fallback.can_exit_with_limitations_when)
      ], 8),
      preferred_next_tools: uniqueStrings([
        ...asArray(source.preferred_next_tools),
        ...asArray(fallback.preferred_next_tools)
      ], 8),
      reasoning_notes: cleanText(source.reasoning_notes, 400)
        || cleanText(fallback.reasoning_notes, 400)
        || 'Use the next most targeted evidence step when the exit conditions are not met.'
    };
  }

  function buildExitCriteriaPrompt(input = {}) {
    return [
      'Generate exit criteria for a science reasoning loop.',
      'The criteria will be used later by a separate judge sub-agent to decide whether the loop should stop.',
      'Be concrete about what evidence must exist before exit, when the loop should continue, and when a limitation-qualified answer is acceptable.',
      `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
      `Policy JSON:\n${JSON.stringify(input.policy || {}, null, 2)}`,
      input.project ? `Resolved project JSON:\n${JSON.stringify(input.project, null, 2)}` : '',
      input.clarification ? `Clarification JSON:\n${JSON.stringify(input.clarification, null, 2)}` : '',
      `Parser payload JSON:\n${JSON.stringify(input.parserPayload || {}, null, 2)}`,
      `Routing JSON:\n${JSON.stringify(input.routing || {}, null, 2)}`,
      `Original user message:\n${cleanText(input.originalMessage || input.message, 3200)}`,
      `Clarified request:\n${cleanText(input.clarifiedInput || input.message, 3200)}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function generateExitCriteria(input = {}) {
    const fallback = buildFallbackExitCriteria(input);
    const result = await requestStructuredJsonPayload({
      provider: cleanText(input.provider, 80),
      endpoint: cleanText(input.endpoint, 2000),
      apiKey: cleanText(input.apiKey, 400),
      model: cleanText(input.model, 120),
      stage: 'science_loop_exit_criteria',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildExitCriteriaPrompt(input),
      schema: SCIENCE_LOOP_EXIT_CRITERIA_SCHEMA,
      traceContext: input.traceContext || null,
      maxOutputTokens: 1500,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Science loop exit criteria generation is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return fallback;
    }
    return normalizeExitCriteriaPayload(result.payload, fallback);
  }

  return {
    SCIENCE_LOOP_EXIT_CRITERIA_SCHEMA,
    buildFallbackExitCriteria,
    normalizeExitCriteriaPayload,
    generateExitCriteria
  };
}

module.exports = {
  SCIENCE_LOOP_EXIT_CRITERIA_SCHEMA,
  createScienceLoopExitCriteriaRuntime
};
