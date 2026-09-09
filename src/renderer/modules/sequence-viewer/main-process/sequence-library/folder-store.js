'use strict';

const {
  normalizeEntryRow,
  openDatabase,
  persistDatabase,
  readRows,
  readSingleRow
} = require('./database');
const {
  ensureLibraryDirectories,
  ensureLibraryFolderDir,
  isReservedLibraryFolderName,
  removeLibraryFolderDirIfEmpty,
  resolveLibraryPaths
} = require('./paths');
const {
  buildFolderId,
  cleanText,
  normalizeName
} = require('./utils');
const { PROJECT_FOLDER_ID_PREFIX } = require('./constants');

function normalizeFolderRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  return {
    id: cleanText(row.id, 200),
    name: cleanText(row.name, 140),
    normalizedName: cleanText(row.normalized_name, 200),
    createdAt: cleanText(row.created_at, 60),
    updatedAt: cleanText(row.updated_at, 60)
  };
}

function isProjectFolderId(folderId) {
  return cleanText(folderId, 200).startsWith(PROJECT_FOLDER_ID_PREFIX);
}

function buildProjectFolderId(projectId) {
  const safeProjectId = cleanText(projectId, 200);
  return safeProjectId ? `${PROJECT_FOLDER_ID_PREFIX}${safeProjectId}` : '';
}

// Every project owns a sequence folder, so the rail lists one per project
// without anyone creating it by hand. The row id is derived from the project
// id, which keeps a renamed project pointing at the same folder (and its
// sequences) instead of spawning a second one.
function syncProjectFolderRows(db, projects) {
  const now = new Date().toISOString();
  let changed = false;
  for (const project of (Array.isArray(projects) ? projects : [])) {
    const folderId = buildProjectFolderId(project?.id);
    const name = normalizeName(project?.name, '');
    if (!folderId || !name) {
      continue;
    }
    // A hand-made folder already using this name wins; overwriting it would
    // break the UNIQUE(normalized_name) constraint.
    const taken = readSingleRow(
      db,
      'SELECT id FROM sequence_folders WHERE normalized_name = ? AND id <> ? LIMIT 1',
      [name.toLowerCase(), folderId]
    );
    if (taken) {
      continue;
    }
    const existing = normalizeFolderRow(readSingleRow(
      db,
      'SELECT * FROM sequence_folders WHERE id = ? LIMIT 1',
      [folderId]
    ));
    if (existing && existing.name === name) {
      continue;
    }
    db.run(
      `INSERT INTO sequence_folders (id, name, normalized_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         normalized_name = excluded.normalized_name,
         updated_at = excluded.updated_at`,
      [folderId, name, name.toLowerCase(), existing?.createdAt || now, now]
    );
    changed = true;
  }
  return changed;
}

function listSequenceFoldersFromDb(db) {
  return readRows(
    db,
    `SELECT * FROM sequence_folders
     ORDER BY name COLLATE NOCASE ASC, created_at ASC`
  ).map((row) => normalizeFolderRow(row)).filter(Boolean);
}

async function listSequenceFolders({ storagePath }) {
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    return {
      rootPath: paths.libraryRoot,
      sqlitePath: paths.sqlitePath,
      folders: listSequenceFoldersFromDb(db)
    };
  } finally {
    db.close();
  }
}

async function upsertSequenceFolder(payload = {}) {
  const paths = resolveLibraryPaths(payload.storagePath);
  const folderId = cleanText(payload.id, 200) || buildFolderId();
  const name = normalizeName(payload.name, '');
  if (!name) {
    throw new Error('Folder name is required.');
  }
  if (isProjectFolderId(folderId)) {
    throw new Error('A project folder is named after its project. Rename the project instead.');
  }
  if (isReservedLibraryFolderName(name)) {
    throw new Error(`"${name}" is reserved by the sequence library. Pick another folder name.`);
  }

  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const existing = normalizeFolderRow(readSingleRow(
      db,
      'SELECT * FROM sequence_folders WHERE id = ? LIMIT 1',
      [folderId]
    ));
    const duplicate = readSingleRow(
      db,
      'SELECT id FROM sequence_folders WHERE normalized_name = ? AND id <> ? LIMIT 1',
      [name.toLowerCase(), folderId]
    );
    if (duplicate) {
      throw new Error('A sequence folder with this name already exists.');
    }

    const now = new Date().toISOString();
    db.run(
      `INSERT INTO sequence_folders (id, name, normalized_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         normalized_name = excluded.normalized_name,
         updated_at = excluded.updated_at`,
      [folderId, name, name.toLowerCase(), existing?.createdAt || now, now]
    );
    await ensureLibraryFolderDir(paths, name, existing?.name);
    await persistDatabase(paths.sqlitePath, db);
    return {
      rootPath: paths.libraryRoot,
      sqlitePath: paths.sqlitePath,
      folder: normalizeFolderRow(readSingleRow(
        db,
        'SELECT * FROM sequence_folders WHERE id = ? LIMIT 1',
        [folderId]
      ))
    };
  } finally {
    db.close();
  }
}

async function deleteSequenceFolder(payload = {}) {
  const paths = resolveLibraryPaths(payload.storagePath);
  const folderId = cleanText(payload.id, 200);
  if (!folderId) {
    throw new Error('Missing sequence folder id.');
  }
  if (isProjectFolderId(folderId)) {
    throw new Error('A project folder goes away with its project. Delete the project instead.');
  }

  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  let deletedName = '';
  try {
    deletedName = normalizeFolderRow(readSingleRow(
      db,
      'SELECT * FROM sequence_folders WHERE id = ? LIMIT 1',
      [folderId]
    ))?.name || '';
    db.run("UPDATE sequence_entries SET folder_id = '' WHERE folder_id = ?", [folderId]);
    db.run('DELETE FROM sequence_folders WHERE id = ?', [folderId]);
    await persistDatabase(paths.sqlitePath, db);
  } finally {
    db.close();
  }
  await removeLibraryFolderDirIfEmpty(paths, deletedName);
  return { ok: true, id: folderId };
}

async function moveSequenceEntryToFolder(payload = {}) {
  const paths = resolveLibraryPaths(payload.storagePath);
  const entryId = cleanText(payload.id, 200);
  const folderId = cleanText(payload.folderId, 200);
  if (!entryId) {
    throw new Error('Missing sequence entry id.');
  }

  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const entry = readSingleRow(db, 'SELECT * FROM sequence_entries WHERE id = ? LIMIT 1', [entryId]);
    if (!entry) {
      throw new Error('Sequence entry not found.');
    }
    if (folderId) {
      const folder = readSingleRow(db, 'SELECT id FROM sequence_folders WHERE id = ? LIMIT 1', [folderId]);
      if (!folder) {
        throw new Error('Sequence folder not found.');
      }
    }

    const now = new Date().toISOString();
    db.run(
      'UPDATE sequence_entries SET folder_id = ?, updated_at = ? WHERE id = ?',
      [folderId, now, entryId]
    );
    await persistDatabase(paths.sqlitePath, db);
    return {
      rootPath: paths.libraryRoot,
      sqlitePath: paths.sqlitePath,
      entry: normalizeEntryRow(readSingleRow(
        db,
        'SELECT * FROM sequence_entries WHERE id = ? LIMIT 1',
        [entryId]
      ))
    };
  } finally {
    db.close();
  }
}

module.exports = {
  deleteSequenceFolder,
  isProjectFolderId,
  listSequenceFolders,
  listSequenceFoldersFromDb,
  moveSequenceEntryToFolder,
  normalizeFolderRow,
  syncProjectFolderRows,
  upsertSequenceFolder
};
