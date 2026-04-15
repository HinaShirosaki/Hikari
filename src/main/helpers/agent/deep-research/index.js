'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');
const { runStep1ClarifyQuestion } = require('./step-1-clarify-question.js');
const { runStep2AskTargetedFollowUp } = require('./step-2-ask-targeted-follow-up.js');
const { runStep3DraftResearchPlan } = require('./step-3-draft-research-plan.js');
const { runStep4ExecutePlan } = require('./step-4-execute-plan.js');
const { runStep5AssembleFinalAnswer } = require('./step-5-assemble-final-answer.js');
const {
  createContextControlState,
  recordSectionBuffer,
  updateContextControlState,
  buildContextControlSnapshot
} = require('./context-control.js');
const {
  normalizeCitation,
  dedupeCitations,
  createAccuracyPreservationState,
  updateAccuracyPreservationState,
  buildAccuracyPreservationSnapshot
} = require('./accuracy-preservation.js');
const {
  shouldDelegateSubAgent,
  buildSubAgentInstruction,
  runCompletionCheck
} = require('./sub-agent-usage.js');
const {
  buildDefaultAnswerOutline,
  mapEvidenceToOutlineSections,
  validateSynthesisSections
} = require('./final-synthesis-quality.js');
const {
  REASONING_ENTRY_TOOL_SCOPES,
  createAgentToolProviderRuntime
} = require('../tools/agent-tool-provide.js');

const DEEP_RESEARCH_INTENTS = Object.freeze([
  'general_science_question',
  'project_science_question',
  'result_analysis'
]);

