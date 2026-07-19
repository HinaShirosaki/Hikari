'use strict';

const fs = require('fs/promises');
const path = require('path');
const { ALIGNMENTS_DIR_NAME, STATUS_SAVED, STATUS_TEMPORARY } = require('./constants');
const {
  normalizeEntryRow,
  openDatabase,
  persistDatabase,
  readSingleRow
} = require('./database');
const { replaceFeatureOccurrencesForEntry } = require('./feature-store');
const {
  clearDirectoryContents,
  ensureLibraryDirectories,
  resolveLibraryPaths,
  toPosixRelative
} = require('./paths');
const {
  buildEntryId,
  cleanText,
  normalizeName,
  normalizeStatus,
  sanitizeFileName
} = require('./utils');
const { findNextSavedName, getSequenceEntry } = require('./entry-read');
const {
  attachAlignmentSourcePaths,
  readAlignmentManifest,
  writeAlignmentManifest
} = require('./alignment-store');

async function upsertSequenceEntry(payload = {}) {
  const storagePath = cleanText(payload.storagePath, 2000);
  const gbkText = String(payload.gbkText || '');
  const htmlText = String(payload.htmlText || '');
  const alignmentSessions = Array.isArray(payload.alignmentSessions) ? payload.alignmentSessions : null;
  if (!gbkText.trim()) {
    throw new Error('GBK content is required.');
  }
  if (!htmlText.trim()) {
    throw new Error('HTML preview content is required.');
  }

  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const existing = await loadExistingEntry(db, payload);
    const row = await writeEntryFilesAndRow({ db, existing, paths, payload, gbkText, htmlText });
    replaceFeatureOccurrencesForEntry(db, row, payload);
    const alignments = await resolveNextAlignmentSessions({ alignmentSessions, entryId: row.id, paths });
    await persistDatabase(paths.sqlitePath, db);
    return {
      rootPath: paths.libraryRoot,
      sqlitePath: paths.sqlitePath,
      entry: row,
      alignments
    };
  } finally {
    db.close();
  }
}

async function loadExistingEntry(db, payload) {
  const inputId = cleanText(payload.id, 200);
  const existingRow = inputId
    ? readSingleRow(db, 'SELECT * FROM sequence_entries WHERE id = ? LIMIT 1', [inputId])
    : null;
  return normalizeEntryRow(existingRow);
}

async function writeEntryFilesAndRow({ db, existing, paths, payload, gbkText, htmlText }) {
  const inputId = cleanText(payload.id, 200);
  const status = normalizeStatus(payload.status || existing?.status || STATUS_TEMPORARY);
  const requestedName = normalizeName(payload.name || existing?.name || 'sequence', 'sequence');
  const resolvedName = status === STATUS_SAVED ? findNextSavedName(db, requestedName, existing?.id || '') : requestedName;
  const entryId = existing?.id || inputId || buildEntryId();
  const entryDir = path.join(paths.entriesRoot, entryId);
  await fs.mkdir(entryDir, { recursive: true });
  await clearDirectoryContents(entryDir, { preserveNames: [ALIGNMENTS_DIR_NAME] });

  const fileSafeName = sanitizeFileName(resolvedName, 'sequence');
  const gbkAbsPath = path.join(entryDir, `${fileSafeName}.gbk`);
  const htmlAbsPath = path.join(entryDir, `${fileSafeName}.html`);
  await fs.writeFile(gbkAbsPath, gbkText, 'utf8');
  await fs.writeFile(htmlAbsPath, htmlText, 'utf8');

  const now = new Date().toISOString();
  const row = buildEntryRow({ existing, payload, entryId, resolvedName, status, gbkAbsPath, htmlAbsPath, paths, now });
  upsertEntryRow(db, row);
  return row;
}

function buildEntryRow({ existing, payload, entryId, resolvedName, status, gbkAbsPath, htmlAbsPath, paths, now }) {
  return {
    id: entryId,
    name: resolvedName,
    normalizedName: resolvedName.toLowerCase(),
    status,
    sourceFormat: cleanText(payload.sourceFormat || existing?.sourceFormat, 80),
    topology: cleanText(payload.topology || existing?.topology, 40) || 'linear',
    sequenceLength: Math.max(0, Math.round(Number(payload.sequenceLength) || Number(existing?.sequenceLength) || 0)),
    featureCount: Math.max(0, Math.round(Number(payload.featureCount) || Number(existing?.featureCount) || 0)),
    gbkRelPath: toPosixRelative(paths.libraryRoot, gbkAbsPath),
    htmlRelPath: toPosixRelative(paths.libraryRoot, htmlAbsPath),
    folderId: cleanText(existing?.folderId, 200),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function upsertEntryRow(db, row) {
  db.run(
    `INSERT INTO sequence_entries (
       id, name, normalized_name, status, source_format, topology, sequence_length, feature_count,
       gbk_rel_path, html_rel_path, folder_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       normalized_name = excluded.normalized_name,
       status = excluded.status,
       source_format = excluded.source_format,
       topology = excluded.topology,
       sequence_length = excluded.sequence_length,
       feature_count = excluded.feature_count,
       gbk_rel_path = excluded.gbk_rel_path,
       html_rel_path = excluded.html_rel_path,
       folder_id = excluded.folder_id,
       updated_at = excluded.updated_at`,
    [
      row.id, row.name, row.normalizedName, row.status, row.sourceFormat, row.topology,
      row.sequenceLength, row.featureCount, row.gbkRelPath, row.htmlRelPath, row.folderId,
      row.createdAt, row.updatedAt
    ]
  );
}

async function resolveNextAlignmentSessions({ alignmentSessions, entryId, paths }) {
  const entryDir = path.join(paths.entriesRoot, entryId);
  if (alignmentSessions === null) {
    return attachAlignmentSourcePaths(await readAlignmentManifest(entryDir, paths.libraryRoot), paths.libraryRoot);
  }
  return attachAlignmentSourcePaths(
    await writeAlignmentManifest(entryDir, alignmentSessions, paths.libraryRoot),
    paths.libraryRoot
  );
}

async function promoteSequenceEntry(payload = {}) {
  const storagePath = cleanText(payload.storagePath, 2000);
  const entryId = cleanText(payload.id, 200);
  if (!entryId) {
    throw new Error('Missing sequence entry id.');
  }
  const current = await getSequenceEntry({ storagePath, id: entryId, includeGbk: true, includeHtml: true });
  if (!current?.entry) {
    throw new Error('Sequence entry not found.');
  }
  return upsertSequenceEntry({
    storagePath,
    id: current.entry.id,
    name: cleanText(payload.name, 140) || current.entry.name,
    status: STATUS_SAVED,
    sourceFormat: current.entry.sourceFormat,
    topology: current.entry.topology,
    sequenceLength: current.entry.sequenceLength,
    featureCount: current.entry.featureCount,
    gbkText: current.gbkText,
    htmlText: current.htmlText
  });
}

module.exports = {
  promoteSequenceEntry,
  upsertSequenceEntry
};
