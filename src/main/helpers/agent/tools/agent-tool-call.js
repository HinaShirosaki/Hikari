/**
 * Backward-compatible wrapper around the split agent tool helpers.
 *
 * - `agent-tool-loading.js` owns catalog loading, schema validation, and
 *   model-facing prompt/argument helpers.
 * - `agent-tool-execution.js` owns executor registration and safe execution.
 */
'use strict';

const loading = require('./agent-tool-loading.js');
const execution = require('./agent-tool-execution.js');

module.exports = {
  ...loading,
  ...execution
};
