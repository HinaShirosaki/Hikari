'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');
const { createAgentSubAgentRuntime } = require('../../tools/agent-sub-agent.js');
const {
  SCIENCE_LOOP_CURRENT_SCIENTIFIC_STATE_SCHEMA,
  createScienceLoopCurrentScientificStateRuntime
} = require('./current-scientific-state.js');
const {
  SCIENCE_LOOP_PRE_SYNTHESIZED_QUESTION_SCHEMA,
  createScienceLoopPreSynthesizedQuestionRuntime
} = require('./pre-synthesized-question.js');

const SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA = {
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

function createScienceLoopExitJudgeRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);
  const judgeWithOverride = typeof deps.judgeScienceLoopExit === 'function'
    ? deps.judgeScienceLoopExit
    : null;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const preSynthesizedQuestionRuntime = createScienceLoopPreSynthesizedQuestionRuntime(deps);
  const {
    buildFallbackPreSynthesizedQuestion,
    normalizePreSynthesizedQuestion,
    buildPreSynthesizedQuestion
  } = preSynthesizedQuestionRuntime;
  const currentScientificStateRuntime = createScienceLoopCurrentScientificStateRuntime(deps);
  const {
    buildFallbackCurrentScientificState,
    normalizeCurrentScientificState,
    buildCurrentScientificStatePrompt,
    buildCurrentScientificState
  } = currentScientificStateRuntime;

  function messageRequestsRecentSources(message) {
    return /\b(latest|recent|current|today|newest|papers|references|citations|study|studies|findings)\b/i
      .test(String(message || ''));
  }

  function messageRequestsComputation(message) {
    return /\b(fit|curve|transform|quantif|outlier|calculate|compute|regression|normalize|analy[sz]e data)\b/i
      .test(String(message || ''));
  }

  function hasExternalCitation(citations) {
    return asArray(citations).some((citation) => {
      const source = cleanText(citation?.source, 120).toLowerCase();
      return ['pubmed', 'crossref', 'europe_pmc', 'uniprot', 'web_source', 'literature-search'].includes(source);
    });
  }

  function hasInternalCitation(citations) {
    return asArray(citations).some((citation) => {
      const source = cleanText(citation?.source, 120).toLowerCase();
      return ['project', 'protocol', 'notebook_entry', 'workflow', 'assay', 'gel_analysis', 'paper', 'python_sandbox', 'python-sandbox', 'record-lookup'].includes(source);
    });
  }

  function hasComputeEvidence(toolTrace) {
    return asArray(toolTrace).some((row) => cleanText(row?.tool_name, 120) === 'python-sandbox' && row?.ok === true);
  }

  function collectBlockingRequirementTexts(exitCriteria = {}) {
    return uniqueStrings([
      ...asArray(exitCriteria.required_evidence),
      ...asArray(exitCriteria.continue_when)
    ], 16);
  }

  function matchesBlockingRequirement(exitCriteria = {}, patterns = []) {
    const rows = collectBlockingRequirementTexts(exitCriteria);
    return rows.some((row) => patterns.some((pattern) => pattern.test(String(row || ''))));
  }

  function requiresExternalCitation(exitCriteria = {}) {
    return matchesBlockingRequirement(exitCriteria, [
      /\bexternal citation\b/i,
      /\bcitation-backed source\b/i,
      /\bexternal source\b/i,
      /\bexternal literature\b/i
    ]);
  }

  function requiresProjectLinkedEvidence(exitCriteria = {}) {
    return matchesBlockingRequirement(exitCriteria, [
      /\binternal project\b/i,
      /\bproject-linked\b/i,
      /\bproject citation\b/i,
      /\binternal evidence\b/i,
      /\bproject record\b/i
    ]);
  }

  function requiresDeterministicComputation(exitCriteria = {}) {
    return matchesBlockingRequirement(exitCriteria, [
      /\bdeterministic computation\b/i,
      /\bpython sandbox\b/i,
      /\bpython-sandbox\b/i,
      /\bcomputation step\b/i,
      /\bquantitative step\b/i
    ]);
  }

  function buildFallbackEvaluation(input = {}) {
    const citations = asArray(input.citations);
    const toolTrace = asArray(input.toolTrace);
    const roundsExecuted = Number(input.roundsExecuted) || 0;
    const maxRounds = Math.max(1, Number(input.maxRounds) || 4);
    const clarifiedInput = cleanText(input.message || input.clarifiedInput || input.originalMessage, 3200);
    const exitCriteria = input.exitCriteria && typeof input.exitCriteria === 'object' ? input.exitCriteria : {};
    const missing = [];
    const hasGroundedEvidence = citations.length > 0 || toolTrace.some((row) => row?.ok === true);

    if (!hasGroundedEvidence) {
      missing.push('The current answer is not yet grounded in completed evidence.');
    }

    if (requiresExternalCitation(exitCriteria) && !hasExternalCitation(citations)) {
      missing.push('At least one external citation-backed source is still missing.');
    }

    if (requiresProjectLinkedEvidence(exitCriteria) && !hasInternalCitation(citations)) {
      missing.push('At least one internal project citation is still missing.');
    }

    if (requiresDeterministicComputation(exitCriteria) && !hasComputeEvidence(toolTrace)) {
      missing.push('A Python sandbox computation step is still required.');
    }

    const preferredTools = asArray(exitCriteria.preferred_next_tools)
      .map((item) => cleanText(item, 120))
      .filter(Boolean);
    const nextTool = preferredTools.find((toolName) => (
      !toolTrace.some((row) => cleanText(row?.tool_name, 120) === toolName && row?.ok === true)
    )) || preferredTools[0] || null;
    const satisfied = missing.length === 0 && hasGroundedEvidence;
    const shouldContinue = satisfied === false && roundsExecuted < maxRounds;

    return {
      satisfied,
      reason: satisfied
        ? 'The exit criteria are satisfied by the current evidence.'
        : (missing[0]
          || (roundsExecuted >= maxRounds
            ? 'The reasoning loop has exhausted its round budget.'
            : 'The current evidence does not satisfy the exit criteria yet.')),
      missing_requirements: uniqueStrings(missing, 8),
      should_continue: shouldContinue,
      next_tool_hint: shouldContinue
        ? {
          tool_name: nextTool,
          query: clarifiedInput || null,
          reason: missing[0] || 'Gather one more targeted evidence step that satisfies the exit criteria.'
        }
        : null,
      can_answer_with_limitations: hasGroundedEvidence
    };
  }

  function normalizeEvaluationPayload(rawPayload, fallback = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const nextToolHint = source.next_tool_hint && typeof source.next_tool_hint === 'object'
      ? {
        tool_name: cleanText(source.next_tool_hint.tool_name, 120) || null,
        query: cleanText(source.next_tool_hint.query, 320) || null,
        reason: cleanText(source.next_tool_hint.reason, 260) || 'More evidence is required.'
      }
      : (fallback.next_tool_hint && typeof fallback.next_tool_hint === 'object'
        ? {
          tool_name: cleanText(fallback.next_tool_hint.tool_name, 120) || null,
          query: cleanText(fallback.next_tool_hint.query, 320) || null,
          reason: cleanText(fallback.next_tool_hint.reason, 260) || 'More evidence is required.'
        }
        : null);
    return {
      satisfied: source.satisfied === true || fallback.satisfied === true,
      reason: cleanText(source.reason, 320) || cleanText(fallback.reason, 320) || 'Exit judgement returned no reason.',
      missing_requirements: uniqueStrings([
        ...asArray(source.missing_requirements),
        ...asArray(fallback.missing_requirements)
      ], 8),
      should_continue: source.should_continue === true || (fallback.should_continue === true && source.satisfied !== true),
      next_tool_hint: nextToolHint,
      can_answer_with_limitations: source.can_answer_with_limitations === true || fallback.can_answer_with_limitations === true
    };
  }

  function buildJudgeSystemPrompt() {
    return [
      'You are a specialized sub-agent that judges whether a science reasoning loop should exit.',
      'A lightweight pre-synthesized question is provided first so you can see the current best answer, supporting basis, and unresolved issues before judging.',
      'A compact current scientific state is provided to summarize what is supported, contradicted, still unknown, and whether the uncertainty is decision-relevant.',
      'Use the provided exit criteria to decide whether the loop already has enough evidence.',
      'Be conservative: continue when a blocking evidence requirement is still missing.',
      'Return JSON only and do not invent evidence.'
    ].join('\n\n');
  }

  function buildJudgeMessage(input = {}) {
    const preSynthesizedQuestion = buildPreSynthesizedQuestion(input);
    return [
      'Judge whether the reasoning loop should stop now or continue.',
      `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
      `Exit criteria JSON:\n${JSON.stringify(input.exitCriteria || {}, null, 2)}`,
      `Pre-synthesized question JSON:\n${JSON.stringify(preSynthesizedQuestion, null, 2)}`,
      input.currentScientificState
        ? `Current scientific state JSON:\n${JSON.stringify(input.currentScientificState, null, 2)}`
        : '',
      input.project ? `Resolved project JSON:\n${JSON.stringify(input.project, null, 2)}` : '',
      input.clarification ? `Clarification JSON:\n${JSON.stringify(input.clarification, null, 2)}` : '',
      `Original user message:\n${cleanText(input.originalMessage, 3200)}`,
      `Clarified request:\n${cleanText(input.message || input.clarifiedInput, 3200)}`,
      `Latest assistant text:\n${cleanText(input.latestAssistantText, 4000) || '-'}`,
      `Latest tool result JSON:\n${JSON.stringify(input.latestToolResult || null, null, 2)}`,
      `Tool trace JSON:\n${JSON.stringify(asArray(input.toolTrace).slice(-8), null, 2)}`,
      `Citations JSON:\n${JSON.stringify(asArray(input.citations).slice(0, 16), null, 2)}`,
      `Rounds executed: ${Number(input.roundsExecuted) || 0}/${Number(input.maxRounds) || 0}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function runJudgeTurn(turnInput = {}, judgeInput = {}) {
    const fallback = buildFallbackEvaluation(judgeInput);
    const preSynthesizedQuestion = normalizePreSynthesizedQuestion(
      judgeInput.preSynthesizedQuestion,
      buildFallbackPreSynthesizedQuestion(judgeInput)
    );
    const currentScientificState = normalizeCurrentScientificState(
      judgeInput.currentScientificState,
      buildFallbackCurrentScientificState({
        ...judgeInput,
        preSynthesizedQuestion
      })
    );
    if (!requestStructuredJsonPayload) {
      return {
        assistant_message: cleanText(fallback.reason, 1200),
        summary: 'Returned deterministic exit-judgement fallback.',
        output: fallback,
        metadata: {
          mode: 'fallback',
          phase: cleanText(turnInput.phase, 40),
          current_scientific_state: currentScientificState,
          pre_synthesized_question: preSynthesizedQuestion
        }
      };
    }

    const result = await requestStructuredJsonPayload({
      provider: cleanText(judgeInput.provider, 80),
      endpoint: cleanText(judgeInput.endpoint, 2000),
      apiKey: cleanText(judgeInput.apiKey, 400),
      model: cleanText(judgeInput.model, 120),
      stage: 'science_loop_exit_judge_sub_agent',
      systemPrompt: cleanText(turnInput.system_prompt, 12000) || buildJudgeSystemPrompt(),
      userPrompt: cleanText(turnInput.message, 48000) || buildJudgeMessage({
        ...judgeInput,
        preSynthesizedQuestion,
        currentScientificState
      }),
      schema: SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA,
      traceContext: judgeInput.traceContext || null,
      maxOutputTokens: 1500,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Science loop exit judge sub-agent is not configured.'
    });

    const normalized = result?.ok && result.payload
      ? normalizeEvaluationPayload(result.payload, fallback)
      : fallback;

    return {
      assistant_message: cleanText(normalized.reason, 1200),
      summary: normalized.satisfied === true
        ? 'Sub-agent judged that the loop can exit.'
        : 'Sub-agent judged that the loop should continue.',
      output: normalized,
      metadata: {
        mode: result?.ok && result.payload ? 'llm' : 'fallback',
        phase: cleanText(turnInput.phase, 40),
        current_scientific_state: currentScientificState,
        pre_synthesized_question: preSynthesizedQuestion
      }
    };
  }

  function normalizeJudgeResult(result, input = {}) {
    const fallback = buildFallbackEvaluation(input);
    const fallbackPreSynthesizedQuestion = buildFallbackPreSynthesizedQuestion(input);
    const fallbackCurrentScientificState = buildFallbackCurrentScientificState({
      ...input,
      preSynthesizedQuestion: input.preSynthesizedQuestion || fallbackPreSynthesizedQuestion
    });
    const source = result && typeof result === 'object' ? result : {};
    const evaluationSource = source.evaluation && typeof source.evaluation === 'object'
      ? source.evaluation
      : (source.output && typeof source.output === 'object' ? source.output : source);
    const preSynthesizedQuestionSource = source.pre_synthesized_question
      && typeof source.pre_synthesized_question === 'object'
      ? source.pre_synthesized_question
      : (source.preSynthesizedQuestion && typeof source.preSynthesizedQuestion === 'object'
        ? source.preSynthesizedQuestion
        : (source.sub_agent?.last_response?.metadata?.pre_synthesized_question
          && typeof source.sub_agent.last_response.metadata.pre_synthesized_question === 'object'
          ? source.sub_agent.last_response.metadata.pre_synthesized_question
          : null));
    const currentScientificStateSource = source.current_scientific_state && typeof source.current_scientific_state === 'object'
      ? source.current_scientific_state
      : (source.currentScientificState && typeof source.currentScientificState === 'object'
        ? source.currentScientificState
        : (source.sub_agent?.last_response?.metadata?.current_scientific_state
          && typeof source.sub_agent.last_response.metadata.current_scientific_state === 'object'
          ? source.sub_agent.last_response.metadata.current_scientific_state
          : null));
    return {
      ok: source.ok !== false,
      status: cleanText(source.status, 80) || 'judged',
      evaluation: normalizeEvaluationPayload(evaluationSource, fallback),
      pre_synthesized_question: normalizePreSynthesizedQuestion(
        preSynthesizedQuestionSource,
        input.preSynthesizedQuestion || fallbackPreSynthesizedQuestion
      ),
      current_scientific_state: normalizeCurrentScientificState(
        currentScientificStateSource,
        fallbackCurrentScientificState
      ),
      sub_agent: source.sub_agent && typeof source.sub_agent === 'object'
        ? source.sub_agent
        : (source.agent && typeof source.agent === 'object' ? source.agent : null),
      summary: cleanText(source.summary, 320)
    };
  }

  async function judgeExit(input = {}) {
    if (judgeWithOverride) {
      const overridden = await judgeWithOverride(input);
      return normalizeJudgeResult(overridden, input);
    }

    const preSynthesizedQuestion = buildPreSynthesizedQuestion(input);
    const currentScientificState = await buildCurrentScientificState({
      ...input,
      preSynthesizedQuestion
    });
    const judgeInputWithState = {
      ...input,
      preSynthesizedQuestion,
      currentScientificState
    };
    const subAgentRuntime = createAgentSubAgentRuntime({
      now,
      runSubAgentTurn: async (turnInput = {}) => runJudgeTurn(turnInput, judgeInputWithState)
    });
    const created = await subAgentRuntime.createSubAgent({
      name: `science-loop-exit-judge-${Date.now()}`,
      system_prompt: buildJudgeSystemPrompt(),
      message: buildJudgeMessage(judgeInputWithState),
      metadata: {
        task_type: 'science-loop-exit-judge',
        tags: ['science', 'reasoning-loop', 'exit-judge']
      }
    });
    return normalizeJudgeResult({
      ok: created?.ok !== false,
      status: created?.status || 'judged',
      evaluation: created?.agent?.last_response?.output,
      pre_synthesized_question: preSynthesizedQuestion,
      current_scientific_state: currentScientificState,
      sub_agent: created?.agent || null,
      summary: created?.summary
    }, input);
  }

  return {
    SCIENCE_LOOP_PRE_SYNTHESIZED_QUESTION_SCHEMA,
    buildFallbackPreSynthesizedQuestion,
    SCIENCE_LOOP_CURRENT_SCIENTIFIC_STATE_SCHEMA,
    buildFallbackCurrentScientificState,
    SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA,
    buildFallbackEvaluation,
    buildCurrentScientificStatePrompt,
    buildJudgeMessage,
    buildCurrentScientificState,
    judgeExit
  };
}

module.exports = {
  SCIENCE_LOOP_PRE_SYNTHESIZED_QUESTION_SCHEMA,
  SCIENCE_LOOP_CURRENT_SCIENTIFIC_STATE_SCHEMA,
  SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA,
  createScienceLoopExitJudgeRuntime
};
