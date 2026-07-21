'use strict';

const { LLM } = require('../../../shared/ipc/channels');

function createLlmApi(ipcRenderer) {
  return {
    getCodexLlmStatus: () => ipcRenderer.invoke(LLM.CODEX_STATUS),
    getCodexLlmCatalog: () => ipcRenderer.invoke(LLM.CODEX_CATALOG),
    loginCodexLlm: () => ipcRenderer.invoke(LLM.CODEX_LOGIN),
    clearCodexLlmLogin: () => ipcRenderer.invoke(LLM.CODEX_CLEAR_LOGIN),
    setCodexLlmModel: (model) => ipcRenderer.invoke(LLM.CODEX_SET_MODEL, { model }),
    setCodexLlmReasoningEffort: (reasoningEffort) => (
      ipcRenderer.invoke(LLM.CODEX_SET_REASONING_EFFORT, { reasoningEffort })
    ),
    getCodexDesktopMcpSetupPrompt: (payload) => (
      ipcRenderer.invoke(LLM.CODEX_DESKTOP_MCP_PROMPT, payload)
    ),
    runCodexLlmPrompt: (payload) => ipcRenderer.invoke(LLM.CODEX_GENERATE, payload),
    getDirectLlmModules: () => ipcRenderer.invoke(LLM.DIRECT_MODULES),
    runDirectLlmPrompt: (payload) => ipcRenderer.invoke(LLM.DIRECT_GENERATE, payload)
  };
}

module.exports = {
  createLlmApi
};
