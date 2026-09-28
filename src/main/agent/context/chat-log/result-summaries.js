'use strict';

const { createAgentResultSummaries } = require('../../../../shared/agent-result-summaries.mjs');
const { cloneJson } = require('../../../lib/normalize.js');
const { normalizeAgentUserQuestion } = require('./agent-questions.js');
const { cleanText } = require('./text-utils.js');

const summaries = createAgentResultSummaries({
  text: cleanText,
  normalizeAgentUserQuestion
});

function extractStructuredThinkingTrace(result) {
  return cloneJson(summaries.extractStructuredThinkingTrace(result), null);
}

function ensureThinkingTraceMeta(meta) {
  const payload = meta && typeof meta === 'object' ? cloneJson(meta, {}) : {};
  if (payload.thinking_trace && typeof payload.thinking_trace === 'object' && !Array.isArray(payload.thinking_trace)) {
    return payload;
  }
  payload.thinking_trace = extractStructuredThinkingTrace(payload);
  return payload;
}

module.exports = {
  ...summaries,
  extractStructuredThinkingTrace,
  ensureThinkingTraceMeta
};
