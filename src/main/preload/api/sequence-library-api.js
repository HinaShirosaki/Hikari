'use strict';

const { SEQUENCE_LIBRARY } = require('../../../shared/ipc/channels');

function createSequenceLibraryApi(ipcRenderer) {
  return {
    sequenceLibraryAgentArtifact: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.AGENT_ARTIFACT, payload),
    sequenceLibraryList: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.LIST, payload),
    sequenceLibraryGet: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.GET, payload),
    sequenceLibraryUpsert: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.UPSERT, payload),
    sequenceLibraryPromote: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.PROMOTE, payload),
    sequenceLibraryDelete: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.DELETE, payload),
    sequenceLibraryUpsertFolder: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.UPSERT_FOLDER, payload),
    sequenceLibraryDeleteFolder: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.DELETE_FOLDER, payload),
    sequenceLibraryMoveEntry: (payload) => ipcRenderer.invoke(SEQUENCE_LIBRARY.MOVE_ENTRY, payload),
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
