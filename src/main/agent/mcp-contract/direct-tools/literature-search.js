'use strict';

const { createDirectAppTool } = require('./generic-app-tool.js');

const LITERATURE_SEARCH_DIRECT_TOOL = createDirectAppTool('literature-search');

module.exports = {
  LITERATURE_SEARCH_MCP_TOOL: LITERATURE_SEARCH_DIRECT_TOOL.definition,
  callLiteratureSearch: LITERATURE_SEARCH_DIRECT_TOOL.handler
};
