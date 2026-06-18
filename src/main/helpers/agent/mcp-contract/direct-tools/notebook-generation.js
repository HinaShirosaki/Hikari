'use strict';

const { createDirectAppTool } = require('./generic-app-tool.js');

const NOTEBOOK_GENERATION_DIRECT_TOOL = createDirectAppTool('notebook-generation');

module.exports = {
  NOTEBOOK_GENERATION_MCP_TOOL: NOTEBOOK_GENERATION_DIRECT_TOOL.definition,
  callNotebookGeneration: NOTEBOOK_GENERATION_DIRECT_TOOL.handler
};
