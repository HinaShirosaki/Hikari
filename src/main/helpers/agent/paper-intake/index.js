'use strict';

/**
 * Barrel export for the paper-intake summary knowledge base.
 *
 * Not wired into the live MCP router yet — the eventual wire-up only needs to:
 *   1. construct an intake store with the workspace path + injected fs +
 *      project/paper linkage resolver,
 *   2. require this module's `PAPER_INTAKE_DIRECT_MCP_TOOLS` (or call
 *      `createPaperIntakeMcpRouter`) from `mcp-contract/direct-tools/index.js`,
 *   3. add the three tool names to `HIKARI_MCP_TOOL_NAMES` in
 *      `mcp-contract/instructions.js` and reference them from the Hikari
 *      agent instructions.
 */

const store = require('./intake-store.js');
const search = require('./intake-search.js');
const mcpTools = require('./mcp-tools.js');

module.exports = {
  ...store,
  ...search,
  ...mcpTools
};
