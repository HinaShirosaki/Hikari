'use strict';

const { createDirectAppTool } = require('./generic-app-tool.js');

const RECORD_LOOKUP_DIRECT_TOOL = createDirectAppTool('record-lookup');

module.exports = {
  RECORD_LOOKUP_MCP_TOOL: RECORD_LOOKUP_DIRECT_TOOL.definition,
  callRecordLookup: RECORD_LOOKUP_DIRECT_TOOL.handler
};
