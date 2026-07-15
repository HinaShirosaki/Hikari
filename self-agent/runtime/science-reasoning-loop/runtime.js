'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/lib/llm/runtime-helpers.js');
const { createAgentRoutePlannerRuntime } = require('./agent-route-planner.js');
const { createScienceInputClarificationRuntime } = require('./input-clarification.js');
const { createScienceFinalSynthesisRuntime } = require('./final-synthesis.js');
const { createScienceLoopExitCriteriaRuntime } = require('./loop-exit-criteria.js');
const { createScienceLoopPreSynthesizedAnswerRuntime } = require('./pre-synthesized-answer.js');
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
const { createAgentToolProviderRuntime } = require('../../../src/main/agent/tools/agent-tool-provide.js');
const { createScienceDirectAnswerRuntime } = require('./direct-answer.js');
const { createScienceLoopPreSynthesisController } = require('./pre-synthesis-controller.js');
const { createScienceToolRoundLoopRuntime } = require('./tool-round-loop.js');

function createScienceReasoningLoopRuntime(deps = {}) {
  const { asArray, cleanText, uniqueStrings } = createAgentLlmRuntimeHelpers(deps);
  const clamp = typeof deps.clamp === 'function'
    ? deps.clamp
    : ((value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)));
  const startAgentSession = typeof deps.startAgentSession === 'function' ? deps.startAgentSession : null;
  const extractAgentSessionText = typeof deps.extractAgentSessionText === 'function'
    ? deps.extractAgentSessionText
    : (() => '');
  const runTool = typeof deps.runTool === 'function' ? deps.runTool : null;
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
      validation: { passed: true, forced_clarification: false, violations: [], failure_reasons: [] },
      provenance: { source_evidence: [], unsupported_statement_count: 0 }
    }));
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const clarifyScienceInput = typeof deps.clarifyScienceInput === 'function'
    ? deps.clarifyScienceInput
    : createScienceInputClarificationRuntime(deps).clarifyInput;
  const draftScienceRoutePlan = typeof deps.draftScienceRoutePlan === 'function'
    ? deps.draftScienceRoutePlan
    : createAgentRoutePlannerRuntime(deps).draftRoutePlan;
  const generateScienceLoopExitCriteria = typeof deps.generateScienceLoopExitCriteria === 'function'
    ? deps.generateScienceLoopExitCriteria
    : createScienceLoopExitCriteriaRuntime(deps).generateExitCriteria;
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
    buildScienceSessionSystemPrompt,
    buildFallbackAnswer,
    hasExternalCitation,
    hasInternalCitation
  } = scienceLoopSupport;
  const roundHelpers = createScienceReasoningRoundHelpers({
    ...deps,
    normalizeCitations,
    normalizeLoadedContextBlocks
  });
  const synthesizeScienceFinal = createScienceFinalSynthesisRuntime({
    ...deps,
    clamp
  }).synthesizeFinal;

  const preSynthesisController = createScienceLoopPreSynthesisController({
    ...deps,
    scienceLoopSupport,
    roundHelpers
  });
  const { runScienceDirectAnswer } = createScienceDirectAnswerRuntime({
    ...deps,
    scienceLoopSupport,
    clamp
  });
  const { runScienceToolRoundLoop } = createScienceToolRoundLoopRuntime({
    ...deps,
    scienceLoopSupport,
    roundHelpers,
    preSynthesisController
  });

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
      12
    );
    const maxInferenceRetries = clamp(
      Number(input.maxInferenceRetries ?? deps.maxInferenceRetries ?? 3),
      0,
      5
    );
    const maxToolsPerRound = clamp(
      Number(input.maxToolsPerRound ?? deps.maxToolsPerRound ?? 4),
      1,
      8
    );
    const lifecycleRecorder = input.lifecycleRecorder || null;
    const conversation = asArray(input.conversation);
    const traceContext = input.traceContext || null;
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

    const state = {
      input,
      intent,
      policy,
      parserPayload,
      reasoningEffort,
      routing,
      project,
      originalMessage,
      message: originalMessage,
      conversation,
      traceContext,
      lifecycleRecorder,
      maxRounds,
      maxInferenceRetries,
      maxToolsPerRound,
      toolTrace: [],
      toolRoundArtifacts: [],
      intermediateStates: [],
      accumulatedCitations: [],
      accumulatedCitationKeys: new Set(),
      roundsExecuted: 0,
      feedbackTurnsWithoutTool: 0,
      clarification: null,
      routePlan: null,
      exitCriteria: null,
      latestAssistantText: '',
      latestPreSynthesizedAnswer: null,
      finalEvaluation: null,
      currentSession: null
    };

    async function attachThinkingTrace(resultPayload = {}, overrides = {}) {
      const thinkingTrace = await generateScienceThinkingTrace({
        ...input,
        intent,
        originalMessage,
        message: cleanText(overrides.message !== undefined ? overrides.message : state.message, 3200),
        clarifiedInput: cleanText(
          overrides.clarifiedInput !== undefined
            ? overrides.clarifiedInput
            : (resultPayload?.clarified_input || state.message || originalMessage),
          3200
        ),
        parserPayload,
        clarification: overrides.clarification !== undefined ? overrides.clarification : state.clarification,
        routePlan: overrides.routePlan !== undefined ? overrides.routePlan : state.routePlan,
        exitCriteria: overrides.exitCriteria !== undefined ? overrides.exitCriteria : state.exitCriteria,
        toolRounds: overrides.toolRounds !== undefined ? overrides.toolRounds : state.toolRoundArtifacts,
        preSynthesizedAnswer: overrides.preSynthesizedAnswer !== undefined
          ? overrides.preSynthesizedAnswer
          : state.latestPreSynthesizedAnswer,
        evaluation: overrides.evaluation !== undefined ? overrides.evaluation : state.finalEvaluation,
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
        latestAssistantText: state.latestAssistantText,
        traceContext
      });
      return {
        ...resultPayload,
        thinking_trace: thinkingTrace,
        final_synthesized_question: cleanText(thinkingTrace?.final_synthesized_question, 3200)
          || cleanText(resultPayload?.clarified_input || state.message || originalMessage, 3200)
      };
    }

    state.intermediateStates.push(buildIntermediateState('science_intake', `Start ${intent} handling.`, {
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
      const direct = await runScienceDirectAnswer({
        input,
        intent,
        policy,
        parserPayload,
        routing,
        project,
        originalMessage,
        reasoningEffort,
        conversation,
        traceContext,
        toolTrace: state.toolTrace,
        intermediateStates: state.intermediateStates,
        lifecycleRecorder,
        attachThinkingTrace
      });
      state.latestAssistantText = direct.latestAssistantText;
      return direct.result;
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_clarification_started',
      status: 'started',
      routing_intent: intent,
      message: `Clarifying ${intent} input before tool execution.`
    });

    state.clarification = await clarifyScienceInput({
      ...input,
      intent,
      message: originalMessage,
      conversation,
      parserPayload,
      routing,
      project,
      traceContext
    });
    state.message = cleanText(state.clarification?.clarified_input, 3200) || originalMessage;

    state.intermediateStates.push(buildIntermediateState('science_clarification', 'Clarified the user request before reasoning.', {
      assumptions: uniqueStrings([
        cleanText(state.clarification?.analysis_goal, 260),
        ...asArray(state.clarification?.important_constraints)
      ], 8),
      open_questions: state.clarification?.should_ask_follow_up === true
        ? uniqueStrings([
          cleanText(state.clarification?.follow_up_question, 320),
          ...asArray(state.clarification?.missing_information)
        ], 6)
        : [],
      confidence: state.clarification?.should_ask_follow_up === true ? 0.4 : 0.66
    }));

    if (state.clarification?.should_ask_follow_up === true) {
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_clarification_completed',
        status: 'pending',
        routing_intent: intent,
        message: cleanText(state.clarification?.follow_up_reason, 320) || 'Clarification requested more information before reasoning.',
        meta: {
          thinking_trace: cleanText(state.clarification?.trace_sentence, 420),
          follow_up_question: cleanText(state.clarification?.follow_up_question, 320)
        }
      });
      return attachThinkingTrace(buildNeedsMoreInfoResult({
        intent,
        routing,
        reason: cleanText(state.clarification?.follow_up_reason, 280) || 'Clarification is required before reasoning.',
        question: cleanText(state.clarification?.follow_up_question, 320),
        toolTrace: state.toolTrace,
        intermediateStates: state.intermediateStates
      }), {
        clarifiedInput: state.message,
        clarification: state.clarification,
        status: 'needs_more_info'
      });
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_clarification_completed',
      status: 'ok',
      routing_intent: intent,
      message: 'Science input was clarified and is ready for reasoning.',
      meta: {
        thinking_trace: cleanText(state.clarification?.trace_sentence, 420)
      }
    });

    if (intent === 'project_science_question' && policy.require_project_resolution === true && !project) {
      const followUpQuestion = cleanText(state.clarification?.follow_up_question, 320)
        || cleanText(input.projectResolutionQuestion, 320);
      state.intermediateStates.push(buildIntermediateState('science_preflight', 'Project-science preflight could not resolve a unique project.', {
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
        toolTrace: state.toolTrace,
        intermediateStates: state.intermediateStates
      }), {
        clarifiedInput: state.message,
        clarification: state.clarification,
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
      state.routePlan = await draftScienceRoutePlan({
        ...input,
        intent,
        policy,
        allowedToolNames: preselectedToolNames,
        routing,
        project,
        message: state.message,
        clarifiedInput: state.message,
        clarification: state.clarification,
        reasoningEffort,
        traceContext
      });
      state.intermediateStates.push(buildIntermediateState('science_route_plan', 'Drafted a reference route plan for the reasoning loop.', {
        assumptions: uniqueStrings([
          cleanText(state.routePlan?.route_summary, 260),
          ...asArray(state.routePlan?.decision_points)
        ], 8),
        open_questions: asArray(state.routePlan?.adaptation_notes),
        proposed_actions: asArray(state.routePlan?.tool_call_suggestions).slice(0, 5).map((item) => ({
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
          thinking_trace: cleanText(state.routePlan?.trace_sentence, 420)
        }
      });
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_exit_criteria_started',
      status: 'started',
      routing_intent: intent,
      message: `Generating exit criteria for ${intent}.`
    });
    state.exitCriteria = await generateScienceLoopExitCriteria({
      ...input,
      intent,
      policy,
      allowedToolNames: preselectedToolNames,
      routing,
      project,
      clarifiedInput: state.message,
      clarification: state.clarification,
      traceContext
    });
    state.intermediateStates.push(buildIntermediateState('science_exit_criteria', 'Generated exit criteria for the reasoning loop.', {
      assumptions: uniqueStrings([
        ...asArray(state.exitCriteria?.exit_conditions),
        cleanText(state.exitCriteria?.reasoning_notes, 260)
      ], 8),
      open_questions: asArray(state.exitCriteria?.continue_when),
      confidence: 0.62
    }));
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_exit_criteria_completed',
      status: 'ok',
      routing_intent: intent,
      message: 'Science loop exit criteria are ready.',
      meta: {
        thinking_trace: cleanText(state.exitCriteria?.trace_sentence, 420)
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
    const toolDefinitionMap = new Map();
    toolDefinitions.forEach((tool) => {
      const name = cleanText(tool?.name, 120);
      if (name) {
        toolDefinitionMap.set(name, tool);
      }
    });
    const candidateAllowedToolNames = asArray(providedTools?.tool_names).length
      ? asArray(providedTools.tool_names)
      : toolDefinitions.map((tool) => cleanText(tool?.name, 120));
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

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'science_intent_started',
      status: 'started',
      routing_intent: intent,
      message: `Started shared science reasoning loop for ${intent}.`
    });

    state.currentSession = await startAgentSession({
      ...input,
      systemPrompt: buildScienceSessionSystemPrompt({
        baseSystemPrompt: cleanText(input.baseSystemPrompt, 12000),
        intent,
        policy,
        routing,
        project,
        originalMessage,
        clarification: state.clarification,
        routePlan: state.routePlan,
        exitCriteria: state.exitCriteria,
        message: state.message,
        reasoningEffort
      }),
      conversation,
      message: state.message,
      hasLatestUserInConversation: input.hasLatestUserInConversation === true,
      toolDefinitions,
      traceContext
    });
    state.latestAssistantText = cleanText(extractAgentSessionText(state.currentSession), 12000);

    state.toolSchemaMap = toolSchemaMap;
    state.toolDefinitionMap = toolDefinitionMap;
    state.allowedToolNamesLowerSet = allowedToolNamesLowerSet;
    state.executeTool = executeTool;

    await runScienceToolRoundLoop(state);

    const partial = !(state.finalEvaluation?.satisfied === true);
    const synthesis = await synthesizeScienceFinal({
      provider: input.provider,
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      model: input.model,
      intent,
      policy,
      message: state.message,
      clarification: state.clarification,
      project,
      roundsExecuted: state.roundsExecuted,
      maxRounds,
      evaluator: state.finalEvaluation,
      accumulatedCitations: state.accumulatedCitations,
      toolTrace: state.toolTrace,
      partial,
      fallbackAnswer: buildFallbackAnswer({
        latestAssistantText: state.latestAssistantText,
        evaluator: state.finalEvaluation,
        toolTrace: state.toolTrace
      }),
      traceContext
    });

    const citations = normalizeCitations(state.accumulatedCitations, 20);
    const synthesisDecisionRecord = normalizeDecisionRecord(synthesis.decision_record, {
      assumptions: [
        `${intent} used the shared science reasoning loop.`,
        policy.distinguish_internal_vs_external === true
          ? `Internal citations=${hasInternalCitation(citations)} external citations=${hasExternalCitation(citations)}.`
          : `Citation count=${citations.length}.`
      ],
      open_questions: asArray(state.finalEvaluation?.missing_requirements),
      verification_notes: [
        partial
          ? 'The loop stopped with remaining gaps and returned a best-effort answer.'
          : 'The evaluator marked the evidence as sufficient before final synthesis.'
      ]
    });

    const responseLayer = applyResponseLayerToOutput({
      normalized: {
        answer: cleanText(synthesis.answer, 12000)
          || buildFallbackAnswer({ latestAssistantText: state.latestAssistantText, evaluator: state.finalEvaluation, toolTrace: state.toolTrace }),
        confidence: Number.isFinite(Number(synthesis.confidence))
          ? clamp(Number(synthesis.confidence), 0, 1)
          : (partial ? 0.48 : 0.68),
        citations,
        decisionRecord: synthesisDecisionRecord
      },
      routing,
      notebookDraft: null,
      toolTrace: state.toolTrace
    });

    const validated = applyValidationGateToOutput({
      routing,
      normalized: responseLayer,
      notebookDraft: null,
      toolTrace: state.toolTrace
    });

    state.intermediateStates.push(buildIntermediateState('science_synthesis', 'Synthesized final science answer from tool evidence.', {
      assumptions: [
        partial
          ? 'Best-effort answer was produced because the loop stopped before full sufficiency.'
          : 'Final answer was produced after evaluator satisfaction.',
        `Total citations=${citations.length}.`
      ],
      evidence: citations,
      open_questions: asArray(state.finalEvaluation?.missing_requirements),
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
        rounds_executed: state.roundsExecuted,
        citation_count: citations.length,
        thinking_trace: cleanText(synthesis?.trace_sentence, 420)
      }
    });

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
      clarified_input: state.message,
      input_clarification: state.clarification,
      route_plan: state.routePlan,
      exit_criteria: state.exitCriteria,
      tool_trace: state.toolTrace,
      intermediate_states: state.intermediateStates,
      rounds_executed: state.roundsExecuted,
      reasoning_effort: reasoningEffort,
      follow_up_questions: uniqueStrings([
        ...asArray(synthesis.follow_up_questions),
        ...asArray(state.finalEvaluation?.missing_requirements).map((item) => {
          const clean = cleanText(item, 240);
          return clean ? `Could you clarify: ${clean}` : '';
        })
      ], 6)
    }, {
      clarifiedInput: state.message,
      clarification: state.clarification,
      routePlan: state.routePlan,
      exitCriteria: state.exitCriteria,
      preSynthesizedAnswer: state.latestPreSynthesizedAnswer,
      evaluation: state.finalEvaluation,
      finalSynthesis: synthesis,
      status: partial ? 'partial' : 'completed',
      partial
    });
  }

  async function runGeneralScienceQuestion(input = {}) {
    return runIntentLoop({ ...input, intent: 'general_science_question' });
  }

  async function runProjectScienceQuestion(input = {}) {
    return runIntentLoop({ ...input, intent: 'project_science_question' });
  }

  async function runResultAnalysis(input = {}) {
    return runIntentLoop({ ...input, intent: 'result_analysis' });
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
