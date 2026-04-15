'use strict';

const {
  SCIENCE_REASONING_INTENTS,
  getScienceReasoningPolicy,
  normalizeScienceReasoningIntent,
  normalizeScienceReasoningEffort,
  getDefaultScienceMaxRounds
} = require('./policies.js');
const { SCIENCE_RESULT_EVALUATION_SCHEMA } = require('./schemas.js');
const { createScienceReasoningLoopRuntime } = require('./runtime.js');

module.exports = {
  SCIENCE_REASONING_INTENTS,
  SCIENCE_RESULT_EVALUATION_SCHEMA,
  getScienceReasoningPolicy,
  normalizeScienceReasoningIntent,
  normalizeScienceReasoningEffort,
  getDefaultScienceMaxRounds,
  createScienceReasoningLoopRuntime
};
