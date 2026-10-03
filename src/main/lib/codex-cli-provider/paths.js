'use strict';

const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isFilesystemRoot } = require('../path-safety.js');
const {
  CODEX_RUNTIME_HOME_DIR_NAME
} = require('./constants');

const {
  HIKARI_PRIVATE_NODE_PATH,
  createCodexCliNotFoundError,
  getCodexCliAvailability,
  resolveCodexBinary,
  resolveCodexInvocation,
  resolveCodexNodeBinary
} = require('./cli-discovery');

function pickExistingDirectory(candidates) {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value || isFilesystemRoot(value)) {
      continue;
    }
    try {
      if (fsSync.statSync(value).isDirectory()) {
        return value;
      }
    } catch {
      // Keep scanning fallbacks.
    }
  }
  return '';
}

function resolveWorkingDirectory(cwd = '') {
  const resolved = pickExistingDirectory([
    cwd,
    process.env.HIKARI_CODEX_WORKSPACE,
    process.env.HIKARI_APP_DATA_ROOT,
    process.cwd(),
    os.homedir(),
    path.dirname(process.execPath)
  ]);
  return resolved || os.homedir() || process.cwd();
}

function getNativeCodexCliHomeDirectory(env = process.env) {
  const configuredHome = String(env.CODEX_HOME || '').trim();
  if (configuredHome) {
    return configuredHome;
  }
  return path.join(os.homedir(), '.codex');
}

function getCodexCliHomeDirectory(env = process.env) {
  const appManagedHome = String(env.HIKARI_CODEX_HOME || '').trim();
  if (appManagedHome) {
    return appManagedHome;
  }
  return getNativeCodexCliHomeDirectory(env);
}

function getCodexCliCandidateHomeDirectories(env = process.env) {
  return [...new Set([
    getCodexCliHomeDirectory(env),
    getNativeCodexCliHomeDirectory(env)
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function getCodexCliAuthFilePath(env = process.env) {
  return path.join(getCodexCliHomeDirectory(env), 'auth.json');
}

function resolveCodexCliRuntimeHomeDirectory(cwd = '', env = process.env) {
  const explicit = String(env.HIKARI_CODEX_HOME || '').trim();
  if (explicit) {
    return explicit;
  }
  const safeCwd = resolveWorkingDirectory(cwd);
  return path.join(safeCwd, 'Config', CODEX_RUNTIME_HOME_DIR_NAME);
}

module.exports = {
  HIKARI_PRIVATE_NODE_PATH,
  getCodexCliAvailability,
  getCodexCliAuthFilePath,
  getCodexCliCandidateHomeDirectories,
  getCodexCliHomeDirectory,
  getNativeCodexCliHomeDirectory,
  createCodexCliNotFoundError,
  isFilesystemRoot,
  resolveCodexBinary,
  resolveCodexInvocation,
  resolveCodexNodeBinary,
  resolveCodexCliRuntimeHomeDirectory,
  resolveWorkingDirectory
};
