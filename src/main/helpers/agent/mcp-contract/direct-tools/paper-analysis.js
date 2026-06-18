'use strict';

const { createDirectAppTool } = require('./generic-app-tool.js');

const PAPER_ANALYSIS_DIRECT_TOOL = createDirectAppTool('paper-analysis');

module.exports = {
  PAPER_ANALYSIS_MCP_TOOL: PAPER_ANALYSIS_DIRECT_TOOL.definition,
  callPaperAnalysis: PAPER_ANALYSIS_DIRECT_TOOL.handler
};
