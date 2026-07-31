'use strict';

const { createAgentApi } = require('./api/agent-api');
const { createAssayApi } = require('./api/assay-api');
const { createGenomeApi } = require('./api/genome-api');
const { createInventoryApi } = require('./api/inventory-api');
const { createLlmApi } = require('./api/llm-api');
const { createSequenceLibraryApi } = require('./api/sequence-library-api');
const { createScheduledTaskApi } = require('./api/scheduled-task-api');
const { createStorageApi } = require('./api/storage-api');
const { createSystemApi } = require('./api/system-api');
const { createTelegramApi } = require('./api/telegram-api');

function createPreloadApi(ipcRenderer, deps = {}) {
  return {
    ...createStorageApi(ipcRenderer),
    ...createSystemApi(ipcRenderer, deps),
    ...createAssayApi(ipcRenderer),
    ...createInventoryApi(ipcRenderer),
    ...createSequenceLibraryApi(ipcRenderer),
    ...createGenomeApi(ipcRenderer),
    ...createScheduledTaskApi(ipcRenderer),
    ...createTelegramApi(ipcRenderer),
    ...createLlmApi(ipcRenderer),
    ...createAgentApi(ipcRenderer)
  };
}

module.exports = {
  createPreloadApi
};
