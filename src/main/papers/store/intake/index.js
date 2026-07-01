'use strict';

/**
 * Barrel export for the paper-intake summary knowledge base.
 *
 * The live MCP router registers the read-only paper-intake tools from
 * `mcp-tools.js`; callers may still build a stand-alone router for tests and
 * narrow integrations with `createPaperIntakeMcpRouter`.
 */

const store = require('./intake-store.js');
const search = require('./intake-search.js');
const pipeline = require('./intake-pipeline.js');
const mcpTools = require('./mcp-tools.js');

module.exports = {
  ...store,
  ...search,
  ...pipeline,
  ...mcpTools
};
