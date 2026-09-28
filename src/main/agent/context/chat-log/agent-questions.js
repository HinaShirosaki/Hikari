'use strict';

const { createAgentQuestionNormalizer } = require('../../../../shared/agent-result-summaries.mjs');
const { cleanText } = require('./text-utils.js');

const normalizeAgentUserQuestion = createAgentQuestionNormalizer({ text: cleanText });

module.exports = { normalizeAgentUserQuestion };
