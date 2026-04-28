'use strict';

const { SYSTEM } = require('../../../shared/ipc/channels');

function createSystemApi(ipcRenderer) {
  return {
    openExternalUrl: (url) => ipcRenderer.invoke(SYSTEM.OPEN_EXTERNAL_URL, { url })
  };
}

module.exports = {
  createSystemApi
};
