'use strict';

const { STORAGE } = require('../../../shared/ipc/channels');

function createStorageApi(ipcRenderer) {
  return {
    autoSaveDataFile: (data, filePath) => ipcRenderer.invoke(STORAGE.AUTO_SAVE, { data, filePath }),
    syncSqliteBundle: (payload) => ipcRenderer.invoke(STORAGE.SYNC_SQLITE_BUNDLE, payload),
    pickStorageDirectory: (currentPath) => ipcRenderer.invoke(STORAGE.PICK_DIRECTORY, { currentPath }),
    ensureStorageDirectory: (path) => ipcRenderer.invoke(STORAGE.ENSURE_DIRECTORY, { path }),
    importStorageRoot: (storagePath) => ipcRenderer.invoke(STORAGE.IMPORT_ROOT, { storagePath }),
    storeImportedFile: (payload) => ipcRenderer.invoke(STORAGE.STORE_IMPORTED_FILE, payload),
    writeJsonFile: (payload) => ipcRenderer.invoke(STORAGE.WRITE_JSON_FILE, payload),
    discoverStoredPapers: (payload) => ipcRenderer.invoke(STORAGE.DISCOVER_PAPERS, payload),
    openFilePath: (path) => ipcRenderer.invoke(STORAGE.OPEN_FILE, { path }),
    readFileBase64: (path) => ipcRenderer.invoke(STORAGE.READ_FILE_BASE64, { path })
  };
}

module.exports = {
  createStorageApi
};
