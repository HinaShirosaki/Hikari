'use strict';

const { LIST_PROJECT_SUMMARIES_DEFINITION, callListProjectSummaries } = require('./mcp/list-summaries.js');
const { TOOL_NAMES } = require('./mcp/projections.js');
const { SEARCH_EXPERIMENTS_DEFINITION, callSearchExperiments } = require('./mcp/search-experiments.js');
const { SEARCH_SUMMARIES_DEFINITION, callSearchSummaries } = require('./mcp/search-summaries.js');

const PAPER_INTAKE_DIRECT_MCP_TOOLS = Object.freeze([
  Object.freeze({
    definition: SEARCH_SUMMARIES_DEFINITION,
    handler: callSearchSummaries
  }),
  Object.freeze({
    definition: SEARCH_EXPERIMENTS_DEFINITION,
    handler: callSearchExperiments
  }),
  Object.freeze({
    definition: LIST_PROJECT_SUMMARIES_DEFINITION,
    handler: callListProjectSummaries
  })
]);

const PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES = Object.freeze(
  PAPER_INTAKE_DIRECT_MCP_TOOLS.map((tool) => tool.definition.name)
);

function getPaperIntakeDirectMcpToolDefinitions() {
  return PAPER_INTAKE_DIRECT_MCP_TOOLS.map((tool) => tool.definition);
}

/**
 * Build a stand-alone router for the three paper-intake tools. Mirrors the
 * shape of `createDirectMcpToolRouter` in `mcp-contract/direct-tools/index.js`
 * so the eventual wire-up can fold these into the main router or expose them
 * as their own sub-router.
 */
function createPaperIntakeMcpRouter(deps = {}) {
  const handlers = new Map(
    PAPER_INTAKE_DIRECT_MCP_TOOLS.map((tool) => [tool.definition.name, tool.handler])
  );

  return Object.freeze({
    hasTool(name) {
      return handlers.has(String(name || ''));
    },
    async callTool(name, args = {}, context = {}) {
      const handler = handlers.get(String(name || ''));
      if (typeof handler !== 'function') {
        return {
          ok: false,
          status: 'unknown_tool',
          error: `Unknown paper-intake MCP tool "${String(name || 'unknown')}".`
        };
      }
      return handler(args, context, deps);
    },
    getToolDefinitions: getPaperIntakeDirectMcpToolDefinitions
  });
}

module.exports = {
  TOOL_NAMES,
  PAPER_INTAKE_DIRECT_MCP_TOOLS,
  PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES,
  LIST_PROJECT_SUMMARIES_DEFINITION,
  SEARCH_SUMMARIES_DEFINITION,
  SEARCH_EXPERIMENTS_DEFINITION,
  callListProjectSummaries,
  callSearchSummaries,
  callSearchExperiments,
  getPaperIntakeDirectMcpToolDefinitions,
  createPaperIntakeMcpRouter
};
