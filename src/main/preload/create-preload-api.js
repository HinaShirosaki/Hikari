'use strict';

const { createAgentApi } = require('./api/agent-api');
const { createAssayApi } = require('./api/assay-api');
const { createBioinformaticsApi } = require('./api/bioinformatics-api');
const { createGenomeApi } = require('./api/genome-api');
const { createInventoryApi } = require('./api/inventory-api');
const { createLlmApi } = require('./api/llm-api');
const { createPythonApi } = require('./api/python-api');
const { createSequenceLibraryApi } = require('./api/sequence-library-api');
const { createScheduledTaskApi } = require('./api/scheduled-task-api');
const { createStorageApi } = require('./api/storage-api');
const { createSystemApi } = require('./api/system-api');

function createPreloadApi(ipcRenderer, deps = {}) {
  return {
    platform: process.platform,
    ...createStorageApi(ipcRenderer),
    ...createSystemApi(ipcRenderer, deps),
    ...createAssayApi(ipcRenderer),
    ...createBioinformaticsApi(ipcRenderer),
    ...createInventoryApi(ipcRenderer),
    ...createSequenceLibraryApi(ipcRenderer),
    ...createGenomeApi(ipcRenderer),
    ...createScheduledTaskApi(ipcRenderer),
    ...createLlmApi(ipcRenderer),
    ...createPythonApi(ipcRenderer),
    ...createAgentApi(ipcRenderer)
  };
}

module.exports = {
  createPreloadApi
};