const DEEP_RESEARCH_POLICIES = Object.freeze({
  general_science_question: Object.freeze({
    intent: 'general_science_question',
    tool_scope: REASONING_ENTRY_TOOL_SCOPES.deep_research_entry.general_science_question,
    require_project_resolution: false
  }),
  project_science_question: Object.freeze({
    intent: 'project_science_question',
    tool_scope: REASONING_ENTRY_TOOL_SCOPES.deep_research_entry.project_science_question,
    require_project_resolution: true
  }),
  result_analysis: Object.freeze({
    intent: 'result_analysis',
    tool_scope: REASONING_ENTRY_TOOL_SCOPES.deep_research_entry.result_analysis,
    require_project_resolution: false
  })
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
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

function normalizeIntent(intent) {
  const normalized = cleanText(intent, 80);
  return DEEP_RESEARCH_INTENTS.includes(normalized) ? normalized : '';
}

function getIntentPolicy(intent) {
  const normalized = normalizeIntent(intent);
  if (!normalized) {
    throw new Error(`Unsupported deep research intent: ${cleanText(intent, 80) || 'missing'}`);
  }
  return DEEP_RESEARCH_POLICIES[normalized];
}

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

function clamp(value, min, max) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : min;
  return Math.max(min, Math.min(max, numeric));
}

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

function normalizeCitations(citations, max = 20) {
  return dedupeCitations(citations, max);
}

function buildIntermediateState(stage, summary, extras = {}) {
  return {
    state_id: `${cleanText(stage, 40) || 'deep-research'}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    stage: cleanText(stage, 80),
    summary: cleanText(summary, 600),
    data: extras && typeof extras === 'object' ? extras : {}
  };
}

function buildNeedsMoreInfoResult({
  intent,
  routing,
  question,
  reason,
  intermediateStates = [],
  citations = []
}, deps = {}) {
  const applyResponseLayerToOutput = typeof deps.applyResponseLayerToOutput === 'function'
    ? deps.applyResponseLayerToOutput
    : (({ normalized }) => normalized);
  const applyValidationGateToOutput = typeof deps.applyValidationGateToOutput === 'function'
    ? deps.applyValidationGateToOutput
    : (({ normalized }) => ({
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

  const followUp = uniqueStrings([
    cleanText(question, 320) || cleanText(reason, 320) || 'Could you clarify the missing detail so I can continue?'
  ], 4);
  const normalized = applyResponseLayerToOutput({
    normalized: {
      answer: followUp[0],
      confidence: 0.35,
      citations: normalizeCitations(citations),
      decisionRecord: {
        assumptions: [`${intent} entered deep research mode.`],
        open_questions: followUp,
        verification_notes: ['Execution stopped before Step 4 because a blocking detail was missing.']
      }
    },
    routing,
    notebookDraft: null,
    toolTrace: []
  });
  const validated = applyValidationGateToOutput({
    routing,
    normalized,
    notebookDraft: null,
    toolTrace: []
  });
  return {
    status: 'needs_more_info',
    answer: cleanText(validated.normalized.answer, 12000),
    confidence: Number.isFinite(Number(validated.normalized.confidence))
      ? Number(validated.normalized.confidence)
      : 0.35,
    citations: normalizeCitations(citations),
    decision_record: validated.normalized.decisionRecord || normalizeDecisionRecord(null, {
      assumptions: [`${intent} entered deep research mode.`],
      open_questions: followUp,
      verification_notes: ['Execution stopped before Step 4 because a blocking detail was missing.']
    }),
    response_type: cleanText(validated.normalized.response_type, 80),
    confidence_label: cleanText(validated.normalized.confidence_label, 40),
    source_summary: validated.normalized.source_summary && typeof validated.normalized.source_summary === 'object'
      ? validated.normalized.source_summary
      : { total_sources: 0, groups: [] },
    unresolved_fields: asArray(validated.normalized.unresolved_fields).map((item) => cleanText(item, 180)).filter(Boolean),
    validation: validated.validation,
    provenance: validated.provenance,
    tool_trace: [],
    intermediate_states: asArray(intermediateStates),
    rounds_executed: 0,
    follow_up_questions: followUp,
    execution_mode: 'deep_research'
  };
}

function createDeepResearchRuntime(deps = {}) {
  const llmHelpers = createAgentLlmRuntimeHelpers(deps);
  const runtimeDeps = {
    ...deps,
    requestStructuredJsonPayload: llmHelpers.requestStructuredJsonPayload
  };
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
    : (({ normalized }) => ({
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

  async function runDeepResearchIntent(input = {}) {
    const intent = normalizeIntent(input.intent);
    if (!intent) {
      throw new Error('Deep research requires a supported intent.');
    }
    const policy = getIntentPolicy(intent);
    const parserPayload = input.parserPayload && typeof input.parserPayload === 'object' ? input.parserPayload : {};
    const routing = input.routing && typeof input.routing === 'object'
      ? input.routing
      : {
        intent,
        confidence: parserPayload.needs_clarification === true ? 0.35 : 0.62,
        entities: {},
        plan: {}
      };
    const project = normalizeProject(input.project) || null;
    const intermediateStates = [];

    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_started',
      status: 'started',
      routing_intent: intent,
      message: `Started deep research pipeline for ${intent}.`
    });

    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_started',
      status: 'started',
      routing_intent: intent,
      message: 'Clarifying the research objective.',
      meta: {
        step: 1,
        title: 'Clarify objective'
      }
    });
    const researchObjective = await runStep1ClarifyQuestion({
      ...input,
      intent,
      parserPayload,
      routing,
      project
    }, runtimeDeps);
    intermediateStates.push(buildIntermediateState('step_1_clarify', 'Clarified the research objective.', researchObjective));
    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_completed',
      status: 'ok',
      routing_intent: intent,
      message: 'Research objective clarified.',
      meta: {
        step: 1,
        title: 'Clarify objective'
      }
    });

    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_started',
      status: 'started',
      routing_intent: intent,
      message: 'Checking whether a blocking follow-up question is still needed.',
      meta: {
        step: 2,
        title: 'Follow-up check'
      }
    });
    const followUp = await runStep2AskTargetedFollowUp({
      ...input,
      intent,
      parserPayload,
      routing,
      project,
      clarifyResult: researchObjective
    }, runtimeDeps);
    intermediateStates.push(buildIntermediateState('step_2_follow_up', 'Checked whether one blocking follow-up question is still needed.', followUp));
    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_completed',
      status: followUp.needs_follow_up === true ? 'pending' : 'ok',
      routing_intent: intent,
      message: followUp.needs_follow_up === true
        ? 'Deep research is waiting on one blocking follow-up answer.'
        : 'No blocking follow-up is needed.',
      meta: {
        step: 2,
        title: 'Follow-up check'
      }
    });

    if (followUp.needs_follow_up === true) {
      return buildNeedsMoreInfoResult({
        intent,
        routing,
        question: followUp.question,
        reason: followUp.reason,
        intermediateStates
      }, {
        applyResponseLayerToOutput,
        applyValidationGateToOutput
      });
    }

    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_started',
      status: 'started',
      routing_intent: intent,
      message: 'Drafting the structured research plan.',
      meta: {
        step: 3,
        title: 'Research plan'
      }
    });
    const researchPlan = await runStep3DraftResearchPlan({
      ...input,
      intent,
      parserPayload,
      routing,
      project,
      clarifyResult: researchObjective,
      policy,
      toolScope: typeof toolProvider?.resolveEntryToolNames === 'function'
        ? toolProvider.resolveEntryToolNames({
          entryPoint: 'deep_research_entry',
          intent
        })
        : asArray(policy.tool_scope)
    }, runtimeDeps);
    intermediateStates.push(buildIntermediateState('step_3_plan', 'Drafted the structured research plan.', researchPlan));
    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_completed',
      status: 'ok',
      routing_intent: intent,
      message: 'Research plan drafted.',
      meta: {
        step: 3,
        title: 'Research plan',
        section_count: asArray(researchPlan?.answer_sections).length
      }
    });
    const requestedToolNames = Array.isArray(researchPlan?.possible_tools_or_sources) && researchPlan.possible_tools_or_sources.length
      ? asArray(researchPlan.possible_tools_or_sources)
      : null;

    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_started',
      status: 'started',
      routing_intent: intent,
      message: 'Executing the research plan and gathering evidence.',
      meta: {
        step: 4,
        title: 'Execute plan'
      }
    });
    const executionResult = await runStep4ExecutePlan({
      ...input,
      intent,
      parserPayload,
      routing,
      project,
      policy,
      researchObjective,
      researchPlan,
      toolDefinitions: typeof toolProvider?.provideToolDefinitions === 'function'
        ? toolProvider.provideToolDefinitions({
          entryPoint: 'deep_research_entry',
          intent,
          requestedToolNames
        })
        : [],
      toolProvider,
      createContextControlState,
      recordSectionBuffer,
      updateContextControlState,
      buildContextControlSnapshot,
      createAccuracyPreservationState,
      updateAccuracyPreservationState,
      buildAccuracyPreservationSnapshot,
      shouldDelegateSubAgent,
      buildSubAgentInstruction,
      runCompletionCheck
    }, runtimeDeps);
    intermediateStates.push(...asArray(executionResult.intermediate_states));
    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_completed',
      status: executionResult.completion_check?.satisfied === true ? 'ok' : 'pending',
      routing_intent: intent,
      message: executionResult.completion_check?.satisfied === true
        ? 'Research plan execution gathered enough evidence.'
        : 'Research plan execution completed with remaining gaps.',
      meta: {
        step: 4,
        title: 'Execute plan',
        rounds_executed: Number(executionResult.rounds_executed) || 0,
        citation_count: asArray(executionResult.citations).length
      }
    });

    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_started',
      status: 'started',
      routing_intent: intent,
      message: 'Drafting the final answer from the gathered evidence.',
      meta: {
        step: 5,
        title: 'Assemble answer'
      }
    });
    const synthesisResult = await runStep5AssembleFinalAnswer({
      ...input,
      intent,
      parserPayload,
      routing,
      project,
      policy,
      researchObjective,
      researchPlan,
      executionResult,
      buildDefaultAnswerOutline,
      mapEvidenceToOutlineSections,
      validateSynthesisSections
    }, runtimeDeps);
    intermediateStates.push(buildIntermediateState('step_5_assemble', 'Assembled the final answer using outline-first synthesis.', {
      outline: synthesisResult.answer_outline,
      validation: synthesisResult.synthesis_validation
    }));
    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_step_completed',
      status: 'ok',
      routing_intent: intent,
      message: 'Final deep research answer drafted.',
      meta: {
        step: 5,
        title: 'Assemble answer'
      }
    });

    const citations = normalizeCitations(executionResult.citations, 20);
    const partial = !(executionResult.completion_check?.satisfied === true);
    const synthesizedDecisionRecord = normalizeDecisionRecord(synthesisResult.decision_record, {
      assumptions: [
        `${intent} used the deep research pipeline.`,
        `Planned sections: ${asArray(researchPlan.answer_sections).join(', ')}.`
      ],
      open_questions: asArray(executionResult.completion_check?.missing_requirements),
      verification_notes: [
        partial
          ? 'Returned a best-effort synthesis with remaining gaps.'
          : 'Completion checker marked the evidence sufficient before final synthesis.',
        `Rounds executed: ${Number(executionResult.rounds_executed) || 0}.`
      ]
    });

    const responseLayer = applyResponseLayerToOutput({
      normalized: {
        answer: cleanText(synthesisResult.answer, 12000),
        confidence: clamp(synthesisResult.confidence, 0, 1),
        citations,
        decisionRecord: synthesizedDecisionRecord
      },
      routing,
      notebookDraft: null,
      toolTrace: executionResult.tool_trace
    });
    const validated = applyValidationGateToOutput({
      routing,
      normalized: responseLayer,
      notebookDraft: null,
      toolTrace: executionResult.tool_trace
    });

    recordLifecycleEvent(input.lifecycleRecorder, {
      stage: 'deep_research_completed',
      status: partial ? 'pending' : 'ok',
      routing_intent: intent,
      message: partial
        ? 'Deep research completed with remaining gaps.'
        : 'Deep research completed successfully.',
      meta: {
        rounds_executed: Number(executionResult.rounds_executed) || 0,
        citation_count: citations.length
      }
    });

    return {
      status: partial ? 'partial' : 'completed',
      answer: cleanText(validated.normalized.answer, 12000),
      confidence: Number.isFinite(Number(validated.normalized.confidence))
        ? Number(validated.normalized.confidence)
        : clamp(synthesisResult.confidence, 0, 1),
      citations,
      decision_record: validated.normalized.decisionRecord || synthesizedDecisionRecord,
      response_type: cleanText(validated.normalized.response_type, 80),
      confidence_label: cleanText(validated.normalized.confidence_label, 40),
      source_summary: validated.normalized.source_summary && typeof validated.normalized.source_summary === 'object'
        ? validated.normalized.source_summary
        : { total_sources: citations.length, groups: [] },
      unresolved_fields: asArray(validated.normalized.unresolved_fields).map((item) => cleanText(item, 180)).filter(Boolean),
      validation: validated.validation,
      provenance: validated.provenance,
      tool_trace: executionResult.tool_trace,
      intermediate_states: intermediateStates,
      rounds_executed: Number(executionResult.rounds_executed) || 0,
      follow_up_questions: uniqueStrings([
        ...asArray(synthesisResult.follow_up_questions),
        ...asArray(executionResult.completion_check?.missing_requirements).map((item) => {
          const clean = cleanText(item, 220);
          return clean ? `Would you like me to resolve: ${clean}?` : '';
        })
      ], 6),
      execution_mode: 'deep_research',
      research_objective: researchObjective,
      research_plan: researchPlan,
      answer_outline: synthesisResult.answer_outline,
      rendered_sections: synthesisResult.rendered_sections,
      completion_checks: executionResult.completion_checks,
      context_snapshot: executionResult.context_snapshot,
      accuracy_snapshot: executionResult.accuracy_snapshot
    };
  }

  async function runGeneralScienceQuestion(input = {}) {
    return runDeepResearchIntent({
      ...input,
      intent: 'general_science_question'
    });
  }

  async function runProjectScienceQuestion(input = {}) {
    return runDeepResearchIntent({
      ...input,
      intent: 'project_science_question'
    });
  }

  async function runResultAnalysis(input = {}) {
    return runDeepResearchIntent({
      ...input,
      intent: 'result_analysis'
    });
  }

  return {
    DEEP_RESEARCH_INTENTS,
    DEEP_RESEARCH_POLICIES,
    getIntentPolicy,
    runDeepResearchIntent,
    runGeneralScienceQuestion,
    runProjectScienceQuestion,
    runResultAnalysis
  };
}

module.exports = {
  DEEP_RESEARCH_INTENTS,
  DEEP_RESEARCH_POLICIES,
  createDeepResearchRuntime
};
