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

function buildPathCommandCandidates(commandName) {
  const command = String(commandName || '').trim();
  if (!command) {
    return [];
  }

  const pathEntries = splitPathEntries(process.env.PATH);
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
      || process.env.ENANA_CODEX_CLI
      || process.env.ENANA_CODEX_BIN
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
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex'
    );
  } else if (process.platform === 'linux') {
    candidates.push('/usr/local/bin/codex', '/usr/bin/codex');
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
    process.env.ENANA_CODEX_WORKSPACE,
    process.env.ENANA_APP_DATA_ROOT,
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
  const appManagedHome = String(process.env.HIKARI_CODEX_HOME || process.env.ENANA_CODEX_HOME || '').trim();
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
  const explicit = String(process.env.HIKARI_CODEX_HOME || process.env.ENANA_CODEX_HOME || '').trim();
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
  isFilesystemRoot,
  resolveCodexBinary,
  resolveCodexCliRuntimeHomeDirectory,
  resolveWorkingDirectory
};
