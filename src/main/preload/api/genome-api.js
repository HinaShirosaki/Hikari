'use strict';

const { GENOME } = require('../../../shared/ipc/channels');

function createGenomeApi(ipcRenderer) {
  return {
    listGenomes: () => ipcRenderer.invoke(GENOME.LIST),
    getGenome: (id) => ipcRenderer.invoke(GENOME.GET, { id }),
    // Opens the native picker in the main process; the renderer never handles a path.
    addGenome: (payload = {}) => ipcRenderer.invoke(GENOME.ADD, payload),
    removeGenome: (id) => ipcRenderer.invoke(GENOME.REMOVE, { id }),
    readGenomeRegion: (payload = {}) => ipcRenderer.invoke(GENOME.READ_REGION, payload)
  };
}

module.exports = {
  createGenomeApi
};
