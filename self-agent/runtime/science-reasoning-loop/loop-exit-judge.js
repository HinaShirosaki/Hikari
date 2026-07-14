'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/lib/llm/runtime-helpers.js');
const { createAgentSubAgentRuntime } = require('../../../src/main/helpers/agent/tools/agent-sub-agent.js');
const {
  SCIENCE_LOOP_PRE_SYNTHESIZED_ANSWER_SCHEMA,
  createScienceLoopPreSynthesizedAnswerRuntime
} = require('./pre-synthesized-answer.js');
const {
  buildLogicalVerificationSection,
  getUnstableScienceInferenceChecks,
  formatScienceInferenceStabilityIssue
} = require('./logical-verification.js');

const SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'satisfied',
    'reason',
    'missing_requirements',
    'should_continue',
    'next_tool_hint',
    'can_answer_with_limitations',
    'trace_sentence'
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
    can_answer_with_limitations: { type: 'boolean' },
    trace_sentence: { type: 'string' }
  }
};

const LOOP_EXIT_JUDGE_CONTEXT_LIMIT = 20;

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
  const preSynthesizedAnswerRuntime = createScienceLoopPreSynthesizedAnswerRuntime(deps);
  const {
    buildFallbackPreSynthesizedAnswer,
    normalizePreSynthesizedAnswer,
    buildPreSynthesizedAnswer
  } = preSynthesizedAnswerRuntime;


  function collectCriteriaEvaluationContext(input = {}, preSynthesizedAnswer = null) {
    const normalizedPreSynthesizedAnswer = normalizePreSynthesizedAnswer(
      preSynthesizedAnswer || input.preSynthesizedAnswer,
      buildFallbackPreSynthesizedAnswer(input)
    );
    const latestToolResult = input.latestToolResult && typeof input.latestToolResult === 'object'
      ? input.latestToolResult
      : {};
    const toolTrace = asArray(input.toolTrace);
    const citations = [
      ...asArray(latestToolResult?.citations),
      ...asArray(latestToolResult?.result?.citations),
      ...asArray(input.citations)
    ];
    const loadedContextBlocks = [
      ...asArray(latestToolResult?.loaded_context_blocks),
      ...asArray(latestToolResult?.result?.loaded_context_blocks),
      ...toolTrace.flatMap((row) => asArray(row?.loaded_context_blocks))
    ];
    const evidenceTexts = uniqueStrings([
      normalizedPreSynthesizedAnswer?.tentative_answer?.current_best_answer,
      ...asArray(normalizedPreSynthesizedAnswer?.supporting_basis),
      cleanText(input.latestAssistantText, 1200),
      cleanText(latestToolResult?.summary || latestToolResult?.result?.summary, 320),
      ...loadedContextBlocks.map((block) => [
        cleanText(block?.paper_title, 160),
        cleanText(block?.section_label, 80),
        cleanText(block?.excerpt, 260),
        cleanText(block?.relevance_reason, 180)
      ].filter(Boolean).join(' - ')),
      ...toolTrace.map((row) => [
        cleanText(row?.tool_name, 120),
        cleanText(row?.summary, 220),
        cleanText(row?.assistant_after_tool, 320)
      ].filter(Boolean).join(': ')),
      ...citations.map((citation) => [
        cleanText(citation?.source, 120),
        cleanText(citation?.pointer, 220),
        cleanText(citation?.reason, 220)
      ].filter(Boolean).join(': '))
    ], 24);
    const gapTexts = uniqueStrings([
      ...asArray(normalizedPreSynthesizedAnswer?.unresolved_issues),
      latestToolResult && latestToolResult.ok === false
        ? cleanText(latestToolResult?.error || latestToolResult?.result?.error, 320)
        : '',
      ...toolTrace.filter((row) => row?.ok === false).map((row) => [
        cleanText(row?.tool_name, 120),
        cleanText(row?.error, 220),
        cleanText(row?.summary, 220)
      ].filter(Boolean).join(': '))
    ], 24);
    const hasSuccessfulToolStep = toolTrace.some((row) => row?.ok === true);
    const hasGroundedEvidence = evidenceTexts.length > 0
      && (
        citations.length > 0
        || hasSuccessfulToolStep
      );
    const answerText = cleanText(normalizedPreSynthesizedAnswer?.tentative_answer?.current_best_answer, 1200);
    const hasTentativeAnswer = Boolean(answerText)
      && !/^no grounded tentative answer is available yet\.?$/i.test(answerText);

    return {
      preSynthesizedAnswer: normalizedPreSynthesizedAnswer,
      evidenceTexts,
      gapTexts,
      hasGroundedEvidence,
      hasSuccessfulToolStep,
      hasTentativeAnswer
    };
  }

  function matchesTexts(targetText, texts) {
    const target = String(targetText || '').toLowerCase().trim();
    if (!target) {
      return false;
    }
    return asArray(texts).some((text) => {
      const candidate = String(text || '').toLowerCase().trim();
      if (!candidate) {
        return false;
      }
      return candidate.includes(target) || target.includes(candidate);
    });
  }

  function hasSubstantiveOverlap(leftText, rightText) {
    const stopwords = new Set([
      'about', 'after', 'again', 'answer', 'because', 'before', 'being', 'between',
      'could', 'evidence', 'explicitly', 'from', 'into', 'remaining', 'should',
      'source', 'stated', 'still', 'synthesized', 'that', 'their', 'there',
      'these', 'this', 'when', 'where', 'with'
    ]);
    const tokenize = (text) => String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !stopwords.has(token));
    const leftTokens = new Set(tokenize(leftText));
    const rightTokens = new Set(tokenize(rightText));
    if (!leftTokens.size || !rightTokens.size) {
      return false;
    }
    const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens;
    const larger = leftTokens.size <= rightTokens.size ? rightTokens : leftTokens;
    let overlap = 0;
    smaller.forEach((token) => {
      if (larger.has(token)) {
        overlap += 1;
      }
    });
    return overlap >= 3 && overlap / smaller.size >= 0.5;
  }

  function criterionIsSatisfied(criterion, context) {
    const criterionText = cleanText(criterion, 220);
    if (!criterionText) {
      return true;
    }
    if (/\bevidence[-\s]?gathering round\b/i.test(criterionText)) {
      return context.hasSuccessfulToolStep;
    }
    if (/\bgrounded\b/i.test(criterionText) && /\banswer|evidence\b/i.test(criterionText)) {
      return context.hasGroundedEvidence && context.hasTentativeAnswer;
    }
    return matchesTexts(criterionText, context.evidenceTexts);
  }

  function continueConditionIsActive(condition, context) {
    const conditionText = cleanText(condition, 220);
    if (!conditionText) {
      return false;
    }
    if (!context.hasGroundedEvidence && /\bgrounded\b|\bevidence gap\b|\bmissing evidence\b/i.test(conditionText)) {
      return true;
    }
    return matchesTexts(conditionText, context.gapTexts);
  }

  function limitationRuleIsSatisfied(rule, context) {
    const ruleText = cleanText(rule, 220);
    if (!ruleText) {
      return false;
    }
    if (matchesTexts(ruleText, [
      ...context.evidenceTexts,
      ...context.gapTexts
    ])) {
      return true;
    }
    if (/\bexplicit|state|noted|disclose/i.test(ruleText)
      && /\buncertaint|limitation|missing|gap/i.test(ruleText)) {
      const answerText = cleanText(
        context.preSynthesizedAnswer?.tentative_answer?.current_best_answer,
        1200
      );
      if (!answerText) {
        return false;
      }
      return context.gapTexts.some((gap) => (
        matchesTexts(gap, [answerText])
        || hasSubstantiveOverlap(gap, answerText)
      ));
    }
    return false;
  }

  function buildFallbackEvaluation(input = {}) {
    const context = collectCriteriaEvaluationContext(input, input.preSynthesizedAnswer);
    const roundsExecuted = Number(input.roundsExecuted) || 0;
    const maxRounds = Math.max(1, Number(input.maxRounds) || 8);
    const clarifiedInput = cleanText(input.message || input.clarifiedInput || input.originalMessage, 3200);
    const exitCriteria = input.exitCriteria && typeof input.exitCriteria === 'object' ? input.exitCriteria : {};
    const unstableInferenceChecks = getUnstableScienceInferenceChecks(
      context.preSynthesizedAnswer?.logical_verification,
      { asArray, cleanText, uniqueStrings }
    );
    const missing = [];

    if (!context.hasGroundedEvidence) {
      missing.push('The pre-synthesized answer is not grounded in completed evidence yet.');
    } else if (!context.hasTentativeAnswer) {
      missing.push('The pre-synthesized answer is still too incomplete to judge against the exit criteria.');
    }

    asArray(exitCriteria.required_evidence).forEach((criterion) => {
      const criterionText = cleanText(criterion, 220);
      if (!criterionText || criterionIsSatisfied(criterionText, context)) {
        return;
      }
      missing.push(criterionText);
    });

    asArray(exitCriteria.exit_conditions).forEach((criterion) => {
      const criterionText = cleanText(criterion, 220);
      if (!criterionText || criterionIsSatisfied(criterionText, context)) {
        return;
      }
      missing.push(criterionText);
    });

    asArray(exitCriteria.continue_when).forEach((condition) => {
      const conditionText = cleanText(condition, 220);
      if (!conditionText || !continueConditionIsActive(conditionText, context)) {
        return;
      }
      missing.push(conditionText);
    });
    unstableInferenceChecks.forEach((row) => {
      missing.push(formatScienceInferenceStabilityIssue(row, { asArray, cleanText, uniqueStrings }));
    });

    const toolTrace = asArray(input.toolTrace);
    const limitationRules = asArray(exitCriteria.can_exit_with_limitations_when)
      .map((item) => cleanText(item, 220))
      .filter(Boolean);
    const satisfied = missing.length === 0 && context.hasGroundedEvidence && context.hasTentativeAnswer;
    const shouldContinue = satisfied === false && roundsExecuted < maxRounds;
    const canAnswerWithLimitations = unstableInferenceChecks.length === 0 && context.hasGroundedEvidence && (
      satisfied
      || limitationRules.some((rule) => limitationRuleIsSatisfied(rule, context))
      || (roundsExecuted >= maxRounds && limitationRules.length > 0)
    );

    return {
      satisfied,
      reason: satisfied
        ? 'The pre-synthesized answer satisfies the current exit criteria.'
        : (missing[0]
          || (roundsExecuted >= maxRounds
            ? 'The reasoning loop has exhausted its round budget.'
            : 'The current evidence does not satisfy the exit criteria yet.')),
      missing_requirements: uniqueStrings(missing, 8),
      should_continue: shouldContinue,
      next_tool_hint: shouldContinue
        ? {
          tool_name: null,
          query: clarifiedInput || null,
          reason: missing[0] || 'Gather one more targeted evidence step that satisfies the exit criteria.'
        }
        : null,
      can_answer_with_limitations: canAnswerWithLimitations,
      trace_sentence: satisfied
        ? 'I am confirming that the current evidence is sufficient for the loop to stop.'
        : 'I am checking whether the current evidence is sufficient or whether a blocking gap remains.'
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
      can_answer_with_limitations: source.can_answer_with_limitations === true || fallback.can_answer_with_limitations === true,
      trace_sentence: cleanText(source.trace_sentence, 240)
        || cleanText(fallback.trace_sentence, 240)
        || 'I am judging whether the reasoning loop has enough evidence to stop.'
    };
  }

  function buildCompactList(title, values, max = 4) {
    const rows = uniqueStrings(asArray(values), max)
      .map((item) => cleanText(item, 260))
      .filter(Boolean);
    if (!rows.length) {
      return '';
    }
    return `${title}:\n${rows.map((item) => `- ${item}`).join('\n')}`;
  }

  function buildExitCriteriaSection(exitCriteria = {}) {
    const source = exitCriteria && typeof exitCriteria === 'object' ? exitCriteria : {};
    return [
      'Exit criteria:',
      cleanText(source.objective_summary, 320) ? `Objective: ${cleanText(source.objective_summary, 320)}` : '',
      buildCompactList('Exit conditions', source.exit_conditions, 4),
      buildCompactList('Required evidence', source.required_evidence, 4),
      buildCompactList('Continue when', source.continue_when, 4),
      buildCompactList('Can exit with limitations when', source.can_exit_with_limitations_when, 3),
      uniqueStrings(source.preferred_next_tools, 3).length
        ? `Preferred next tools: ${uniqueStrings(source.preferred_next_tools, 3).join(' | ')}`
        : ''
    ].filter(Boolean).join('\n');
  }

  function buildPreSynthesizedAnswerSection(answer = {}) {
    const source = answer && typeof answer === 'object' ? answer : {};
    return [
      'Pre-synthesized answer:',
      cleanText(source?.tentative_answer?.current_best_answer, 600)
        ? `Current best answer: ${cleanText(source.tentative_answer.current_best_answer, 600)}`
        : '',
      buildCompactList('Supporting basis', asArray(source.supporting_basis).slice(-LOOP_EXIT_JUDGE_CONTEXT_LIMIT), LOOP_EXIT_JUDGE_CONTEXT_LIMIT),
      buildCompactList('Unresolved issues', source.unresolved_issues, 8),
      buildLogicalVerificationSection(source.logical_verification, { asArray, cleanText, uniqueStrings })
    ].filter(Boolean).join('\n');
  }

  function buildLoadedContextSection(blocks = []) {
    const rows = uniqueStrings(
      asArray(blocks)
        .slice(-LOOP_EXIT_JUDGE_CONTEXT_LIMIT)
        .map((block) => {
          const paperTitle = cleanText(block?.paper_title, 160);
          const sectionLabel = cleanText(block?.section_label, 80);
          const excerpt = cleanText(block?.excerpt, 180);
          const reason = cleanText(block?.relevance_reason, 180);
          return [[paperTitle, sectionLabel].filter(Boolean).join(' | '), excerpt, reason].filter(Boolean).join(' - ');
        }),
      LOOP_EXIT_JUDGE_CONTEXT_LIMIT
    );
    if (!rows.length) {
      return '';
    }
    return `Loaded context blocks:\n${rows.map((item) => `- ${item}`).join('\n')}`;
  }

  function buildJudgeSystemPrompt() {
    return [
      'You are a specialized sub-agent that judges whether a science reasoning loop should exit.',
      'A lightweight pre-synthesized answer is provided so you can see the current best answer, supporting basis, and unresolved issues before judging.',
      'Judge the pre-synthesized answer only against the provided exit criteria and clarified request.',
      'Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.',
      'Judge sufficiency, not perfection: stop when the evidence supports the main answer and remaining gaps can be stated as caveats without changing the conclusion.',
      'Continue only when a missing requirement is truly blocking for the clarified request.',
      'Do not require exhaustive literature coverage, every selected paper to be fully read, or extra citations unless the exit criteria explicitly require them.',
      'For stable general science, citation-backed anchors plus well-established background knowledge can be enough; project facts still require project/tool evidence.',
      'Return JSON only and do not invent evidence.'
    ].join('\n\n');
  }

  function buildJudgeMessage(input = {}) {
    const preSynthesizedAnswer = buildPreSynthesizedAnswer(input);
    const clarifiedRequest = cleanText(input.message || input.clarifiedInput || input.originalMessage, 3200);
    return [
      'Judge whether the reasoning loop should stop now or continue.',
      'Include trace_sentence as one short sentence describing what you are doing at this step.',
      `Clarified request:\n${clarifiedRequest}`,
      buildExitCriteriaSection(input.exitCriteria),
      buildPreSynthesizedAnswerSection(preSynthesizedAnswer),
      buildLoadedContextSection([
        ...asArray(input.latestToolResult?.loaded_context_blocks),
        ...asArray(input.latestToolResult?.result?.loaded_context_blocks),
        ...asArray(input.toolTrace).flatMap((row) => asArray(row?.loaded_context_blocks))
      ]),
      `Rounds executed: ${Number(input.roundsExecuted) || 0}/${Number(input.maxRounds) || 0}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function runJudgeTurn(turnInput = {}, judgeInput = {}) {
    const fallback = buildFallbackEvaluation(judgeInput);
    const preSynthesizedAnswer = normalizePreSynthesizedAnswer(
      judgeInput.preSynthesizedAnswer,
      buildFallbackPreSynthesizedAnswer(judgeInput)
    );
    if (!requestStructuredJsonPayload) {
      return {
        assistant_message: cleanText(fallback.reason, 1200),
        summary: 'Returned deterministic exit-judgement fallback.',
        output: fallback,
        metadata: {
          mode: 'fallback',
          phase: cleanText(turnInput.phase, 40),
          pre_synthesized_answer: preSynthesizedAnswer
        }
      };
    }

    const result = await requestStructuredJsonPayload({
      source: judgeInput,
      stage: 'science_loop_exit_judge_sub_agent',
      systemPrompt: cleanText(turnInput.system_prompt, 12000) || buildJudgeSystemPrompt(),
      userPrompt: cleanText(turnInput.message, 48000) || buildJudgeMessage({
        ...judgeInput,
        preSynthesizedAnswer
      }),
      schema: SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA,
      traceContext: judgeInput.traceContext || null,
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
        pre_synthesized_answer: preSynthesizedAnswer
      }
    };
  }

  function normalizeJudgeResult(result, input = {}) {
    const fallback = buildFallbackEvaluation(input);
    const fallbackPreSynthesizedAnswer = buildFallbackPreSynthesizedAnswer(input);
    const source = result && typeof result === 'object' ? result : {};
    const evaluationSource = source.evaluation && typeof source.evaluation === 'object'
      ? source.evaluation
      : (source.output && typeof source.output === 'object' ? source.output : source);
    const preSynthesizedAnswerSource = source.pre_synthesized_answer
      && typeof source.pre_synthesized_answer === 'object'
      ? source.pre_synthesized_answer
      : (source.preSynthesizedAnswer && typeof source.preSynthesizedAnswer === 'object'
        ? source.preSynthesizedAnswer
        : (source.sub_agent?.last_response?.metadata?.pre_synthesized_answer
          && typeof source.sub_agent.last_response.metadata.pre_synthesized_answer === 'object'
          ? source.sub_agent.last_response.metadata.pre_synthesized_answer
          : null));
    return {
      ok: source.ok !== false,
      status: cleanText(source.status, 80) || 'judged',
      evaluation: normalizeEvaluationPayload(evaluationSource, fallback),
      pre_synthesized_answer: normalizePreSynthesizedAnswer(
        preSynthesizedAnswerSource,
        input.preSynthesizedAnswer || fallbackPreSynthesizedAnswer
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

    const preSynthesizedAnswer = buildPreSynthesizedAnswer(input);
    const judgeInputWithAnswer = {
      ...input,
      preSynthesizedAnswer
    };
    const subAgentRuntime = createAgentSubAgentRuntime({
      now,
      runSubAgentTurn: async (turnInput = {}) => runJudgeTurn(turnInput, judgeInputWithAnswer)
    });
    const created = await subAgentRuntime.createSubAgent({
      name: `science-loop-exit-judge-${Date.now()}`,
      system_prompt: buildJudgeSystemPrompt(),
      message: buildJudgeMessage(judgeInputWithAnswer),
      metadata: {
        task_type: 'science-loop-exit-judge',
        tags: ['science', 'reasoning-loop', 'exit-judge']
      }
    });
    return normalizeJudgeResult({
      ok: created?.ok !== false,
      status: created?.status || 'judged',
      evaluation: created?.agent?.last_response?.output,
      pre_synthesized_answer: preSynthesizedAnswer,
      sub_agent: created?.agent || null,
      summary: created?.summary
    }, input);
  }

  return {
    SCIENCE_LOOP_PRE_SYNTHESIZED_ANSWER_SCHEMA,
    buildFallbackPreSynthesizedAnswer,
    SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA,
    buildFallbackEvaluation,
    buildJudgeSystemPrompt,
    buildJudgeMessage,
    judgeExit
  };
}

module.exports = {
  SCIENCE_LOOP_PRE_SYNTHESIZED_ANSWER_SCHEMA,
  SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA,
  createScienceLoopExitJudgeRuntime
};
