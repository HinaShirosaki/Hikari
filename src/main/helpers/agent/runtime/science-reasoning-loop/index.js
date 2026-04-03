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

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');
const { createScienceInputClarificationRuntime } = require('./input-clarification.js');
const { createScienceFinalSynthesisRuntime } = require('./final-synthesis.js');
const { createScienceLoopExitCriteriaRuntime } = require('./loop-exit-criteria.js');
const { createScienceLoopExitJudgeRuntime } = require('./loop-exit-judge.js');
const { createScienceLoopPreSynthesizedQuestionRuntime } = require('./pre-synthesized-question.js');
const { createScienceLoopSupport } = require('./support.js');
const {
  REASONING_ENTRY_TOOL_SCOPES,
  createAgentToolProviderRuntime
} = require('../../tools/agent-tool-provide.js');

// Supported science intents that can be routed into the shared reasoning loop.
const SCIENCE_REASONING_INTENTS = Object.freeze([
  'general_science_question',
  'project_science_question',
  'result_analysis'
]);

const SCIENCE_REASONING_EFFORT_LEVELS = Object.freeze([0, 1, 2]);

// Per-intent execution policies controlling tool scope, retrieval order, and evidence requirements.
const SCIENCE_REASONING_POLICIES = Object.freeze({
  // General science Q&A prefers external literature retrieval before broad web search.
  general_science_question: Object.freeze({
    intent: 'general_science_question',
    description: 'Use literature and web retrieval to answer general science questions with grounded citations.',
    tool_scope: REASONING_ENTRY_TOOL_SCOPES.science_reasoning_entry.general_science_question,
    retrieval_priority: 'literature_first_web_last',
    require_external_citation_when_recent: true,
    require_retrieval_attempt: true,
    answer_with_limitations_after_attempt: true
  }),
  // Project science reasoning must ground answers in project-linked records before external sources.
  project_science_question: Object.freeze({
    intent: 'project_science_question',
    description: 'Use project-linked records first, then external literature only when internal evidence is insufficient.',
    tool_scope: REASONING_ENTRY_TOOL_SCOPES.science_reasoning_entry.project_science_question,
    retrieval_priority: 'internal_first_then_external',
    require_project_resolution: true,
    distinguish_internal_vs_external: true
  }),
  // Result analysis emphasizes deterministic computation before internal/external interpretation.
  result_analysis: Object.freeze({
    intent: 'result_analysis',
    description: 'Use deterministic computation plus local records, then add literature only for interpretation.',
    tool_scope: REASONING_ENTRY_TOOL_SCOPES.science_reasoning_entry.result_analysis,
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
    safeParseJson
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
  const toolProvider = deps.toolProvider && typeof deps.toolProvider === 'object'
    ? deps.toolProvider
    : createAgentToolProviderRuntime({
      ...deps,
      getModelToolDefinitions: typeof deps.resolveToolDefinitions === 'function'
        ? deps.resolveToolDefinitions
        : null
    });
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
  const clarifyScienceInput = typeof deps.clarifyScienceInput === 'function'
    ? deps.clarifyScienceInput
    : createScienceInputClarificationRuntime(deps).clarifyInput;
  const generateScienceLoopExitCriteria = typeof deps.generateScienceLoopExitCriteria === 'function'
    ? deps.generateScienceLoopExitCriteria
    : createScienceLoopExitCriteriaRuntime(deps).generateExitCriteria;
  const judgeScienceLoopExit = typeof deps.judgeScienceLoopExit === 'function'
    ? deps.judgeScienceLoopExit
    : createScienceLoopExitJudgeRuntime(deps).judgeExit;
  const buildSciencePreSynthesizedQuestion = typeof deps.buildSciencePreSynthesizedQuestion === 'function'
    ? deps.buildSciencePreSynthesizedQuestion
    : createScienceLoopPreSynthesizedQuestionRuntime(deps).buildPreSynthesizedQuestion;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const scienceLoopSupport = createScienceLoopSupport({
    ...deps,
    applyResponseLayerToOutput,
    applyValidationGateToOutput,
    clamp,
    now
  });
  const {
    normalizeProject,
    normalizeCitations,
    normalizeDecisionRecord,
    buildIntermediateState,
    buildNeedsMoreInfoResult,
    buildToolSchemaMap,
    validateArgumentsAgainstSchema,
    normalizeToolCall,
    buildScienceSessionSystemPrompt,
    buildEvaluatorFeedback,
    buildFallbackAnswer,
    buildSyntheticToolEnvelope,
    mergePolicyEvaluationHints,
    hasExternalCitation,
    hasInternalCitation
  } = scienceLoopSupport;
  const synthesizeScienceFinal = createScienceFinalSynthesisRuntime({
    ...deps,
    clamp
  }).synthesizeFinal;

  // Normalize an incoming intent and reject unsupported science routes.
  function normalizeIntent(intent) {
    const normalized = cleanText(intent, 80);
    return SCIENCE_REASONING_INTENTS.includes(normalized) ? normalized : '';
  }

  // Resolve the policy object for a validated intent.
  function getIntentPolicy(intent) {
    const normalized = normalizeIntent(intent);
    if (!normalized) {
      throw new Error(`Unsupported science reasoning intent: ${cleanText(intent, 80) || 'missing'}`);
    }
    return SCIENCE_REASONING_POLICIES[normalized];
  }

  function normalizeReasoningEffort(intent, parserPayload = {}) {
    const numeric = Number(parserPayload?.reasoning_effort);
    if (!['general_science_question', 'project_science_question'].includes(intent)) {
      return 0;
    }
    return SCIENCE_REASONING_EFFORT_LEVELS.includes(numeric) ? numeric : 1;
  }

  function getDefaultMaxRounds(intent, reasoningEffort) {
    if (['general_science_question', 'project_science_question'].includes(intent)) {
      return reasoningEffort >= 2 ? 5 : 3;
    }
    return 4;
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
    const judgeResult = await judgeScienceLoopExit({
      provider: cleanText(payload.provider, 80),
      endpoint: cleanText(payload.endpoint, 2000),
      apiKey: cleanText(payload.apiKey, 400),
      model: cleanText(payload.model, 120),
      intent: cleanText(payload.intent, 80),
      policy: payload.policy && typeof payload.policy === 'object' ? payload.policy : {},
      originalMessage: cleanText(payload.originalMessage, 3200),
      message: cleanText(payload.message, 3200),
      clarifiedInput: cleanText(payload.message, 3200),
      clarification: payload.clarification && typeof payload.clarification === 'object' ? payload.clarification : null,
      parserPayload: payload.parserPayload && typeof payload.parserPayload === 'object' ? payload.parserPayload : {},
      project: payload.project && typeof payload.project === 'object' ? payload.project : null,
      exitCriteria: payload.exitCriteria && typeof payload.exitCriteria === 'object' ? payload.exitCriteria : {},
      citations: asArray(payload.accumulatedCitations),
      toolTrace: asArray(payload.toolTrace),
      latestToolResult: payload.latestToolResult && typeof payload.latestToolResult === 'object' ? payload.latestToolResult : null,
      preSynthesizedQuestion: payload.preSynthesizedQuestion && typeof payload.preSynthesizedQuestion === 'object'
        ? payload.preSynthesizedQuestion
        : buildSciencePreSynthesizedQuestion({
          intent: cleanText(payload.intent, 80),
          originalMessage: cleanText(payload.originalMessage, 3200),
          message: cleanText(payload.message, 3200),
          clarification: payload.clarification && typeof payload.clarification === 'object' ? payload.clarification : null,
          project: payload.project && typeof payload.project === 'object' ? payload.project : null,
          citations: asArray(payload.accumulatedCitations),
          toolTrace: asArray(payload.toolTrace),
          latestToolResult: payload.latestToolResult && typeof payload.latestToolResult === 'object' ? payload.latestToolResult : null,
          latestAssistantText: cleanText(payload.latestAssistantText, 4000),
          roundsExecuted: Number(payload.roundsExecuted) || 0,
          maxRounds: Number(payload.maxRounds) || 0
        }),
      latestAssistantText: cleanText(payload.latestAssistantText, 4000),
      roundsExecuted: Number(payload.roundsExecuted) || 0,
      maxRounds: Number(payload.maxRounds) || 0,
      traceContext: payload.traceContext || null
    });
    if (judgeResult?.ok === false) {
      return {
        satisfied: false,
        reason: cleanText(judgeResult?.error, 320) || 'Science reasoning exit judge failed.',
        missing_requirements: ['Exit judgement was unavailable.'],
        should_continue: true,
        next_tool_hint: null,
        can_answer_with_limitations: true
      };
    }
    return normalizeEvaluationPayload(judgeResult?.evaluation || judgeResult, 'Science reasoning exit judge returned no explicit reason.');
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
    const originalMessage = cleanText(input.message, 3200);
    const parserPayload = input.parserPayload && typeof input.parserPayload === 'object' ? input.parserPayload : {};
    const reasoningEffort = normalizeReasoningEffort(intent, parserPayload);
    const baseRouting = input.routing && typeof input.routing === 'object'
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
    const routing = {
      ...baseRouting,
      plan: {
        ...(baseRouting?.plan && typeof baseRouting.plan === 'object' ? baseRouting.plan : {}),
        reasoning_effort: Number.isFinite(Number(baseRouting?.plan?.reasoning_effort))
          ? Number(baseRouting.plan.reasoning_effort)
          : reasoningEffort
      },
      classifier: {
        ...(baseRouting?.classifier && typeof baseRouting.classifier === 'object' ? baseRouting.classifier : {}),
        reasoning_effort: Number.isFinite(Number(baseRouting?.classifier?.reasoning_effort))
          ? Number(baseRouting.classifier.reasoning_effort)
          : reasoningEffort
      }
    };
    const project = normalizeProject(input.project)
      || normalizeProject(input.projectEvidence?.selected_project)
      || null;
    const maxRounds = clamp(
      Number(input.maxRounds || deps.maxRounds || getDefaultMaxRounds(intent, reasoningEffort)),
      1,
      8
    );
    const lifecycleRecorder = input.lifecycleRecorder || null;
    const toolTrace = [];
    const intermediateStates = [];
    const accumulatedCitations = [];
    const conversation = asArray(input.conversation);
    const traceContext = input.traceContext || null;
    let roundsExecuted = 0;
    let feedbackTurnsWithoutTool = 0;
    let clarification = null;
    let exitCriteria = null;
    let message = originalMessage;
    let requestSignalText = originalMessage;

    // Capture the initial reasoning snapshot before any clarification or tool execution occurs.
    intermediateStates.push(buildIntermediateState('science_intake', `Start ${intent} handling.`, {
      assumptions: [
        `Intent policy=${policy.retrieval_priority}.`,
        `reasoning_effort=${reasoningEffort}.`,
        reasoningEffort === 0
          ? 'This request should answer directly without entering the reasoning loop.'
          : 'This request should enter the reasoning loop.'
      ],
      open_questions: parserPayload.needs_clarification === true
        ? [cleanText(parserPayload?.clarification_reason, 320) || 'Clarification is required before retrieval.']
        : [],
      confidence: 0.52
    }));

    if (reasoningEffort === 0 && ['general_science_question', 'project_science_question'].includes(intent)) {
      if (!startAgentSession) {
        throw new Error('Science direct-answer path requires startAgentSession.');
      }
      if (parserPayload.needs_clarification === true) {
        return buildNeedsMoreInfoResult({
          intent,
          routing,
          reason: cleanText(parserPayload?.clarification_reason, 280) || 'Clarification is required before answering directly.',
          question: cleanText(parserPayload?.clarification_reason, 320),
          toolTrace,
          intermediateStates
        });
      }
      if (intent === 'project_science_question' && policy.require_project_resolution === true && !project) {
        const followUpQuestion = cleanText(input.projectResolutionQuestion, 320)
          || 'Which project should I use for this question?';
        intermediateStates.push(buildIntermediateState('science_preflight', 'Project-science direct answer could not resolve a unique project.', {
          assumptions: [
            'Project-science questions still require project resolution even at reasoning_effort=0.'
          ],
          open_questions: uniqueStrings([
            followUpQuestion,
            'Project resolution was missing or ambiguous.'
          ], 3),
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

      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_direct_answer_started',
        status: 'started',
        routing_intent: intent,
        message: `Answering ${intent} directly at reasoning_effort=0.`
      });

      const directSession = await startAgentSession({
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
          originalMessage,
          clarification: null,
          exitCriteria: null,
          message: originalMessage,
          reasoningEffort,
          directAnswerOnly: true
        }),
        conversation,
        message: originalMessage,
        hasLatestUserInConversation: input.hasLatestUserInConversation === true,
        toolDefinitions: [],
        traceContext
      });

      const directDecisionRecord = normalizeDecisionRecord(null, {
        assumptions: [
          `${intent} was answered directly at reasoning_effort=0.`
        ],
        verification_notes: [
          'No reasoning loop or retrieval tool was used.'
        ]
      });
      const responseLayer = applyResponseLayerToOutput({
        normalized: {
          answer: cleanText(extractAgentSessionText(directSession), 12000)
            || 'I could not generate a direct science answer.',
          confidence: intent === 'general_science_question' ? 0.68 : 0.62,
          citations: [],
          decisionRecord: directDecisionRecord
        },
        routing,
        notebookDraft: null,
        toolTrace
      });
      const validated = applyValidationGateToOutput({
        routing,
        normalized: responseLayer,
        notebookDraft: null,
        toolTrace
      });

      intermediateStates.push(buildIntermediateState('science_direct_answer', 'Answered directly without entering the reasoning loop.', {
        assumptions: [
          'reasoning_effort=0 requested a direct answer path.',
          'No retrieval tools were invoked.'
        ],
        confidence: Number.isFinite(Number(validated.normalized.confidence))
          ? clamp(Number(validated.normalized.confidence), 0, 1)
          : 0.64
      }));

      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_direct_answer_completed',
        status: 'ok',
        routing_intent: intent,
        message: 'Science direct-answer path completed successfully.',
        meta: {
          rounds_executed: 0,
          citation_count: 0
        }
      });

      return {
        status: 'completed',
        answer: cleanText(validated.normalized.answer, 12000),
        confidence: Number.isFinite(Number(validated.normalized.confidence))
          ? Number(validated.normalized.confidence)
          : 0.64,
        citations: [],
        decision_record: validated.normalized.decisionRecord || directDecisionRecord,
        response_type: cleanText(validated.normalized.response_type, 80),
        confidence_label: cleanText(validated.normalized.confidence_label, 40),
        source_summary: validated.normalized.source_summary && typeof validated.normalized.source_summary === 'object'
          ? validated.normalized.source_summary
          : { total_sources: 0, groups: [] },
        unresolved_fields: asArray(validated.normalized.unresolved_fields).map((item) => cleanText(item, 180)).filter(Boolean),
        validation: validated.validation,
        provenance: validated.provenance,
        clarified_input: originalMessage,
        input_clarification: null,
        exit_criteria: null,
        tool_trace: [],
        intermediate_states: intermediateStates,
        rounds_executed: 0,
        follow_up_questions: [],
        reasoning_effort: reasoningEffort
      };
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_clarification_started',
      status: 'started',
      routing_intent: intent,
      message: `Clarifying ${intent} input before tool execution.`
    });

    clarification = await clarifyScienceInput({
      ...input,
      intent,
      message: originalMessage,
      conversation,
      parserPayload,
      routing,
      project,
      traceContext
    });
    message = cleanText(clarification?.clarified_input, 3200) || originalMessage;
    requestSignalText = [originalMessage, message].filter(Boolean).join('\n').trim();

    intermediateStates.push(buildIntermediateState('science_clarification', 'Clarified the user request before reasoning.', {
      assumptions: uniqueStrings([
        cleanText(clarification?.analysis_goal, 260),
        ...asArray(clarification?.important_constraints)
      ], 8),
      open_questions: clarification?.should_ask_follow_up === true
        ? uniqueStrings([
          cleanText(clarification?.follow_up_question, 320),
          ...asArray(clarification?.missing_information)
        ], 6)
        : [],
      confidence: clarification?.should_ask_follow_up === true ? 0.4 : 0.66
    }));

    if (clarification?.should_ask_follow_up === true) {
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_clarification_completed',
        status: 'pending',
        routing_intent: intent,
        message: cleanText(clarification?.follow_up_reason, 320) || 'Clarification requested more information before reasoning.'
      });
      return buildNeedsMoreInfoResult({
        intent,
        routing,
        reason: cleanText(clarification?.follow_up_reason, 280) || 'Clarification is required before reasoning.',
        question: cleanText(clarification?.follow_up_question, 320),
        toolTrace,
        intermediateStates
      });
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_clarification_completed',
      status: 'ok',
      routing_intent: intent,
      message: 'Science input was clarified and is ready for reasoning.'
    });

    // Project-grounded science questions cannot proceed until a single project is resolved.
    if (intent === 'project_science_question' && policy.require_project_resolution === true && !project) {
      const followUpQuestion = cleanText(clarification?.follow_up_question, 320)
        || cleanText(input.projectResolutionQuestion, 320);
      intermediateStates.push(buildIntermediateState('science_preflight', 'Project-science preflight could not resolve a unique project.', {
        assumptions: [
          'Project-science questions require a resolved project before retrieval begins.'
        ],
        open_questions: uniqueStrings([
          followUpQuestion,
          'Project resolution was missing or ambiguous.'
        ], 3),
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

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_exit_criteria_started',
      status: 'started',
      routing_intent: intent,
      message: `Generating exit criteria for ${intent}.`
    });
    exitCriteria = await generateScienceLoopExitCriteria({
      ...input,
      intent,
      policy,
      parserPayload,
      routing,
      project,
      originalMessage,
      clarifiedInput: message,
      clarification,
      traceContext
    });
    intermediateStates.push(buildIntermediateState('science_exit_criteria', 'Generated exit criteria for the reasoning loop.', {
      assumptions: uniqueStrings([
        ...asArray(exitCriteria?.exit_conditions),
        cleanText(exitCriteria?.reasoning_notes, 260)
      ], 8),
      open_questions: asArray(exitCriteria?.continue_when),
      confidence: 0.62
    }));
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_exit_criteria_completed',
      status: 'ok',
      routing_intent: intent,
      message: 'Science loop exit criteria are ready.'
    });

    const requestedToolNames = Array.isArray(input.selectedToolNames) ? input.selectedToolNames : null;
    const providedTools = asArray(input.toolDefinitions).length
      ? {
        tool_names: asArray(input.toolDefinitions).map((tool) => cleanText(tool?.name, 120)).filter(Boolean),
        tool_definitions: asArray(input.toolDefinitions)
      }
      : (typeof toolProvider?.provideTools === 'function'
        ? toolProvider.provideTools({
          entryPoint: 'science_reasoning_entry',
          intent,
          requestedToolNames
        })
        : {
          tool_names: asArray(policy.tool_scope),
          tool_definitions: []
        });
    const toolDefinitions = asArray(providedTools?.tool_definitions);
    const allowedToolNames = uniqueStrings(
      asArray(providedTools?.tool_names).length
        ? asArray(providedTools.tool_names)
        : toolDefinitions.map((tool) => cleanText(tool?.name, 120)),
      20
    );
    const toolSchemaMap = buildToolSchemaMap(toolDefinitions);

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
        originalMessage,
        clarification,
        exitCriteria,
        message,
        reasoningEffort
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
        const preSynthesizedQuestion = buildSciencePreSynthesizedQuestion({
          intent,
          policy,
          originalMessage,
          message,
          clarification,
          parserPayload,
          project,
          citations: accumulatedCitations,
          toolTrace,
          latestToolResult: null,
          latestAssistantText,
          roundsExecuted,
          maxRounds
        });
        finalEvaluation = mergePolicyEvaluationHints(
          intent,
          policy,
          requestSignalText,
          await evaluateScienceRound({
            provider: input.provider,
            endpoint: input.endpoint,
            apiKey: input.apiKey,
            model: input.model,
            intent,
            policy,
            exitCriteria,
            originalMessage,
            message,
            clarification,
            parserPayload,
            project,
            accumulatedCitations,
            toolTrace,
            latestToolResult: null,
            preSynthesizedQuestion,
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
            message: cleanText(finalEvaluation.reason, 320) || 'Evaluator marked current evidence as sufficient.',
            meta: {
              round: roundsExecuted
            }
          });
          break;
        }
        if (roundsExecuted >= maxRounds || feedbackTurnsWithoutTool >= maxRounds) {
          recordLifecycleEvent(lifecycleRecorder, {
            stage: 'science_budget_exhausted',
            status: 'failed',
            routing_intent: intent,
            message: 'Science reasoning loop exhausted its budget without a valid tool call.',
            meta: {
              round: roundsExecuted
            }
          });
          break;
        }

        // Feed evaluator guidance back into the session to steer the next single-tool proposal.
        feedbackTurnsWithoutTool += 1;
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_evaluator_continue',
          status: 'started',
          routing_intent: intent,
          message: cleanText(finalEvaluation.reason, 320) || 'Evaluator requested another tool step.',
          meta: {
            round: roundsExecuted
          }
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
          round: roundsExecuted,
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
      } else if (!allowedToolNames.includes(selectedCall.name)) {
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
      const preSynthesizedQuestion = buildSciencePreSynthesizedQuestion({
        intent,
        policy,
        originalMessage,
        message,
        clarification,
        parserPayload,
        project,
        citations: accumulatedCitations,
        toolTrace,
        latestToolResult: toolEnvelope,
        latestAssistantText,
        roundsExecuted,
        maxRounds
      });
      intermediateStates.push(buildIntermediateState('science_pre_synthesis', 'Prepared a lightweight pre-synthesized question before exit judgement.', {
        assumptions: [
          cleanText(preSynthesizedQuestion?.tentative_answer?.current_best_answer, 320)
            ? `Tentative answer: ${cleanText(preSynthesizedQuestion.tentative_answer.current_best_answer, 320)}`
            : 'No grounded tentative answer was available yet.'
        ],
        evidence: normalizeCitations(toolEnvelope?.citations, 8),
        open_questions: asArray(preSynthesizedQuestion?.unresolved_issues),
        confidence: toolEnvelope?.ok === true ? 0.64 : 0.4
      }));

      // Re-run sufficiency evaluation now that a new tool result has been incorporated.
      finalEvaluation = mergePolicyEvaluationHints(
        intent,
        policy,
        requestSignalText,
        await evaluateScienceRound({
          provider: input.provider,
          endpoint: input.endpoint,
          apiKey: input.apiKey,
          model: input.model,
          intent,
          policy,
          exitCriteria,
          originalMessage,
          message,
          clarification,
          parserPayload,
          project,
          accumulatedCitations,
          toolTrace,
          latestToolResult: toolEnvelope,
          preSynthesizedQuestion,
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
          message: cleanText(finalEvaluation.reason, 320) || 'Evaluator marked current evidence as sufficient.',
          meta: {
            round: roundsExecuted
          }
        });
        break;
      }

      if (roundsExecuted >= maxRounds) {
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_budget_exhausted',
          status: 'failed',
          routing_intent: intent,
          tool_name: selectedCall.name,
          message: 'Science reasoning loop exhausted its tool round budget.',
          meta: {
            round: roundsExecuted
          }
        });
        break;
      }

      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_evaluator_continue',
        status: 'started',
        routing_intent: intent,
        tool_name: selectedCall.name,
        message: cleanText(finalEvaluation.reason, 320) || 'Evaluator requested another retrieval/tool round.',
        meta: {
          round: roundsExecuted
        }
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
      originalMessage,
      message,
      clarification,
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
      clarified_input: message,
      input_clarification: clarification,
      exit_criteria: exitCriteria,
      tool_trace: toolTrace,
      intermediate_states: intermediateStates,
      rounds_executed: roundsExecuted,
      reasoning_effort: reasoningEffort,
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
