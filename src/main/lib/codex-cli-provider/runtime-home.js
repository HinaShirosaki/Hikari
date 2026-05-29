'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  ensureHikariCodexAgentsFile,
  ensureHikariCodexMcpConfig
} = require('../../helpers/agent/codex-agent/runtime-files.js');
const {
  CODEX_CONFIG_FILE,
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

async function writeRuntimeGuidance(runtimeHome = '', cwd = '') {
  await ensureHikariCodexMcpConfig(path.join(runtimeHome, CODEX_CONFIG_FILE), {
    workspace: resolveWorkingDirectory(cwd)
  });
  await ensureHikariCodexAgentsFile(runtimeHome).catch(() => '');
}

async function ensureCodexCliRuntimeHome(cwd = '') {
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
    await writeRuntimeGuidance(runtimeHome, cwd);
    return runtimeHome;
  }
  const resolvedSource = path.resolve(sourceHome);
  const resolvedTarget = path.resolve(runtimeHome);
  if (resolvedSource === resolvedTarget || !(await pathExists(resolvedSource))) {
    await writeRuntimeGuidance(runtimeHome, cwd);
    return runtimeHome;
  }

  await Promise.all(CODEX_RUNTIME_HOME_FILES.map((fileName) => (
    copyFileIfChanged(
      path.join(resolvedSource, fileName),
      path.join(resolvedTarget, fileName)
    )
  )));
  await syncCodexCliRuntimePluginCache(resolvedSource, resolvedTarget);
  await writeRuntimeGuidance(runtimeHome, cwd);
  return runtimeHome;
}

async function buildCodexCommandEnv(cwd = '') {
  const env = {
    ...process.env
  };
  const runtimeHome = await ensureCodexCliRuntimeHome(cwd).catch(() => '');
  if (runtimeHome) {
    env.CODEX_HOME = runtimeHome;
  }
  return env;
}

module.exports = {
  buildCodexCommandEnv,
  ensureCodexCliRuntimeHome,
  syncCodexCliRuntimePluginCache,
  syncCodexCliRuntimePluginCacheEntry
};
