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

module.exports = {
  TOOL_NAMES,
  PAPER_INTAKE_DIRECT_MCP_TOOLS,
  PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES,
  LIST_PROJECT_SUMMARIES_DEFINITION,
  SEARCH_SUMMARIES_DEFINITION,
  SEARCH_EXPERIMENTS_DEFINITION,
  callListProjectSummaries,
  callSearchSummaries,
  callSearchExperiments
};
