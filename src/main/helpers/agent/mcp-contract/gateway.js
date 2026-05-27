'use strict';

const { createDirectMcpToolRouter } = require('./direct-tools/index.js');

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const limit = Number.isFinite(Number(maxLength)) ? Number(maxLength) : 2000;
  return limit > 0 ? text.slice(0, limit) : text;
}

function createAgentMcpGateway(deps = {}) {
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : null;
  const directToolRouter = createDirectMcpToolRouter({
    runTool
  });

  async function callGatewayTool(name = '', args = {}, context = {}) {
    const toolName = cleanText(name, 120);
    if (directToolRouter.hasTool(toolName)) {
      return directToolRouter.callTool(toolName, args, context);
    }
    return {
      ok: false,
      error: `Unknown Hikari MCP gateway tool "${toolName || 'unknown'}".`
    };
  }

  return {
    callGatewayTool
  };
}

const createCodexAgentMcpGateway = createAgentMcpGateway;

module.exports = {
  createAgentMcpGateway,
  createCodexAgentMcpGateway
};
