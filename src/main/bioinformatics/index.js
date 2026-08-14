'use strict';

const { createBlastService } = require('./blast-service');
const { createBioinformaticsRequestClient } = require('./request-client');
const { createUniProtService } = require('./uniprot-service');

function createBioinformaticsService(deps = {}) {
  const client = createBioinformaticsRequestClient(deps);
  return {
    ...createBlastService({ ...deps, requestText: client.requestText }),
    ...createUniProtService({ ...deps, requestText: client.requestText }),
    stop: client.stop
  };
}

module.exports = {
  createBioinformaticsService
};
