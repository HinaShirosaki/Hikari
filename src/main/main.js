'use strict';

// Cookies are Chromium's only Keychain-encrypted data, and Hikari doesn't need
// them protected. Ad hoc builds change identity on every update, so the real
// Keychain would ask for access after each one.
if (process.platform === 'darwin') require('electron').app.commandLine.appendSwitch('use-mock-keychain');

// Branch before loading application services or taking the single-instance lock.
if (process.argv.some((arg) => arg.startsWith('--hikari-swap-into='))) {
  // Windows portable update: this new build copies itself over the old app folder.
  const { app } = require('electron');
  const { finishPortableUpdate } = require('./updater/finish-portable-update');
  // Only after loading (this code lives in app.asar): copy app.asar as a file,
  // not through Electron's asar view of it.
  process.noAsar = true;
  finishPortableUpdate().finally(() => app.exit(0));
} else if (require('./updater/app-code').loadNewerAppCode()) {
  // An app-only update downloaded a newer Hikari; its main.js ran instead of this one.
} else if (process.argv.includes('--hikari-mcp-stdio')) {
  require('./agent/mcp-contract/electron-stdio-entry').startElectronMcpStdio();
} else {
  const { startMainApp } = require('./app/start-main-app');
  startMainApp();
}
