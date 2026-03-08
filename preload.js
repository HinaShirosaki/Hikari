const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('enanaApi', {
  saveEnaFile: (data, filePath) => ipcRenderer.invoke('ena:save', { data, filePath }),
  loadEnaFile: () => ipcRenderer.invoke('ena:load'),
  autoSaveDataFile: (data, filePath) => ipcRenderer.invoke('data:auto-save', { data, filePath }),
  autoLoadDataFile: (filePath) => ipcRenderer.invoke('data:auto-load', { filePath }),
  pickStorageDirectory: (currentPath) => ipcRenderer.invoke('storage:pick-directory', { currentPath }),
  ensureStorageDirectory: (path) => ipcRenderer.invoke('storage:ensure-directory', { path }),
  plannotateCheckEnv: (dbDir = '') => ipcRenderer.invoke('plannotate:check-env', { dbDir }),
  plannotateAnnotate: (payload) => ipcRenderer.invoke('plannotate:annotate', payload),
  getTelegramBotConfig: () => ipcRenderer.invoke('telegram:get-config'),
  setTelegramBotToken: (token) => ipcRenderer.invoke('telegram:set-token', { token }),
  clearTelegramBotToken: () => ipcRenderer.invoke('telegram:clear-token'),
  agentChat: (payload) => ipcRenderer.invoke('agent:chat', payload),
  onTelegramCommand: (handler) => {
    if (typeof handler !== 'function') {
      return;
    }
    ipcRenderer.on('telegram-command', (_event, payload) => {
      handler(payload);
    });
  }
});
