'use strict';

const { REASONING_ENTRY_TOOL_SCOPES } = require('../../../src/main/agent/tools/agent-tool-provide.js');

const SCIENCE_REASONING_INTENTS = Object.freeze([
  'general_science_question',
  'project_science_question',
  'result_analysis'
]);

const SCIENCE_REASONING_EFFORT_LEVELS = Object.freeze([0, 1, 2]);

function cleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function normalizeScienceReasoningIntent(intent) {
  const normalized = cleanText(intent, 80);
  return SCIENCE_REASONING_INTENTS.includes(normalized) ? normalized : '';
}

function getScienceReasoningPolicy(intent) {
  const normalized = normalizeScienceReasoningIntent(intent);
  if (!normalized) {
    throw new Error(`Unsupported science reasoning intent: ${cleanText(intent, 80) || 'missing'}`);
  }
  if (normalized === 'general_science_question') {
    return Object.freeze({
      intent: normalized,
      description: 'Use literature and web retrieval to answer general science questions with grounded citations.',
      tool_scope: REASONING_ENTRY_TOOL_SCOPES.science_reasoning_entry.general_science_question,
      retrieval_priority: 'literature_first_web_last',
      require_external_citation_when_recent: true,
      require_retrieval_attempt: true,
      answer_with_limitations_after_attempt: true
    });
  }
  if (normalized === 'project_science_question') {
    return Object.freeze({
      intent: normalized,
      description: 'Use project-linked records first, then external literature only when internal evidence is insufficient.',
      tool_scope: REASONING_ENTRY_TOOL_SCOPES.science_reasoning_entry.project_science_question,
      retrieval_priority: 'internal_first_then_external',
      require_project_resolution: true,
      distinguish_internal_vs_external: true
    });
  }
  return Object.freeze({
    intent: normalized,
    description: 'Use deterministic computation plus local records, then add literature only for interpretation.',
    tool_scope: REASONING_ENTRY_TOOL_SCOPES.science_reasoning_entry.result_analysis,
    retrieval_priority: 'compute_then_internal_then_external',
    require_compute_for_numeric_queries: true
  });
}

function normalizeScienceReasoningEffort(intent, parserPayload = {}) {
  const numeric = Number(parserPayload?.reasoning_effort);
  // Result analysis always has computation to perform; never short-circuit to the direct-answer path.
  if (intent === 'result_analysis') {
    if (SCIENCE_REASONING_EFFORT_LEVELS.includes(numeric) && numeric >= 1) {
      return numeric;
    }
    return 1;
  }
  if (!['general_science_question', 'project_science_question'].includes(intent)) {
    return 0;
  }
  return SCIENCE_REASONING_EFFORT_LEVELS.includes(numeric) ? numeric : 1;
}

function getDefaultScienceMaxRounds(intent, reasoningEffort) {
  if (['general_science_question', 'project_science_question'].includes(intent)) {
    return reasoningEffort >= 2 ? 8 : 5;
  }
  return 6;
}

module.exports = {
  SCIENCE_REASONING_INTENTS,
  SCIENCE_REASONING_EFFORT_LEVELS,
  normalizeScienceReasoningIntent,
  getScienceReasoningPolicy,
  normalizeScienceReasoningEffort,
  getDefaultScienceMaxRounds
};
