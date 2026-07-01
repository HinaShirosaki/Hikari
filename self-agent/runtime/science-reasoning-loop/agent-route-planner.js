'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/helpers/agent/shared/agent-llm-utils.js');
const { buildKeywordStyleLiteratureQuery } = require('../../../src/main/papers/search/agent-literature-query-utils.js');

const SCIENCE_ROUTE_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'goal',
    'route_summary',
    'step_sequence',
    'tool_call_suggestions',
    'decision_points',
    'adaptation_notes',
    'reference_only',
    'trace_sentence'
  ],
  properties: {
    goal: { type: 'string' },
    route_summary: { type: 'string' },
    step_sequence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step_label', 'objective', 'suggested_tools', 'reason'],
        properties: {
          step_label: { type: 'string' },
          objective: { type: 'string' },
          suggested_tools: {
            type: 'array',
            items: { type: 'string' }
          },
          reason: { type: 'string' }
        }
      }
    },
    tool_call_suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tool_name', 'priority', 'when_to_use', 'reason', 'query_hint'],
        properties: {
          tool_name: { type: 'string' },
          priority: { type: 'integer' },
          when_to_use: { type: 'string' },
          reason: { type: 'string' },
          query_hint: { type: 'string' }
        }
      }
    },
    decision_points: {
      type: 'array',
      items: { type: 'string' }
    },
    adaptation_notes: {
      type: 'array',
      items: { type: 'string' }
    },
    reference_only: { type: 'boolean' },
    trace_sentence: { type: 'string' }
  }
};

function createAgentRoutePlannerRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);
  const clamp = typeof deps.clamp === 'function'
    ? deps.clamp
    : ((value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)));

  function getAllowedTools(input = {}) {
    return uniqueStrings([
      ...asArray(input.policy?.tool_scope),
      ...asArray(input.toolScope),
      ...asArray(input.allowedToolNames)
    ].map((item) => cleanText(item, 120)).filter(Boolean), 12);
  }

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

  function normalizeToolList(values, allowedTools = [], max = 4) {
    const normalized = uniqueStrings(asArray(values).map((item) => cleanText(item, 120)).filter(Boolean), max);
    if (!allowedTools.length) {
      return normalized;
    }
    const filtered = normalized.filter((tool) => allowedTools.includes(tool));
    return filtered.length ? filtered : [];
  }

  function defaultToolReason(toolName, intent) {
    const normalizedTool = cleanText(toolName, 120);
    if (normalizedTool === 'record-lookup') {
      return intent === 'project_science_question'
        ? 'Use local project evidence when it is the most targeted way to ground the answer.'
        : 'Use local records when they can narrow the search space or ground the answer.'
    }
    if (normalizedTool === 'literature-search') {
      return 'Use targeted literature retrieval when citation-backed external grounding is the most direct next step.'
    }
    if (normalizedTool === 'python-sandbox') {
      return 'Use deterministic computation or transformation when the request depends on quantitative or reproducible analysis.'
    }
    if (normalizedTool === 'web-search') {
      return 'Use broader web retrieval only when the targeted evidence step is insufficient.'
    }
    return 'Use this tool only when it is the most targeted next evidence step.'
  }

  function defaultQueryHint(toolName, input = {}) {
    const clarifiedInput = cleanText(input.clarifiedInput || input.message, 320);
    if (toolName === 'record-lookup' && input.project?.name) {
      return `${cleanText(input.project.name, 120)} ${clarifiedInput}`.trim();
    }
    if (toolName === 'literature-search') {
      return buildKeywordStyleLiteratureQuery({
        query: clarifiedInput,
        parser_payload: input.parser_payload || input.parserPayload || null
      }, {
        maxLength: 320
      });
    }
    if (toolName === 'web-search') {
      return clarifiedInput;
    }
    return '';
  }

  function buildFallbackStepSequence(input = {}, allowedTools = []) {
    const intent = cleanText(input.intent, 80);
    const firstTools = allowedTools.slice(0, 2);
    const laterTools = allowedTools.slice(1, 3);
    const steps = [
      {
        step_label: 'scope-question',
        objective: intent === 'project_science_question'
          ? 'Restate the project-scoped question and isolate the specific scientific issue to explain.'
          : 'Restate the clarified science question and note any freshness, evidence, or scope constraints.',
        suggested_tools: [],
        reason: 'Keeping scope tight reduces unnecessary retrieval or analysis.'
      },
      {
        step_label: 'targeted-evidence',
        objective: intent === 'result_analysis'
          ? 'Take the most targeted next evidence step, favoring deterministic analysis when the request depends on computation.'
          : 'Take the most targeted next evidence step for the clarified question.',
        suggested_tools: firstTools,
        reason: 'Start with the smallest high-yield step instead of hardcoding a fixed tool order.'
      }
    ];

    if (laterTools.length) {
      steps.push({
        step_label: 'adapt-if-needed',
        objective: 'Only expand to a second evidence step if the first result leaves a real gap, contradiction, or missing citation.',
        suggested_tools: laterTools,
        reason: 'The route should adapt to actual evidence rather than follow a preset sequence.'
      });
    }

    steps.push({
      step_label: 'synthesis',
      objective: 'Answer from the strongest gathered evidence and state any remaining uncertainty.',
      suggested_tools: [],
      reason: 'The final answer should reflect evidence quality rather than blindly following the route.'
    });

    return steps.slice(0, 4);
  }

  function buildFallbackRoutePlan(input = {}) {
    const intent = cleanText(input.intent, 80);
    const clarifiedInput = cleanText(input.clarifiedInput || input.message, 3200);
    const allowedTools = getAllowedTools(input);
    const goal = clarifiedInput || 'Plan the next science reasoning steps.';
    const toolCallSuggestions = allowedTools.map((toolName, index) => ({
      tool_name: toolName,
      priority: index + 1,
      when_to_use: index === 0
        ? 'Use first unless the clarification already resolves the answer.'
        : 'Use only if the prior step leaves a meaningful evidence gap.',
      reason: defaultToolReason(toolName, intent),
      query_hint: defaultQueryHint(toolName, input)
    }));

    return {
      goal,
      route_summary: intent === 'project_science_question'
        ? 'Start with the most targeted project-grounded evidence step and adapt from there only if a real gap remains.'
        : (intent === 'result_analysis'
          ? 'Start with the most targeted evidence step, favoring deterministic analysis when it is truly needed.'
          : 'Start with the most targeted grounding step and broaden only if the first pass is insufficient.'),
      step_sequence: buildFallbackStepSequence(input, allowedTools),
      tool_call_suggestions: toolCallSuggestions,
      decision_points: uniqueStrings([
        input.project?.name && intent === 'project_science_question'
          ? `Keep the answer scoped to project "${cleanText(input.project.name, 220)}".`
          : '',
        cleanText(input.clarification?.analysis_goal, 260),
        'If the first evidence step is weak, refine the query before expanding the search surface.',
        'Stop early when the current evidence directly answers the clarified request with stated limitations.'
      ], 6),
      adaptation_notes: uniqueStrings([
        'This route is a reference only and can be changed when tool results reveal a better path.',
        'Skip low-yield steps instead of following the sequence mechanically.',
        'Preserve explicit uncertainty whenever evidence is incomplete or conflicting.'
      ], 6),
      reference_only: true,
      trace_sentence: 'I am sketching a lightweight route so the loop can start with the most targeted evidence step.'
    };
  }

  function normalizeStep(step, fallbackStep, index, allowedTools = []) {
    const source = step && typeof step === 'object' ? step : {};
    const fallback = fallbackStep && typeof fallbackStep === 'object' ? fallbackStep : {};
    const suggestedTools = normalizeToolList(source.suggested_tools, allowedTools, 3);
    const fallbackSuggestedTools = normalizeToolList(fallback.suggested_tools, allowedTools, 3);
    const objective = cleanText(source.objective, 320) || cleanText(fallback.objective, 320);
    const reason = cleanText(source.reason, 260) || cleanText(fallback.reason, 260);
    if (!objective && !reason && !suggestedTools.length && !fallbackSuggestedTools.length) {
      return null;
    }
    return {
      step_label: cleanText(source.step_label, 120)
        || cleanText(fallback.step_label, 120)
        || `step_${index + 1}`,
      objective: objective || 'Advance the next evidence-gathering step.',
      suggested_tools: suggestedTools.length ? suggestedTools : fallbackSuggestedTools,
      reason: reason || 'Use the next most targeted step rather than following the route rigidly.'
    };
  }

  function normalizeToolSuggestion(suggestion, fallbackSuggestion, index, allowedTools = [], input = {}) {
    const source = suggestion && typeof suggestion === 'object' ? suggestion : {};
    const fallback = fallbackSuggestion && typeof fallbackSuggestion === 'object' ? fallbackSuggestion : {};
    const sourceTool = cleanText(source.tool_name, 120);
    const fallbackTool = cleanText(fallback.tool_name, 120);
    const resolvedTool = allowedTools.length
      ? ([sourceTool, fallbackTool].find((tool) => tool && allowedTools.includes(tool)) || '')
      : (sourceTool || fallbackTool);
    if (!resolvedTool) {
      return null;
    }
    return {
      tool_name: resolvedTool,
      priority: clamp(Number.isFinite(Number(source.priority)) ? Number(source.priority) : (Number(fallback.priority) || index + 1), 1, 8),
      when_to_use: cleanText(source.when_to_use, 240)
        || cleanText(fallback.when_to_use, 240)
        || 'Use only if it is the most targeted next step.',
      reason: cleanText(source.reason, 260)
        || cleanText(fallback.reason, 260)
        || defaultToolReason(resolvedTool, ''),
      query_hint: resolvedTool === 'literature-search'
        ? buildKeywordStyleLiteratureQuery({
          query: cleanText(source.query_hint, 320)
            || cleanText(fallback.query_hint, 320)
            || defaultQueryHint(resolvedTool, { ...input }),
          parser_payload: input.parser_payload || input.parserPayload || null
        }, {
          maxLength: 320
        })
        : (cleanText(source.query_hint, 320)
          || cleanText(fallback.query_hint, 320)
          || '')
    };
  }

  function normalizeRoutePlan(rawPayload, fallback = {}, input = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
    const allowedTools = getAllowedTools(input);
    const fallbackSteps = asArray(fallbackSource.step_sequence);
    const fallbackSuggestions = asArray(fallbackSource.tool_call_suggestions);
    const resolvedSteps = (asArray(source.step_sequence).length ? asArray(source.step_sequence) : fallbackSteps)
      .slice(0, 5)
      .map((step, index) => normalizeStep(step, fallbackSteps[index], index, allowedTools))
      .filter(Boolean);
    const resolvedSuggestions = (asArray(source.tool_call_suggestions).length ? asArray(source.tool_call_suggestions) : fallbackSuggestions)
      .slice(0, 6)
      .map((item, index) => normalizeToolSuggestion(item, fallbackSuggestions[index], index, allowedTools, input))
      .filter(Boolean)
      .sort((left, right) => left.priority - right.priority);

    return {
      goal: cleanText(source.goal, 1200)
        || cleanText(fallbackSource.goal, 1200)
        || 'Plan the next science reasoning steps.',
      route_summary: cleanText(source.route_summary, 1200)
        || cleanText(fallbackSource.route_summary, 1200)
        || 'Use the most targeted evidence steps first and adapt when better evidence paths appear.',
      step_sequence: resolvedSteps.length ? resolvedSteps : fallbackSteps.map((step, index) => normalizeStep(step, null, index, allowedTools)).filter(Boolean),
      tool_call_suggestions: resolvedSuggestions.length
        ? resolvedSuggestions
        : fallbackSuggestions.map((item, index) => normalizeToolSuggestion(item, null, index, allowedTools, input)).filter(Boolean),
      decision_points: uniqueStrings([
        ...asArray(source.decision_points),
        ...asArray(fallbackSource.decision_points)
      ], 8),
      adaptation_notes: uniqueStrings([
        ...asArray(source.adaptation_notes),
        ...asArray(fallbackSource.adaptation_notes)
      ], 8),
      reference_only: true,
      trace_sentence: cleanText(source.trace_sentence, 240)
        || cleanText(fallbackSource.trace_sentence, 240)
        || 'I am drafting a concise reference route for the next evidence steps.'
    };
  }

  function buildRoutePlanPrompt(input = {}) {
    const executionRequest = cleanText(input.clarifiedInput || input.message, 3200);
    const allowedTools = getAllowedTools(input);
    return [
      'Draft a reference route plan for the science reasoning loop.',
      'This plan is guidance only. The agent may deviate when real tool outputs or evidence suggest a better path.',
      'Keep the route concise, practical, and tool-aware.',
      'Suggest a likely order of evidence-gathering steps, optional tool calls, and when the route should adapt.',
      'Include trace_sentence as one short sentence describing what you are doing at this step.',
      'Prefer only tools that are already allowed by policy or tool scope.',
      'For literature-search query_hint, return short keyword phrases rather than a full sentence.',
      `Clarified request:\n${executionRequest}`,
      Number(input.reasoningEffort) === 1
        ? 'Reasoning effort 1: keep the route narrow and targeted.'
        : '',
      Number(input.reasoningEffort) >= 2
        ? 'Reasoning effort 2: a broader multi-step route is acceptable, but do not over-plan.'
        : '',
      `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
      Number.isFinite(Number(input.reasoningEffort)) ? `Reasoning effort: ${Number(input.reasoningEffort)}` : '',
      buildPolicySection(input.policy),
      buildProjectSection(input.project),
      allowedTools.length ? `Allowed tools: ${allowedTools.join(' | ')}` : '',
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function draftRoutePlan(input = {}) {
    const fallback = buildFallbackRoutePlan(input);
    const result = await requestStructuredJsonPayload({
      stage: 'science_route_planner',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildRoutePlanPrompt(input),
      schema: SCIENCE_ROUTE_PLAN_SCHEMA,
      traceContext: input.traceContext || null,
      defaultError: 'Science route planner is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return fallback;
    }
    return normalizeRoutePlan(result.payload, fallback, input);
  }

  return {
    SCIENCE_ROUTE_PLAN_SCHEMA,
    buildFallbackRoutePlan,
    buildRoutePlanPrompt,
    normalizeRoutePlan,
    draftRoutePlan
  };
}

module.exports = {
  SCIENCE_ROUTE_PLAN_SCHEMA,
  createAgentRoutePlannerRuntime
};
