'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/helpers/agent/shared/agent-llm-utils.js');
const { createAgentSubAgentRuntime } = require('../../../src/main/helpers/agent/tools/agent-sub-agent.js');

const SCIENCE_LOOP_LOGIC_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reasoning_type', 'logic'],
  properties: {
    reasoning_type: { type: 'string', enum: ['deductive', 'inductive', 'abductive'] },
    logic: { type: 'string' }
  }
};

const SCIENCE_LOOP_LOGIC_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['context', 'pre_synthesized_answer', 'logic_list'],
  properties: {
    context: { type: 'string' },
    pre_synthesized_answer: { type: 'string' },
    logic_list: {
      type: 'array',
      items: SCIENCE_LOOP_LOGIC_ITEM_SCHEMA
    }
  }
};

const SCIENCE_LOOP_INFERENCE_STABILITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stable', 'failed_reason'],
  properties: {
    stable: { type: 'boolean' },
    failed_reason: { type: 'string' }
  }
};

const SCIENCE_LOOP_LOGICAL_VERIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['part_1', 'part_2'],
  properties: {
    part_1: SCIENCE_LOOP_LOGIC_EXTRACTION_SCHEMA,
    part_2: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['reasoning_type', 'logic', 'stable', 'failed_reason'],
        properties: {
          reasoning_type: { type: 'string', enum: ['deductive', 'inductive', 'abductive'] },
          logic: { type: 'string' },
          stable: { type: 'boolean' },
          failed_reason: { type: 'string' }
        }
      }
    }
  }
};

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function defaultUniqueStrings(values, max = 20, {
  asArray = defaultAsArray,
  cleanText = defaultCleanText
} = {}) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 220);
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

function capitalize(value) {
  const text = String(value || '');
  return text ? `${text.slice(0, 1).toUpperCase()}${text.slice(1)}` : '';
}

function normalizeReasoningType(value, cleanText = defaultCleanText) {
  const normalized = cleanText(value, 40).toLowerCase();
  return ['deductive', 'inductive', 'abductive'].includes(normalized) ? normalized : '';
}

function normalizeLogicListRow(rawPayload, fallback = {}, deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const reasoningType = normalizeReasoningType(
    source.reasoning_type || source.reasoningType,
    cleanText
  ) || normalizeReasoningType(
    fallbackSource.reasoning_type || fallbackSource.reasoningType,
    cleanText
  );
  const logic = cleanText(source.logic, 240) || cleanText(fallbackSource.logic, 240);
  if (!reasoningType || !logic) {
    return null;
  }
  return {
    reasoning_type: reasoningType,
    logic
  };
}

function normalizeLogicListRows(rows, fallbackRows = [], deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const seen = new Set();
  const out = [];

  function append(rawRow, fallbackRow = null) {
    const normalized = normalizeLogicListRow(rawRow, fallbackRow || {}, deps);
    if (!normalized || seen.has(normalized.reasoning_type)) {
      return;
    }
    seen.add(normalized.reasoning_type);
    out.push(normalized);
  }

  asArray(rows).forEach((row) => append(row));
  asArray(fallbackRows).forEach((row) => append(row));
  return out.slice(0, 3);
}

function normalizeInferenceStabilityRow(rawPayload, fallback = {}, deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const reasoningType = normalizeReasoningType(
    source.reasoning_type || source.reasoningType,
    cleanText
  ) || normalizeReasoningType(
    fallbackSource.reasoning_type || fallbackSource.reasoningType,
    cleanText
  );
  if (!reasoningType) {
    return null;
  }
  return {
    reasoning_type: reasoningType,
    logic: cleanText(source.logic, 240) || cleanText(fallbackSource.logic, 240),
    stable: source.stable === true || (source.stable !== false && fallbackSource.stable === true),
    failed_reason: cleanText(source.failed_reason || source.failedReason, 160)
      || cleanText(fallbackSource.failed_reason || fallbackSource.failedReason, 160)
  };
}

