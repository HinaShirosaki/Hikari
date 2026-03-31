/**
 * Shared science-reasoning runtime for agent flows that need iterative evidence gathering.
 *
 * This module centralizes three related science intents:
 * - general_science_question: literature/web-grounded science Q&A
 * - project_science_question: project-aware reasoning that prefers internal records first
 * - result_analysis: deterministic analysis that prefers computation before interpretation
 *
 * The runtime enforces a single-tool-per-round loop, evaluates whether evidence is
 * sufficient after each round, and then synthesizes a final grounded answer.
 */
'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');

// Supported science intents that can be routed into the shared reasoning loop.
const SCIENCE_REASONING_INTENTS = Object.freeze([
  'general_science_question',
  'project_science_question',
  'result_analysis'
]);

// Per-intent execution policies controlling tool scope, retrieval order, and evidence requirements.
const SCIENCE_REASONING_POLICIES = Object.freeze({
  // General science Q&A prefers external literature retrieval before broad web search.
  general_science_question: Object.freeze({
    intent: 'general_science_question',
    description: 'Use literature and web retrieval to answer general science questions with grounded citations.',
    tool_scope: Object.freeze([
      'search_pubmed',
      'search_europe_pmc',
      'search_crossref',
      'search_uniprot',
      'search_web'
    ]),
    retrieval_priority: 'literature_first_web_last',
    require_external_citation_when_recent: true,
    require_retrieval_attempt: true,
    answer_with_limitations_after_attempt: true
  }),
  // Project science reasoning must ground answers in project-linked records before external sources.
  project_science_question: Object.freeze({
    intent: 'project_science_question',
    description: 'Use project-linked records first, then external literature only when internal evidence is insufficient.',
    tool_scope: Object.freeze([
      'search_projects',
      'search_protocols',
      'search_notebook_entries',
      'search_workflows',
      'search_assays',
      'search_gel_analyses',
      'search_papers',
      'search_pubmed',
      'search_europe_pmc',
      'search_crossref',
      'search_uniprot',
      'search_web'
    ]),
    retrieval_priority: 'internal_first_then_external',
    require_project_resolution: true,
    distinguish_internal_vs_external: true
  }),
  // Result analysis emphasizes deterministic computation before internal/external interpretation.
  result_analysis: Object.freeze({
    intent: 'result_analysis',
    description: 'Use deterministic computation plus local records, then add literature only for interpretation.',
    tool_scope: Object.freeze([
      'run_python_sandbox',
      'search_projects',
      'search_protocols',
      'search_notebook_entries',
      'search_workflows',
      'search_assays',
      'search_gel_analyses',
      'search_papers',
      'search_pubmed',
      'search_europe_pmc',
      'search_crossref',
      'search_uniprot',
      'search_web'
    ]),
    retrieval_priority: 'compute_then_internal_then_external',
    require_compute_for_numeric_queries: true
  })
});

// Structured schema for the evaluator that decides whether another loop round is required.
const SCIENCE_RESULT_EVALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'satisfied',
    'reason',
    'missing_requirements',
    'should_continue',
    'next_tool_hint',
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
    next_tool_hint: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['tool_name', 'reason'],
          properties: {
            tool_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            query: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reason: { type: 'string' }
          }
        }
      ]
    },
    can_answer_with_limitations: { type: 'boolean' }
  }
};

// Structured schema for the final synthesis step that converts gathered evidence into an answer.
const SCIENCE_FINAL_SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'confidence', 'decision_record', 'follow_up_questions'],
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    decision_record: {
      type: 'object',
      additionalProperties: false,
      required: ['assumptions', 'open_questions', 'verification_notes'],
      properties: {
        assumptions: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
        verification_notes: { type: 'array', items: { type: 'string' } }
      }
    },
    follow_up_questions: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

/**
 * Build the shared science reasoning runtime.
 *
 * The runtime is dependency-injected so the surrounding app can provide:
 * - LLM helpers for structured JSON generation
 * - agent session lifecycle methods
 * - tool execution hooks
 * - response shaping / validation layers
 * - lifecycle logging hooks
 */
