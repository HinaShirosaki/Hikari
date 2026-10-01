'use strict';

const { createAgentMcpHost } = require('../../agent/mcp-contract/host.js');
const { createAssayPlotBridge } = require('./assay-plot-bridge.js');
const { createPluginCanvasBridge } = require('./plugin-canvas-bridge.js');

function createMainMcpService({
  agentToolRuntime,
  ipcMain,
  getMainWindow,
  fileAccess,
  getWorkingDirectory = () => process.cwd(),
  processObject = process,
  createMcpHost = createAgentMcpHost
} = {}) {
  const plotBridge = createAssayPlotBridge({ ipcMain, getMainWindow });
  const canvasBridge = createPluginCanvasBridge({ ipcMain, getMainWindow });
  const mcpHost = createMcpHost({
    runTool: (toolId, ...args) => {
      if (toolId === 'workspace-files') return fileAccess?.execute(args[0], args[2]?.fileAccessToken)
        || { ok: false, status: 'unavailable', error: 'Workspace files is unavailable.' };
      if (toolId === 'plugin-canvas') return canvasBridge.run(args[0]);
      return toolId === 'assay-plot' ? plotBridge.run(args[0]) : agentToolRuntime?.runAgentTool(toolId, ...args);
    },
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
    plotBridge.close();
    canvasBridge.close();
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
