'use strict';

// Enabled by the desktop service, so importing the provider in tests/tools never
// installs software. Every CLI entry point shares the same pending update.
let updater = null;

function setCodexCliUpdater(service) {
  updater = service || null;
}

async function ensureCodexCliUpdated() {
  return updater?.ensureLatest();
}

function getCodexCliUpdateStatus() {
  return updater?.getStatus() || {};
}

module.exports = { ensureCodexCliUpdated, getCodexCliUpdateStatus, setCodexCliUpdater };
