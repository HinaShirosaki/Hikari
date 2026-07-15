'use strict';

const { createAgentMcpHost } = require('../../agent/mcp-contract/host.js');
const { createAgentMcpInitializer } = require('./create-agent-mcp-initializer.js');

function createMainMcpService({
  cleanText,
  agentToolRuntime,
  getCodexCliWorkingDirectory,
  getDefaultDataFilePath,
  getBundlePaths,
  processObject = process,
  createMcpHost = createAgentMcpHost,
  createMcpInitializer = createAgentMcpInitializer
} = {}) {
  const mcpHost = createMcpHost({
    runTool: agentToolRuntime?.runAgentTool,
    env: processObject.env,
    getSnapshot: () => ({}),
    getContextDefaults: () => ({
      cwd: getCodexCliWorkingDirectory(),
      dataFilePath: '',
      fallbackDataFilePath: ''
    })
  });
  const initializer = createMcpInitializer({
    cleanText,
    mcpHost,
    getCodexCliWorkingDirectory,
    getDefaultDataFilePath,
    getBundlePaths
  });

  async function initialize(input = {}) {
    return initializer.initialize(input);
  }

  async function stop() {
    await mcpHost.close();
  }

  return {
    getLastInitialization: initializer.getLastResult,
    initialize,
    mcpHost,
    stop
  };
}

module.exports = {
  createMainMcpService
};
