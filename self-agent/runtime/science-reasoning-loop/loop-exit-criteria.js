'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/lib/llm/runtime-helpers.js');

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
    'reasoning_notes',
    'trace_sentence'
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
    reasoning_notes: { type: 'string' },
    trace_sentence: { type: 'string' }
  }
};

function createScienceLoopExitCriteriaRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);

  function buildProjectSection(project = null) {
    const source = project && typeof project === 'object' ? project : null;
    if (!source) {
      return '';
    }
    const projectName = cleanText(source.name, 220);
    const projectId = cleanText(source.id, 120);
    const resolutionSource = cleanText(source.resolution_source, 120);
    return [
      'Project context:',
      projectName ? `Name: ${projectName}` : '',
      projectId ? `ID: ${projectId}` : '',
      resolutionSource ? `Resolution source: ${resolutionSource}` : ''
    ].filter(Boolean).join('\n');
  }

  function buildPolicySection(policy = {}) {
    const source = policy && typeof policy === 'object' ? policy : {};
    return [
      'Science policy:',
      cleanText(source.description, 320) ? `Description: ${cleanText(source.description, 320)}` : '',
      cleanText(source.retrieval_priority, 120) ? `Retrieval priority: ${cleanText(source.retrieval_priority, 120)}` : '',
      source.require_external_citation_when_recent === true ? 'Require external citation when freshness matters: yes' : '',
      source.require_retrieval_attempt === true ? 'Require retrieval attempt before answer: yes' : '',
      source.answer_with_limitations_after_attempt === true ? 'Allow limitation-qualified answer after evidence attempt: yes' : ''
    ].filter(Boolean).join('\n');
  }

  function getAllowedTools(input = {}) {
    return uniqueStrings([
      ...asArray(input.allowedToolNames),
      ...asArray(input.toolScope),
      ...asArray(input.policy?.tool_scope)
    ], 12)
      .map((item) => cleanText(item, 120))
      .filter(Boolean);
  }

  function buildFallbackExitCriteria(input = {}) {
    const policy = input.policy && typeof input.policy === 'object' ? input.policy : {};
    const project = input.project && typeof input.project === 'object' ? input.project : null;
    const clarifiedInput = cleanText(input.clarifiedInput || input.message, 3200);
    const preferredNextTools = uniqueStrings([
      ...asArray(input.allowedToolNames),
      ...asArray(input.toolScope),
      ...asArray(policy.tool_scope)
    ], 12)
      .map((item) => cleanText(item, 120))
      .filter(Boolean);
    const exitConditions = [
      'The current evidence directly supports a grounded answer to the clarified request.'
    ];
    const continueWhen = [
      'A blocking gap remains between the clarified request and the collected evidence.'
    ];
    const limitationRules = [
      'A limitation-qualified answer is acceptable when the remaining uncertainty is stated explicitly.'
    ];

    if (project?.name) {
      exitConditions.push(`Keep the answer scoped to project "${cleanText(project.name, 220)}".`);
    }

    return {
      objective_summary: clarifiedInput || 'Decide when the science reasoning loop has enough grounded evidence to stop.',
      exit_conditions: uniqueStrings(exitConditions, 8),
      required_evidence: [],
      continue_when: uniqueStrings(continueWhen, 8),
      can_exit_with_limitations_when: uniqueStrings(limitationRules, 6),
      preferred_next_tools: uniqueStrings(preferredNextTools, 8),
      reasoning_notes: cleanText(policy.retrieval_priority, 160)
        ? `Follow policy order: ${cleanText(policy.retrieval_priority, 160)}.`
        : 'Use the next most targeted evidence step when the exit conditions are not met.',
      trace_sentence: 'I am defining what evidence must exist before the reasoning loop can safely stop.'
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
        || 'Use the next most targeted evidence step when the exit conditions are not met.',
      trace_sentence: cleanText(source.trace_sentence, 240)
        || cleanText(fallback.trace_sentence, 240)
        || 'I am defining the stopping criteria for this reasoning loop.'
    };
  }

  function buildExitCriteriaPrompt(input = {}) {
    const executionRequest = cleanText(input.clarifiedInput || input.message, 3200);
    const allowedTools = getAllowedTools(input);
    return [
      'Generate exit criteria for a science reasoning loop.',
      'The criteria will be used later by a separate judge sub-agent to decide whether the loop should stop.',
      'Be concrete about what evidence must exist before exit, when the loop should continue, and when a limitation-qualified answer is acceptable.',
      'Include trace_sentence as one short sentence describing what you are doing at this step.',
      `Clarified request:\n${executionRequest}`,
      `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
      buildPolicySection(input.policy),
      buildProjectSection(input.project),
      allowedTools.length ? `Allowed tools: ${allowedTools.join(' | ')}` : '',
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function generateExitCriteria(input = {}) {
    const fallback = buildFallbackExitCriteria(input);
    const result = await requestStructuredJsonPayload({
      stage: 'science_loop_exit_criteria',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildExitCriteriaPrompt(input),
      schema: SCIENCE_LOOP_EXIT_CRITERIA_SCHEMA,
      traceContext: input.traceContext || null,
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
    buildExitCriteriaPrompt,
    normalizeExitCriteriaPayload,
    generateExitCriteria
  };
}

module.exports = {
  SCIENCE_LOOP_EXIT_CRITERIA_SCHEMA,
  createScienceLoopExitCriteriaRuntime
};
