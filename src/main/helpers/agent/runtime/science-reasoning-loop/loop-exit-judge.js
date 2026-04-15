'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');
const { createAgentSubAgentRuntime } = require('../../tools/agent-sub-agent.js');
const {
  SCIENCE_LOOP_PRE_SYNTHESIZED_QUESTION_SCHEMA,
  createScienceLoopPreSynthesizedQuestionRuntime
} = require('./pre-synthesized-question.js');
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

  const MATCH_STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'by', 'for', 'from', 'has', 'have',
    'if', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'then',
    'there', 'these', 'this', 'to', 'when', 'with'
  ]);

  function normalizeForMatching(value, maxLength = 400) {
    return cleanText(value, maxLength)
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenizeForMatching(value, maxLength = 400) {
    return normalizeForMatching(value, maxLength)
      .split(' ')
      .filter((token) => token.length > 2 && !MATCH_STOP_WORDS.has(token));
  }

  function collectCriteriaEvaluationContext(input = {}, preSynthesizedQuestion = null) {
    const normalizedPreSynthesizedQuestion = normalizePreSynthesizedQuestion(
      preSynthesizedQuestion || input.preSynthesizedQuestion,
      buildFallbackPreSynthesizedQuestion(input)
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
      normalizedPreSynthesizedQuestion?.tentative_answer?.current_best_answer,
      ...asArray(normalizedPreSynthesizedQuestion?.supporting_basis),
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
      ...asArray(normalizedPreSynthesizedQuestion?.unresolved_issues),
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
    const answerText = cleanText(normalizedPreSynthesizedQuestion?.tentative_answer?.current_best_answer, 1200);
    const hasTentativeAnswer = Boolean(answerText)
      && !/^no grounded tentative answer is available yet\.?$/i.test(answerText);

    return {
      preSynthesizedQuestion: normalizedPreSynthesizedQuestion,
      evidenceTexts,
      gapTexts,
      hasGroundedEvidence,
      hasSuccessfulToolStep,
      hasTentativeAnswer
    };
  }

  function matchesTexts(targetText, texts) {
    const normalizedTarget = normalizeForMatching(targetText);
    if (!normalizedTarget) {
      return false;
    }
    const targetTokens = tokenizeForMatching(targetText);
    return asArray(texts).some((text) => {
      const normalizedText = normalizeForMatching(text);
      if (!normalizedText) {
        return false;
      }
      if (normalizedText.includes(normalizedTarget) || normalizedTarget.includes(normalizedText)) {
        return true;
      }
      const textTokens = new Set(tokenizeForMatching(text));
      if (!targetTokens.length || !textTokens.size) {
        return false;
      }
      let overlap = 0;
      targetTokens.forEach((token) => {
        if (textTokens.has(token)) {
          overlap += 1;
        }
      });
      const minimumOverlap = targetTokens.length >= 5
        ? 3
        : Math.min(2, targetTokens.length);
      return overlap >= minimumOverlap
        || (targetTokens.length >= 4 && overlap / targetTokens.length >= 0.6);
    });
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
        context.preSynthesizedQuestion?.tentative_answer?.current_best_answer,
        1200
      );
      if (!answerText) {
        return false;
      }
      return context.gapTexts.some((gap) => matchesTexts(gap, [answerText]));
    }
    return false;
  }

  function buildFallbackEvaluation(input = {}) {
    const context = collectCriteriaEvaluationContext(input, input.preSynthesizedQuestion);
    const roundsExecuted = Number(input.roundsExecuted) || 0;
    const maxRounds = Math.max(1, Number(input.maxRounds) || 4);
    const clarifiedInput = cleanText(input.message || input.clarifiedInput || input.originalMessage, 3200);
    const exitCriteria = input.exitCriteria && typeof input.exitCriteria === 'object' ? input.exitCriteria : {};
    const unstableInferenceChecks = getUnstableScienceInferenceChecks(
      context.preSynthesizedQuestion?.logical_verification,
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

  function buildPreSynthesizedQuestionSection(question = {}) {
    const source = question && typeof question === 'object' ? question : {};
    return [
      'Pre-synthesized question:',
      cleanText(source?.tentative_answer?.current_best_answer, 600)
        ? `Current best answer: ${cleanText(source.tentative_answer.current_best_answer, 600)}`
        : '',
      buildCompactList('Supporting basis', source.supporting_basis, 4),
      buildCompactList('Unresolved issues', source.unresolved_issues, 4),
      buildLogicalVerificationSection(source.logical_verification, { asArray, cleanText, uniqueStrings })
    ].filter(Boolean).join('\n');
  }

  function buildLoadedContextSection(blocks = []) {
    const rows = uniqueStrings(asArray(blocks).map((block) => {
      const paperTitle = cleanText(block?.paper_title, 160);
      const sectionLabel = cleanText(block?.section_label, 80);
      const excerpt = cleanText(block?.excerpt, 180);
      const reason = cleanText(block?.relevance_reason, 180);
      return [[paperTitle, sectionLabel].filter(Boolean).join(' | '), excerpt, reason].filter(Boolean).join(' - ');
    }), 4);
    if (!rows.length) {
      return '';
    }
    return `Loaded context blocks:\n${rows.map((item) => `- ${item}`).join('\n')}`;
  }

  function buildJudgeSystemPrompt() {
    return [
      'You are a specialized sub-agent that judges whether a science reasoning loop should exit.',
      'A lightweight pre-synthesized question is provided so you can see the current best answer, supporting basis, and unresolved issues before judging.',
      'Judge the pre-synthesized answer only against the provided exit criteria and clarified request.',
      'Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.',
      'Be conservative: continue when a blocking evidence requirement is still missing.',
      'Return JSON only and do not invent evidence.'
    ].join('\n\n');
  }

  function buildJudgeMessage(input = {}) {
    const preSynthesizedQuestion = buildPreSynthesizedQuestion(input);
    const clarifiedRequest = cleanText(input.message || input.clarifiedInput || input.originalMessage, 3200);
    return [
      'Judge whether the reasoning loop should stop now or continue.',
      'Include trace_sentence as one short sentence describing what you are doing at this step.',
      `Clarified request:\n${clarifiedRequest}`,
      buildExitCriteriaSection(input.exitCriteria),
      buildPreSynthesizedQuestionSection(preSynthesizedQuestion),
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
    const preSynthesizedQuestion = normalizePreSynthesizedQuestion(
      judgeInput.preSynthesizedQuestion,
      buildFallbackPreSynthesizedQuestion(judgeInput)
    );
    if (!requestStructuredJsonPayload) {
      return {
        assistant_message: cleanText(fallback.reason, 1200),
        summary: 'Returned deterministic exit-judgement fallback.',
        output: fallback,
        metadata: {
          mode: 'fallback',
          phase: cleanText(turnInput.phase, 40),
          pre_synthesized_question: preSynthesizedQuestion
        }
      };
    }

    const result = await requestStructuredJsonPayload({
      source: judgeInput,
      stage: 'science_loop_exit_judge_sub_agent',
      systemPrompt: cleanText(turnInput.system_prompt, 12000) || buildJudgeSystemPrompt(),
      userPrompt: cleanText(turnInput.message, 48000) || buildJudgeMessage({
        ...judgeInput,
        preSynthesizedQuestion
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
        pre_synthesized_question: preSynthesizedQuestion
      }
    };
  }

  function normalizeJudgeResult(result, input = {}) {
    const fallback = buildFallbackEvaluation(input);
    const fallbackPreSynthesizedQuestion = buildFallbackPreSynthesizedQuestion(input);
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
    return {
      ok: source.ok !== false,
      status: cleanText(source.status, 80) || 'judged',
      evaluation: normalizeEvaluationPayload(evaluationSource, fallback),
      pre_synthesized_question: normalizePreSynthesizedQuestion(
        preSynthesizedQuestionSource,
        input.preSynthesizedQuestion || fallbackPreSynthesizedQuestion
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
    const judgeInputWithQuestion = {
      ...input,
      preSynthesizedQuestion
    };
    const subAgentRuntime = createAgentSubAgentRuntime({
      now,
      runSubAgentTurn: async (turnInput = {}) => runJudgeTurn(turnInput, judgeInputWithQuestion)
    });
    const created = await subAgentRuntime.createSubAgent({
      name: `science-loop-exit-judge-${Date.now()}`,
      system_prompt: buildJudgeSystemPrompt(),
      message: buildJudgeMessage(judgeInputWithQuestion),
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
      sub_agent: created?.agent || null,
      summary: created?.summary
    }, input);
  }

  return {
    SCIENCE_LOOP_PRE_SYNTHESIZED_QUESTION_SCHEMA,
    buildFallbackPreSynthesizedQuestion,
    SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA,
    buildFallbackEvaluation,
    buildJudgeSystemPrompt,
    buildJudgeMessage,
    judgeExit
  };
}

module.exports = {
  SCIENCE_LOOP_PRE_SYNTHESIZED_QUESTION_SCHEMA,
  SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA,
  createScienceLoopExitJudgeRuntime
};
