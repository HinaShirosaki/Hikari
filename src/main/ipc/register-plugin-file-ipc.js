'use strict';

const { PLUGINS } = require('../../shared/ipc/channels');
const { readPluginFile, writePluginFile } = require('../lib/plugin-files');

function registerPluginFileIpc({ ipcMain }) {
  for (const [channel, operation] of [
    [PLUGINS.READ_FILE, readPluginFile],
    [PLUGINS.WRITE_FILE, writePluginFile]
  ]) {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        return { ok: true, ...await operation(payload) };
      } catch (error) {
        return {
          ok: false,
          error: error?.code
            ? `Plugin file operation failed (${error.code}).`
            : String(error?.message || error)
        };
      }
    });
  }
}

module.exports = { registerPluginFileIpc };
