'use strict';

const fs = require('fs/promises');
const path = require('path');
const { STATUS_SAVED, STATUS_TEMPORARY } = require('./constants');
const {
  normalizeEntryRow,
  openDatabase,
  persistDatabase,
  readRows,
  readSingleRow
} = require('./database');
const { findNextSavedName } = require('./entry-row-store');
const { recoverMissingSequenceEntries } = require('./entry-reconcile');
const { deleteOrphanFeatures, rebuildCdsSequenceTable } = require('./feature-store');
const {
  ensureLibraryDirectories,
  ensureLibraryFolderDir,
  ensurePathWithinRoot,
  ensureProjectSequenceDirectories,
  resolveLibraryPaths
} = require('./paths');
const { cleanText } = require('./utils');
const {
  attachAlignmentSourcePaths,
  readAlignmentManifest
} = require('./alignment-store');
const {
  isProjectFolderId,
  listSequenceFoldersFromDb,
  syncProjectFolderRows
} = require('./folder-store');

async function listSequenceEntries({ storagePath, status = '', projects = [] }) {
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  await ensureProjectSequenceDirectories(paths, projects);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const recoveredEntryCount = await recoverMissingSequenceEntries({ db, paths });
    const syncedProjectFolders = syncProjectFolderRows(db, projects);
    if (recoveredEntryCount > 0 || syncedProjectFolders) {
      await persistDatabase(paths.sqlitePath, db);
    }
    const normalizedStatus = cleanText(status, 40).toLowerCase();
    const filtered = normalizedStatus === STATUS_SAVED || normalizedStatus === STATUS_TEMPORARY;
    const rows = filtered
      ? readRows(
        db,
        `SELECT * FROM sequence_entries
         WHERE status = ?
         ORDER BY updated_at DESC, name COLLATE NOCASE ASC`,
        [normalizedStatus]
      )
      : readRows(
        db,
        `SELECT * FROM sequence_entries
         ORDER BY status ASC, updated_at DESC, name COLLATE NOCASE ASC`
      );
    const folders = listSequenceFoldersFromDb(db);
    // Backfills folders that predate the on-disk mirror, and puts a directory
    // back if one was removed outside the app.
    await Promise.all(folders
      .filter((folder) => !isProjectFolderId(folder.id))
      .map((folder) => ensureLibraryFolderDir(paths, folder.name)));
    return {
      rootPath: paths.libraryRoot,
      sqlitePath: paths.sqlitePath,
      folders,
      entries: rows.map((row) => normalizeEntryRow(row)).filter(Boolean)
    };
  } finally {
    db.close();
  }
}

async function getSequenceEntry({ storagePath, id, includeGbk = false, includeAlignments = false }) {
  const safeId = cleanText(id, 200);
  if (!safeId) {
    throw new Error('Missing sequence entry id.');
  }

  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const recoveredEntryCount = await recoverMissingSequenceEntries({ db, paths });
    if (recoveredEntryCount > 0) {
      await persistDatabase(paths.sqlitePath, db);
    }
    const row = readSingleRow(db, 'SELECT * FROM sequence_entries WHERE id = ? LIMIT 1', [safeId]);
    const entry = normalizeEntryRow(row);
    if (!entry) {
      return { entry: null };
    }
    return buildEntryPayload({ paths, entry, includeGbk, includeAlignments });
  } finally {
    db.close();
  }
}

async function buildEntryPayload({ paths, entry, includeGbk, includeAlignments }) {
  const result = { entry };
  if (includeGbk) {
    result.gbkText = await fs.readFile(ensurePathWithinRoot(paths.libraryRoot, entry.gbkRelPath), 'utf8');
  }
  if (includeAlignments) {
    const entryDir = path.join(paths.entriesRoot, entry.id);
    result.alignments = attachAlignmentSourcePaths(await readAlignmentManifest(entryDir, paths.libraryRoot), paths.libraryRoot);
  }
  return result;
}

async function deleteSequenceEntry({ storagePath, id }) {
  const safeId = cleanText(id, 200);
  if (!safeId) {
    throw new Error('Missing sequence entry id.');
  }
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    db.run('DELETE FROM sequence_feature_occurrences WHERE host_vector_id = ?', [safeId]);
    db.run('DELETE FROM sequence_entries WHERE id = ?', [safeId]);
    deleteOrphanFeatures(db);
    rebuildCdsSequenceTable(db);
    await persistDatabase(paths.sqlitePath, db);
  } finally {
    db.close();
  }
  await fs.rm(path.join(paths.entriesRoot, safeId), { recursive: true, force: true });
  return { ok: true, id: safeId };
}

module.exports = {
  deleteSequenceEntry,
  findNextSavedName,
  getSequenceEntry,
  listSequenceEntries
};
