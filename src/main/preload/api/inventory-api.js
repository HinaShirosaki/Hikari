'use strict';

const { INVENTORY } = require('../../../shared/ipc/channels');

function createInventoryApi(ipcRenderer) {
  return {
    parseChemicalImportFile: (payload) => ipcRenderer.invoke(INVENTORY.PARSE_CHEMICAL_IMPORT, payload)
  };
}

module.exports = {
  createInventoryApi
};
