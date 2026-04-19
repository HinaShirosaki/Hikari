const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('enanaApi', {
  autoSaveDataFile: (data, filePath) => ipcRenderer.invoke('data:auto-save', { data, filePath }),
  syncSqliteBundle: (payload) => ipcRenderer.invoke('storage:sync-sqlite-bundle', payload),
  pickStorageDirectory: (currentPath) => ipcRenderer.invoke('storage:pick-directory', { currentPath }),
  ensureStorageDirectory: (path) => ipcRenderer.invoke('storage:ensure-directory', { path }),
  importStorageRoot: (storagePath) => ipcRenderer.invoke('storage:import-root', { storagePath }),
  storeImportedFile: (payload) => ipcRenderer.invoke('storage:store-imported-file', payload),
  writeJsonFile: (payload) => ipcRenderer.invoke('storage:write-json-file', payload),
  discoverStoredPapers: (payload) => ipcRenderer.invoke('storage:discover-papers', payload),
  openFilePath: (path) => ipcRenderer.invoke('storage:open-file', { path }),
  openExternalUrl: (url) => ipcRenderer.invoke('system:open-external-url', { url }),
  readFileBase64: (path) => ipcRenderer.invoke('storage:read-file-base64', { path }),
  sequenceLibraryList: (payload) => ipcRenderer.invoke('sequence-library:list', payload),
  sequenceLibraryGet: (payload) => ipcRenderer.invoke('sequence-library:get', payload),
  sequenceLibraryUpsert: (payload) => ipcRenderer.invoke('sequence-library:upsert', payload),
  sequenceLibraryPromote: (payload) => ipcRenderer.invoke('sequence-library:promote', payload),
  sequenceLibraryDelete: (payload) => ipcRenderer.invoke('sequence-library:delete', payload),
  sequenceLibrarySearchFeatures: (payload) => ipcRenderer.invoke('sequence-library:search-features', payload),
  sequenceLibraryAnnotate: (payload) => ipcRenderer.invoke('sequence-library:annotate', payload),
  sequenceLibraryRecognizeBackbone: (payload) => ipcRenderer.invoke('sequence-library:recognize-backbone', payload),
  getTelegramBotConfig: () => ipcRenderer.invoke('telegram:get-config'),
  setTelegramBotToken: (token) => ipcRenderer.invoke('telegram:set-token', { token }),
  clearTelegramBotToken: () => ipcRenderer.invoke('telegram:clear-token'),
  getCodexLlmStatus: () => ipcRenderer.invoke('llm:codex-status'),
  getCodexLlmCatalog: () => ipcRenderer.invoke('llm:codex-catalog'),
  loginCodexLlm: () => ipcRenderer.invoke('llm:codex-login'),
  clearCodexLlmLogin: () => ipcRenderer.invoke('llm:codex-clear-login'),
  setCodexLlmModel: (model) => ipcRenderer.invoke('llm:codex-set-model', { model }),
  setCodexLlmReasoningEffort: (reasoningEffort) => ipcRenderer.invoke('llm:codex-set-reasoning-effort', { reasoningEffort }),
  runCodexLlmPrompt: (payload) => ipcRenderer.invoke('llm:codex-generate', payload),
  agentChat: (payload) => ipcRenderer.invoke('agent:chat', payload),
  agentChatCancel: (payload) => ipcRenderer.invoke('agent:chat:cancel', payload),
  agentGenerateProtocol: (payload) => ipcRenderer.invoke('agent:generate-protocol', payload),
  agentChatLogCreateSession: (payload) => ipcRenderer.invoke('agent:chat-log:create-session', payload),
  agentChatLogListSessions: (payload) => ipcRenderer.invoke('agent:chat-log:list-sessions', payload),
  agentChatLogGetSession: (payload) => ipcRenderer.invoke('agent:chat-log:get-session', payload),
  agentDeveloperTestTools: (payload) => ipcRenderer.invoke('agent:developer:test-tools', payload),
  agentLogsListRequests: () => ipcRenderer.invoke('agent:logs:list-requests'),
  agentLogsReplay: (payload) => ipcRenderer.invoke('agent:logs:replay', payload),
  onAgentProgress: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on('agent-progress', listener);
    return () => {
      ipcRenderer.removeListener('agent-progress', listener);
    };
  },
  onTelegramCommand: (handler) => {
    if (typeof handler !== 'function') {
      return;
    }
    ipcRenderer.on('telegram-command', (_event, payload) => {
      handler(payload);
    });
  }
});
