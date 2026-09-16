'use strict';

const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CODEX_RUNTIME_HOME_DIR_NAME
} = require('./constants');

function looksLikePath(value) {
  const text = String(value || '');
  if (!text) {
    return false;
  }
  return text.includes('/') || text.includes('\\') || text.startsWith('.') || path.isAbsolute(text);
}

function isRunnableFile(candidatePath) {
  const target = String(candidatePath || '').trim();
  if (!target) {
    return false;
  }
  try {
    const stat = fsSync.statSync(target);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function splitPathEntries(pathValue) {
  return String(pathValue || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPathCommandCandidates(commandName, pathValue = process.env.PATH) {
  const command = String(commandName || '').trim();
  if (!command) {
    return [];
  }

  const pathEntries = splitPathEntries(pathValue);
  const extCandidates = process.platform === 'win32'
    ? ['', '.exe', '.cmd', '.bat', '.com']
    : [''];
  const items = [];
  pathEntries.forEach((entry) => {
    extCandidates.forEach((ext) => {
      items.push(path.join(entry, `${command}${ext}`));
    });
  });
  return items;
}

function resolveCodexBinary() {
  const explicit = String(
    process.env.HIKARI_CODEX_CLI
      || process.env.HIKARI_CODEX_BIN
      || ''
  ).trim();
  const candidates = [];
  if (explicit) {
    candidates.push(explicit);
    if (!looksLikePath(explicit)) {
      candidates.push(...buildPathCommandCandidates(explicit));
    }
  }

  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Codex.app/Contents/Resources/codex',
      path.join(os.homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
      // The standalone Codex installer defaults here. Finder-launched Electron
      // apps do not normally inherit the user's shell PATH, so probe it
      // explicitly instead of assuming `codex` can be resolved by spawn().
      path.join(os.homedir(), '.local', 'bin', 'codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex'
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      path.join(os.homedir(), '.local', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/usr/bin/codex'
    );
  } else if (process.platform === 'win32') {
    const localAppData = String(process.env.LOCALAPPDATA || '').trim();
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
    }
  }

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'codex'));
  }
  if (process.execPath) {
    candidates.push(path.join(path.dirname(process.execPath), 'codex'));
  }

  candidates.push(...buildPathCommandCandidates('codex'));

  const seen = new Set();
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    if (looksLikePath(value) && isRunnableFile(value)) {
      return value;
    }
  }

  return explicit || 'codex';
}

function createCodexCliNotFoundError(cause = null) {
  const error = new Error(
    'Codex CLI was not found. Install Codex CLI, reopen Hikari, then sign in from Settings > Codex Model & Access.'
  );
  error.code = 'ENOENT';
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function executableUsesEnvNode(candidatePath = '') {
  const target = String(candidatePath || '').trim();
  if (!target || process.platform === 'win32') {
    return false;
  }
  let descriptor = null;
  try {
    descriptor = fsSync.openSync(target, 'r');
    const buffer = Buffer.alloc(512);
    const bytesRead = fsSync.readSync(descriptor, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/u, 1)[0];
    return /^#![^\r\n]*\benv(?:\s+-S)?\s+node(?:\s|$)/u.test(firstLine);
  } catch {
    return false;
  } finally {
    if (descriptor !== null) {
      try {
        fsSync.closeSync(descriptor);
      } catch {
        // Ignore close failures while probing an executable.
      }
    }
  }
}

function resolveCodexNodeBinary(codexBinary = '', env = process.env, options = {}) {
  const envSource = env && typeof env === 'object' ? env : process.env;
  const explicit = String(
    envSource.HIKARI_CODEX_NODE_PATH
      || envSource.HIKARI_NODE_PATH
      || ''
  ).trim();
  const processExecPath = Object.prototype.hasOwnProperty.call(options, 'processExecPath')
    ? String(options.processExecPath || '').trim()
    : String(process.execPath || '').trim();
  const commonNodePaths = Array.isArray(options.commonNodePaths)
    ? options.commonNodePaths
    : process.platform === 'darwin'
      ? ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/opt/local/bin/node', '/usr/bin/node']
      : ['/usr/local/bin/node', '/usr/bin/node'];
  const candidates = [];

  if (explicit) {
    candidates.push(explicit);
    if (!looksLikePath(explicit)) {
      candidates.push(...buildPathCommandCandidates(explicit, envSource.PATH));
    }
  }
  if (looksLikePath(codexBinary)) {
    candidates.push(path.join(path.dirname(codexBinary), process.platform === 'win32' ? 'node.exe' : 'node'));
  }
  if (/^node(?:\.exe)?$/iu.test(path.basename(processExecPath))) {
    candidates.push(processExecPath);
  }
  candidates.push(...buildPathCommandCandidates('node', envSource.PATH));
  candidates.push(...commonNodePaths);

  const seen = new Set();
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    if (looksLikePath(value) && isRunnableFile(value)) {
      return value;
    }
  }
  return '';
}

function resolveCodexInvocation(env = process.env, options = {}) {
  const codexBinary = String(options.codexBinary || resolveCodexBinary()).trim();
  if (!executableUsesEnvNode(codexBinary)) {
    return {
      command: codexBinary,
      argsPrefix: []
    };
  }
  const nodeBinary = resolveCodexNodeBinary(codexBinary, env, options);
  if (!nodeBinary) {
    return {
      command: codexBinary,
      argsPrefix: []
    };
  }
  return {
    command: nodeBinary,
    argsPrefix: [codexBinary]
  };
}

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

function isFilesystemRoot(candidatePath = '') {
  const value = String(candidatePath || '').trim();
  if (!value) {
    return false;
  }
  try {
    const resolved = path.resolve(value);
    return resolved === path.parse(resolved).root;
  } catch {
    return false;
  }
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

function getNativeCodexCliHomeDirectory() {
  const configuredHome = String(process.env.CODEX_HOME || '').trim();
  if (configuredHome) {
    return configuredHome;
  }
  return path.join(os.homedir(), '.codex');
}

function getCodexCliHomeDirectory() {
  const appManagedHome = String(process.env.HIKARI_CODEX_HOME || '').trim();
  if (appManagedHome) {
    return appManagedHome;
  }
  return getNativeCodexCliHomeDirectory();
}

function getCodexCliCandidateHomeDirectories() {
  return [...new Set([
    getCodexCliHomeDirectory(),
    getNativeCodexCliHomeDirectory()
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function getCodexCliAuthFilePath() {
  return path.join(getCodexCliHomeDirectory(), 'auth.json');
}

function resolveCodexCliRuntimeHomeDirectory(cwd = '') {
  const explicit = String(process.env.HIKARI_CODEX_HOME || '').trim();
  if (explicit) {
    return explicit;
  }
  const safeCwd = resolveWorkingDirectory(cwd);
  return path.join(safeCwd, 'Config', CODEX_RUNTIME_HOME_DIR_NAME);
}

module.exports = {
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
