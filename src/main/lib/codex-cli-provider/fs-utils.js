'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathExistsQuietly: pathExists } = require('../path-safety.js');

async function removeFileIfExists(targetPath = '') {
  if (!targetPath) {
    return false;
  }
  const existed = await pathExists(targetPath);
  if (!existed) {
    return false;
  }
  await fs.rm(targetPath, { force: true });
  return true;
}

async function copyFileIfChanged(sourcePath = '', targetPath = '') {
  if (!sourcePath || !targetPath) {
    return false;
  }
  try {
    const sourceStats = await fs.stat(sourcePath);
    if (!sourceStats.isFile()) {
      return false;
    }
    let shouldCopy = true;
    try {
      const targetStats = await fs.stat(targetPath);
      shouldCopy = !targetStats.isFile()
        || targetStats.size !== sourceStats.size
        || Math.abs(targetStats.mtimeMs - sourceStats.mtimeMs) > 1;
    } catch {
      shouldCopy = true;
    }
    if (!shouldCopy) {
      return false;
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getPathStats(targetPath = '', { followSymlink = false } = {}) {
  try {
    return followSymlink ? await fs.stat(targetPath) : await fs.lstat(targetPath);
  } catch {
    return null;
  }
}

async function isDirectoryLike(targetPath = '') {
  const stats = await getPathStats(targetPath);
  if (!stats) {
    return false;
  }
  if (stats.isDirectory()) {
    return true;
  }
  if (!stats.isSymbolicLink()) {
    return false;
  }
  const resolvedStats = await getPathStats(targetPath, { followSymlink: true });
  return Boolean(resolvedStats?.isDirectory());
}

async function copyPathIfMissing(sourcePath = '', targetPath = '') {
  const sourceStats = await getPathStats(sourcePath, { followSymlink: true });
  if (!sourceStats) {
    return false;
  }
  if (await getPathStats(targetPath)) {
    return false;
  }
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const symlinkType = sourceStats.isDirectory()
      ? (process.platform === 'win32' ? 'junction' : 'dir')
      : 'file';
    await fs.symlink(sourcePath, targetPath, symlinkType);
    return true;
  } catch {
    try {
      if (sourceStats.isDirectory()) {
        await fs.cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: false });
      } else if (sourceStats.isFile()) {
        await copyFileIfChanged(sourcePath, targetPath);
      }
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = {
  copyFileIfChanged,
  copyPathIfMissing,
  getPathStats,
  isDirectoryLike,
  pathExists,
  removeFileIfExists
};
