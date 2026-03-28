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

function safeParseJson(value, fallback = null) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
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

const NEXT_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'reason', 'assistant_note'],
  properties: {
    action: {
      type: 'string',
      enum: ['tool', 'answer']
    },
    reason: { type: 'string' },
    assistant_note: { type: 'string' },
    tool_name: {
      anyOf: [{ type: 'string' }, { type: 'null' }]
    },
    arguments: {
      type: 'object'
    },
    answer_fragment: {
      anyOf: [{ type: 'string' }, { type: 'null' }]
    }
  }
};

function buildToolSchemaMap(toolDefinitions) {
  const out = new Map();
  asArray(toolDefinitions).forEach((tool) => {
    const name = cleanText(tool?.name, 120);
    if (!name) {
      return;
    }
    out.set(name, tool?.parameters && typeof tool.parameters === 'object'
      ? tool.parameters
      : (tool?.input_schema && typeof tool.input_schema === 'object'
        ? tool.input_schema
        : { type: 'object', additionalProperties: true, properties: {} }));
  });
  return out;
}

function validatePrimitiveByType(value, schemaType) {
  if (schemaType === 'string') {
    return typeof value === 'string';
  }
  if (schemaType === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (schemaType === 'integer') {
    return Number.isInteger(value);
  }
  if (schemaType === 'boolean') {
    return typeof value === 'boolean';
  }
  if (schemaType === 'array') {
    return Array.isArray(value);
  }
  if (schemaType === 'object') {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
  return true;
}

function validateArgumentsAgainstSchema(schema, value, path = 'arguments') {
  const targetSchema = schema && typeof schema === 'object' ? schema : {};
  if (Array.isArray(targetSchema.anyOf) && targetSchema.anyOf.length) {
    const matched = targetSchema.anyOf.some((entry) => validateArgumentsAgainstSchema(entry, value, path).ok);
    return matched
      ? { ok: true }
      : { ok: false, error: `${path} does not satisfy any allowed schema branch.` };
  }
  const schemaType = cleanText(targetSchema.type, 30);
  if (schemaType && !validatePrimitiveByType(value, schemaType)) {
    return { ok: false, error: `${path} must be of type ${schemaType}.` };
  }
  if (schemaType === 'array' && targetSchema.items) {
    for (let index = 0; index < value.length; index += 1) {
      const child = validateArgumentsAgainstSchema(targetSchema.items, value[index], `${path}[${index}]`);
      if (!child.ok) {
        return child;
      }
    }
  }
  if (schemaType === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = targetSchema.properties && typeof targetSchema.properties === 'object'
      ? targetSchema.properties
      : {};
    const required = asArray(targetSchema.required).map((item) => cleanText(item, 120)).filter(Boolean);
    for (const requiredKey of required) {
      if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
        return { ok: false, error: `${path}.${requiredKey} is required.` };
      }
    }
    if (targetSchema.additionalProperties === false) {
      const unknownKey = Object.keys(value).find((key) => !Object.prototype.hasOwnProperty.call(properties, key));
      if (unknownKey) {
        return { ok: false, error: `${path}.${unknownKey} is not allowed.` };
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      const child = validateArgumentsAgainstSchema(propertySchema, value[key], `${path}.${key}`);
      if (!child.ok) {
        return child;
      }
    }
  }
  return { ok: true };
}

function normalizeCitation(value, fallbackSource = '') {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = {
    source: cleanText(source.source, 120) || cleanText(fallbackSource, 120),
    pointer: cleanText(source.pointer, 240),
    reason: cleanText(source.reason, 320)
  };
  return normalized.source || normalized.pointer ? normalized : null;
}

function normalizeCitations(rows, fallbackSource = '', max = 20) {
  const seen = new Set();
  const out = [];
  asArray(rows).forEach((row) => {
    const normalized = normalizeCitation(row, fallbackSource);
    if (!normalized) {
      return;
    }
    const key = `${normalized.source.toLowerCase()}::${normalized.pointer.toLowerCase()}`;
    if (seen.has(key) || out.length >= max) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function buildSyntheticToolEnvelope(toolName, args, errorMessage) {
  return {
    ok: false,
    tool_name: cleanText(toolName, 120),
    input: args && typeof args === 'object' ? args : {},
    result: null,
    items: [],
    citations: [],
    summary: cleanText(errorMessage, 320) || 'Tool execution failed.',
    error: cleanText(errorMessage, 600) || 'Tool execution failed.'
  };
}

function inferEnvelopeCitations(envelope, toolName) {
  const direct = normalizeCitations(envelope?.citations, toolName, 8);
  if (direct.length) {
    return direct;
  }
  const resultCitations = normalizeCitations(envelope?.result?.citations, toolName, 8);
  if (resultCitations.length) {
    return resultCitations;
  }
  return asArray(envelope?.items || envelope?.result?.items)
    .slice(0, 6)
    .map((item) => normalizeCitation({
      source: toolName,
      pointer: cleanText(item?.title || item?.name || item?.id || item?.paper_title, 240),
      reason: cleanText(item?.summary || item?.reason || item?.status, 240)
    }, toolName))
    .filter(Boolean);
}

function summarizeToolEnvelope(envelope, toolName) {
  return cleanText(
    envelope?.summary
      || envelope?.error
      || envelope?.result?.summary
      || `${cleanText(toolName, 120) || 'tool'} completed.`,
    320
  ) || `${cleanText(toolName, 120) || 'tool'} completed.`;
}

function buildFallbackPythonCode(input = {}) {
  const assayRuns = asArray(input.snapshot?.experimentData?.assay_runs);
  const gelRuns = asArray(input.snapshot?.experimentData?.gel_runs);
  return [
    'import json',
    'payload = {',
    `  "note": ${JSON.stringify('Deep research fallback could not infer a more specific computation request.')},`,
    `  "assay_run_count": ${JSON.stringify(assayRuns.length)},`,
    `  "gel_run_count": ${JSON.stringify(gelRuns.length)}`,
    '}',
    'print(json.dumps(payload))'
  ].join('\n');
}

function buildFallbackToolArguments(toolName, input = {}) {
  if (toolName === 'record-lookup') {
    return {
      query: cleanText(input.researchObjective?.research_goal || input.message, 600)
    };
  }
  if (toolName === 'literature-search') {
    const out = {
      query: cleanText(input.researchObjective?.research_goal || input.message, 600),
      limit: 5,
      prefer_recent: input.researchObjective?.time_sensitive === true
    };
    if (input.parserPayload && typeof input.parserPayload === 'object') {
      out.parser_payload = input.parserPayload;
    }
    return out;
  }
  if (toolName === 'python-sandbox') {
    return {
      code: buildFallbackPythonCode(input)
    };
  }
  return {};
}

function buildFallbackAction(input = {}) {
  const toolTrace = asArray(input.toolTrace);
  const toolCandidates = asArray(input.researchPlan?.possible_tools_or_sources)
    .map((item) => cleanText(item, 120))
    .filter(Boolean);
  const nextTool = toolCandidates.find((toolName) => {
    return !toolTrace.some((row) => cleanText(row?.tool_name, 120) === toolName && row?.ok === true);
  }) || toolCandidates[0] || '';
  if (!nextTool) {
    return {
      action: 'answer',
      reason: 'No more planned tools remain.',
      assistant_note: 'Move to synthesis with the current evidence.',
      tool_name: null,
      arguments: {},
      answer_fragment: cleanText(input.latestAssistantText, 600)
    };
  }
  return {
    action: 'tool',
    reason: `Run ${nextTool} as the next planned evidence step.`,
    assistant_note: `Next evidence step: ${nextTool}.`,
    tool_name: nextTool,
    arguments: buildFallbackToolArguments(nextTool, input),
    answer_fragment: null
  };
}

function normalizeNextAction(rawPayload, fallback = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  return {
    action: cleanText(source.action, 40) === 'answer' ? 'answer' : (cleanText(source.action, 40) === 'tool' ? 'tool' : cleanText(fallback.action, 40) || 'answer'),
    reason: cleanText(source.reason, 320) || cleanText(fallback.reason, 320) || 'No action reason was provided.',
    assistant_note: cleanText(source.assistant_note, 800) || cleanText(fallback.assistant_note, 800) || '',
    tool_name: cleanText(source.tool_name, 120) || cleanText(fallback.tool_name, 120) || null,
    arguments: source.arguments && typeof source.arguments === 'object'
      ? source.arguments
      : (fallback.arguments && typeof fallback.arguments === 'object' ? fallback.arguments : {}),
    answer_fragment: cleanText(source.answer_fragment, 1200) || cleanText(fallback.answer_fragment, 1200) || ''
  };
}

function buildExecutionActionPrompt(input = {}) {
  const toolDefinitions = asArray(input.toolDefinitions).map((tool) => ({
    name: cleanText(tool?.name, 120),
    description: cleanText(tool?.description, 500),
    parameters: tool?.parameters && typeof tool.parameters === 'object'
      ? tool.parameters
      : {}
  }));
  return [
    'You are executing Step 4 of a deep research workflow.',
    'Choose exactly one next action: either call one tool or stop and hand off to synthesis.',
    'Prefer the minimum next action that meaningfully advances the research plan.',
    'Use sub-agent only if the sub-question is independent and parallel work clearly helps.',
    `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
    `Research objective JSON:\n${JSON.stringify(input.researchObjective || {}, null, 2)}`,
    `Research plan JSON:\n${JSON.stringify(input.researchPlan || {}, null, 2)}`,
    `Context snapshot JSON:\n${JSON.stringify(input.contextSnapshot || {}, null, 2)}`,
    `Accuracy snapshot JSON:\n${JSON.stringify(input.accuracySnapshot || {}, null, 2)}`,
    `Latest completion check JSON:\n${JSON.stringify(input.completionCheck || null, null, 2)}`,
    `Tool trace JSON:\n${JSON.stringify(asArray(input.toolTrace).slice(-8), null, 2)}`,
    `Available tools JSON:\n${JSON.stringify(toolDefinitions, null, 2)}`,
    `Rounds executed: ${Number(input.roundsExecuted) || 0}/${Number(input.maxRounds) || 0}`,
    'Return JSON only.'
  ].filter(Boolean).join('\n\n');
}

async function selectNextAction(input = {}, deps = {}) {
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const fallback = buildFallbackAction(input);
  if (!requestStructuredJsonPayload) {
    return fallback;
  }
  const result = await requestStructuredJsonPayload({
    provider: cleanText(input.provider, 80),
    endpoint: cleanText(input.endpoint, 2000),
    apiKey: cleanText(input.apiKey, 400),
    model: cleanText(input.model, 120),
    stage: 'deep_research_step_4_next_action',
    systemPrompt: 'Return valid JSON only.',
    userPrompt: buildExecutionActionPrompt(input),
    schema: NEXT_ACTION_SCHEMA,
    traceContext: input.traceContext || null,
    maxOutputTokens: 1500,
    openAiStrict: true,
    openAiAsDefaultProvider: true,
    defaultError: 'Deep research execution planner is not configured.'
  });
  if (!result?.ok || !result.payload) {
    return fallback;
  }
  return normalizeNextAction(result.payload, fallback);
}

function buildSubAgentArguments(input = {}, existingArgs = {}) {
  const args = existingArgs && typeof existingArgs === 'object' ? { ...existingArgs } : {};
  if (!cleanText(args.action, 40)) {
    args.action = 'create';
  }
  if (args.action === 'create') {
    args.name = cleanText(args.name, 160) || 'deep-research-helper';
    args.system_prompt = cleanText(
      args.system_prompt,
      40000
    ) || 'You are a deep research helper. Review one independent sub-question, preserve evidence quality, and report contradictions instead of flattening them.';
    args.message = cleanText(args.message, 40000) || cleanText(input.buildSubAgentInstruction?.({
      researchObjective: input.researchObjective?.research_goal,
      subquestion: asArray(input.researchPlan?.key_subquestions)[1] || asArray(input.researchPlan?.key_subquestions)[0],
      contextSnapshot: input.contextSnapshot
    }), 40000);
    args.reason = cleanText(args.reason, 240) || 'Parallelize one independent sub-question.';
  }
  return args;
}

async function runStep4ExecutePlan(input = {}, deps = {}) {
  const resolveToolDefinitions = typeof deps.resolveToolDefinitions === 'function'
    ? deps.resolveToolDefinitions
    : ((toolNames = []) => asArray(toolNames).map((toolName) => ({
      name: cleanText(toolName, 120),
      description: '',
      parameters: { type: 'object', additionalProperties: true, properties: {} }
    })));
  const runTool = typeof input.runTool === 'function' ? input.runTool : deps.runTool;
  const runCompletionCheck = typeof input.runCompletionCheck === 'function'
    ? input.runCompletionCheck
    : deps.runCompletionCheck;
  const createContextControlState = typeof input.createContextControlState === 'function'
    ? input.createContextControlState
    : deps.createContextControlState;
  const updateContextControlState = typeof input.updateContextControlState === 'function'
    ? input.updateContextControlState
    : deps.updateContextControlState;
  const buildContextControlSnapshot = typeof input.buildContextControlSnapshot === 'function'
    ? input.buildContextControlSnapshot
    : deps.buildContextControlSnapshot;
  const createAccuracyPreservationState = typeof input.createAccuracyPreservationState === 'function'
    ? input.createAccuracyPreservationState
    : deps.createAccuracyPreservationState;
  const updateAccuracyPreservationState = typeof input.updateAccuracyPreservationState === 'function'
    ? input.updateAccuracyPreservationState
    : deps.updateAccuracyPreservationState;
  const buildAccuracyPreservationSnapshot = typeof input.buildAccuracyPreservationSnapshot === 'function'
    ? input.buildAccuracyPreservationSnapshot
    : deps.buildAccuracyPreservationSnapshot;
  const shouldDelegateSubAgent = typeof input.shouldDelegateSubAgent === 'function'
    ? input.shouldDelegateSubAgent
    : deps.shouldDelegateSubAgent;
  const buildSubAgentInstruction = typeof input.buildSubAgentInstruction === 'function'
    ? input.buildSubAgentInstruction
    : deps.buildSubAgentInstruction;

  if (typeof runTool !== 'function') {
    throw new Error('Deep research execution requires runTool.');
  }
  if (typeof runCompletionCheck !== 'function') {
    throw new Error('Deep research execution requires runCompletionCheck.');
  }

  const maxRounds = Math.max(1, Number(input.maxRounds) || 4);
  const toolDefinitions = asArray(input.toolDefinitions).length
    ? asArray(input.toolDefinitions)
    : resolveToolDefinitions(asArray(input.researchPlan?.possible_tools_or_sources));
  const toolSchemaMap = buildToolSchemaMap(toolDefinitions);
  const allowedToolNames = toolDefinitions.map((tool) => cleanText(tool?.name, 120)).filter(Boolean);
  let contextState = typeof createContextControlState === 'function'
    ? createContextControlState({
      objective_summary: cleanText(input.researchObjective?.research_goal, 600)
    })
    : {
      rolling_summary: '',
      evidence_buffer: [],
      round_summaries: [],
      section_buffers: {},
      retrieval_notes: []
    };
  let accuracyState = typeof createAccuracyPreservationState === 'function'
    ? createAccuracyPreservationState()
    : {
      citations: [],
      contradictions: [],
      load_bearing_claims: [],
      uncertainty_markers: []
    };
  const toolTrace = [];
  const completionChecks = [];
  const intermediateStates = [];
  const aggregatedCitations = [];
  let latestAssistantText = '';
  let latestCompletionCheck = null;

  for (let round = 1; round <= maxRounds; round += 1) {
    const contextSnapshot = typeof buildContextControlSnapshot === 'function'
      ? buildContextControlSnapshot(contextState, { maxEvidence: 10, maxRounds: 4, maxSections: 4 })
      : contextState;
    const accuracySnapshot = typeof buildAccuracyPreservationSnapshot === 'function'
      ? buildAccuracyPreservationSnapshot(accuracyState, { maxCitations: 10, maxClaims: 8, maxContradictions: 6 })
      : accuracyState;
    const action = await selectNextAction({
      ...input,
      toolDefinitions,
      toolTrace,
      roundsExecuted: round - 1,
      maxRounds,
      latestAssistantText,
      contextSnapshot,
      accuracySnapshot,
      completionCheck: latestCompletionCheck
    }, deps);

    if (action.action !== 'tool' || !cleanText(action.tool_name, 120)) {
      latestAssistantText = cleanText(action.answer_fragment, 1200) || cleanText(action.assistant_note, 1200);
      latestCompletionCheck = await runCompletionCheck({
        ...input,
        allowedToolNames,
        toolTrace,
        citations: aggregatedCitations,
        roundsExecuted: round - 1,
        maxRounds,
        contextSnapshot,
        accuracySnapshot
      }, deps);
      completionChecks.push(latestCompletionCheck);
      intermediateStates.push({
        stage: 'step_4_execute',
        round: round - 1,
        action: 'answer',
        reason: cleanText(action.reason, 320),
        completion_check: latestCompletionCheck
      });
      break;
    }

    const toolName = cleanText(action.tool_name, 120);
    const argsObject = action.arguments && typeof action.arguments === 'object' ? action.arguments : {};
    const validation = validateArgumentsAgainstSchema(toolSchemaMap.get(toolName), argsObject);
    let envelope;
    let effectiveArgs = argsObject;

    if (!allowedToolNames.includes(toolName)) {
      envelope = buildSyntheticToolEnvelope(toolName, argsObject, `Tool ${toolName} is not allowed for this deep research plan.`);
    } else if (toolName === 'sub-agent') {
      const allowDelegation = typeof shouldDelegateSubAgent === 'function'
        ? shouldDelegateSubAgent({
          ...input,
          allowedToolNames,
          toolTrace,
          roundsExecuted: round - 1,
          maxRounds
        })
        : false;
      if (!allowDelegation) {
        envelope = buildSyntheticToolEnvelope(toolName, argsObject, 'Sub-agent delegation is not justified yet for this research run.');
      } else {
        effectiveArgs = buildSubAgentArguments({
          ...input,
          contextSnapshot,
          buildSubAgentInstruction
        }, argsObject);
        const delegatedValidation = validateArgumentsAgainstSchema(toolSchemaMap.get(toolName), effectiveArgs);
        if (!delegatedValidation.ok) {
          envelope = buildSyntheticToolEnvelope(toolName, effectiveArgs, cleanText(delegatedValidation.error, 320));
        }
      }
    } else if (!validation.ok) {
      envelope = buildSyntheticToolEnvelope(toolName, argsObject, cleanText(validation.error, 320));
    }

    if (!envelope) {
      try {
        envelope = await runTool(toolName, effectiveArgs, {
          allowWriteTools: false,
          traceContext: input.traceContext || null,
          lifecycleRecorder: input.lifecycleRecorder || null
        });
      } catch (error) {
        envelope = buildSyntheticToolEnvelope(toolName, effectiveArgs, cleanText(error?.message || error, 320));
      }
    }

    const citations = inferEnvelopeCitations(envelope, toolName);
    citations.forEach((citation) => aggregatedCitations.push(citation));
    latestAssistantText = cleanText(action.assistant_note, 1200) || summarizeToolEnvelope(envelope, toolName);
    toolTrace.push({
      round,
      tool_name: toolName,
      input: effectiveArgs,
      ok: envelope?.ok === true,
      summary: summarizeToolEnvelope(envelope, toolName),
      error: cleanText(envelope?.error, 600),
      citations
    });

    if (typeof updateContextControlState === 'function') {
      contextState = updateContextControlState(contextState, {
        round,
        stage: 'execute',
        tool_name: toolName,
        assistant_text: latestAssistantText,
        tool_summary: summarizeToolEnvelope(envelope, toolName),
        retrieval_note: cleanText(action.reason, 320),
        evidence_rows: citations,
        section_buffers: asArray(input.researchPlan?.answer_sections).slice(0, 3).map((section) => ({
          section,
          evidence: citations.slice(0, 2)
        }))
      });
    }
    if (typeof updateAccuracyPreservationState === 'function') {
      accuracyState = updateAccuracyPreservationState(accuracyState, {
        citations,
        contradictions: envelope?.result?.contradictions,
        load_bearing_claims: [latestAssistantText],
        uncertainty_markers: envelope?.result?.uncertainty_markers,
        assistant_text: latestAssistantText
      });
    }

    const refreshedContextSnapshot = typeof buildContextControlSnapshot === 'function'
      ? buildContextControlSnapshot(contextState, { maxEvidence: 10, maxRounds: 4, maxSections: 4 })
      : contextState;
    const refreshedAccuracySnapshot = typeof buildAccuracyPreservationSnapshot === 'function'
      ? buildAccuracyPreservationSnapshot(accuracyState, { maxCitations: 10, maxClaims: 8, maxContradictions: 6 })
      : accuracyState;

    latestCompletionCheck = await runCompletionCheck({
      ...input,
      allowedToolNames,
      toolTrace,
      citations: aggregatedCitations,
      roundsExecuted: round,
      maxRounds,
      contextSnapshot: refreshedContextSnapshot,
      accuracySnapshot: refreshedAccuracySnapshot
    }, deps);
    completionChecks.push(latestCompletionCheck);
    intermediateStates.push({
      stage: 'step_4_execute',
      round,
      action: 'tool',
      tool_name: toolName,
      tool_summary: summarizeToolEnvelope(envelope, toolName),
      completion_check: latestCompletionCheck
    });

    if (latestCompletionCheck?.satisfied === true) {
      break;
    }
  }

  return {
    rounds_executed: toolTrace.length,
    tool_trace: toolTrace,
    citations: normalizeCitations(aggregatedCitations, '', 20),
    context_snapshot: typeof buildContextControlSnapshot === 'function'
      ? buildContextControlSnapshot(contextState, { maxEvidence: 12, maxRounds: 5, maxSections: 5 })
      : contextState,
    accuracy_snapshot: typeof buildAccuracyPreservationSnapshot === 'function'
      ? buildAccuracyPreservationSnapshot(accuracyState, { maxCitations: 12, maxClaims: 8, maxContradictions: 8 })
      : accuracyState,
    completion_check: latestCompletionCheck,
    completion_checks: completionChecks,
    intermediate_states: intermediateStates,
    latest_assistant_text: latestAssistantText
  };
}

module.exports = {
  runStep4ExecutePlan
};
