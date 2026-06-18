'use strict';

const { createMainServiceCatalog } = require('./main-service-catalog');
const { createMainServiceLifecycle } = require('./service-lifecycle');

function createHikariMainCore(options = {}) {
  const lifecycle = createMainServiceLifecycle({
    definitions: createMainServiceCatalog(options),
    context: options
  });
  const appMetadata = lifecycle.getService('app-metadata');

  return {
    appIconPath: appMetadata.appIconPath,
    getService: lifecycle.getService,
    listServices: lifecycle.listServices,
    onAppReady: lifecycle.startServices,
    registerIpcHandlers: lifecycle.registerIpcHandlers,
    shutdown: lifecycle.stopServices
  };
}

module.exports = {
  createHikariMainCore,
  createMainRuntime: createHikariMainCore
};
