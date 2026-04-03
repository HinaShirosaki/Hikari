'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');

const SCIENCE_FINAL_SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'confidence', 'decision_record', 'follow_up_questions'],
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    decision_record: {
      type: 'object',
      additionalProperties: false,
      required: ['assumptions', 'open_questions', 'verification_notes'],
      properties: {
        assumptions: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
        verification_notes: { type: 'array', items: { type: 'string' } }
      }
    },
    follow_up_questions: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

function createScienceFinalSynthesisRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);
  const clamp = typeof deps.clamp === 'function'
    ? deps.clamp
    : ((value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)));
  const synthesizeScienceFinalOverride = typeof deps.synthesizeScienceFinal === 'function'
    ? deps.synthesizeScienceFinal
    : null;

  function normalizeCitations(citations, max = 20) {
    const seen = new Set();
    const out = [];
    asArray(citations).forEach((citation) => {
      const source = cleanText(citation?.source, 120);
      const pointer = cleanText(citation?.pointer, 220);
      const reason = cleanText(citation?.reason, 260);
      const key = `${source.toLowerCase()}::${pointer.toLowerCase()}`;
      if (!source && !pointer) {
        return;
      }
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push({ source, pointer, reason });
    });
    return out;
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

  function buildSynthesisPrompt({
    intent,
    policy,
    originalMessage,
    message,
    clarification,
    parserPayload,
    project,
    roundsExecuted,
    maxRounds,
    evaluator,
    accumulatedCitations,
    toolTrace,
    partial
  }) {
    return [
      'You are the final answer synthesizer for a science reasoning loop.',
      'Answer using only the evidence and tool trace provided by the app.',
      'Do not invent evidence, papers, values, or project facts.',
      partial
        ? 'The loop stopped before full satisfaction. Produce the best available answer and explicitly name the remaining gaps.'
        : 'The evaluator judged the evidence sufficient. Produce a concise grounded answer.',
      `Intent: ${cleanText(intent, 80)}`,
      `Policy JSON:\n${JSON.stringify(policy || {}, null, 2)}`,
      project ? `Resolved project JSON:\n${JSON.stringify(project, null, 2)}` : '',
      `Original user message:\n${cleanText(originalMessage, 3200)}`,
      `Clarified request:\n${cleanText(message, 3200)}`,
      clarification ? `Clarification JSON:\n${JSON.stringify(clarification, null, 2)}` : '',
      `Parser payload JSON:\n${JSON.stringify(parserPayload || {}, null, 2)}`,
      `Rounds executed: ${Number(roundsExecuted) || 0}/${Number(maxRounds) || 0}`,
      `Evaluator JSON:\n${JSON.stringify(evaluator || null, null, 2)}`,
      `Citations JSON:\n${JSON.stringify(normalizeCitations(accumulatedCitations, 20), null, 2)}`,
      `Tool trace JSON:\n${JSON.stringify(asArray(toolTrace).slice(0, 20), null, 2)}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  function normalizeSynthesisPayload(rawPayload, payload = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    return {
      answer: cleanText(source.answer, 12000)
        || cleanText(payload.fallbackAnswer, 12000)
        || 'I could not complete a grounded final synthesis from the available evidence.',
      confidence: Number.isFinite(Number(source.confidence))
        ? clamp(Number(source.confidence), 0, 1)
        : (payload.partial === true ? 0.48 : 0.58),
      decision_record: normalizeDecisionRecord(source.decision_record, {
        assumptions: !source.decision_record ? ['The final synthesis model response was unavailable.'] : [],
        verification_notes: !source.decision_record ? ['Returned fallback final synthesis payload.'] : []
      }),
      follow_up_questions: uniqueStrings(asArray(source.follow_up_questions), 6)
    };
  }

  async function synthesizeFinal(payload = {}) {
    if (synthesizeScienceFinalOverride) {
      return normalizeSynthesisPayload(await synthesizeScienceFinalOverride(payload), payload);
    }
    const llmResult = await requestStructuredJsonPayload({
      provider: cleanText(payload.provider, 80),
      endpoint: cleanText(payload.endpoint, 2000),
      apiKey: cleanText(payload.apiKey, 400),
      model: cleanText(payload.model, 120),
      stage: 'science_reasoning_final_synthesis',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildSynthesisPrompt(payload),
      schema: SCIENCE_FINAL_SYNTHESIS_SCHEMA,
      traceContext: payload.traceContext || null,
      maxOutputTokens: 1700,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Science reasoning synthesis is not configured.'
    });
    if (!llmResult?.ok || !llmResult.payload) {
      return normalizeSynthesisPayload(null, payload);
    }
    return normalizeSynthesisPayload(llmResult.payload, payload);
  }

  return {
    SCIENCE_FINAL_SYNTHESIS_SCHEMA,
    synthesizeFinal
  };
}

module.exports = {
  SCIENCE_FINAL_SYNTHESIS_SCHEMA,
  createScienceFinalSynthesisRuntime
};
