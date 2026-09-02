'use strict';

const fs = require('node:fs/promises');
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
  const env = deps.env && typeof deps.env === 'object' ? deps.env : process.env;
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : null;

  function buildDirectRouterDeps(context = {}) {
    const safeContext = context && typeof context === 'object' && !Array.isArray(context)
      ? context
      : {};
    const contextSnapshot = safeContext.snapshot && typeof safeContext.snapshot === 'object'
      ? safeContext.snapshot
      : {};
    const contextSettings = contextSnapshot.settings && typeof contextSnapshot.settings === 'object'
      ? contextSnapshot.settings
      : {};
    const workspacePath = cleanText(
      deps.storagePath
        || deps.storage_path
        || env.HIKARI_AGENT_STORAGE_PATH
        || safeContext.storagePath
        || safeContext.storage_path
        || contextSettings.storagePath
        || contextSettings.storage_path
        || contextSnapshot.storagePath
        || contextSnapshot.storage_path
        || deps.workspacePath
        || deps.workspace_path
        || env.HIKARI_AGENT_MCP_WORKSPACE
        || env.HIKARI_CODEX_WORKSPACE
        || safeContext.cwd
        || safeContext.workspacePath
        || safeContext.workspace_path,
      2400
    );
    return {
      ...deps,
      runTool,
      fs: deps.fs || fs,
      workspacePath
    };
  }

  // The router owns unknown-tool handling so there is exactly one such response
  // shape. Gating on hasTool() here only re-implemented it with a thinner payload.
  async function callGatewayTool(name = '', args = {}, context = {}) {
    return createDirectMcpToolRouter(buildDirectRouterDeps(context))
      .callTool(cleanText(name, 120), args, context);
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
