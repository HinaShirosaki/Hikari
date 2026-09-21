'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  ensureHikariCodexAgentsFile,
  ensureHikariCodexMcpConfig
} = require('../../agent/codex-agent/runtime-files.js');
const {
  CODEX_CONFIG_FILE,
  CODEX_MODELS_CACHE_FILE,
  CODEX_RUNTIME_HOME_DIRS,
  CODEX_RUNTIME_HOME_FILES
} = require('./constants');
const {
  copyFileIfChanged,
  copyPathIfMissing,
  getPathStats,
  isDirectoryLike,
  pathExists
} = require('./fs-utils');
const {
  getNativeCodexCliHomeDirectory,
  resolveCodexCliRuntimeHomeDirectory,
  resolveWorkingDirectory
} = require('./paths');

const SUPPORTED_CODEX_CLI_REASONING_EFFORTS = new Set([
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh'
]);

function normalizeCodexCliModelsCache(rawValue = '') {
  try {
    const parsed = JSON.parse(String(rawValue || ''));
    if (!Array.isArray(parsed?.models)) {
      return String(rawValue || '');
    }
    let changed = false;
    const models = parsed.models.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }
      let nextEntry = entry;
      if (!Object.prototype.hasOwnProperty.call(entry, 'supports_reasoning_summaries')) {
        nextEntry = {
          ...nextEntry,
          supports_reasoning_summaries: Boolean(String(entry.default_reasoning_summary || '').trim())
        };
        changed = true;
      }
      if (!Array.isArray(entry.supported_reasoning_levels)) {
        return nextEntry;
      }
      const supportedReasoningLevels = entry.supported_reasoning_levels.filter((level) => (
        SUPPORTED_CODEX_CLI_REASONING_EFFORTS.has(String(level?.effort || '').trim().toLowerCase())
      ));
      if (supportedReasoningLevels.length === entry.supported_reasoning_levels.length) {
        return nextEntry;
      }
      changed = true;
      nextEntry = {
        ...nextEntry,
        supported_reasoning_levels: supportedReasoningLevels
      };
      const defaultReasoningEffort = String(entry.default_reasoning_level || '').trim().toLowerCase();
      if (!SUPPORTED_CODEX_CLI_REASONING_EFFORTS.has(defaultReasoningEffort)) {
        nextEntry.default_reasoning_level = String(supportedReasoningLevels.at(-1)?.effort || '');
      }
      return nextEntry;
    });
    return changed
      ? `${JSON.stringify({ ...parsed, models }, null, 2)}\n`
      : String(rawValue || '');
  } catch {
    return String(rawValue || '');
  }
}

async function copyCompatibleCodexCliModelsCache(sourcePath = '', targetPath = '') {
  try {
    const source = await fs.readFile(sourcePath, 'utf8');
    const compatible = normalizeCodexCliModelsCache(source);
    const current = await fs.readFile(targetPath, 'utf8').catch(() => '');
    if (current === compatible) {
      return false;
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, compatible, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function syncCodexCliRuntimePluginCacheEntry(sourcePath = '', targetPath = '', depth = 0) {
  const sourceStats = await getPathStats(sourcePath, { followSymlink: true });
  if (!sourceStats) {
    return false;
  }
  const targetStats = await getPathStats(targetPath);
  if (!targetStats) {
    return copyPathIfMissing(sourcePath, targetPath);
  }
  if (!sourceStats.isDirectory() || !(await isDirectoryLike(targetPath)) || depth >= 2) {
    return false;
  }
  let entries = [];
  try {
    entries = await fs.readdir(sourcePath, { withFileTypes: true });
  } catch {
    return false;
  }
  const results = await Promise.all(entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => syncCodexCliRuntimePluginCacheEntry(
      path.join(sourcePath, entry.name),
      path.join(targetPath, entry.name),
      depth + 1
    )));
  return results.some(Boolean);
}

async function syncCodexCliRuntimePluginCache(sourceHome = '', runtimeHome = '') {
  const sourceCacheRoot = path.join(sourceHome, 'plugins', 'cache');
  const targetCacheRoot = path.join(runtimeHome, 'plugins', 'cache');
  if (path.resolve(sourceCacheRoot) === path.resolve(targetCacheRoot)) {
    return false;
  }
  if (!(await isDirectoryLike(sourceCacheRoot))) {
    return false;
  }
  await fs.mkdir(targetCacheRoot, { recursive: true });
  let marketplaces = [];
  try {
    marketplaces = await fs.readdir(sourceCacheRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  const results = await Promise.all(marketplaces
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => syncCodexCliRuntimePluginCacheEntry(
      path.join(sourceCacheRoot, entry.name),
      path.join(targetCacheRoot, entry.name)
    )));
  return results.some(Boolean);
}

async function writeRuntimeGuidance(runtimeHome = '', cwd = '', options = {}) {
  await ensureHikariCodexMcpConfig(path.join(runtimeHome, CODEX_CONFIG_FILE), {
    workspace: resolveWorkingDirectory(cwd),
    envOverrides: options.envOverrides,
    dataFilePath: options.dataFilePath,
    storagePath: options.storagePath,
    mcpHostUrl: options.mcpHostUrl,
    mcpToken: options.mcpToken
  });
  await ensureHikariCodexAgentsFile(runtimeHome).catch(() => '');
}

async function ensureCodexCliRuntimeHome(cwd = '', options = {}) {
  const runtimeHome = resolveCodexCliRuntimeHomeDirectory(cwd);
  if (!runtimeHome) {
    return '';
  }
  await fs.mkdir(runtimeHome, { recursive: true });
  await Promise.all(CODEX_RUNTIME_HOME_DIRS.map((dirName) => (
    fs.mkdir(path.join(runtimeHome, dirName), { recursive: true }).catch(() => {})
  )));

  const sourceHome = getNativeCodexCliHomeDirectory();
  if (!sourceHome) {
    await writeRuntimeGuidance(runtimeHome, cwd, options);
    return runtimeHome;
  }
  const resolvedSource = path.resolve(sourceHome);
  const resolvedTarget = path.resolve(runtimeHome);
  if (resolvedSource === resolvedTarget || !(await pathExists(resolvedSource))) {
    await writeRuntimeGuidance(runtimeHome, cwd, options);
    return runtimeHome;
  }

  await Promise.all(CODEX_RUNTIME_HOME_FILES
    .filter((fileName) => fileName !== CODEX_MODELS_CACHE_FILE)
    .map((fileName) => (
    copyFileIfChanged(
      path.join(resolvedSource, fileName),
      path.join(resolvedTarget, fileName)
    )
  )));
  await copyCompatibleCodexCliModelsCache(
    path.join(resolvedSource, CODEX_MODELS_CACHE_FILE),
    path.join(resolvedTarget, CODEX_MODELS_CACHE_FILE)
  );
  await syncCodexCliRuntimePluginCache(resolvedSource, resolvedTarget);
  await writeRuntimeGuidance(runtimeHome, cwd, options);
  return runtimeHome;
}

async function buildCodexCommandEnv(cwd = '', options = {}) {
  const env = {
    ...process.env
  };
  const runtimeHome = await ensureCodexCliRuntimeHome(cwd, {
    envOverrides: options.envOverrides
  });
  if (runtimeHome) {
    env.CODEX_HOME = runtimeHome;
  }
  return env;
}

module.exports = {
  buildCodexCommandEnv,
  copyCompatibleCodexCliModelsCache,
  ensureCodexCliRuntimeHome,
  normalizeCodexCliModelsCache,
  syncCodexCliRuntimePluginCache,
  syncCodexCliRuntimePluginCacheEntry
};
