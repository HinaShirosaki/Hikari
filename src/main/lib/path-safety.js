'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(String(parentPath || ''));
  const child = path.resolve(String(childPath || ''));
  if (parent === child) {
    return true;
  }
  const prefix = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(prefix);
}

function ensurePathWithinRoot(rootPath, targetPath, errorMessage = 'Target path must be inside the configured storage path.') {
  const resolvedTarget = path.resolve(targetPath);
  if (!isPathInside(rootPath, resolvedTarget)) {
    throw new Error(errorMessage);
  }
  return resolvedTarget;
}

function ensureRelativePathWithinRoot(rootPath, relativePath, errorMessage = 'Resolved path escaped root.') {
  return ensurePathWithinRoot(rootPath, path.resolve(rootPath, relativePath), errorMessage);
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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function pathExistsQuietly(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ensurePathWithinRoot,
  ensureRelativePathWithinRoot,
  isFilesystemRoot,
  isPathInside,
  pathExists,
  pathExistsQuietly
};
