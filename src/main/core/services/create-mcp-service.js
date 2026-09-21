'use strict';

const { createAgentMcpHost } = require('../../agent/mcp-contract/host.js');

function createMainMcpService({
  agentToolRuntime,
  getWorkingDirectory = () => process.cwd(),
  processObject = process,
  createMcpHost = createAgentMcpHost
} = {}) {
  const mcpHost = createMcpHost({
    runTool: agentToolRuntime?.runAgentTool,
    env: processObject.env,
    getSnapshot: () => ({}),
    getContextDefaults: () => ({
      cwd: getWorkingDirectory(),
      dataFilePath: '',
      fallbackDataFilePath: ''
    })
  });
  let lastInitialization = null;

  async function initialize() {
    const host = await mcpHost.ensureStarted();
    const hostUrl = String(host?.url || mcpHost.getHostUrl?.() || '').trim();
    const token = String(host?.token || mcpHost.getToken?.() || '').trim();
    lastInitialization = {
      ok: Boolean(hostUrl && token),
      status: hostUrl && token ? 'initialized' : 'failed',
      host_url: hostUrl,
      has_token: Boolean(token)
    };
    return lastInitialization;
  }

  async function stop() {
    await mcpHost.close();
  }

  return {
    getLastInitialization: () => lastInitialization,
    initialize,
    mcpHost,
    stop
  };
}

module.exports = {
  createMainMcpService
};
