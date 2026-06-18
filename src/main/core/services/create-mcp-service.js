'use strict';

const { createAgentMcpHost } = require('../../helpers/agent/mcp-contract/host.js');
const { createAgentMcpInitializer } = require('../../helpers/main/agent-mcp-initializer.js');

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
    getSnapshot: () => ({
      data_file_path: cleanText(getDefaultDataFilePath(), 2000)
    }),
    getContextDefaults: () => ({
      cwd: getCodexCliWorkingDirectory(),
      dataFilePath: cleanText(getDefaultDataFilePath(), 2000),
      fallbackDataFilePath: cleanText(getDefaultDataFilePath(), 2000)
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
