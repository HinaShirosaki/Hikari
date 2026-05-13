'use strict';

const { ASSAY } = require('../../../shared/ipc/channels');

function createAssayApi(ipcRenderer) {
  return {
    parseAssayResultImportFile: (payload) => ipcRenderer.invoke(ASSAY.PARSE_RESULT_IMPORT, payload)
  };
}

module.exports = {
  createAssayApi
};
