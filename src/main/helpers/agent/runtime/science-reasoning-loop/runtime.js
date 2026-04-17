/**
 * Shared science-reasoning runtime for agent flows that need iterative evidence gathering.
 *
 * This module centralizes three related science intents:
 * - general_science_question: literature/web-grounded science Q&A
 * - project_science_question: project-aware reasoning that prefers internal records first
 * - result_analysis: deterministic analysis that prefers computation before interpretation
 *
 * The runtime executes evidence rounds that may contain one or more independent tools,
 * evaluates whether evidence is sufficient after each round, and then synthesizes a
 * final grounded answer.
 */
'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');
const { createAgentRoutePlannerRuntime } = require('./agent-route-planner.js');
const { createScienceInputClarificationRuntime } = require('./input-clarification.js');
const { createScienceFinalSynthesisRuntime } = require('./final-synthesis.js');
const { createScienceLoopExitCriteriaRuntime } = require('./loop-exit-criteria.js');
const { createScienceLoopExitJudgeRuntime } = require('./loop-exit-judge.js');
const { createScienceLoopPreSynthesizedQuestionRuntime } = require('./pre-synthesized-question.js');
const {
  createScienceLoopLogicalVerificationRuntime,
  normalizeScienceLogicalVerification,
  getUnstableScienceInferenceChecks,
  formatScienceInferenceStabilityIssue
} = require('./logical-verification.js');
const { createScienceThinkingTraceRuntime } = require('./thinking-trace.js');
const { createScienceLoopSupport } = require('./support.js');
const { SCIENCE_RESULT_EVALUATION_SCHEMA } = require('./schemas.js');
const {
  getScienceReasoningPolicy,
  normalizeScienceReasoningIntent,
  normalizeScienceReasoningEffort,
  getDefaultScienceMaxRounds
} = require('./policies.js');
const { createScienceReasoningRoundHelpers } = require('./round-helpers.js');
const { createScienceToolRoundSatisfactionRuntime } = require('./tool-round-satisfaction.js');
const { isAgentRequestAbortError } = require('../../shared/agent-request-context.js');
const { createAgentToolProviderRuntime } = require('../../tools/agent-tool-provide.js');

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
  const draftScienceRoutePlan = typeof deps.draftScienceRoutePlan === 'function'
    ? deps.draftScienceRoutePlan
    : createAgentRoutePlannerRuntime(deps).draftRoutePlan;
  const generateScienceLoopExitCriteria = typeof deps.generateScienceLoopExitCriteria === 'function'
    ? deps.generateScienceLoopExitCriteria
    : createScienceLoopExitCriteriaRuntime(deps).generateExitCriteria;
  const judgeScienceLoopExit = typeof deps.judgeScienceLoopExit === 'function'
    ? deps.judgeScienceLoopExit
    : createScienceLoopExitJudgeRuntime(deps).judgeExit;
  const askMainAgentToolRoundSatisfaction = typeof deps.askMainAgentToolRoundSatisfaction === 'function'
    ? deps.askMainAgentToolRoundSatisfaction
    : null;
  const buildSciencePreSynthesizedQuestion = typeof deps.buildSciencePreSynthesizedQuestion === 'function'
    ? deps.buildSciencePreSynthesizedQuestion
    : createScienceLoopPreSynthesizedQuestionRuntime(deps).buildPreSynthesizedQuestion;
  const scienceLogicalVerificationRuntime = createScienceLoopLogicalVerificationRuntime({
    ...deps,
    now: typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString())
  });
  const verifySciencePreSynthesizedQuestionLogic = typeof deps.verifySciencePreSynthesizedQuestionLogic === 'function'
    ? deps.verifySciencePreSynthesizedQuestionLogic
    : scienceLogicalVerificationRuntime.verifyPreSynthesizedQuestion;
  const buildScienceInferenceRetryFeedback = typeof deps.buildScienceInferenceRetryFeedback === 'function'
    ? deps.buildScienceInferenceRetryFeedback
    : scienceLogicalVerificationRuntime.buildInferenceRetryFeedback;
  const generateScienceThinkingTrace = typeof deps.generateScienceThinkingTrace === 'function'
    ? deps.generateScienceThinkingTrace
    : createScienceThinkingTraceRuntime(deps).generateThinkingTrace;
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
    normalizeLoadedContextBlocks,
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
    hasExternalCitation,
    hasInternalCitation
  } = scienceLoopSupport;
  const {
    normalizeEvaluationPayload,
    buildToolRoundThinkingTrace,
    buildRoundToolResult,
    buildToolTraceRenderOutputs
  } = createScienceReasoningRoundHelpers({
    ...deps,
    normalizeCitations,
    normalizeLoadedContextBlocks
  });
  const {
    buildToolRoundSatisfactionFeedback,
    checkCurrentToolRoundSatisfaction
  } = createScienceToolRoundSatisfactionRuntime(deps);
  const synthesizeScienceFinal = createScienceFinalSynthesisRuntime({
    ...deps,
    clamp
  }).synthesizeFinal;

  // Run the sufficiency evaluator after each round, or delegate to a caller-provided override.
  async function evaluateScienceRound(payload = {}) {
    if (evaluateScienceRoundOverride) {
      const overridden = await evaluateScienceRoundOverride(payload);
      return normalizeEvaluationPayload(overridden, 'Custom evaluator returned no explicit reason.');
    }
    const judgeResult = await judgeScienceLoopExit({
      ...payload,
      intent: cleanText(payload.intent, 80),
      policy: payload.policy && typeof payload.policy === 'object' ? payload.policy : {},
      originalMessage: cleanText(payload.originalMessage, 3200),
      message: cleanText(payload.message, 3200),
      clarifiedInput: cleanText(payload.message, 3200),
      clarification: payload.clarification && typeof payload.clarification === 'object' ? payload.clarification : null,
      project: payload.project && typeof payload.project === 'object' ? payload.project : null,
      exitCriteria: payload.exitCriteria && typeof payload.exitCriteria === 'object' ? payload.exitCriteria : {},
      citations: asArray(payload.accumulatedCitations),
      toolTrace: asArray(payload.toolTrace),
      latestToolResult: payload.latestToolResult && typeof payload.latestToolResult === 'object' ? payload.latestToolResult : null,
      preSynthesizedQuestion: payload.preSynthesizedQuestion && typeof payload.preSynthesizedQuestion === 'object'
        ? payload.preSynthesizedQuestion
        : buildSciencePreSynthesizedQuestion({
          intent: cleanText(payload.intent, 80),
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
        can_answer_with_limitations: true,
        trace_sentence: 'I am checking whether the current evidence is sufficient, but the exit judge was unavailable.'
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
   * 3. Execute one or more valid tools per round.
   * 4. Re-evaluate sufficiency after each completed tool round.
   * 5. Synthesize a final answer once evidence is sufficient or the budget is exhausted.
   */
  async function runIntentLoop(input = {}) {
    const intent = normalizeScienceReasoningIntent(input.intent);
    if (!intent) {
      throw new Error('Science reasoning loop requires a supported intent.');
    }
    const policy = getScienceReasoningPolicy(intent);
    const originalMessage = cleanText(input.message, 3200);
    const parserPayload = input.parserPayload && typeof input.parserPayload === 'object' ? input.parserPayload : {};
    const reasoningEffort = normalizeScienceReasoningEffort(intent, parserPayload);
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
      Number(input.maxRounds || deps.maxRounds || getDefaultScienceMaxRounds(intent, reasoningEffort)),
      1,
      8
    );
    const maxInferenceRetries = clamp(
      Number(input.maxInferenceRetries ?? deps.maxInferenceRetries ?? 2),
      0,
      3
    );
    const maxToolsPerRound = clamp(
      Number(input.maxToolsPerRound ?? deps.maxToolsPerRound ?? 4),
      1,
      6
    );
    const lifecycleRecorder = input.lifecycleRecorder || null;
    const toolTrace = [];
    const toolRoundArtifacts = [];
    const intermediateStates = [];
    const accumulatedCitations = [];
    const accumulatedCitationKeys = new Set();
    const conversation = asArray(input.conversation);
    const traceContext = input.traceContext || null;
    let roundsExecuted = 0;
    let feedbackTurnsWithoutTool = 0;
    let clarification = null;
    let routePlan = null;
    let exitCriteria = null;
    let message = originalMessage;
    let latestAssistantText = '';
    let latestPreSynthesizedQuestion = null;
    let finalEvaluation = null;
    let currentSession = null;
    const requestedToolNames = Array.isArray(input.selectedToolNames) ? input.selectedToolNames : null;
    const preselectedToolNames = asArray(input.toolDefinitions).length
      ? asArray(input.toolDefinitions).map((tool) => cleanText(tool?.name, 120)).filter(Boolean)
      : (typeof toolProvider?.resolveEntryToolNames === 'function'
        ? toolProvider.resolveEntryToolNames({
          entryPoint: 'science_reasoning_entry',
          intent,
          requestedToolNames
        })
        : []);

    async function attachThinkingTrace(resultPayload = {}, overrides = {}) {
      const thinkingTrace = await generateScienceThinkingTrace({
        ...input,
        intent,
        originalMessage,
        message: cleanText(overrides.message !== undefined ? overrides.message : message, 3200),
        clarifiedInput: cleanText(
          overrides.clarifiedInput !== undefined
            ? overrides.clarifiedInput
            : (resultPayload?.clarified_input || message || originalMessage),
          3200
        ),
        parserPayload,
        clarification: overrides.clarification !== undefined ? overrides.clarification : clarification,
        routePlan: overrides.routePlan !== undefined ? overrides.routePlan : routePlan,
        exitCriteria: overrides.exitCriteria !== undefined ? overrides.exitCriteria : exitCriteria,
        toolRounds: overrides.toolRounds !== undefined ? overrides.toolRounds : toolRoundArtifacts,
        preSynthesizedQuestion: overrides.preSynthesizedQuestion !== undefined
          ? overrides.preSynthesizedQuestion
          : latestPreSynthesizedQuestion,
        evaluation: overrides.evaluation !== undefined ? overrides.evaluation : finalEvaluation,
        finalSynthesis: overrides.finalSynthesis,
        finalSynthesizedQuestion: cleanText(
          overrides.finalSynthesizedQuestion !== undefined
            ? overrides.finalSynthesizedQuestion
            : resultPayload?.final_synthesized_question,
          3200
        ),
        finalAnswer: cleanText(overrides.finalAnswer !== undefined ? overrides.finalAnswer : resultPayload?.answer, 12000),
        answer: cleanText(resultPayload?.answer, 12000),
        status: cleanText(overrides.status !== undefined ? overrides.status : resultPayload?.status, 40),
        partial: overrides.partial === true || cleanText(resultPayload?.status, 40) === 'partial',
        latestAssistantText,
        traceContext
      });
      return {
        ...resultPayload,
        thinking_trace: thinkingTrace,
        final_synthesized_question: cleanText(thinkingTrace?.final_synthesized_question, 3200)
          || cleanText(resultPayload?.clarified_input || message || originalMessage, 3200)
      };
    }

    async function buildVerifiedPreSynthesizedQuestion({
      session,
      latestToolResult = null,
      rounds = roundsExecuted
    } = {}) {
      let workingSession = session || null;
      let workingAssistantText = cleanText(latestAssistantText, 12000);
      let preSynthesizedQuestion = null;
      let retryCount = 0;

      while (retryCount <= maxInferenceRetries) {
        preSynthesizedQuestion = buildSciencePreSynthesizedQuestion({
          intent,
          policy,
          message,
          clarification,
          project,
          citations: accumulatedCitations,
          toolTrace,
          latestToolResult,
          latestAssistantText: workingAssistantText,
          roundsExecuted: rounds,
          maxRounds
        });
        preSynthesizedQuestion = {
          ...preSynthesizedQuestion,
          logical_verification: normalizeScienceLogicalVerification(
            await verifySciencePreSynthesizedQuestionLogic({
              provider: input.provider,
              endpoint: input.endpoint,
              apiKey: input.apiKey,
              model: input.model,
              intent,
              policy,
              message,
              clarification,
              project,
              preSynthesizedQuestion,
              latestAssistantText: workingAssistantText,
              latestToolResult,
              toolTrace,
              citations: accumulatedCitations,
              roundsExecuted: rounds,
              maxRounds,
              traceContext
            }),
            {},
            { asArray, cleanText, uniqueStrings }
          )
        };
        const unstableChecks = getUnstableScienceInferenceChecks(
          preSynthesizedQuestion.logical_verification,
          { asArray, cleanText, uniqueStrings }
        );
        if (!unstableChecks.length || retryCount >= maxInferenceRetries || !workingSession) {
          return {
            preSynthesizedQuestion,
            session: workingSession,
            latestAssistantText: workingAssistantText,
            retryCount
          };
        }

        const retryFeedback = cleanText(
          buildScienceInferenceRetryFeedback(preSynthesizedQuestion.logical_verification),
          4000
        );
        if (!retryFeedback) {
          return {
            preSynthesizedQuestion,
            session: workingSession,
            latestAssistantText: workingAssistantText,
            retryCount
          };
        }

        retryCount += 1;
        intermediateStates.push(buildIntermediateState(
          'science_inference_retry',
          'Retried the tentative inference because a logic stability check failed.',
          {
            assumptions: unstableChecks
              .map((row) => formatScienceInferenceStabilityIssue(row, { asArray, cleanText, uniqueStrings }))
              .filter(Boolean),
            open_questions: asArray(preSynthesizedQuestion?.unresolved_issues),
            confidence: 0.44
          }
        ));
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_inference_retry',
          status: 'started',
          routing_intent: intent,
          message: 'Retrying the tentative inference after an unstable logic check.',
          meta: {
            round: rounds,
            retry_count: retryCount,
            failed_reasons: unstableChecks
              .map((row) => formatScienceInferenceStabilityIssue(row, { asArray, cleanText, uniqueStrings }))
              .filter(Boolean)
          }
        });

        workingSession = await continueAgentSessionWithUserMessage(
          workingSession,
          retryFeedback,
          traceContext
        );
        workingAssistantText = cleanText(extractAgentSessionText(workingSession), 12000);
      }

      return {
        preSynthesizedQuestion,
        session: workingSession,
        latestAssistantText: workingAssistantText,
        retryCount
      };
    }

    async function evaluateCurrentLoopState({
      latestToolResult = null,
      includePreSynthesisState = false
    } = {}) {
      const preSynthesisState = await buildVerifiedPreSynthesizedQuestion({
        session: currentSession,
        latestToolResult,
        rounds: roundsExecuted
      });
      currentSession = preSynthesisState.session || currentSession;
      latestAssistantText = cleanText(preSynthesisState.latestAssistantText, 12000);
      latestPreSynthesizedQuestion = preSynthesisState.preSynthesizedQuestion;

      if (includePreSynthesisState) {
        const latestEvidence = normalizeCitations(latestToolResult?.citations || latestToolResult?.result?.citations, 8);
        intermediateStates.push(buildIntermediateState(
          'science_pre_synthesis',
          'Prepared a lightweight pre-synthesized question before exit judgement.',
          {
            assumptions: [
              cleanText(latestPreSynthesizedQuestion?.tentative_answer?.current_best_answer, 320)
                ? `Tentative answer: ${cleanText(latestPreSynthesizedQuestion.tentative_answer.current_best_answer, 320)}`
                : 'No grounded tentative answer was available yet.'
            ],
            evidence: latestEvidence,
            open_questions: uniqueStrings([
              ...asArray(latestPreSynthesizedQuestion?.unresolved_issues),
              ...getUnstableScienceInferenceChecks(
                latestPreSynthesizedQuestion?.logical_verification,
                { asArray, cleanText, uniqueStrings }
              ).map((row) => formatScienceInferenceStabilityIssue(row, { asArray, cleanText, uniqueStrings }))
            ], 8),
            confidence: latestToolResult?.ok === true ? 0.64 : 0.4
          }
        ));
      }

      finalEvaluation = await evaluateScienceRound({
        provider: input.provider,
        endpoint: input.endpoint,
        apiKey: input.apiKey,
        model: input.model,
        intent,
        policy,
        exitCriteria,
        message,
        clarification,
        project,
        accumulatedCitations,
        toolTrace,
        latestToolResult,
        preSynthesizedQuestion: latestPreSynthesizedQuestion,
        latestAssistantText,
        roundsExecuted,
        maxRounds,
        traceContext
      });
      if (!toolTrace.length) {
        finalEvaluation = {
          ...finalEvaluation,
          satisfied: false,
          should_continue: true,
          can_answer_with_limitations: false,
          reason: 'The science reasoning loop needs at least one tool round before it can stop.',
          missing_requirements: uniqueStrings([
            ...asArray(finalEvaluation?.missing_requirements),
            'At least one tool round must run before exit judgement.'
          ], 8),
          next_tool_hint: finalEvaluation?.next_tool_hint && typeof finalEvaluation.next_tool_hint === 'object'
            ? finalEvaluation.next_tool_hint
            : {
              tool_name: null,
              query: message || null,
              reason: 'Run the next best science tool call or parallel tool batch before answering.'
            }
        };
      }
      return finalEvaluation;
    }

    async function continueAfterUnsatisfiedEvaluation() {
      if (roundsExecuted >= maxRounds || feedbackTurnsWithoutTool >= maxRounds) {
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_budget_exhausted',
          status: 'failed',
          routing_intent: intent,
          message: 'Science reasoning loop exhausted its budget without sufficient evidence.',
          meta: {
            round: roundsExecuted
          }
        });
        return false;
      }

      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_evaluator_continue',
        status: 'started',
        routing_intent: intent,
        message: cleanText(finalEvaluation?.reason, 320) || 'Evaluator requested another tool step.',
        meta: {
          round: roundsExecuted,
          thinking_trace: cleanText(finalEvaluation?.trace_sentence, 420)
        }
      });
      currentSession = await continueAgentSessionWithUserMessage(
        currentSession,
        buildEvaluatorFeedback(finalEvaluation, intent),
        traceContext
      );
      latestAssistantText = cleanText(extractAgentSessionText(currentSession), 12000);
      return true;
    }

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
        return attachThinkingTrace(buildNeedsMoreInfoResult({
          intent,
          routing,
          reason: cleanText(parserPayload?.clarification_reason, 280) || 'Clarification is required before answering directly.',
          question: cleanText(parserPayload?.clarification_reason, 320),
          toolTrace,
          intermediateStates
        }), {
          clarifiedInput: originalMessage,
          status: 'needs_more_info'
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
        return attachThinkingTrace(buildNeedsMoreInfoResult({
          intent,
          routing,
          reason: 'Project resolution was missing or ambiguous.',
          question: followUpQuestion,
          toolTrace,
          intermediateStates
        }), {
          clarifiedInput: originalMessage,
          status: 'needs_more_info'
        });
      }

      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_direct_answer_started',
        status: 'started',
        routing_intent: intent,
        message: `Answering ${intent} directly at reasoning_effort=0.`
      });

      const directSession = await startAgentSession({
        ...input,
        systemPrompt: buildScienceSessionSystemPrompt({
          baseSystemPrompt: cleanText(input.baseSystemPrompt, 12000),
          intent,
          policy,
          routing,
          project,
          originalMessage,
          clarification: null,
          routePlan: null,
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
      latestAssistantText = cleanText(extractAgentSessionText(directSession), 12000);

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
          answer: latestAssistantText
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
          citation_count: 0,
          thinking_trace: 'I can answer this request directly without running the evidence loop.'
        }
      });

      return attachThinkingTrace({
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
        route_plan: null,
        exit_criteria: null,
        tool_trace: [],
        intermediate_states: intermediateStates,
        rounds_executed: 0,
        follow_up_questions: [],
        reasoning_effort: reasoningEffort
      }, {
        clarifiedInput: originalMessage,
        status: 'completed'
      });
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
        message: cleanText(clarification?.follow_up_reason, 320) || 'Clarification requested more information before reasoning.',
        meta: {
          thinking_trace: cleanText(clarification?.trace_sentence, 420),
          follow_up_question: cleanText(clarification?.follow_up_question, 320)
        }
      });
      return attachThinkingTrace(buildNeedsMoreInfoResult({
        intent,
        routing,
        reason: cleanText(clarification?.follow_up_reason, 280) || 'Clarification is required before reasoning.',
        question: cleanText(clarification?.follow_up_question, 320),
        toolTrace,
        intermediateStates
      }), {
        clarifiedInput: message,
        clarification,
        status: 'needs_more_info'
      });
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_clarification_completed',
      status: 'ok',
      routing_intent: intent,
      message: 'Science input was clarified and is ready for reasoning.',
      meta: {
        thinking_trace: cleanText(clarification?.trace_sentence, 420)
      }
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
      return attachThinkingTrace(buildNeedsMoreInfoResult({
        intent,
        routing,
        reason: 'Project resolution was missing or ambiguous.',
        question: followUpQuestion,
        toolTrace,
        intermediateStates
      }), {
        clarifiedInput: message,
        clarification,
        status: 'needs_more_info'
      });
    }

    if (reasoningEffort >= 1 && reasoningEffort <= 2) {
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_route_planner_started',
        status: 'started',
        routing_intent: intent,
        message: `Drafting a reference route plan for ${intent}.`
      });
      routePlan = await draftScienceRoutePlan({
        ...input,
        intent,
        policy,
        allowedToolNames: preselectedToolNames,
        routing,
        project,
        message,
        clarifiedInput: message,
        clarification,
        reasoningEffort,
        traceContext
      });
      intermediateStates.push(buildIntermediateState('science_route_plan', 'Drafted a reference route plan for the reasoning loop.', {
        assumptions: uniqueStrings([
          cleanText(routePlan?.route_summary, 260),
          ...asArray(routePlan?.decision_points)
        ], 8),
        open_questions: asArray(routePlan?.adaptation_notes),
        proposed_actions: asArray(routePlan?.tool_call_suggestions).slice(0, 5).map((item) => ({
          action_type: 'read',
          tool_name: cleanText(item?.tool_name, 120),
          risk_level: 'low',
          reason: cleanText(item?.reason, 260) || cleanText(item?.when_to_use, 220)
        })),
        confidence: 0.64
      }));
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_route_planner_completed',
        status: 'ok',
        routing_intent: intent,
        message: 'Reference route plan is ready.',
        meta: {
          thinking_trace: cleanText(routePlan?.trace_sentence, 420)
        }
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
      allowedToolNames: preselectedToolNames,
      routing,
      project,
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
      message: 'Science loop exit criteria are ready.',
      meta: {
        thinking_trace: cleanText(exitCriteria?.trace_sentence, 420)
      }
    });

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
    const toolSchemaMap = buildToolSchemaMap(toolDefinitions);
    const candidateAllowedToolNames = asArray(providedTools?.tool_names).length
      ? asArray(providedTools.tool_names)
      : toolDefinitions.map((tool) => cleanText(tool?.name, 120));
    // Derive the cap from the schema map so the allowed set cannot shrink below the schema-known tools.
    const allowedToolNamesCap = Math.max(
      20,
      typeof toolSchemaMap.getCanonicalNames === 'function' ? toolSchemaMap.getCanonicalNames().length : 0,
      candidateAllowedToolNames.length
    );
    const allowedToolNames = uniqueStrings(candidateAllowedToolNames, allowedToolNamesCap);
    const allowedToolNamesLowerSet = new Set(allowedToolNames.map((name) => name.toLowerCase()));

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
    currentSession = await startAgentSession({
      ...input,
      systemPrompt: buildScienceSessionSystemPrompt({
        baseSystemPrompt: cleanText(input.baseSystemPrompt, 12000),
        intent,
        policy,
        routing,
        project,
        originalMessage,
        clarification,
        routePlan,
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

    latestAssistantText = cleanText(extractAgentSessionText(currentSession), 12000);

    // Continue until evidence is sufficient or the tool / feedback budget is exhausted.
    while (roundsExecuted < maxRounds && feedbackTurnsWithoutTool < maxRounds) {
      const rawCalls = asArray(extractAgentSessionFunctionCalls(currentSession)).map(normalizeToolCall);
      const resolveCanonicalToolName = typeof toolSchemaMap.resolveCanonicalName === 'function'
        ? toolSchemaMap.resolveCanonicalName.bind(toolSchemaMap)
        : ((candidate) => (toolSchemaMap.has(candidate) ? candidate : ''));
      // Canonicalize tool names so case-variant suggestions are resolved to the registered schema.
      const canonicalCalls = rawCalls.map((call) => {
        const canonicalName = resolveCanonicalToolName(call.name);
        return {
          ...call,
          originalName: call.name,
          name: canonicalName || call.name,
          isKnownTool: Boolean(canonicalName)
        };
      });
      const validCalls = canonicalCalls.filter((call) => call.isKnownTool);
      const unknownCalls = canonicalCalls.filter((call) => !call.isKnownTool);

      // No valid tool was proposed, so ask the evaluator whether the loop can stop anyway.
      if (!validCalls.length) {
        // If the model emitted only unknown tool calls, respond to each with a
        // synthetic 'unknown tool' envelope so the provider session's tool_use
        // blocks are matched and the model learns the valid tool names.
        if (unknownCalls.length > 0) {
          const knownNamesList = (typeof toolSchemaMap.getCanonicalNames === 'function'
            ? toolSchemaMap.getCanonicalNames()
            : Array.from(toolSchemaMap.keys())
          ).slice(0, 12).join(', ');
          const syntheticOutputs = unknownCalls.map((call) => {
            const parsedArgs = safeParseJson(call.argsText || '{}', {});
            const argsObject = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
            return {
              callId: call.callId,
              name: call.originalName || call.name,
              output: JSON.stringify(buildSyntheticToolEnvelope(
                call.originalName || call.name,
                argsObject,
                roundsExecuted,
                `Unknown tool "${call.originalName || call.name}". Use one of the registered tools: ${knownNamesList || '(none available)'}.`
              ))
            };
          });
          currentSession = await continueAgentSessionWithToolOutputs(currentSession, syntheticOutputs, traceContext);
          latestAssistantText = cleanText(extractAgentSessionText(currentSession), 12000);
          feedbackTurnsWithoutTool += 1;
          if (roundsExecuted >= maxRounds || feedbackTurnsWithoutTool >= maxRounds) {
            recordLifecycleEvent(lifecycleRecorder, {
              stage: 'science_budget_exhausted',
              status: 'failed',
              routing_intent: intent,
              message: 'Science reasoning loop exhausted its budget after repeated unknown-tool attempts.',
              meta: { round: roundsExecuted }
            });
            break;
          }
          continue;
        }

        await evaluateCurrentLoopState({
          latestToolResult: null,
          includePreSynthesisState: false
        });

        if (finalEvaluation.satisfied === true) {
          recordLifecycleEvent(lifecycleRecorder, {
            stage: 'science_evaluator_satisfied',
            status: 'ok',
            routing_intent: intent,
            message: cleanText(finalEvaluation.reason, 320) || 'Evaluator marked current evidence as sufficient.',
            meta: {
              round: roundsExecuted,
              thinking_trace: cleanText(finalEvaluation?.trace_sentence, 420)
            }
          });
          break;
        }
        if (finalEvaluation?.should_continue === false) {
          recordLifecycleEvent(lifecycleRecorder, {
            stage: 'science_evaluator_stop',
            status: 'ok',
            routing_intent: intent,
            message: cleanText(finalEvaluation.reason, 320)
              || 'Evaluator requested to stop the loop without additional tool rounds.',
            meta: {
              round: roundsExecuted,
              thinking_trace: cleanText(finalEvaluation?.trace_sentence, 420)
            }
          });
          break;
        }
        feedbackTurnsWithoutTool += 1;
        if (!(await continueAfterUnsatisfiedEvaluation())) {
          break;
        }
        continue;
      }

      // A valid tool round resets the no-tool feedback counter.
      feedbackTurnsWithoutTool = 0;
      const selectedCalls = validCalls.slice(0, maxToolsPerRound).map((call) => {
        const parsedArgs = safeParseJson(call.argsText || '{}', {});
        const argsObject = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
        return {
          ...call,
          argsObject,
          validation: validateArgumentsAgainstSchema(toolSchemaMap.get(call.name), argsObject)
        };
      });
      // Valid calls that exceed the per-round cap must still receive tool_result envelopes so
      // the provider session's tool_use blocks remain matched. These are marked as deferred.
      const deferredValidCalls = validCalls.slice(maxToolsPerRound).map((call) => {
        const parsedArgs = safeParseJson(call.argsText || '{}', {});
        const argsObject = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
        return { ...call, argsObject };
      });
      const unknownResolvedCalls = unknownCalls.map((call) => {
        const parsedArgs = safeParseJson(call.argsText || '{}', {});
        const argsObject = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
        return { ...call, argsObject };
      });
      const multiToolRound = selectedCalls.length > 1;
      const truncatedMultiCall = deferredValidCalls.length > 0;
      const assistantBeforeTool = cleanText(latestAssistantText, 4000);
      roundsExecuted += 1;
      const selectedToolNames = selectedCalls.map((call) => cleanText(call.name, 120)).filter(Boolean);

      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_round_started',
        status: 'started',
        routing_intent: intent,
        tool_name: multiToolRound ? 'parallel-tool-round' : selectedToolNames[0],
        message: `Science reasoning round ${roundsExecuted} started with ${selectedToolNames.join(', ')}.`,
        meta: {
          round: roundsExecuted,
          multi_tool_round: multiToolRound,
          tool_count: selectedCalls.length,
          tool_names: selectedToolNames,
          truncated_multi_call: truncatedMultiCall,
          thinking_trace: buildToolRoundThinkingTrace(selectedCalls)
        }
      });

      // Validate and execute the selected tools in parallel, then synthesize only after the batch finishes.
      const executedCalls = await Promise.all(selectedCalls.map(async (selectedCall, index) => {
        let toolEnvelope;
        if (!selectedCall.validation.ok) {
          toolEnvelope = buildSyntheticToolEnvelope(
            selectedCall.name,
            selectedCall.argsObject,
            roundsExecuted,
            cleanText(selectedCall.validation.error, 320) || 'Tool arguments failed schema validation.'
          );
        } else if (!allowedToolNamesLowerSet.has(selectedCall.name.toLowerCase())) {
          toolEnvelope = buildSyntheticToolEnvelope(
            selectedCall.name,
            selectedCall.argsObject,
            roundsExecuted,
            `Tool ${selectedCall.name} is not allowed for ${intent}.`
          );
        } else {
          try {
            toolEnvelope = await executeTool(selectedCall.name, selectedCall.argsObject, {
              allowWriteTools: false,
              traceContext,
              lifecycleRecorder
            });
          } catch (error) {
            if (isAgentRequestAbortError(error)) {
              throw error;
            }
            toolEnvelope = buildSyntheticToolEnvelope(
              selectedCall.name,
              selectedCall.argsObject,
              roundsExecuted,
              cleanText(String(error?.message || error), 320) || 'Tool execution failed.'
            );
          }
        }
        return {
          selectedCall,
          toolEnvelope,
          tool_index_in_round: index + 1,
          tool_count_in_round: selectedCalls.length
        };
      }));
      const roundToolResult = buildRoundToolResult(executedCalls);
      const roundEvidence = normalizeCitations(roundToolResult?.citations, 8);
      const roundSucceeded = executedCalls.some((entry) => entry?.toolEnvelope?.ok === true);

      // Persist compact trace rows for observability and downstream answer synthesis.
      executedCalls.forEach((entry) => {
        const selectedCall = entry.selectedCall;
        const toolEnvelope = entry.toolEnvelope;
        const normalizedTraceRow = {
          round: roundsExecuted,
          call_id: selectedCall.callId,
          tool_name: cleanText(selectedCall.name, 120),
          input: selectedCall.argsObject,
          ok: toolEnvelope?.ok === true,
          status: cleanText(toolEnvelope?.result?.status, 40),
          run_id: cleanText(toolEnvelope?.result?.run_id, 120),
          summary: cleanText(toolEnvelope?.summary, 320)
            || cleanText(toolEnvelope?.error, 320)
            || 'No summary was generated.',
          multi_tool_round: multiToolRound,
          tool_index_in_round: entry.tool_index_in_round,
          tool_count_in_round: entry.tool_count_in_round,
          truncated_multi_call: truncatedMultiCall,
          error: cleanText(toolEnvelope?.error || toolEnvelope?.result?.error, 1200),
          stdout: cleanText(toolEnvelope?.result?.stdout, 12000),
          stderr: cleanText(toolEnvelope?.result?.stderr, 12000),
          render_outputs: buildToolTraceRenderOutputs(toolEnvelope?.result?.render_outputs),
          citations: normalizeCitations(toolEnvelope?.citations || toolEnvelope?.result?.citations, 8),
          loaded_context_blocks: normalizeLoadedContextBlocks(
            toolEnvelope?.loaded_context_blocks || toolEnvelope?.result?.loaded_context_blocks,
            6
          )
        };
        toolTrace.push(normalizedTraceRow);
        // Dedupe incrementally so the accumulated list does not grow unbounded as rounds stack.
        normalizedTraceRow.citations.forEach((citation) => {
          const source = cleanText(citation?.source, 120).toLowerCase();
          const pointer = cleanText(citation?.pointer, 220).toLowerCase();
          if (!source && !pointer) {
            return;
          }
          const key = `${source}::${pointer}`;
          if (!accumulatedCitationKeys.has(key)) {
            accumulatedCitationKeys.add(key);
            accumulatedCitations.push(citation);
          }
        });
      });

      intermediateStates.push(buildIntermediateState(
        'science_tool_round',
        multiToolRound
          ? `Executed ${selectedCalls.length} tools in round ${roundsExecuted}.`
          : `Executed ${selectedToolNames[0]} in round ${roundsExecuted}.`,
        {
          assumptions: [
            multiToolRound
              ? `Executed ${selectedCalls.length} independent tool calls in parallel for this round.`
              : `Executed ${selectedToolNames[0]} for this round.`,
            truncatedMultiCall
              ? `Additional valid tool calls were deferred because the round hit the per-round cap of ${maxToolsPerRound}.`
              : '',
            roundSucceeded
              ? 'This round returned usable tool evidence.'
              : 'This round did not return usable tool evidence.'
          ].filter(Boolean),
          evidence: roundEvidence,
          proposed_actions: executedCalls.slice(0, 4).map((entry) => ({
            action_type: 'read',
            tool_name: cleanText(entry?.selectedCall?.name, 120),
            risk_level: 'low',
            reason: cleanText(entry?.toolEnvelope?.summary || entry?.toolEnvelope?.error, 260)
          })).filter((entry) => entry.tool_name || entry.reason),
          confidence: roundSucceeded ? 0.66 : 0.42
        }
      ));

      // Build synthetic tool outputs for deferred (over-cap) and unknown calls so every
      // function_call emitted by the model receives a matching tool_result in the session.
      const knownNamesListForRound = (typeof toolSchemaMap.getCanonicalNames === 'function'
        ? toolSchemaMap.getCanonicalNames()
        : Array.from(toolSchemaMap.keys())
      ).slice(0, 12).join(', ');
      const deferredSyntheticOutputs = deferredValidCalls.map((call) => ({
        callId: call.callId,
        name: call.name,
        output: JSON.stringify(buildSyntheticToolEnvelope(
          call.name,
          call.argsObject,
          roundsExecuted,
          `Tool call deferred: per-round cap of ${maxToolsPerRound} was reached. Re-issue this call on the next turn if still needed.`
        ))
      }));
      const unknownSyntheticOutputs = unknownResolvedCalls.map((call) => ({
        callId: call.callId,
        name: call.originalName || call.name,
        output: JSON.stringify(buildSyntheticToolEnvelope(
          call.originalName || call.name,
          call.argsObject,
          roundsExecuted,
          `Unknown tool "${call.originalName || call.name}". Use one of the registered tools: ${knownNamesListForRound || '(none available)'}.`
        ))
      }));
      // Return the full tool batch to the session so the agent can continue from the complete round state.
      currentSession = await continueAgentSessionWithToolOutputs(currentSession, [
        ...executedCalls.map((entry) => ({
          callId: entry.selectedCall.callId,
          name: entry.selectedCall.name,
          output: JSON.stringify(entry.toolEnvelope || {})
        })),
        ...deferredSyntheticOutputs,
        ...unknownSyntheticOutputs
      ], traceContext);
      latestAssistantText = cleanText(extractAgentSessionText(currentSession), 12000);
      toolRoundArtifacts.push({
        round: roundsExecuted,
        tool_name: multiToolRound ? 'parallel-tool-round' : cleanText(selectedToolNames[0], 120),
        tool_arguments: multiToolRound ? { tool_names: selectedToolNames } : selectedCalls[0]?.argsObject,
        tool_calls: executedCalls.map((entry) => ({
          tool_name: cleanText(entry?.selectedCall?.name, 120),
          tool_arguments: entry?.selectedCall?.argsObject,
          tool_summary: cleanText(entry?.toolEnvelope?.summary, 600),
          tool_error: cleanText(entry?.toolEnvelope?.error || entry?.toolEnvelope?.result?.error, 1200)
        })),
        assistant_before_tool: assistantBeforeTool,
        tool_summary: cleanText(roundToolResult?.summary, 600),
        tool_error: cleanText(roundToolResult?.error, 1200),
        assistant_after_tool: cleanText(latestAssistantText, 4000)
      });
      const assistantAfterToolRound = cleanText(latestAssistantText, 12000);
      const toolRoundSatisfaction = await checkCurrentToolRoundSatisfaction({
        askMainAgentToolRoundSatisfaction,
        continueAgentSessionWithUserMessage,
        extractAgentSessionText,
        extractAgentSessionFunctionCalls,
        normalizeToolCall,
        toolSchemaMap,
        session: currentSession,
        assistantTextForRound: assistantAfterToolRound,
        roundsExecuted,
        maxRounds,
        traceContext
      });
      if (toolRoundArtifacts.length) {
        toolRoundArtifacts[toolRoundArtifacts.length - 1].main_agent_satisfaction = {
          satisfied: toolRoundSatisfaction.satisfied === true,
          reason: cleanText(toolRoundSatisfaction.reason, 320)
        };
      }
      intermediateStates.push(buildIntermediateState(
        'science_tool_round_satisfaction',
        toolRoundSatisfaction.satisfied === true
          ? 'Main agent judged the latest tool round satisfying enough to pre-synthesize.'
          : 'Main agent judged the latest tool round not satisfying enough yet.',
        {
          assumptions: [
            cleanText(toolRoundSatisfaction.reason, 320)
              || (
                toolRoundSatisfaction.satisfied === true
                  ? 'The current tool evidence feels sufficient for pre-synthesis.'
                  : 'The current tool evidence does not feel sufficient yet.'
              )
          ],
          evidence: roundEvidence,
          open_questions: toolRoundSatisfaction.satisfied === true
            ? []
            : uniqueStrings([
              'Another tool round is needed before pre-synthesis.'
            ], 4),
          confidence: toolRoundSatisfaction.satisfied === true
            ? (roundSucceeded ? 0.66 : 0.54)
            : 0.44
        }
      ));
      recordLifecycleEvent(lifecycleRecorder, {
        stage: toolRoundSatisfaction.satisfied === true
          ? 'science_tool_round_satisfied'
          : 'science_tool_round_unsatisfied',
        status: toolRoundSatisfaction.satisfied === true ? 'ok' : 'started',
        routing_intent: intent,
        tool_name: multiToolRound ? 'parallel-tool-round' : selectedToolNames[0],
        message: cleanText(toolRoundSatisfaction.reason, 320)
          || (
            toolRoundSatisfaction.satisfied === true
              ? 'Main agent marked the tool round as satisfying.'
              : 'Main agent requested another tool round before pre-synthesis.'
          ),
        meta: {
          round: roundsExecuted,
          tool_names: selectedToolNames,
          pending_tool_names: asArray(toolRoundSatisfaction.pendingValidToolCalls)
            .map((call) => cleanText(call?.name, 120))
            .filter(Boolean),
          thinking_trace: cleanText(toolRoundSatisfaction.trace_sentence, 420)
        }
      });
      if (toolRoundSatisfaction.satisfied !== true && roundsExecuted < maxRounds) {
        currentSession = toolRoundSatisfaction.session || currentSession;
        latestAssistantText = cleanText(toolRoundSatisfaction.latestAssistantText, 12000) || assistantAfterToolRound;
        // Only send a user-message feedback when the satisfaction session has no outstanding
        // tool_use blocks (valid or unknown). Unmatched tool_use would break the next turn, so
        // let the outer loop handle it via the synthetic tool-output path.
        const hasPendingToolUse = asArray(toolRoundSatisfaction.pendingValidToolCalls).length > 0
          || asArray(toolRoundSatisfaction.pendingToolCalls).length > 0;
        if (!hasPendingToolUse) {
          currentSession = await continueAgentSessionWithUserMessage(
            currentSession,
            buildToolRoundSatisfactionFeedback(toolRoundSatisfaction),
            traceContext
          );
          latestAssistantText = cleanText(extractAgentSessionText(currentSession), 12000);
          if (toolRoundArtifacts.length) {
            toolRoundArtifacts[toolRoundArtifacts.length - 1].assistant_after_tool = cleanText(latestAssistantText, 4000);
          }
        }
        continue;
      }
      await evaluateCurrentLoopState({
        latestToolResult: roundToolResult,
        includePreSynthesisState: true
      });
      if (toolRoundArtifacts.length) {
        toolRoundArtifacts[toolRoundArtifacts.length - 1].assistant_after_tool = cleanText(latestAssistantText, 4000);
      }

      if (finalEvaluation.satisfied === true) {
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_evaluator_satisfied',
          status: 'ok',
          routing_intent: intent,
          tool_name: multiToolRound ? 'parallel-tool-round' : selectedToolNames[0],
          message: cleanText(finalEvaluation.reason, 320) || 'Evaluator marked current evidence as sufficient.',
          meta: {
            round: roundsExecuted,
            tool_names: selectedToolNames,
            thinking_trace: cleanText(finalEvaluation?.trace_sentence, 420)
          }
        });
        break;
      }

      // Honor an explicit should_continue=false from the evaluator even when not satisfied —
      // further rounds will not help (e.g., no remaining budget or no promising next tool).
      if (finalEvaluation?.should_continue === false) {
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_evaluator_stop',
          status: 'ok',
          routing_intent: intent,
          tool_name: multiToolRound ? 'parallel-tool-round' : selectedToolNames[0],
          message: cleanText(finalEvaluation.reason, 320)
            || 'Evaluator requested to stop the loop without additional tool rounds.',
          meta: {
            round: roundsExecuted,
            tool_names: selectedToolNames,
            thinking_trace: cleanText(finalEvaluation?.trace_sentence, 420)
          }
        });
        break;
      }

      if (!(await continueAfterUnsatisfiedEvaluation())) {
        break;
      }
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
      clarification,
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
        citation_count: citations.length,
        thinking_trace: cleanText(synthesis?.trace_sentence, 420)
      }
    });

    // Return the fully normalized result object consumed by higher-level agent orchestration.
    return attachThinkingTrace({
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
      route_plan: routePlan,
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
    }, {
      clarifiedInput: message,
      clarification,
      routePlan,
      exitCriteria,
      preSynthesizedQuestion: latestPreSynthesizedQuestion,
      evaluation: finalEvaluation,
      finalSynthesis: synthesis,
      status: partial ? 'partial' : 'completed',
      partial
    });
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
    getIntentPolicy: getScienceReasoningPolicy,
    buildNeedsMoreInfoResult,
    runIntentLoop,
    runGeneralScienceQuestion,
    runProjectScienceQuestion,
    runResultAnalysis
  };
}

module.exports = {
  createScienceReasoningLoopRuntime
};
