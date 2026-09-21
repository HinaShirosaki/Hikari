'use strict';

// Branch before loading application services or taking the single-instance lock.
if (process.argv.includes('--hikari-mcp-stdio')) {
  require('./agent/mcp-contract/electron-stdio-entry').startElectronMcpStdio();
} else {
  const { startMainApp } = require('./app/start-main-app');
  startMainApp();
}
