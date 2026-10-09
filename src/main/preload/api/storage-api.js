'use strict';

const { STORAGE } = require('../../../shared/ipc/channels');

function createStorageApi(ipcRenderer) {
  function subscribe(channel, handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  }

  return {
    autoSaveDataFile: (data, filePath) => ipcRenderer.invoke(STORAGE.AUTO_SAVE, { data, filePath }),
    syncSqliteBundle: (payload) => ipcRenderer.invoke(STORAGE.SYNC_SQLITE_BUNDLE, payload),
    pickStorageDirectory: (currentPath) => ipcRenderer.invoke(STORAGE.PICK_DIRECTORY, { currentPath }),
    ensureStorageDirectory: (path) => ipcRenderer.invoke(STORAGE.ENSURE_DIRECTORY, { path }),
    importStorageRoot: (storagePath) => ipcRenderer.invoke(STORAGE.IMPORT_ROOT, { storagePath }),
    getLastStorageRoot: () => ipcRenderer.invoke(STORAGE.LAST_ROOT),
    getCloudDriveStatus: () => ipcRenderer.invoke(STORAGE.CLOUD_STATUS),
    connectCloudDrive: (provider) => ipcRenderer.invoke(STORAGE.CLOUD_CONNECT, { provider }),
    cancelCloudDriveLogin: (provider) => ipcRenderer.invoke(STORAGE.CLOUD_CANCEL_LOGIN, { provider }),
    disconnectCloudDrive: (provider) => ipcRenderer.invoke(STORAGE.CLOUD_DISCONNECT, { provider }),
    listCloudWorkspaces: (provider) => ipcRenderer.invoke(STORAGE.CLOUD_WORKSPACES, { provider }),
    linkCloudWorkspace: (payload) => ipcRenderer.invoke(STORAGE.CLOUD_LINK, payload),
    unlinkCloudWorkspace: (provider) => ipcRenderer.invoke(STORAGE.CLOUD_UNLINK, { provider }),
    syncCloudWorkspace: (payload) => ipcRenderer.invoke(STORAGE.CLOUD_SYNC, payload),
    onCloudDriveChanged: (handler) => subscribe(STORAGE.CLOUD_CHANGED, handler),
    onCloudDriveSyncCheck: (handler) => subscribe(STORAGE.CLOUD_CHECK, handler),
    respondToCloudDriveSyncCheck: (payload) => ipcRenderer.send(STORAGE.CLOUD_CHECK_RESPONSE, payload),
    storeImportedFile: (payload) => ipcRenderer.invoke(STORAGE.STORE_IMPORTED_FILE, payload),
    moveStoredFile: (payload) => ipcRenderer.invoke(STORAGE.MOVE_STORED_FILE, payload),
    transformStoredPaperPdf: (payload) => ipcRenderer.invoke(STORAGE.TRANSFORM_PAPER_PDF, payload),
    writeJsonFile: (payload) => ipcRenderer.invoke(STORAGE.WRITE_JSON_FILE, payload),
    discoverStoredPapers: (payload) => ipcRenderer.invoke(STORAGE.DISCOVER_PAPERS, payload),
    openFilePath: (path) => ipcRenderer.invoke(STORAGE.OPEN_FILE, { path }),
    readFileBytes: (path) => ipcRenderer.invoke(STORAGE.READ_FILE_BYTES, { path }),
    readFileBase64: (path) => ipcRenderer.invoke(STORAGE.READ_FILE_BASE64, { path }),
    appendNotebookPageLog: (payload) => ipcRenderer.invoke(STORAGE.APPEND_NOTEBOOK_PAGE_LOG, payload),
    onProtocolRecordSaved: (handler) => subscribe(STORAGE.PROTOCOL_RECORD_SAVED, handler),
    onPaperFileSaved: (handler) => subscribe(STORAGE.PAPER_FILE_SAVED, handler)
  };
}

module.exports = {
  createStorageApi
};
