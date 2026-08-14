'use strict';

const { PYTHON } = require('../../../shared/ipc/channels');

function createPythonApi(ipcRenderer) {
  return {
    // payload: { code, files?, readback_paths?, timeout_ms? }
    runPython: (payload = {}) => ipcRenderer.invoke(PYTHON.RUN, payload)
  };
}

module.exports = {
  createPythonApi
};
