'use strict';

// Branch before loading application services or taking the single-instance lock.
if (process.argv.includes('--hikari-mcp-stdio')) {
  require('./agent/mcp-contract/electron-stdio-entry').startElectronMcpStdio();
} else if (process.argv.some((arg) => arg.startsWith('--hikari-swap-into='))) {
  // Windows portable update: this new build copies itself over the old app folder.
  // noAsar: copy app.asar as a file, not through Electron's asar view of it.
  process.noAsar = true;
  const { app } = require('electron');
  require('./updater/finish-portable-update').finishPortableUpdate().finally(() => app.exit(0));
} else {
  const { startMainApp } = require('./app/start-main-app');
  startMainApp();
}
