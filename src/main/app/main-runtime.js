'use strict';

const { createHikariMainCore } = require('../core/start-hikari-main-core');

function createMainRuntime(options) {
  return createHikariMainCore(options);
}

module.exports = {
  createMainRuntime
};
