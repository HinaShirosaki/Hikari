'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/lib/llm/runtime-helpers.js');

function createScienceDirectAnswerRuntime(deps = {}) {
  const { asArray, cleanText, uniqueStrings } = createAgentLlmRuntimeHelpers(deps);
  const clamp = typeof deps.clamp === 'function'
    ? deps.clamp
    : ((value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)));
  const startAgentSession = typeof deps.startAgentSession === 'function' ? deps.startAgentSession : null;
  const extractAgentSessionText = typeof deps.extractAgentSessionText === 'function'
    ? deps.extractAgentSessionText
    : (() => '');
  const applyResponseLayerToOutput = typeof deps.applyResponseLayerToOutput === 'function'
    ? deps.applyResponseLayerToOutput
    : (({ normalized }) => normalized);
  const applyValidationGateToOutput = typeof deps.applyValidationGateToOutput === 'function'
    ? deps.applyValidationGateToOutput
    : (({ normalized }) => ({
      normalized,
      validation: { passed: true, forced_clarification: false, violations: [], failure_reasons: [] },
      provenance: { source_evidence: [], unsupported_statement_count: 0 }
    }));
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const {
    buildScienceSessionSystemPrompt,
    buildIntermediateState,
    buildNeedsMoreInfoResult,
    normalizeDecisionRecord
  } = deps.scienceLoopSupport || {};

  async function runScienceDirectAnswer({
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
    toolTrace,
    intermediateStates,
    lifecycleRecorder,
    attachThinkingTrace
  }) {
    if (!startAgentSession) {
      throw new Error('Science direct-answer path requires startAgentSession.');
    }
    if (parserPayload.needs_clarification === true) {
      return {
        result: await attachThinkingTrace(buildNeedsMoreInfoResult({
          intent,
          routing,
          reason: cleanText(parserPayload?.clarification_reason, 280) || 'Clarification is required before answering directly.',
          question: cleanText(parserPayload?.clarification_reason, 320),
          toolTrace,
          intermediateStates
        }), {
          clarifiedInput: originalMessage,
          status: 'needs_more_info'
        }),
        latestAssistantText: ''
      };
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
      return {
        result: await attachThinkingTrace(buildNeedsMoreInfoResult({
          intent,
          routing,
          reason: 'Project resolution was missing or ambiguous.',
          question: followUpQuestion,
          toolTrace,
          intermediateStates
        }), {
          clarifiedInput: originalMessage,
          status: 'needs_more_info'
        }),
        latestAssistantText: ''
      };
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
    const latestAssistantText = cleanText(extractAgentSessionText(directSession), 12000);

    const directDecisionRecord = normalizeDecisionRecord(null, {
      assumptions: [`${intent} was answered directly at reasoning_effort=0.`],
      verification_notes: ['No reasoning loop or retrieval tool was used.']
    });
    const responseLayer = applyResponseLayerToOutput({
      normalized: {
        answer: latestAssistantText || 'I could not generate a direct science answer.',
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

    return {
      result: await attachThinkingTrace({
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
      }),
      latestAssistantText
    };
  }

  return { runScienceDirectAnswer };
}

module.exports = {
  createScienceDirectAnswerRuntime
};
