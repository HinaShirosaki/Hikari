'use strict';

const { createDirectAppTool } = require('./generic-app-tool.js');

const PAPER_DOWNLOAD_DIRECT_TOOL = createDirectAppTool('paper-download');

module.exports = {
  PAPER_DOWNLOAD_MCP_TOOL: PAPER_DOWNLOAD_DIRECT_TOOL.definition,
  callPaperDownload: PAPER_DOWNLOAD_DIRECT_TOOL.handler
};
