'use strict';

const { createDirectAppTool } = require('./generic-app-tool.js');

const MEMORY_DIRECT_TOOL = createDirectAppTool('memory');

module.exports = {
  MEMORY_MCP_TOOL: MEMORY_DIRECT_TOOL.definition,
  callMemory: MEMORY_DIRECT_TOOL.handler
};
