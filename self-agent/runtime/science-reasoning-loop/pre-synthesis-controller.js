'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/helpers/agent/shared/agent-llm-utils.js');
const { createScienceLoopExitJudgeRuntime } = require('./loop-exit-judge.js');
const { createScienceLoopPreSynthesizedAnswerRuntime } = require('./pre-synthesized-answer.js');
const {
  createScienceLoopLogicalVerificationRuntime,
  normalizeScienceLogicalVerification,
  getUnstableScienceInferenceChecks,
  formatScienceInferenceStabilityIssue
} = require('./logical-verification.js');

function createScienceLoopPreSynthesisController(deps = {}) {
  const { asArray, cleanText, uniqueStrings } = createAgentLlmRuntimeHelpers(deps);
  const extractAgentSessionText = typeof deps.extractAgentSessionText === 'function'
    ? deps.extractAgentSessionText
    : (() => '');
  const continueAgentSessionWithUserMessage = typeof deps.continueAgentSessionWithUserMessage === 'function'
    ? deps.continueAgentSessionWithUserMessage
    : (async (session) => session);
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const evaluateScienceRoundOverride = typeof deps.evaluateScienceRound === 'function'
    ? deps.evaluateScienceRound
    : null;
  const judgeScienceLoopExit = typeof deps.judgeScienceLoopExit === 'function'
    ? deps.judgeScienceLoopExit
    : createScienceLoopExitJudgeRuntime(deps).judgeExit;
  const buildSciencePreSynthesizedAnswer = typeof deps.buildSciencePreSynthesizedAnswer === 'function'
    ? deps.buildSciencePreSynthesizedAnswer
    : createScienceLoopPreSynthesizedAnswerRuntime(deps).buildPreSynthesizedAnswer;
  const scienceLogicalVerificationRuntime = createScienceLoopLogicalVerificationRuntime({
    ...deps,
    now: typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString())
  });
  const verifySciencePreSynthesizedAnswerLogic = typeof deps.verifySciencePreSynthesizedAnswerLogic === 'function'
    ? deps.verifySciencePreSynthesizedAnswerLogic
    : scienceLogicalVerificationRuntime.verifyPreSynthesizedAnswer;
  const buildScienceInferenceRetryFeedback = typeof deps.buildScienceInferenceRetryFeedback === 'function'
    ? deps.buildScienceInferenceRetryFeedback
    : scienceLogicalVerificationRuntime.buildInferenceRetryFeedback;

  const { normalizeEvaluationPayload } = deps.roundHelpers || {};
  const { normalizeCitations, buildIntermediateState, buildEvaluatorFeedback } = deps.scienceLoopSupport || {};

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
      preSynthesizedAnswer: payload.preSynthesizedAnswer && typeof payload.preSynthesizedAnswer === 'object'
        ? payload.preSynthesizedAnswer
        : buildSciencePreSynthesizedAnswer({
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

  async function buildVerifiedPreSynthesizedAnswer(ctx, {
    session,
    latestToolResult = null,
    rounds
  } = {}) {
    const {
      input, intent, policy, message, clarification, project,
      accumulatedCitations, toolTrace, maxRounds, maxInferenceRetries,
      latestAssistantText, intermediateStates, lifecycleRecorder, traceContext
    } = ctx;
    const targetRounds = rounds == null ? ctx.roundsExecuted : rounds;
    let workingSession = session || null;
    let workingAssistantText = cleanText(latestAssistantText, 12000);
    let preSynthesizedAnswer = null;
    let retryCount = 0;

    while (retryCount <= maxInferenceRetries) {
      preSynthesizedAnswer = buildSciencePreSynthesizedAnswer({
        intent,
        policy,
        message,
        clarification,
        project,
        citations: accumulatedCitations,
        toolTrace,
        latestToolResult,
        latestAssistantText: workingAssistantText,
        roundsExecuted: targetRounds,
        maxRounds
      });
      preSynthesizedAnswer = {
        ...preSynthesizedAnswer,
        logical_verification: normalizeScienceLogicalVerification(
          await verifySciencePreSynthesizedAnswerLogic({
            provider: input.provider,
            endpoint: input.endpoint,
            apiKey: input.apiKey,
            model: input.model,
            intent,
            policy,
            message,
            clarification,
            project,
            preSynthesizedAnswer,
            latestAssistantText: workingAssistantText,
            latestToolResult,
            toolTrace,
            citations: accumulatedCitations,
            roundsExecuted: targetRounds,
            maxRounds,
            traceContext
          }),
          {},
          { asArray, cleanText, uniqueStrings }
        )
      };
      const unstableChecks = getUnstableScienceInferenceChecks(
        preSynthesizedAnswer.logical_verification,
        { asArray, cleanText, uniqueStrings }
      );
      if (!unstableChecks.length || retryCount >= maxInferenceRetries || !workingSession) {
        return {
          preSynthesizedAnswer,
          session: workingSession,
          latestAssistantText: workingAssistantText,
          retryCount
        };
      }

      const retryFeedback = cleanText(
        buildScienceInferenceRetryFeedback(preSynthesizedAnswer.logical_verification),
        4000
      );
      if (!retryFeedback) {
        return {
          preSynthesizedAnswer,
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
          open_questions: asArray(preSynthesizedAnswer?.unresolved_issues),
          confidence: 0.44
        }
      ));
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_inference_retry',
        status: 'started',
        routing_intent: intent,
        message: 'Retrying the tentative inference after an unstable logic check.',
        meta: {
          round: targetRounds,
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
      preSynthesizedAnswer,
      session: workingSession,
      latestAssistantText: workingAssistantText,
      retryCount
    };
  }

  async function evaluateCurrentLoopState(state, {
    latestToolResult = null,
    includePreSynthesisState = false
  } = {}) {
    const ctx = {
      input: state.input,
      intent: state.intent,
      policy: state.policy,
      message: state.message,
      clarification: state.clarification,
      project: state.project,
      accumulatedCitations: state.accumulatedCitations,
      toolTrace: state.toolTrace,
      maxRounds: state.maxRounds,
      maxInferenceRetries: state.maxInferenceRetries,
      latestAssistantText: state.latestAssistantText,
      intermediateStates: state.intermediateStates,
      lifecycleRecorder: state.lifecycleRecorder,
      traceContext: state.traceContext,
      roundsExecuted: state.roundsExecuted
    };
    const preSynthesisState = await buildVerifiedPreSynthesizedAnswer(ctx, {
      session: state.currentSession,
      latestToolResult,
      rounds: state.roundsExecuted
    });
    state.currentSession = preSynthesisState.session || state.currentSession;
    state.latestAssistantText = cleanText(preSynthesisState.latestAssistantText, 12000);
    state.latestPreSynthesizedAnswer = preSynthesisState.preSynthesizedAnswer;

    if (includePreSynthesisState) {
      const latestEvidence = normalizeCitations(latestToolResult?.citations || latestToolResult?.result?.citations, 8);
      state.intermediateStates.push(buildIntermediateState(
        'science_pre_synthesis',
        'Prepared a lightweight pre-synthesized answer before exit judgement.',
        {
          assumptions: [
            cleanText(state.latestPreSynthesizedAnswer?.tentative_answer?.current_best_answer, 320)
              ? `Tentative answer: ${cleanText(state.latestPreSynthesizedAnswer.tentative_answer.current_best_answer, 320)}`
              : 'No grounded tentative answer was available yet.'
          ],
          evidence: latestEvidence,
          open_questions: uniqueStrings([
            ...asArray(state.latestPreSynthesizedAnswer?.unresolved_issues),
            ...getUnstableScienceInferenceChecks(
              state.latestPreSynthesizedAnswer?.logical_verification,
              { asArray, cleanText, uniqueStrings }
            ).map((row) => formatScienceInferenceStabilityIssue(row, { asArray, cleanText, uniqueStrings }))
          ], 8),
          confidence: latestToolResult?.ok === true ? 0.64 : 0.4
        }
      ));
    }

    state.finalEvaluation = await evaluateScienceRound({
      provider: state.input.provider,
      endpoint: state.input.endpoint,
      apiKey: state.input.apiKey,
      model: state.input.model,
      intent: state.intent,
      policy: state.policy,
      exitCriteria: state.exitCriteria,
      message: state.message,
      clarification: state.clarification,
      project: state.project,
      accumulatedCitations: state.accumulatedCitations,
      toolTrace: state.toolTrace,
      latestToolResult,
      preSynthesizedAnswer: state.latestPreSynthesizedAnswer,
      latestAssistantText: state.latestAssistantText,
      roundsExecuted: state.roundsExecuted,
      maxRounds: state.maxRounds,
      traceContext: state.traceContext
    });
    if (!state.toolTrace.length) {
      state.finalEvaluation = {
        ...state.finalEvaluation,
        satisfied: false,
        should_continue: true,
        can_answer_with_limitations: false,
        reason: 'The science reasoning loop needs at least one tool round before it can stop.',
        missing_requirements: uniqueStrings([
          ...asArray(state.finalEvaluation?.missing_requirements),
          'At least one tool round must run before exit judgement.'
        ], 8),
        next_tool_hint: state.finalEvaluation?.next_tool_hint && typeof state.finalEvaluation.next_tool_hint === 'object'
          ? state.finalEvaluation.next_tool_hint
          : {
            tool_name: null,
            query: state.message || null,
            reason: 'Run the next best science tool call or parallel tool batch before answering.'
          }
      };
    }
    return state.finalEvaluation;
  }

  async function continueAfterUnsatisfiedEvaluation(state) {
    if (state.roundsExecuted >= state.maxRounds || state.feedbackTurnsWithoutTool >= state.maxRounds) {
      recordLifecycleEvent(state.lifecycleRecorder, {
        stage: 'science_budget_exhausted',
        status: 'failed',
        routing_intent: state.intent,
        message: 'Science reasoning loop exhausted its budget without sufficient evidence.',
        meta: { round: state.roundsExecuted }
      });
      return false;
    }

    recordLifecycleEvent(state.lifecycleRecorder, {
      stage: 'science_evaluator_continue',
      status: 'started',
      routing_intent: state.intent,
      message: cleanText(state.finalEvaluation?.reason, 320) || 'Evaluator requested another tool step.',
      meta: {
        round: state.roundsExecuted,
        thinking_trace: cleanText(state.finalEvaluation?.trace_sentence, 420)
      }
    });
    state.currentSession = await continueAgentSessionWithUserMessage(
      state.currentSession,
      buildEvaluatorFeedback(state.finalEvaluation, state.intent),
      state.traceContext
    );
    state.latestAssistantText = cleanText(extractAgentSessionText(state.currentSession), 12000);
    return true;
  }

  return {
    evaluateScienceRound,
    buildVerifiedPreSynthesizedAnswer,
    evaluateCurrentLoopState,
    continueAfterUnsatisfiedEvaluation
  };
}

module.exports = {
  createScienceLoopPreSynthesisController
};
