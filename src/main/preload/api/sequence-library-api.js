'use strict';

const { SEQUENCE_LIBRARY } = require('../../../shared/ipc/channels');

function createSequenceLibraryApi(ipcRenderer) {
  return {
    sequenceLibraryList: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.LIST, payload),
    sequenceLibraryGet: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.GET, payload),
    sequenceLibraryUpsert: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.UPSERT, payload),
    sequenceLibraryPromote: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.PROMOTE, payload),
    sequenceLibraryDelete: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.DELETE, payload),
    sequenceLibrarySearchFeatures: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.SEARCH_FEATURES, payload),
    sequenceLibraryListBackbones: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.LIST_BACKBONES, payload),
    sequenceLibraryUpsertBackbone: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.UPSERT_BACKBONE, payload),
    sequenceLibraryAnnotate: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.ANNOTATE, payload),
    sequenceLibraryRecognizeBackbone: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.RECOGNIZE_BACKBONE, payload)
  };
}

module.exports = {
  createSequenceLibraryApi
};
