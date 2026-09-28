'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  DB_FILE_NAME,
  LIBRARY_FOLDER_NAME,
  RECOGNIZED_BACKBONE_ARTIFACT_DIR_NAME,
  RECOGNIZED_BACKBONE_STORE_FILE_NAME
} = require('./constants');
const {
  PROJECT_ROOT_FOLDER_NAME,
  PROJECT_SEQUENCE_FOLDER_NAME
} = require('../../../../../main/storage/storage-paths');
const { sanitizeFolderName } = require('../../../../../main/storage/storage-utils');
const { cleanText } = require('./utils');
const { ensureRelativePathWithinRoot } = require('../../../../../main/lib/path-safety.js');

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
  return ensureRelativePathWithinRoot(rootPath, relativePath, 'Resolved path escaped sequence library root.');
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

// Names the library itself owns inside `SequenceViewer/`. A user folder taking
// one of these would point at the store's own files.
const RESERVED_LIBRARY_FOLDER_NAMES = new Set([
  'entries',
  DB_FILE_NAME,
  RECOGNIZED_BACKBONE_STORE_FILE_NAME,
  RECOGNIZED_BACKBONE_ARTIFACT_DIR_NAME.split('/')[0]
].map((name) => name.toLowerCase()));

function resolveLibraryFolderDir(paths, folderName) {
  return path.join(paths.libraryRoot, sanitizeFolderName(folderName, 'Folder'));
}

function isReservedLibraryFolderName(folderName) {
  return RESERVED_LIBRARY_FOLDER_NAMES.has(sanitizeFolderName(folderName, 'Folder').toLowerCase());
}

// A folder the user makes gets a real directory beside the library's own files,
// and follows the folder when it is renamed. The rail creates a folder as
// "New Folder" and renames it inline straight away, so without the move every
// folder would leave a stale New_Folder behind.
async function ensureLibraryFolderDir(paths, folderName, previousName = '') {
  const targetDir = resolveLibraryFolderDir(paths, folderName);
  const previousDir = previousName ? resolveLibraryFolderDir(paths, previousName) : '';
  if (previousDir && previousDir !== targetDir) {
    // Fails when the old directory is gone or the new name is already taken on
    // disk; either way the mkdir below is the right fallback.
    const renamed = await fs.rename(previousDir, targetDir).then(() => true, () => false);
    if (renamed) {
      return targetDir;
    }
  }
  await fs.mkdir(targetDir, { recursive: true });
  return targetDir;
}

// Deleting a folder only unfiles its sequences, so anything the user put in the
// directory stays. rmdir fails on a non-empty directory, which is the wanted
// outcome.
async function removeLibraryFolderDirIfEmpty(paths, folderName) {
  if (!String(folderName || '').trim()) {
    return;
  }
  await fs.rmdir(resolveLibraryFolderDir(paths, folderName)).catch(() => {});
}

// Mirror of the rail's per-project folders on disk, next to the Notebook
// folder the same project already owns. Same sanitizer as the notebook side so
// both land in one `Project/<Name>` folder rather than two near-identical ones.
function resolveProjectSequenceDir(paths, projectName) {
  return path.join(
    paths.storageRoot,
    PROJECT_ROOT_FOLDER_NAME,
    sanitizeFolderName(projectName, 'Untitled_Project'),
    PROJECT_SEQUENCE_FOLDER_NAME
  );
}

async function ensureProjectSequenceDirectories(paths, projects) {
  await Promise.all((Array.isArray(projects) ? projects : [])
    .filter((project) => cleanText(project?.name, 320).trim())
    .map((project) => fs.mkdir(resolveProjectSequenceDir(paths, project.name), { recursive: true })));
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
  ensureLibraryFolderDir,
  ensurePathWithinRoot,
  ensureProjectSequenceDirectories,
  isReservedLibraryFolderName,
  removeLibraryFolderDirIfEmpty,
  resolveLibraryPaths,
  toPosixRelative
};
