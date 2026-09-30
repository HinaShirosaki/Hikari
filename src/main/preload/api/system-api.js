'use strict';

const { SYSTEM } = require('../../../shared/ipc/channels');

function createSystemApi(ipcRenderer) {
  return {
    openExternalUrl: (url) => ipcRenderer.invoke(SYSTEM.OPEN_EXTERNAL_URL, { url }),
    onAppCloseRequested: (handler) => {
      if (typeof handler !== 'function') {
        return () => {};
      }
      const listener = () => handler();
      ipcRenderer.on(SYSTEM.APP_CLOSE_REQUESTED, listener);
      return () => ipcRenderer.removeListener(SYSTEM.APP_CLOSE_REQUESTED, listener);
    },
    respondToAppClose: (action) => {
      ipcRenderer.send(SYSTEM.APP_CLOSE_RESPONSE, {
        action: String(action || '').trim()
      });
    },
    reportError: (payload) => ipcRenderer.send(SYSTEM.REPORT_ERROR, payload),
    openLogsFolder: () => ipcRenderer.invoke(SYSTEM.OPEN_LOGS_FOLDER),
    openThirdPartyNotices: () => ipcRenderer.invoke(SYSTEM.OPEN_THIRD_PARTY_NOTICES),
    getUpdateStatus: () => ipcRenderer.invoke(SYSTEM.UPDATE_STATUS),
    checkForUpdates: () => ipcRenderer.invoke(SYSTEM.CHECK_FOR_UPDATES),
    installUpdate: () => ipcRenderer.invoke(SYSTEM.INSTALL_UPDATE)
  };
}

module.exports = {
  createSystemApi
};
