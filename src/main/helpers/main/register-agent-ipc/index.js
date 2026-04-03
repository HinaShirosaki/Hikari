'use strict';

const { createAgentLifecycleService } = require('./agent-lifecycle-service');
const { createAgentControllerCore } = require('./agent-controller-core');
const { registerAgentChatHandler } = require('./agent-chat-handler');
const { registerAgentLogHandlers } = require('./agent-log-handlers');

function registerAgentIpc(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      if (text.length <= maxLength) {
        return text;
      }
      return `${text.slice(0, maxLength)}...`;
    });

  const lifecycleService = createAgentLifecycleService({
    cleanText,
    observability: deps.observability || {},
    controllerUtils: deps.controllerUtils || {},
    agentToolRuntime: deps.agentToolRuntime || {},
    appendAgentChatLogEntry: deps.appendAgentChatLogEntry
  });

  const { runAgentController } = createAgentControllerCore({
    deps,
    cleanText,
    controllerUtils: deps.controllerUtils || {},
    observability: deps.observability || {},
    protocolNotebookRuntime: deps.protocolNotebookRuntime,
    scienceReasoningLoopRuntime: deps.scienceReasoningLoopRuntime,
    deepResearchRuntime: deps.deepResearchRuntime,
    scienceMainUtils: deps.scienceMainUtils || {},
    agentToolRuntime: deps.agentToolRuntime || {},
    executeInventoryLookup: deps.executeInventoryLookup,
    executeRecordLookup: deps.executeRecordLookup,
    getAgentChatLogPath: deps.getAgentChatLogPath,
    getDefaultDataFilePath: deps.getDefaultDataFilePath,
    setCodexCliModel: typeof deps.setCodexCliModel === 'function' ? deps.setCodexCliModel : (() => ''),
    setCodexCliReasoningEffort: typeof deps.setCodexCliReasoningEffort === 'function'
      ? deps.setCodexCliReasoningEffort
      : (() => ''),
    lifecycleService
  });

  registerAgentChatHandler({
    ipcMain: deps.ipcMain,
    cleanText,
    controllerUtils: deps.controllerUtils || {},
    observability: deps.observability || {},
    agentChatLogRuntime: deps.agentChatLogRuntime,
    getAgentChatLogPath: deps.getAgentChatLogPath,
    getAgentChatSessionStoragePath: deps.getAgentChatSessionStoragePath,
    appendAgentChatLogEntry: deps.appendAgentChatLogEntry,
    lifecycleService,
    runAgentController
  });

  registerAgentLogHandlers({
    ipcMain: deps.ipcMain,
    cleanText,
    observability: deps.observability || {},
    agentChatLogRuntime: deps.agentChatLogRuntime,
    getAgentChatLogPath: deps.getAgentChatLogPath,
    getAgentChatSessionStoragePath: deps.getAgentChatSessionStoragePath,
    agentToolRuntime: deps.agentToolRuntime || {},
    agentToolSmokeTestRuntime: deps.agentToolSmokeTestRuntime,
    controllerUtils: deps.controllerUtils || {},
    lifecycleService
  });
}

module.exports = {
  registerAgentIpc
};
