'use strict';

const { PLUGINS } = require('../../../shared/ipc/channels');

function createPluginApi(ipcRenderer) {
  return {
    inspectPluginFolder: (path) => ipcRenderer.invoke(PLUGINS.INSPECT_FOLDER, { path }),
    servePluginFolder: (id, path) => ipcRenderer.invoke(PLUGINS.SERVE_FOLDER, { id, path }),
    readPluginFile: (payload) => ipcRenderer.invoke(PLUGINS.READ_FILE, payload),
    writePluginFile: (payload) => ipcRenderer.invoke(PLUGINS.WRITE_FILE, payload),
    exportPluginFile: (payload) => ipcRenderer.invoke(PLUGINS.EXPORT_FILE, payload)
  };
}

module.exports = { createPluginApi };