function normalizeInferenceStabilityRows(rows, fallbackRows = [], deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const seen = new Set();
  const out = [];

  function append(rawRow, fallbackRow = null) {
    const normalized = normalizeInferenceStabilityRow(rawRow, fallbackRow || {}, deps);
    if (!normalized || seen.has(normalized.reasoning_type)) {
      return;
    }
    seen.add(normalized.reasoning_type);
    out.push(normalized);
  }

  asArray(rows).forEach((row) => append(row));
  asArray(fallbackRows).forEach((row) => append(row));
  return out.slice(0, 3);
}

function normalizeScienceLogicalVerification(rawPayload, fallback = {}, deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 20) => defaultUniqueStrings(values, max, { asArray, cleanText }));
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const part1Source = source.part_1 && typeof source.part_1 === 'object'
    ? source.part_1
    : (source.logic_extraction && typeof source.logic_extraction === 'object'
      ? source.logic_extraction
      : {});
  const part1Fallback = fallbackSource.part_1 && typeof fallbackSource.part_1 === 'object'
    ? fallbackSource.part_1
    : (fallbackSource.logic_extraction && typeof fallbackSource.logic_extraction === 'object'
      ? fallbackSource.logic_extraction
      : {});
  const legacyPart1Rows = [
    { reasoning_type: 'deductive', logic: part1Source.deductive },
    { reasoning_type: 'inductive', logic: part1Source.inductive },
    { reasoning_type: 'abductive', logic: part1Source.abductive }
  ];
  const legacyFallbackRows = [
    { reasoning_type: 'deductive', logic: part1Fallback.deductive },
    { reasoning_type: 'inductive', logic: part1Fallback.inductive },
    { reasoning_type: 'abductive', logic: part1Fallback.abductive }
  ];
  return {
    part_1: {
      context: cleanText(part1Source.context, 320) || cleanText(part1Fallback.context, 320),
      pre_synthesized_answer: cleanText(part1Source.pre_synthesized_answer, 320)
        || cleanText(part1Fallback.pre_synthesized_answer, 320),
      logic_list: normalizeLogicListRows(
        asArray(part1Source.logic_list).length ? part1Source.logic_list : legacyPart1Rows,
        asArray(part1Fallback.logic_list).length ? part1Fallback.logic_list : legacyFallbackRows,
        { asArray, cleanText, uniqueStrings }
      )
    },
    part_2: normalizeInferenceStabilityRows(
      asArray(source.part_2),
      asArray(fallbackSource.part_2),
      { asArray, cleanText, uniqueStrings }
    )
  };
}

function getUnstableScienceInferenceChecks(logicalVerification, deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  return asArray(normalizeScienceLogicalVerification(logicalVerification, {}, deps).part_2)
    .filter((row) => row?.stable === false);
}

function formatScienceInferenceStabilityIssue(row, deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const normalized = normalizeInferenceStabilityRow(row, {}, deps);
  if (!normalized) {
    return '';
  }
  const prefix = `${capitalize(normalized.reasoning_type)} inference is unstable`;
  const failedReason = cleanText(normalized.failed_reason, 160);
  return failedReason ? `${prefix}: ${failedReason}` : prefix;
}

function buildLogicalVerificationSection(logicalVerification, deps = {}) {
  const normalized = normalizeScienceLogicalVerification(logicalVerification, {}, deps);
  const part1 = normalized.part_1;
  const part2 = normalized.part_2;
  const lines = [];
  if (!part1.context && !part1.pre_synthesized_answer && !part1.logic_list.length && !part2.length) {
    return '';
  }
  lines.push('Logical verification:');
  if (part1.context || part1.pre_synthesized_answer || part1.logic_list.length) {
    lines.push('Part 1:');
    if (part1.context) {
      lines.push(`- Context: ${part1.context}`);
    }
    if (part1.pre_synthesized_answer) {
      lines.push(`- Pre-synthesized answer: ${part1.pre_synthesized_answer}`);
    }
    part1.logic_list.forEach((row) => {
      lines.push(`- ${capitalize(row.reasoning_type)}: ${row.logic}`);
    });
  }
  if (part2.length) {
    lines.push('Part 2:');
    part2.forEach((row) => {
      lines.push(
        row.stable === true
          ? `- ${capitalize(row.reasoning_type)}: stable`
          : `- ${capitalize(row.reasoning_type)}: unstable - ${row.failed_reason || 'needs revision'}`
      );
    });
  }
  return lines.join('\n');
}

function createScienceLoopLogicalVerificationRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());

  function normalizeAnswer(answer = {}) {
    const source = answer && typeof answer === 'object' ? answer : {};
    return {
      tentative_answer: {
        current_best_answer: cleanText(
          source?.tentative_answer?.current_best_answer || source.current_best_answer,
          1200
        )
      },
      supporting_basis: uniqueStrings(asArray(source.supporting_basis), 6),
      unresolved_issues: uniqueStrings(asArray(source.unresolved_issues), 6),
      logical_verification: normalizeScienceLogicalVerification(
        source.logical_verification,
        {},
        { asArray, cleanText, uniqueStrings }
      )
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

  function buildAnswerSection(answer = {}) {
    const source = normalizeAnswer(answer);
    return [
      'Pre-synthesized answer:',
      cleanText(source?.tentative_answer?.current_best_answer, 600)
        ? `Current best answer: ${cleanText(source.tentative_answer.current_best_answer, 600)}`
        : '',
      buildCompactList('Supporting basis', source.supporting_basis, 4),
      buildCompactList('Unresolved issues', source.unresolved_issues, 4)
    ].filter(Boolean).join('\n');
  }

  function buildFallbackLogicExtraction(input = {}) {
    const answer = normalizeAnswer(input.preSynthesizedAnswer);
    const existing = normalizeScienceLogicalVerification(
      input.logical_verification || input.logicalVerification,
      {},
      { asArray, cleanText, uniqueStrings }
    ).part_1;
    return {
      context: cleanText(existing.context, 320)
        || uniqueStrings([
          ...answer.supporting_basis.slice(0, 2),
          ...answer.unresolved_issues.slice(0, 1)
        ], 3).join(' | '),
      pre_synthesized_answer: cleanText(
        existing.pre_synthesized_answer || answer?.tentative_answer?.current_best_answer,
        320
      ),
      logic_list: normalizeLogicListRows(existing.logic_list, [], { asArray, cleanText, uniqueStrings })
    };
  }

  function normalizeLogicExtraction(rawPayload, fallback = {}) {
    const normalized = normalizeScienceLogicalVerification(
      { part_1: rawPayload && typeof rawPayload === 'object' ? rawPayload : {} },
      { part_1: fallback && typeof fallback === 'object' ? fallback : {} },
      { asArray, cleanText, uniqueStrings }
    );
    return normalized.part_1;
  }

  function buildLogicExtractionPrompt(input = {}) {
    const clarifiedRequest = cleanText(input.message || input.clarifiedInput || input.originalMessage, 3200);
    const answer = normalizeAnswer(input.preSynthesizedAnswer);
    return [
      'Extract the short logical structure from the current pre-synthesized answer.',
      'Deductive means a direct conclusion from the stated basis.',
      'Inductive means a pattern or generalization from the available evidence.',
      'Abductive means the current best explanation or hypothesis.',
      'Return a short context, the short pre-synthesized answer, and a short logic_list.',
      'Each logic_list item should contain one reasoning_type and one short logic string.',
      'Do not add evidence or alternatives that are not already in the provided answer state.',
      `Clarified request:\n${clarifiedRequest}`,
      buildAnswerSection(answer),
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function extractLogic(input = {}) {
    const fallback = buildFallbackLogicExtraction(input);
    if (!requestStructuredJsonPayload) {
      return fallback;
    }
    const result = await requestStructuredJsonPayload({
      stage: 'science_loop_logic_extraction',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildLogicExtractionPrompt(input),
      schema: SCIENCE_LOOP_LOGIC_EXTRACTION_SCHEMA,
      traceContext: input.traceContext || null,
      defaultError: 'Science loop logic extraction is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return fallback;
    }
    return normalizeLogicExtraction(result.payload, fallback);
  }

  function buildFallbackInferenceStability(input = {}) {
    return {
      reasoning_type: normalizeReasoningType(input.reasoningType, cleanText),
      logic: cleanText(input.logicText, 240),
      stable: true,
      failed_reason: ''
    };
  }

  function normalizeInferenceStability(rawPayload, fallback = {}) {
    return normalizeInferenceStabilityRow(rawPayload, fallback, { asArray, cleanText, uniqueStrings })
      || normalizeInferenceStabilityRow(fallback, {}, { asArray, cleanText, uniqueStrings })
      || {
        reasoning_type: '',
        logic: '',
        stable: true,
        failed_reason: ''
      };
  }

  function buildInferenceStabilitySystemPrompt() {
    return [
      'You are a specialized sub-agent that judges whether one extracted inference is stable.',
      'Judge only from the clarified request, the current best answer, the supporting basis, the unresolved issues, and the extracted context.',
      'Mark stable=false when the inference overreaches the evidence, ignores a stated gap, or leaves obvious unresolved alternatives.',
      'Keep failed_reason very short.',
      'Return JSON only.'
    ].join('\n\n');
  }

  function buildInferenceStabilityMessage(input = {}) {
    const clarifiedRequest = cleanText(input.message || input.clarifiedInput || input.originalMessage, 3200);
    const answer = normalizeAnswer(input.preSynthesizedAnswer);
    const reasoningType = normalizeReasoningType(input.reasoningType, cleanText);
    const logicText = cleanText(input.logicText, 240);
    const context = cleanText(input.context, 320);
    const extractedAnswer = cleanText(input.extractedAnswer, 320);
    return [
      'Judge whether this one extracted inference is stable.',
      `Clarified request:\n${clarifiedRequest}`,
      context ? `Extracted context: ${context}` : '',
      extractedAnswer ? `Extracted pre-synthesized answer: ${extractedAnswer}` : '',
      buildAnswerSection(answer),
      `Reasoning type: ${reasoningType}`,
      `Extracted logic: ${logicText}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function runInferenceStabilityTurn(turnInput = {}, judgeInput = {}) {
    const fallback = buildFallbackInferenceStability(judgeInput);
    if (!requestStructuredJsonPayload) {
      return {
        assistant_message: fallback.stable ? 'stable' : 'unstable',
        summary: 'Returned deterministic inference-stability fallback.',
        output: fallback,
        metadata: {
          reasoning_type: fallback.reasoning_type
        }
      };
    }

    const result = await requestStructuredJsonPayload({
      source: judgeInput,
      stage: 'science_loop_inference_stability',
      systemPrompt: cleanText(turnInput.system_prompt, 12000) || buildInferenceStabilitySystemPrompt(),
      userPrompt: cleanText(turnInput.message, 48000) || buildInferenceStabilityMessage(judgeInput),
      schema: SCIENCE_LOOP_INFERENCE_STABILITY_SCHEMA,
      traceContext: judgeInput.traceContext || null,
      defaultError: 'Science loop inference stability check is not configured.'
    });

    const normalized = result?.ok && result.payload
      ? normalizeInferenceStability(
        {
          ...result.payload,
          reasoning_type: judgeInput.reasoningType,
          logic: judgeInput.logicText
        },
        fallback
      )
      : fallback;

    return {
      assistant_message: normalized.stable === true ? 'stable' : 'unstable',
      summary: normalized.stable === true
        ? `${capitalize(normalized.reasoning_type)} inference judged stable.`
        : `${capitalize(normalized.reasoning_type)} inference judged unstable.`,
      output: normalized,
      metadata: {
        reasoning_type: normalized.reasoning_type
      }
    };
  }

  async function judgeInferenceStability(input = {}) {
    const fallback = buildFallbackInferenceStability(input);
    if (!fallback.reasoning_type || !cleanText(input.logicText, 240)) {
      return fallback;
    }
    const subAgentRuntime = createAgentSubAgentRuntime({
      now,
      runSubAgentTurn: async (turnInput = {}) => runInferenceStabilityTurn(turnInput, input)
    });
    const created = await subAgentRuntime.createSubAgent({
      name: `science-loop-${fallback.reasoning_type}-stability-${Date.now()}`,
      system_prompt: buildInferenceStabilitySystemPrompt(),
      message: buildInferenceStabilityMessage(input),
      metadata: {
        task_type: 'science-loop-inference-stability',
        reasoning_type: fallback.reasoning_type,
        tags: ['science', 'reasoning-loop', 'inference-stability', fallback.reasoning_type]
      }
    });
    return normalizeInferenceStability(
      {
        ...(created?.agent?.last_response?.output || {}),
        reasoning_type: fallback.reasoning_type,
        logic: fallback.logic
      },
      fallback
    );
  }

  async function verifyPreSynthesizedAnswer(input = {}) {
    const part1 = await extractLogic(input);
    const rows = [];
    for (const row of asArray(part1.logic_list)) {
      const reasoningType = normalizeReasoningType(row?.reasoning_type, cleanText);
      const logicText = cleanText(row?.logic, 240);
      if (!reasoningType || !logicText) {
        continue;
      }
      rows.push(await judgeInferenceStability({
        ...input,
        reasoningType,
        logicText,
        context: cleanText(part1.context, 320),
        extractedAnswer: cleanText(part1.pre_synthesized_answer, 320)
      }));
    }
    return normalizeScienceLogicalVerification(
      {
        part_1: part1,
        part_2: rows
      },
      {
        part_1: buildFallbackLogicExtraction(input),
        part_2: []
      },
      { asArray, cleanText, uniqueStrings }
    );
  }

  function buildInferenceRetryFeedback(logicalVerification) {
    const unstable = getUnstableScienceInferenceChecks(logicalVerification, { asArray, cleanText, uniqueStrings });
    if (!unstable.length) {
      return '';
    }
    return [
      'Revise the current best answer using only the collected evidence.',
      'One or more inference checks were unstable.',
      ...unstable.map((row) => `- ${capitalize(row.reasoning_type)} (${row.logic || 'logic'}): ${row.failed_reason || 'needs revision'}`),
      'Keep the revision short and explicit about remaining gaps.',
      'Do not call tools in this revision step.'
    ].join('\n');
  }

  return {
    SCIENCE_LOOP_LOGIC_ITEM_SCHEMA,
    SCIENCE_LOOP_LOGIC_EXTRACTION_SCHEMA,
    SCIENCE_LOOP_INFERENCE_STABILITY_SCHEMA,
    SCIENCE_LOOP_LOGICAL_VERIFICATION_SCHEMA,
    normalizeScienceLogicalVerification: (rawPayload, fallback = {}) => normalizeScienceLogicalVerification(
      rawPayload,
      fallback,
      { asArray, cleanText, uniqueStrings }
    ),
    buildLogicalVerificationSection: (logicalVerification) => buildLogicalVerificationSection(
      logicalVerification,
      { asArray, cleanText, uniqueStrings }
    ),
    getUnstableScienceInferenceChecks: (logicalVerification) => getUnstableScienceInferenceChecks(
      logicalVerification,
      { asArray, cleanText, uniqueStrings }
    ),
    buildLogicExtractionPrompt,
    buildInferenceStabilitySystemPrompt,
    buildInferenceStabilityMessage,
    verifyPreSynthesizedAnswer,
    buildInferenceRetryFeedback
  };
}

module.exports = {
  SCIENCE_LOOP_LOGIC_ITEM_SCHEMA,
  SCIENCE_LOOP_LOGIC_EXTRACTION_SCHEMA,
  SCIENCE_LOOP_INFERENCE_STABILITY_SCHEMA,
  SCIENCE_LOOP_LOGICAL_VERIFICATION_SCHEMA,
  normalizeScienceLogicalVerification,
  getUnstableScienceInferenceChecks,
  formatScienceInferenceStabilityIssue,
  buildLogicalVerificationSection,
  createScienceLoopLogicalVerificationRuntime
};
