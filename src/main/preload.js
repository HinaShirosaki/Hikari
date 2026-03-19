const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('enanaApi', {
  saveEnaFile: (data, filePath) => ipcRenderer.invoke('ena:save', { data, filePath }),
  loadEnaFile: () => ipcRenderer.invoke('ena:load'),
  autoSaveDataFile: (data, filePath) => ipcRenderer.invoke('data:auto-save', { data, filePath }),
  autoLoadDataFile: (filePath) => ipcRenderer.invoke('data:auto-load', { filePath }),
  pickStorageDirectory: (currentPath) => ipcRenderer.invoke('storage:pick-directory', { currentPath }),
  ensureStorageDirectory: (path) => ipcRenderer.invoke('storage:ensure-directory', { path }),
  storeImportedFile: (payload) => ipcRenderer.invoke('storage:store-imported-file', payload),
  openFilePath: (path) => ipcRenderer.invoke('storage:open-file', { path }),
  sequenceLibraryList: (payload) => ipcRenderer.invoke('sequence-library:list', payload),
  sequenceLibraryGet: (payload) => ipcRenderer.invoke('sequence-library:get', payload),
  sequenceLibraryUpsert: (payload) => ipcRenderer.invoke('sequence-library:upsert', payload),
  sequenceLibraryPromote: (payload) => ipcRenderer.invoke('sequence-library:promote', payload),
  sequenceLibraryDelete: (payload) => ipcRenderer.invoke('sequence-library:delete', payload),
  plannotateCheckEnv: (dbDir = '') => ipcRenderer.invoke('plannotate:check-env', { dbDir }),
  plannotateAnnotate: (payload) => ipcRenderer.invoke('plannotate:annotate', payload),
  plannotateGenerateGbk: (payload) => ipcRenderer.invoke('plannotate:generate-gbk', payload),
  plannotateInstallAll: () => ipcRenderer.invoke('plannotate:install-all'),
  getTelegramBotConfig: () => ipcRenderer.invoke('telegram:get-config'),
  setTelegramBotToken: (token) => ipcRenderer.invoke('telegram:set-token', { token }),
  clearTelegramBotToken: () => ipcRenderer.invoke('telegram:clear-token'),
  getCodexLlmStatus: () => ipcRenderer.invoke('llm:codex-status'),
  runCodexLlmPrompt: (payload) => ipcRenderer.invoke('llm:codex-generate', payload),
  agentChat: (payload) => ipcRenderer.invoke('agent:chat', payload),
  getAgentIoContract: () => ipcRenderer.invoke('agent:get-io-contract'),
  agentLogsListRequests: () => ipcRenderer.invoke('agent:logs:list-requests'),
  agentLogsReplay: (payload) => ipcRenderer.invoke('agent:logs:replay', payload),
  onTelegramCommand: (handler) => {
    if (typeof handler !== 'function') {
      return;
    }
    ipcRenderer.on('telegram-command', (_event, payload) => {
      handler(payload);
    });
  }
});
