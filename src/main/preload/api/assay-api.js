'use strict';

const { ASSAY } = require('../../../shared/ipc/channels');

function createAssayApi(ipcRenderer) {
  return {
    parseAssayResultImportFile: (payload) => ipcRenderer.invoke(ASSAY.PARSE_RESULT_IMPORT, payload),
    onAssayPlotRequest: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on(ASSAY.PLOT_REQUEST, listener);
      return () => ipcRenderer.removeListener(ASSAY.PLOT_REQUEST, listener);
    },
    respondToAssayPlotRequest: (payload) => ipcRenderer.send(ASSAY.PLOT_RESPONSE, payload)
  };
}

module.exports = {
  createAssayApi
};
