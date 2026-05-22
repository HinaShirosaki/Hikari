'use strict';

const fs = require('fs/promises');
const path = require('path');
const { DB_FILE_NAME, LIBRARY_FOLDER_NAME } = require('./constants');
const { cleanText } = require('./utils');

function ensureStoragePath(storagePath) {
  const resolved = path.resolve(cleanText(storagePath, 2000));
  if (!resolved) {
    throw new Error('Missing storage path.');
  }
  return resolved;
}

function toPosixRelative(rootPath, absolutePath) {
  return path.relative(rootPath, absolutePath).split(path.sep).join('/');
}

function ensurePathWithinRoot(rootPath, relativePath) {
  const target = path.resolve(rootPath, relativePath);
  const normalizedRoot = `${path.resolve(rootPath)}${path.sep}`;
  if (target !== path.resolve(rootPath) && !target.startsWith(normalizedRoot)) {
    throw new Error('Resolved path escaped sequence library root.');
  }
  return target;
}

function resolveLibraryPaths(storagePath) {
  const root = ensureStoragePath(storagePath);
  const libraryRoot = path.join(root, LIBRARY_FOLDER_NAME);
  return {
    storageRoot: root,
    libraryRoot,
    entriesRoot: path.join(libraryRoot, 'entries'),
    sqlitePath: path.join(libraryRoot, DB_FILE_NAME)
  };
}

async function ensureLibraryDirectories(paths) {
  await fs.mkdir(paths.libraryRoot, { recursive: true });
  await fs.mkdir(paths.entriesRoot, { recursive: true });
}

async function clearDirectoryContents(targetDir, options = {}) {
  const preserveNames = new Set((Array.isArray(options.preserveNames) ? options.preserveNames : []).map((value) => String(value)));
  try {
    const items = await fs.readdir(targetDir);
    await Promise.all(items.map(async (itemName) => {
      if (!preserveNames.has(itemName)) {
        await fs.rm(path.join(targetDir, itemName), { recursive: true, force: true });
      }
    }));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

module.exports = {
  clearDirectoryContents,
  ensureLibraryDirectories,
  ensurePathWithinRoot,
  resolveLibraryPaths,
  toPosixRelative
};