function createScienceReasoningLoopRuntime(deps = {}) {
  // Shared helper utilities used throughout normalization, validation, and structured LLM calls.
  const {
    asArray,
    cleanText,
    uniqueStrings,
    safeParseJson,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);
  // Optional dependency overrides with deterministic fallbacks for testability.
  const clamp = typeof deps.clamp === 'function'
    ? deps.clamp
    : ((value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)));
  const startAgentSession = typeof deps.startAgentSession === 'function'
    ? deps.startAgentSession
    : null;
  const extractAgentSessionFunctionCalls = typeof deps.extractAgentSessionFunctionCalls === 'function'
    ? deps.extractAgentSessionFunctionCalls
    : (() => []);
  const extractAgentSessionText = typeof deps.extractAgentSessionText === 'function'
    ? deps.extractAgentSessionText
    : (() => '');
  const continueAgentSessionWithToolOutputs = typeof deps.continueAgentSessionWithToolOutputs === 'function'
    ? deps.continueAgentSessionWithToolOutputs
    : (async (session) => session);
  const continueAgentSessionWithUserMessage = typeof deps.continueAgentSessionWithUserMessage === 'function'
    ? deps.continueAgentSessionWithUserMessage
    : (async (session) => session);
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : null;
  const resolveToolDefinitions = typeof deps.resolveToolDefinitions === 'function'
    ? deps.resolveToolDefinitions
    : ((selectedToolNames = []) => asArray(selectedToolNames).map((name) => ({
      name: cleanText(name, 120),
      description: '',
      parameters: {
        type: 'object',
        additionalProperties: true,
        properties: {}
      }
    })));
  const applyResponseLayerToOutput = typeof deps.applyResponseLayerToOutput === 'function'
    ? deps.applyResponseLayerToOutput
    : (({ normalized }) => normalized);
  const applyValidationGateToOutput = typeof deps.applyValidationGateToOutput === 'function'
    ? deps.applyValidationGateToOutput
    : (({ routing, normalized }) => ({
      routing,
      normalized,
      validation: {
        passed: true,
        forced_clarification: false,
        violations: [],
        failure_reasons: []
      },
      provenance: {
        source_evidence: [],
        unsupported_statement_count: 0
      }
    }));
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const evaluateScienceRoundOverride = typeof deps.evaluateScienceRound === 'function'
    ? deps.evaluateScienceRound
    : null;
  const synthesizeScienceFinalOverride = typeof deps.synthesizeScienceFinal === 'function'
    ? deps.synthesizeScienceFinal
    : null;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());

  // Normalize an incoming intent and reject unsupported science routes.
  function normalizeIntent(intent) {
    const normalized = cleanText(intent, 80);
    return SCIENCE_REASONING_INTENTS.includes(normalized) ? normalized : '';
  }

  // Create lightweight unique IDs for intermediate state snapshots captured during the loop.
  function buildStateId(prefix) {
    return `${cleanText(prefix, 40) || 'science'}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  // Record a structured checkpoint so the caller can inspect how reasoning evolved across rounds.
  function buildIntermediateState(stage, goal, extras = {}) {
    return {
      state_id: buildStateId(stage),
      created_at: now(),
      stage: cleanText(stage, 80),
      goal: cleanText(goal, 800),
      assumptions: asArray(extras.assumptions).map((item) => cleanText(item, 320)).filter(Boolean),
      open_questions: asArray(extras.open_questions).map((item) => cleanText(item, 320)).filter(Boolean),
      evidence: asArray(extras.evidence).slice(0, 20).map((item) => ({
        source: cleanText(item?.source, 120),
        pointer: cleanText(item?.pointer, 220),
        reason: cleanText(item?.reason, 260)
      })).filter((item) => item.source || item.pointer),
      proposed_actions: asArray(extras.proposed_actions).slice(0, 10).map((item) => ({
        action_type: cleanText(item?.action_type, 40),
        tool_name: cleanText(item?.tool_name, 120),
        risk_level: cleanText(item?.risk_level, 30),
        reason: cleanText(item?.reason, 260)
      })).filter((item) => item.action_type || item.tool_name || item.reason),
      confidence: Number.isFinite(Number(extras.confidence))
        ? clamp(Number(extras.confidence), 0, 1)
        : 0.5
    };
  }

  // Resolve the policy object for a validated intent.
  function getIntentPolicy(intent) {
    const normalized = normalizeIntent(intent);
    if (!normalized) {
      throw new Error(`Unsupported science reasoning intent: ${cleanText(intent, 80) || 'missing'}`);
    }
    return SCIENCE_REASONING_POLICIES[normalized];
  }

  // Reduce project metadata to the minimal fields the loop needs for grounded project reasoning.
  function normalizeProject(project) {
    const source = project && typeof project === 'object' ? project : {};
    const id = cleanText(source.id, 120);
    const name = cleanText(source.name, 220);
    if (!id && !name) {
      return null;
    }
    return {
      id,
      name,
      resolution_source: cleanText(source.resolution_source, 80) || 'unknown'
    };
  }

  // Classify citation sources by how directly they support claims inside the app.
  function citationSupportLevel(source) {
    const normalized = cleanText(source, 120).toLowerCase();
    if (!normalized) {
      return 'none';
    }
    if ([
      'project',
      'protocol',
      'notebook_entry',
      'workflow',
      'assay',
      'gel_analysis',
      'paper',
      'python_sandbox'
    ].includes(normalized)) {
      return 'direct';
    }
    return 'indirect';
  }

  // Deduplicate and sanitize citation objects so downstream layers receive a stable format.
  function normalizeCitations(citations, max = 20) {
    const seen = new Set();
    const out = [];
    asArray(citations).forEach((citation) => {
      const source = cleanText(citation?.source, 120);
      const pointer = cleanText(citation?.pointer, 220);
      const reason = cleanText(citation?.reason, 260);
      const key = `${source.toLowerCase()}::${pointer.toLowerCase()}`;
      if (!source && !pointer) {
        return;
      }
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push({ source, pointer, reason });
    });
    return out;
  }

  // Merge model-produced decision records with deterministic fallback notes.
  function normalizeDecisionRecord(record, fallback = {}) {
    const source = record && typeof record === 'object' ? record : {};
    return {
      assumptions: uniqueStrings([
        ...asArray(source.assumptions),
        ...asArray(fallback.assumptions)
      ], 10),
      open_questions: uniqueStrings([
        ...asArray(source.open_questions),
        ...asArray(fallback.open_questions)
      ], 10),
      verification_notes: uniqueStrings([
        ...asArray(source.verification_notes),
        ...asArray(fallback.verification_notes)
      ], 12)
    };
  }

  // Build a consistent early-exit payload when clarification is required before any safe retrieval.
  function buildNeedsMoreInfoResult({
    intent,
    routing,
    reason,
    question,
    toolTrace = [],
    intermediateStates = [],
    citations = []
  }) {
    const followUp = uniqueStrings([
      cleanText(question, 320) || cleanText(reason, 280) || 'Could you clarify the missing details so I can continue safely?'
    ], 4);
    const normalizedBase = applyResponseLayerToOutput({
      normalized: {
        answer: followUp[0],
        confidence: 0.35,
        citations: normalizeCitations(citations),
        decision_record: {
          assumptions: [
            `${intent} was routed into the shared science reasoning loop.`
          ],
          open_questions: followUp,
          verification_notes: [
            'Execution stopped before tool use because prerequisite clarification was missing.'
          ]
        }
      },
      routing,
      notebookDraft: null,
      toolTrace
    });
    const validation = applyValidationGateToOutput({
      routing,
      normalized: {
        ...normalizedBase,
        decisionRecord: normalizeDecisionRecord(normalizedBase.decision_record, {
          assumptions: [`${intent} requires clarification before retrieval.`],
          open_questions: followUp,
          verification_notes: ['No science retrieval tool was executed.']
        })
      },
      notebookDraft: null,
      toolTrace
    });
    return {
      status: 'needs_more_info',
      answer: validation.normalized.answer,
      confidence: Number.isFinite(Number(validation.normalized.confidence))
        ? Number(validation.normalized.confidence)
        : 0.35,
      citations: normalizeCitations(citations),
      decision_record: validation.normalized.decisionRecord || normalizeDecisionRecord(null, {
        assumptions: [`${intent} requires clarification before retrieval.`],
        open_questions: followUp,
        verification_notes: ['No science retrieval tool was executed.']
      }),
      response_type: cleanText(validation.normalized.response_type, 80),
      confidence_label: cleanText(validation.normalized.confidence_label, 40),
      source_summary: validation.normalized.source_summary && typeof validation.normalized.source_summary === 'object'
        ? validation.normalized.source_summary
        : { total_sources: 0, groups: [] },
      unresolved_fields: asArray(validation.normalized.unresolved_fields).map((item) => cleanText(item, 180)).filter(Boolean),
      validation: validation.validation,
      provenance: validation.provenance,
      tool_trace: asArray(toolTrace),
      intermediate_states: asArray(intermediateStates),
      rounds_executed: 0,
      follow_up_questions: followUp
    };
  }

  // Convert tool definitions into a quick lookup map for per-call argument validation.
  function buildToolSchemaMap(toolDefinitions) {
    const out = new Map();
    asArray(toolDefinitions).forEach((tool) => {
      const name = cleanText(tool?.name, 120);
      if (!name) {
        return;
      }
      out.set(name, tool?.parameters && typeof tool.parameters === 'object'
        ? tool.parameters
        : { type: 'object', additionalProperties: true, properties: {} });
    });
    return out;
  }

  // Minimal JSON-schema-like primitive type check used by the local argument validator.
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

  // Recursively validate tool arguments against the resolved tool parameter schema.
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
    if (schemaType === 'integer' && Number.isFinite(Number(targetSchema.minimum)) && Number(value) < Number(targetSchema.minimum)) {
      return { ok: false, error: `${path} must be >= ${Number(targetSchema.minimum)}.` };
    }
    if (schemaType === 'integer' && Number.isFinite(Number(targetSchema.maximum)) && Number(value) > Number(targetSchema.maximum)) {
      return { ok: false, error: `${path} must be <= ${Number(targetSchema.maximum)}.` };
    }
    if (schemaType === 'number' && Number.isFinite(Number(targetSchema.minimum)) && Number(value) < Number(targetSchema.minimum)) {
      return { ok: false, error: `${path} must be >= ${Number(targetSchema.minimum)}.` };
    }
    if (schemaType === 'number' && Number.isFinite(Number(targetSchema.maximum)) && Number(value) > Number(targetSchema.maximum)) {
      return { ok: false, error: `${path} must be <= ${Number(targetSchema.maximum)}.` };
    }
    if (Array.isArray(targetSchema.enum) && targetSchema.enum.length && !targetSchema.enum.includes(value)) {
      return { ok: false, error: `${path} must be one of: ${targetSchema.enum.join(', ')}.` };
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

  // Normalize raw function-call payloads from the agent session into a stable local shape.
  function normalizeToolCall(call) {
    const source = call && typeof call === 'object' ? call : {};
    return {
      callId: cleanText(source.callId || source.call_id || source.id, 120),
      name: cleanText(source.name || source.tool_name, 120),
      argsText: cleanText(source.argsText || source.arguments || source.args, 12000)
    };
  }

  // Heuristic: detect requests that should not be satisfied without recent/reference-backed sources.
  function messageRequestsRecentSources(message) {
    return /\b(latest|recent|current|today|newest|papers|references|citations|study|studies|findings)\b/i
      .test(String(message || ''));
  }

  // Heuristic: detect prompts that imply deterministic numeric or transformation work.
  function messageRequestsComputation(message) {
    return /\b(fit|curve|transform|quantif|outlier|calculate|compute|regression|normalize|analy[sz]e data)\b/i
      .test(String(message || ''));
  }

  // Check whether any accumulated citation came from an external evidence source.
  function hasExternalCitation(citations) {
    return asArray(citations).some((citation) => {
      const source = cleanText(citation?.source, 120).toLowerCase();
      return ['pubmed', 'crossref', 'europe_pmc', 'uniprot', 'web_source'].includes(source);
    });
  }

  // Check whether any accumulated citation came from internal/project-linked evidence.
  function hasInternalCitation(citations) {
    return asArray(citations).some((citation) => {
      const source = cleanText(citation?.source, 120).toLowerCase();
      return ['project', 'protocol', 'notebook_entry', 'workflow', 'assay', 'gel_analysis', 'paper', 'python_sandbox'].includes(source);
    });
  }

  // Assemble the evaluator prompt that judges whether the current evidence is sufficient.
  function buildEvaluationPrompt({
    intent,
    policy,
    message,
    parserPayload,
    project,
    accumulatedCitations,
    toolTrace,
    latestToolResult,
    latestAssistantText,
    roundsExecuted,
    maxRounds
  }) {
    return [
      'You are the sufficiency evaluator for a science reasoning loop.',
      'Decide whether the latest available evidence is enough to answer the user request.',
      'Be strict about missing evidence, but allow a best-effort answer when the user can still be helped with clearly stated limitations.',
      `Intent: ${intent}`,
      `Policy JSON:\n${JSON.stringify(policy, null, 2)}`,
      project ? `Resolved project JSON:\n${JSON.stringify(project, null, 2)}` : '',
      `User message:\n${cleanText(message, 3200)}`,
      `Parser payload JSON:\n${JSON.stringify(parserPayload || {}, null, 2)}`,
      `Rounds executed: ${roundsExecuted}/${maxRounds}`,
      `Latest assistant text:\n${cleanText(latestAssistantText, 4000) || '-'}`,
      `Latest tool result JSON:\n${JSON.stringify(latestToolResult || null, null, 2)}`,
      `Accumulated citations JSON:\n${JSON.stringify(normalizeCitations(accumulatedCitations, 16), null, 2)}`,
      `Tool trace JSON:\n${JSON.stringify(asArray(toolTrace).slice(-8), null, 2)}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  // Sanitize evaluator output so the loop can continue safely even with imperfect model responses.
  function normalizeEvaluationPayload(rawPayload, fallbackReason = '') {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const nextToolHint = source.next_tool_hint && typeof source.next_tool_hint === 'object'
      ? {
        tool_name: cleanText(source.next_tool_hint.tool_name, 120) || null,
        query: cleanText(source.next_tool_hint.query, 320) || null,
        reason: cleanText(source.next_tool_hint.reason, 260) || 'More evidence is required.'
      }
      : null;
    return {
      satisfied: source.satisfied === true,
      reason: cleanText(source.reason, 320) || cleanText(fallbackReason, 320) || 'No sufficiency rationale was provided.',
      missing_requirements: uniqueStrings(asArray(source.missing_requirements), 6),
      should_continue: source.should_continue === true,
      next_tool_hint: nextToolHint,
      can_answer_with_limitations: source.can_answer_with_limitations === true
    };
  }

  // Run the sufficiency evaluator after each round, or delegate to a caller-provided override.
  async function evaluateScienceRound(payload = {}) {
    if (evaluateScienceRoundOverride) {
      const overridden = await evaluateScienceRoundOverride(payload);
      return normalizeEvaluationPayload(overridden, 'Custom evaluator returned no explicit reason.');
    }
    const llmResult = await requestStructuredJsonPayload({
      provider: cleanText(payload.provider, 80),
      endpoint: cleanText(payload.endpoint, 2000),
      apiKey: cleanText(payload.apiKey, 400),
      model: cleanText(payload.model, 120),
      stage: 'science_reasoning_evaluator',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildEvaluationPrompt(payload),
      schema: SCIENCE_RESULT_EVALUATION_SCHEMA,
      traceContext: payload.traceContext || null,
      maxOutputTokens: 1400,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Science reasoning evaluator is not configured.'
    });
    if (!llmResult?.ok || !llmResult.payload) {
      return {
        satisfied: false,
        reason: cleanText(llmResult?.error, 320) || 'Science reasoning evaluator failed.',
        missing_requirements: ['Evaluator output was unavailable.'],
        should_continue: true,
        next_tool_hint: null,
        can_answer_with_limitations: true
      };
    }
    return normalizeEvaluationPayload(llmResult.payload);
  }

  // Assemble the final synthesis prompt using only evidence already collected by the loop.
  function buildSynthesisPrompt({
    intent,
    policy,
    message,
    parserPayload,
    project,
    roundsExecuted,
    maxRounds,
    evaluator,
    accumulatedCitations,
    toolTrace,
    partial
  }) {
    return [
      'You are the final answer synthesizer for a science reasoning loop.',
      'Answer using only the evidence and tool trace provided by the app.',
      'Do not invent evidence, papers, values, or project facts.',
      partial
        ? 'The loop stopped before full satisfaction. Produce the best available answer and explicitly name the remaining gaps.'
        : 'The evaluator judged the evidence sufficient. Produce a concise grounded answer.',
      `Intent: ${intent}`,
      `Policy JSON:\n${JSON.stringify(policy, null, 2)}`,
      project ? `Resolved project JSON:\n${JSON.stringify(project, null, 2)}` : '',
      `User message:\n${cleanText(message, 3200)}`,
      `Parser payload JSON:\n${JSON.stringify(parserPayload || {}, null, 2)}`,
      `Rounds executed: ${roundsExecuted}/${maxRounds}`,
      `Evaluator JSON:\n${JSON.stringify(evaluator || null, null, 2)}`,
      `Citations JSON:\n${JSON.stringify(normalizeCitations(accumulatedCitations, 20), null, 2)}`,
      `Tool trace JSON:\n${JSON.stringify(asArray(toolTrace).slice(0, 20), null, 2)}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  // Produce the final answer payload, or fall back deterministically if synthesis is unavailable.
  async function synthesizeScienceFinal(payload = {}) {
    if (synthesizeScienceFinalOverride) {
      const overridden = await synthesizeScienceFinalOverride(payload);
      return {
        answer: cleanText(overridden?.answer, 12000),
        confidence: Number.isFinite(Number(overridden?.confidence))
          ? clamp(Number(overridden.confidence), 0, 1)
          : 0.58,
        decision_record: normalizeDecisionRecord(overridden?.decision_record, {
          verification_notes: ['Returned custom final synthesis payload.']
        }),
        follow_up_questions: uniqueStrings(asArray(overridden?.follow_up_questions), 6)
      };
    }
    const llmResult = await requestStructuredJsonPayload({
      provider: cleanText(payload.provider, 80),
      endpoint: cleanText(payload.endpoint, 2000),
      apiKey: cleanText(payload.apiKey, 400),
      model: cleanText(payload.model, 120),
      stage: 'science_reasoning_final_synthesis',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildSynthesisPrompt(payload),
      schema: SCIENCE_FINAL_SYNTHESIS_SCHEMA,
      traceContext: payload.traceContext || null,
      maxOutputTokens: 1700,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Science reasoning synthesis is not configured.'
    });
    if (!llmResult?.ok || !llmResult.payload) {
      return {
        answer: cleanText(payload.fallbackAnswer, 12000)
          || 'I could not complete a grounded final synthesis from the available evidence.',
        confidence: payload.partial === true ? 0.48 : 0.58,
        decision_record: normalizeDecisionRecord(null, {
          assumptions: ['The final synthesis model response was unavailable.'],
          open_questions: asArray(payload?.evaluator?.missing_requirements),
          verification_notes: ['Returned a deterministic fallback synthesis.']
        }),
        follow_up_questions: uniqueStrings(asArray(payload?.evaluator?.missing_requirements), 6)
      };
    }
    return {
      answer: cleanText(llmResult.payload.answer, 12000),
      confidence: Number.isFinite(Number(llmResult.payload.confidence))
        ? clamp(Number(llmResult.payload.confidence), 0, 1)
        : (payload.partial === true ? 0.5 : 0.65),
      decision_record: normalizeDecisionRecord(llmResult.payload.decision_record),
      follow_up_questions: uniqueStrings(asArray(llmResult.payload.follow_up_questions), 6)
    };
  }

  // Construct the agent session system prompt that constrains the loop to one tool per turn.
  function buildScienceSessionSystemPrompt({
    baseSystemPrompt = '',
    intent,
    policy,
    routing,
    project,
    message
  }) {
    const rules = [
      'You are inside a deterministic science reasoning loop.',
      'At each assistant turn, either call exactly one tool or answer directly if you already have sufficient evidence.',
      'Do not call more than one tool in a single assistant turn.',
      'Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.',
      'If a tool result is weak or empty, choose a more targeted next tool on the following turn.',
      'Do not fabricate project records, literature results, or computation outputs.'
    ];
    if (intent === 'general_science_question') {
      rules.push('For general science questions, use literature tools before generic web search whenever possible.');
    }
    if (intent === 'project_science_question') {
      rules.push('For project science questions, use internal project records first and clearly separate internal evidence from external evidence.');
    }
    if (intent === 'result_analysis') {
      rules.push('For result analysis, use run_python_sandbox for calculations or transformations before interpreting results.');
    }
    return [
      cleanText(baseSystemPrompt, 12000),
      'Science loop policy JSON:',
      JSON.stringify(policy, null, 2),
      `Routing JSON:\n${JSON.stringify(routing || {}, null, 2)}`,
      project ? `Resolved project JSON:\n${JSON.stringify(project, null, 2)}` : '',
      `Latest user message:\n${cleanText(message, 3200)}`,
      rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')
    ].filter(Boolean).join('\n\n');
  }

  // Turn evaluator output into a follow-up user-style message that nudges the agent forward.
  function buildEvaluatorFeedback(evaluation, intent) {
    const missing = uniqueStrings(asArray(evaluation?.missing_requirements), 6);
    const nextTool = evaluation?.next_tool_hint && typeof evaluation.next_tool_hint === 'object'
      ? evaluation.next_tool_hint
      : null;
    return [
      `Evaluator feedback for ${cleanText(intent, 80) || 'science'}: the previous result is not sufficient yet.`,
      cleanText(evaluation?.reason, 320) ? `Reason: ${cleanText(evaluation.reason, 320)}` : '',
      missing.length ? `Missing requirements: ${missing.join('; ')}` : '',
      nextTool?.tool_name ? `Suggested next tool: ${cleanText(nextTool.tool_name, 120)}.` : '',
      nextTool?.query ? `Suggested query refinement: ${cleanText(nextTool.query, 320)}` : '',
      nextTool?.reason ? `Why: ${cleanText(nextTool.reason, 260)}` : '',
      'Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.'
    ].filter(Boolean).join('\n');
  }

  // Create a last-resort textual answer from the latest assistant/tool state when synthesis fails.
  function buildFallbackAnswer({
    latestAssistantText,
    evaluator,
    toolTrace
  }) {
    const missing = uniqueStrings(asArray(evaluator?.missing_requirements), 5);
    const latestSummary = cleanText(asArray(toolTrace).slice(-1)[0]?.summary, 320);
    const parts = [
      cleanText(latestAssistantText, 4000),
      missing.length ? `Remaining gaps: ${missing.join('; ')}.` : '',
      latestSummary ? `Latest tool summary: ${latestSummary}` : ''
    ].filter(Boolean);
    return parts.join('\n\n') || 'I could not gather enough evidence to produce a confident answer.';
  }

  // Wrap validation or execution failures in the same shape as real tool outputs.
  function buildSyntheticToolEnvelope(toolName, args, roundIndex, errorMessage) {
    return {
      ok: false,
      tool_name: cleanText(toolName, 120),
      input: args && typeof args === 'object' ? args : {},
      result: {
        items: [],
        citations: [],
        summary: cleanText(errorMessage, 320) || 'Tool invocation failed before execution.'
      },
      items: [],
      citations: [],
      summary: cleanText(errorMessage, 320) || 'Tool invocation failed before execution.',
      error: cleanText(errorMessage, 600) || 'Tool invocation failed before execution.',
      round: roundIndex
    };
  }

  // Enforce deterministic policy checks on top of evaluator output before deciding to stop.
  function mergePolicyEvaluationHints(intent, policy, message, evaluation, citations, toolTrace) {
    const next = {
      ...evaluation,
      missing_requirements: uniqueStrings(evaluation.missing_requirements, 6)
    };
    if (intent === 'general_science_question'
      && policy.require_external_citation_when_recent === true
      && messageRequestsRecentSources(message)
      && !hasExternalCitation(citations)) {
      next.satisfied = false;
      next.should_continue = true;
      next.can_answer_with_limitations = true;
      next.reason = 'Recent/reference-style question still lacks an external citation-backed source.';
      next.missing_requirements = uniqueStrings([
        ...next.missing_requirements,
        'At least one external citation-backed source is still missing.'
      ], 6);
      next.next_tool_hint = next.next_tool_hint || {
        tool_name: 'search_pubmed',
        query: cleanText(message, 320) || null,
        reason: 'Retrieve at least one external citation before answering.'
      };
    }
    if (intent === 'result_analysis'
      && policy.require_compute_for_numeric_queries === true
      && messageRequestsComputation(message)
      && !asArray(toolTrace).some((entry) => cleanText(entry?.tool_name, 120) === 'run_python_sandbox' && entry?.ok === true)) {
      next.satisfied = false;
      next.should_continue = true;
      next.can_answer_with_limitations = true;
      next.reason = 'Requested analysis still lacks compute evidence from the Python sandbox.';
      next.missing_requirements = uniqueStrings([
        ...next.missing_requirements,
        'A Python sandbox computation step is still required.'
      ], 6);
      next.next_tool_hint = next.next_tool_hint || {
        tool_name: 'run_python_sandbox',
        query: null,
        reason: 'Run deterministic computation before interpreting the result.'
      };
    }
    if (intent === 'project_science_question'
      && policy.distinguish_internal_vs_external === true
      && !hasInternalCitation(citations)) {
      next.satisfied = false;
      next.should_continue = true;
      next.can_answer_with_limitations = true;
      next.reason = 'Project question still lacks direct internal project evidence.';
      next.missing_requirements = uniqueStrings([
        ...next.missing_requirements,
        'At least one internal project citation is still missing.'
      ], 6);
    }
    if (policy.require_retrieval_attempt === true && asArray(toolTrace).length === 0) {
      next.satisfied = false;
      next.should_continue = true;
      next.can_answer_with_limitations = false;
      next.reason = 'No retrieval attempt has been made yet.';
      next.missing_requirements = uniqueStrings([
        ...next.missing_requirements,
        'At least one retrieval tool should run before answering.'
      ], 6);
    }
    return next;
  }

  /**
   * Core multi-round execution loop shared by all science intents.
   *
   * Flow:
   * 1. Normalize routing/context.
   * 2. Start an agent session constrained by the selected policy.
   * 3. Execute at most one valid tool per round.
   * 4. Re-evaluate sufficiency after each tool result.
   * 5. Synthesize a final answer once evidence is sufficient or the budget is exhausted.
   */
  async function runIntentLoop(input = {}) {
    const intent = normalizeIntent(input.intent);
    if (!intent) {
      throw new Error('Science reasoning loop requires a supported intent.');
    }
    const policy = getIntentPolicy(intent);
    const message = cleanText(input.message, 3200);
    const parserPayload = input.parserPayload && typeof input.parserPayload === 'object' ? input.parserPayload : {};
    const routing = input.routing && typeof input.routing === 'object'
      ? input.routing
      : {
        intent,
        confidence: parserPayload.needs_clarification === true ? 0.35 : 0.62,
        entities: {},
        plan: {
          needs_clarification: parserPayload.needs_clarification === true,
          clarification_reason: cleanText(parserPayload?.clarification_reason, 260),
          clarification_question: cleanText(parserPayload?.clarification_reason, 320)
        }
      };
    const project = normalizeProject(input.project)
      || normalizeProject(input.projectEvidence?.selected_project)
      || null;
    const maxRounds = clamp(Number(input.maxRounds || deps.maxRounds || 4), 1, 8);
    const toolDefinitions = asArray(input.toolDefinitions).length
      ? asArray(input.toolDefinitions)
      : resolveToolDefinitions(policy.tool_scope);
    const toolSchemaMap = buildToolSchemaMap(toolDefinitions);
    const lifecycleRecorder = input.lifecycleRecorder || null;
    const toolTrace = [];
    const intermediateStates = [];
    const accumulatedCitations = [];
    const conversation = asArray(input.conversation);
    const traceContext = input.traceContext || null;
    let roundsExecuted = 0;
    let feedbackTurnsWithoutTool = 0;

    // Capture the initial reasoning snapshot before any clarification or tool execution occurs.
    intermediateStates.push(buildIntermediateState('science_intake', `Start ${intent} reasoning loop.`, {
      assumptions: [
        `Intent policy=${policy.retrieval_priority}.`,
        `Allowed tools=${policy.tool_scope.join(', ')}.`
      ],
      open_questions: parserPayload.needs_clarification === true
        ? [cleanText(parserPayload?.clarification_reason, 320) || 'Clarification is required before retrieval.']
        : [],
      confidence: 0.52
    }));

    // Stop early when the parser has already identified missing information.
    if (parserPayload.needs_clarification === true) {
      return buildNeedsMoreInfoResult({
        intent,
        routing,
        reason: cleanText(parserPayload?.clarification_reason, 280) || 'The parser requested clarification.',
        question: cleanText(parserPayload?.clarification_reason, 320) || 'Could you clarify the missing details?',
        toolTrace,
        intermediateStates
      });
    }

    // Project-grounded science questions cannot proceed until a single project is resolved.
    if (intent === 'project_science_question' && policy.require_project_resolution === true && !project) {
      const followUpQuestion = cleanText(input.projectResolutionQuestion, 320)
        || 'Which project should I use for this science question?';
      intermediateStates.push(buildIntermediateState('science_preflight', 'Project-science preflight could not resolve a unique project.', {
        assumptions: [
          'Project-science questions require a resolved project before retrieval begins.'
        ],
        open_questions: [followUpQuestion],
        confidence: 0.36
      }));
      return buildNeedsMoreInfoResult({
        intent,
        routing,
        reason: 'Project resolution was missing or ambiguous.',
        question: followUpQuestion,
        toolTrace,
        intermediateStates
      });
    }

    const executeTool = typeof input.runTool === 'function' ? input.runTool : runTool;
    if (!startAgentSession || !executeTool) {
      throw new Error('Science reasoning loop requires startAgentSession and runTool dependencies.');
    }

    // Notify lifecycle observers that the shared science loop has started.
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_intent_started',
      status: 'started',
      routing_intent: intent,
      message: `Started shared science reasoning loop for ${intent}.`
    });

    // Start the constrained agent session that will iteratively propose tool calls.
    let currentSession = await startAgentSession({
      provider: cleanText(input.provider, 80),
      endpoint: cleanText(input.endpoint, 2000),
      apiKey: cleanText(input.apiKey, 400),
      model: cleanText(input.model, 120),
      systemPrompt: buildScienceSessionSystemPrompt({
        baseSystemPrompt: cleanText(input.baseSystemPrompt, 12000),
        intent,
        policy,
        routing,
        project,
        message
      }),
      conversation,
      message,
      hasLatestUserInConversation: input.hasLatestUserInConversation === true,
      toolDefinitions,
      traceContext
    });

    let latestAssistantText = cleanText(extractAgentSessionText(currentSession), 12000);
    let finalEvaluation = null;

    // Continue until evidence is sufficient or the tool / feedback budget is exhausted.
    while (roundsExecuted < maxRounds || feedbackTurnsWithoutTool < maxRounds) {
      const rawCalls = asArray(extractAgentSessionFunctionCalls(currentSession)).map(normalizeToolCall);
      const validCalls = rawCalls.filter((call) => toolSchemaMap.has(call.name));

      // No valid tool was proposed, so ask the evaluator whether the loop can stop anyway.
      if (!validCalls.length) {
        finalEvaluation = mergePolicyEvaluationHints(
          intent,
          policy,
          message,
          await evaluateScienceRound({
            provider: input.provider,
            endpoint: input.endpoint,
            apiKey: input.apiKey,
            model: input.model,
            intent,
            policy,
            message,
            parserPayload,
            project,
            accumulatedCitations,
            toolTrace,
            latestToolResult: null,
            latestAssistantText,
            roundsExecuted,
            maxRounds,
            traceContext
          }),
          accumulatedCitations,
          toolTrace
        );

        if (finalEvaluation.satisfied === true) {
          recordLifecycleEvent(lifecycleRecorder, {
            stage: 'science_evaluator_satisfied',
            status: 'ok',
            routing_intent: intent,
            message: cleanText(finalEvaluation.reason, 320) || 'Evaluator marked current evidence as sufficient.'
          });
          break;
        }
        if (roundsExecuted >= maxRounds || feedbackTurnsWithoutTool >= maxRounds) {
          recordLifecycleEvent(lifecycleRecorder, {
            stage: 'science_budget_exhausted',
            status: 'failed',
            routing_intent: intent,
            message: 'Science reasoning loop exhausted its budget without a valid tool call.'
          });
          break;
        }

        // Feed evaluator guidance back into the session to steer the next single-tool proposal.
        feedbackTurnsWithoutTool += 1;
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_evaluator_continue',
          status: 'started',
          routing_intent: intent,
          message: cleanText(finalEvaluation.reason, 320) || 'Evaluator requested another tool step.'
        });
        currentSession = await continueAgentSessionWithUserMessage(
          currentSession,
          buildEvaluatorFeedback(finalEvaluation, intent),
          traceContext
        );
        latestAssistantText = cleanText(extractAgentSessionText(currentSession), 12000);
        continue;
      }

      // A valid tool call resets the no-tool feedback counter.
      feedbackTurnsWithoutTool = 0;
      // Only the first valid call is executed to preserve deterministic one-tool-per-round behavior.
      const selectedCall = validCalls[0];
      const parsedArgs = safeParseJson(selectedCall.argsText || '{}', {});
      const argsObject = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
      const validation = validateArgumentsAgainstSchema(toolSchemaMap.get(selectedCall.name), argsObject);
      const truncatedMultiCall = rawCalls.length > 1;
      roundsExecuted += 1;

      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_round_started',
        status: 'started',
        routing_intent: intent,
        tool_name: selectedCall.name,
        message: `Science reasoning round ${roundsExecuted} started with ${selectedCall.name}.`,
        meta: {
          truncated_multi_call: truncatedMultiCall
        }
      });

      // Validate and execute the selected tool, normalizing any failure into a synthetic envelope.
      let toolEnvelope;
      if (!validation.ok) {
        toolEnvelope = buildSyntheticToolEnvelope(
          selectedCall.name,
          argsObject,
          roundsExecuted,
          cleanText(validation.error, 320) || 'Tool arguments failed schema validation.'
        );
      } else if (!policy.tool_scope.includes(selectedCall.name)) {
        toolEnvelope = buildSyntheticToolEnvelope(
          selectedCall.name,
          argsObject,
          roundsExecuted,
          `Tool ${selectedCall.name} is not allowed for ${intent}.`
        );
      } else {
        try {
          toolEnvelope = await executeTool(selectedCall.name, argsObject, {
            allowWriteTools: false,
            traceContext,
            lifecycleRecorder
          });
        } catch (error) {
          toolEnvelope = buildSyntheticToolEnvelope(
            selectedCall.name,
            argsObject,
            roundsExecuted,
            cleanText(String(error?.message || error), 320) || 'Tool execution failed.'
          );
        }
      }

      // Persist a compact trace row for observability and downstream answer synthesis.
      const normalizedTraceRow = {
        round: roundsExecuted,
        call_id: selectedCall.callId,
        tool_name: cleanText(selectedCall.name, 120),
        input: argsObject,
        ok: toolEnvelope?.ok === true,
        summary: cleanText(toolEnvelope?.summary, 320)
          || cleanText(toolEnvelope?.error, 320)
          || 'No summary was generated.',
        truncated_multi_call: truncatedMultiCall,
        error: cleanText(toolEnvelope?.error, 600),
        citations: normalizeCitations(toolEnvelope?.citations, 8)
      };
      toolTrace.push(normalizedTraceRow);
      normalizeCitations(toolEnvelope?.citations, 10).forEach((citation) => accumulatedCitations.push(citation));

      intermediateStates.push(buildIntermediateState('science_tool_round', `Executed ${selectedCall.name} in round ${roundsExecuted}.`, {
        assumptions: [
          truncatedMultiCall
            ? 'Multiple tool calls were proposed; only the first valid call was executed this round.'
            : 'Exactly one tool call was executed this round.',
          toolEnvelope?.ok === true
            ? 'Tool execution returned a success envelope.'
            : 'Tool execution returned a failure envelope.'
        ],
        evidence: normalizeCitations(toolEnvelope?.citations, 8),
        proposed_actions: [
          {
            action_type: 'read',
            tool_name: selectedCall.name,
            risk_level: 'low',
            reason: cleanText(toolEnvelope?.summary || toolEnvelope?.error, 260)
          }
        ],
        confidence: toolEnvelope?.ok === true ? 0.66 : 0.42
      }));

      // Return the tool output to the session so the agent can continue from fresh evidence.
      currentSession = await continueAgentSessionWithToolOutputs(currentSession, [
        {
          callId: selectedCall.callId,
          name: selectedCall.name,
          output: JSON.stringify(toolEnvelope || {})
        }
      ], traceContext);
      latestAssistantText = cleanText(extractAgentSessionText(currentSession), 12000);

      // Re-run sufficiency evaluation now that a new tool result has been incorporated.
      finalEvaluation = mergePolicyEvaluationHints(
        intent,
        policy,
        message,
        await evaluateScienceRound({
          provider: input.provider,
          endpoint: input.endpoint,
          apiKey: input.apiKey,
          model: input.model,
          intent,
          policy,
          message,
          parserPayload,
          project,
          accumulatedCitations,
          toolTrace,
          latestToolResult: toolEnvelope,
          latestAssistantText,
          roundsExecuted,
          maxRounds,
          traceContext
        }),
        accumulatedCitations,
        toolTrace
      );

      if (finalEvaluation.satisfied === true) {
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_evaluator_satisfied',
          status: 'ok',
          routing_intent: intent,
          tool_name: selectedCall.name,
          message: cleanText(finalEvaluation.reason, 320) || 'Evaluator marked current evidence as sufficient.'
        });
        break;
      }

      if (roundsExecuted >= maxRounds) {
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_budget_exhausted',
          status: 'failed',
          routing_intent: intent,
          tool_name: selectedCall.name,
          message: 'Science reasoning loop exhausted its tool round budget.'
        });
        break;
      }

      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_evaluator_continue',
        status: 'started',
        routing_intent: intent,
        tool_name: selectedCall.name,
        message: cleanText(finalEvaluation.reason, 320) || 'Evaluator requested another retrieval/tool round.'
      });
      currentSession = await continueAgentSessionWithUserMessage(
        currentSession,
        buildEvaluatorFeedback(finalEvaluation, intent),
        traceContext
      );
      latestAssistantText = cleanText(extractAgentSessionText(currentSession), 12000);
    }

    // If the evaluator never marked the loop satisfied, return a best-effort partial answer.
    const partial = !(finalEvaluation?.satisfied === true);
    const synthesis = await synthesizeScienceFinal({
      provider: input.provider,
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      model: input.model,
      intent,
      policy,
      message,
      parserPayload,
      project,
      roundsExecuted,
      maxRounds,
      evaluator: finalEvaluation,
      accumulatedCitations,
      toolTrace,
      partial,
      fallbackAnswer: buildFallbackAnswer({
        latestAssistantText,
        evaluator: finalEvaluation,
        toolTrace
      }),
      traceContext
    });

    const citations = normalizeCitations(accumulatedCitations, 20);
    const synthesisDecisionRecord = normalizeDecisionRecord(synthesis.decision_record, {
      assumptions: [
        `${intent} used the shared science reasoning loop.`,
        policy.distinguish_internal_vs_external === true
          ? `Internal citations=${hasInternalCitation(citations)} external citations=${hasExternalCitation(citations)}.`
          : `Citation count=${citations.length}.`
      ],
      open_questions: asArray(finalEvaluation?.missing_requirements),
      verification_notes: [
        partial
          ? 'The loop stopped with remaining gaps and returned a best-effort answer.'
          : 'The evaluator marked the evidence as sufficient before final synthesis.'
      ]
    });

    // Pass the synthesized answer through the app's response-layer normalizer.
    const responseLayer = applyResponseLayerToOutput({
      normalized: {
        answer: cleanText(synthesis.answer, 12000)
          || buildFallbackAnswer({ latestAssistantText, evaluator: finalEvaluation, toolTrace }),
        confidence: Number.isFinite(Number(synthesis.confidence))
          ? clamp(Number(synthesis.confidence), 0, 1)
          : (partial ? 0.48 : 0.68),
        citations,
        decisionRecord: synthesisDecisionRecord
      },
      routing,
      notebookDraft: null,
      toolTrace
    });

    // Run the final answer through validation/provenance gates before returning it.
    const validated = applyValidationGateToOutput({
      routing,
      normalized: responseLayer,
      notebookDraft: null,
      toolTrace
    });

    intermediateStates.push(buildIntermediateState('science_synthesis', 'Synthesized final science answer from tool evidence.', {
      assumptions: [
        partial
          ? 'Best-effort answer was produced because the loop stopped before full sufficiency.'
          : 'Final answer was produced after evaluator satisfaction.',
        `Total citations=${citations.length}.`
      ],
      evidence: citations,
      open_questions: asArray(finalEvaluation?.missing_requirements),
      confidence: Number.isFinite(Number(validated.normalized.confidence))
        ? clamp(Number(validated.normalized.confidence), 0, 1)
        : (partial ? 0.5 : 0.7)
    }));

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_intent_completed',
      status: partial ? 'pending' : 'ok',
      routing_intent: intent,
      message: partial
        ? 'Science reasoning loop completed with limitations.'
        : 'Science reasoning loop completed successfully.',
      meta: {
        rounds_executed: roundsExecuted,
        citation_count: citations.length
      }
    });

    // Return the fully normalized result object consumed by higher-level agent orchestration.
    return {
      status: partial ? 'partial' : 'completed',
      answer: cleanText(validated.normalized.answer, 12000),
      confidence: Number.isFinite(Number(validated.normalized.confidence))
        ? Number(validated.normalized.confidence)
        : (partial ? 0.48 : 0.68),
      citations,
      decision_record: validated.normalized.decisionRecord || synthesisDecisionRecord,
      response_type: cleanText(validated.normalized.response_type, 80),
      confidence_label: cleanText(validated.normalized.confidence_label, 40),
      source_summary: validated.normalized.source_summary && typeof validated.normalized.source_summary === 'object'
        ? validated.normalized.source_summary
        : { total_sources: citations.length, groups: [] },
      unresolved_fields: asArray(validated.normalized.unresolved_fields).map((item) => cleanText(item, 180)).filter(Boolean),
      validation: validated.validation,
      provenance: validated.provenance,
      tool_trace: toolTrace,
      intermediate_states: intermediateStates,
      rounds_executed: roundsExecuted,
      follow_up_questions: uniqueStrings([
        ...asArray(synthesis.follow_up_questions),
        ...asArray(finalEvaluation?.missing_requirements).map((item) => {
          const clean = cleanText(item, 240);
          return clean ? `Could you clarify: ${clean}` : '';
        })
      ], 6)
    };
  }

  // Convenience wrapper for the general-science intent.
  async function runGeneralScienceQuestion(input = {}) {
    return runIntentLoop({
      ...input,
      intent: 'general_science_question'
    });
  }

  // Convenience wrapper for the project-science intent.
  async function runProjectScienceQuestion(input = {}) {
    return runIntentLoop({
      ...input,
      intent: 'project_science_question'
    });
  }

  // Convenience wrapper for the result-analysis intent.
  async function runResultAnalysis(input = {}) {
    return runIntentLoop({
      ...input,
      intent: 'result_analysis'
    });
  }

  return {
    SCIENCE_RESULT_EVALUATION_SCHEMA,
    getIntentPolicy,
    buildNeedsMoreInfoResult,
    runIntentLoop,
    runGeneralScienceQuestion,
    runProjectScienceQuestion,
    runResultAnalysis
  };
}

// Export both runtime builders and policy constants for reuse in other agent modules and tests.
module.exports = {
  SCIENCE_REASONING_INTENTS,
  SCIENCE_REASONING_POLICIES,
  SCIENCE_RESULT_EVALUATION_SCHEMA,
  createScienceReasoningLoopRuntime
};
