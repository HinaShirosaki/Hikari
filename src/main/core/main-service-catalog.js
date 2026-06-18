'use strict';

const { createAppServiceDefinitions } = require('./catalog/app-services');
const { createAgentServiceDefinitions } = require('./catalog/agent-services');
const { createIpcServiceDefinitions } = require('./catalog/ipc-services');

function createMainServiceCatalog(context = {}) {
  return [
    ...createAppServiceDefinitions(context),
    ...createAgentServiceDefinitions(context),
    ...createIpcServiceDefinitions(context)
  ];
}

module.exports = {
  createMainServiceCatalog
};
