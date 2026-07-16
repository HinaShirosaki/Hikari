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
const { deleteOrphanFeatures, rebuildCdsSequenceTable } = require('./feature-store');
const {
  ensureLibraryDirectories,
  ensurePathWithinRoot,
  resolveLibraryPaths
} = require('./paths');
const {
  cleanText,
  normalizeName
} = require('./utils');
const {
  attachAlignmentSourcePaths,
  readAlignmentManifest
} = require('./alignment-store');

function findNextSavedName(db, requestedName, selfId = '') {
  const base = normalizeName(requestedName, 'sequence');
  for (let attempt = 1; attempt < 5000; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}_${attempt}`;
    const normalized = candidate.toLowerCase();
    const row = readSingleRow(
      db,
      'SELECT id FROM sequence_entries WHERE status = ? AND normalized_name = ? LIMIT 1',
      [STATUS_SAVED, normalized]
    );
    if (!row || cleanText(row.id, 200) === cleanText(selfId, 200)) {
      return candidate;
    }
  }
  throw new Error('Failed to resolve a unique saved sequence name.');
}

async function listSequenceEntries({ storagePath, status = '' }) {
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
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
    return {
      rootPath: paths.libraryRoot,
      sqlitePath: paths.sqlitePath,
      entries: rows.map((row) => normalizeEntryRow(row)).filter(Boolean)
    };
  } finally {
    db.close();
  }
}

async function getSequenceEntry({ storagePath, id, includeGbk = false, includeHtml = false, includeAlignments = false }) {
  const safeId = cleanText(id, 200);
  if (!safeId) {
    throw new Error('Missing sequence entry id.');
  }

  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const row = readSingleRow(db, 'SELECT * FROM sequence_entries WHERE id = ? LIMIT 1', [safeId]);
    const entry = normalizeEntryRow(row);
    if (!entry) {
      return { entry: null };
    }
    return buildEntryPayload({ paths, entry, includeGbk, includeHtml, includeAlignments });
  } finally {
    db.close();
  }
}

async function buildEntryPayload({ paths, entry, includeGbk, includeHtml, includeAlignments }) {
  const result = { entry };
  if (includeGbk) {
    result.gbkText = await fs.readFile(ensurePathWithinRoot(paths.libraryRoot, entry.gbkRelPath), 'utf8');
  }
  if (includeHtml) {
    result.htmlText = await fs.readFile(ensurePathWithinRoot(paths.libraryRoot, entry.htmlRelPath), 'utf8');
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
