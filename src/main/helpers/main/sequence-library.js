'use strict';

const fs = require('fs/promises');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const SQLJS_WASM_JS_PATH = path.join(PROJECT_ROOT, 'vendor', 'sqljs', 'sql-wasm.js');
const LIBRARY_FOLDER_NAME = 'SequenceViewer';
const DB_FILE_NAME = 'sequence-library.sqlite';
const STATUS_SAVED = 'saved';
const STATUS_TEMPORARY = 'temporary';

let sqlJsInitPromise = null;

function cleanText(value, maxLength = 300) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (!Number.isFinite(Number(maxLength)) || maxLength <= 0) {
    return text;
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeStatus(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return normalized === STATUS_SAVED ? STATUS_SAVED : STATUS_TEMPORARY;
}

function sanitizeFileName(value, fallback = 'sequence') {
  const normalized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeName(value, fallback = 'sequence') {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return normalized || fallback;
}

function buildEntryId() {
  return `seq_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

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

async function loadSqlJs() {
  if (!sqlJsInitPromise) {
    sqlJsInitPromise = (async () => {
      const initSqlJs = require(SQLJS_WASM_JS_PATH);
      return initSqlJs({
        locateFile: (fileName) => path.join(path.dirname(SQLJS_WASM_JS_PATH), fileName)
      });
    })();
  }
  return sqlJsInitPromise;
}

function applySchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS sequence_entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      status TEXT NOT NULL,
      source_format TEXT NOT NULL DEFAULT '',
      topology TEXT NOT NULL DEFAULT 'linear',
      sequence_length INTEGER NOT NULL DEFAULT 0,
      feature_count INTEGER NOT NULL DEFAULT 0,
      gbk_rel_path TEXT NOT NULL,
      html_rel_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sequence_entries_status
      ON sequence_entries(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sequence_entries_name
      ON sequence_entries(normalized_name);
  `);
}

async function openDatabase(sqlitePath) {
  const SQL = await loadSqlJs();
  let db;
  try {
    const bytes = await fs.readFile(sqlitePath);
    db = bytes.length > 0
      ? new SQL.Database(new Uint8Array(bytes))
      : new SQL.Database();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      db = new SQL.Database();
    } else {
      throw error;
    }
  }
  applySchema(db);
  return db;
}

async function persistDatabase(sqlitePath, db) {
  const bytes = db.export();
  await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
  await fs.writeFile(sqlitePath, Buffer.from(bytes));
}

function readSingleRow(db, sql, values = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(values);
    if (!stmt.step()) {
      return null;
    }
    const row = stmt.getAsObject();
    return row && typeof row === 'object' ? row : null;
  } finally {
    stmt.free();
  }
}

function readRows(db, sql, values = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(values);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows;
}

function normalizeEntryRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  return {
    id: cleanText(row.id, 200),
    name: cleanText(row.name, 140),
    normalizedName: cleanText(row.normalized_name, 200),
    status: normalizeStatus(row.status),
    sourceFormat: cleanText(row.source_format, 80),
    topology: cleanText(row.topology, 40) || 'linear',
    sequenceLength: Math.max(0, Number(row.sequence_length) || 0),
    featureCount: Math.max(0, Number(row.feature_count) || 0),
    gbkRelPath: cleanText(row.gbk_rel_path, 1200),
    htmlRelPath: cleanText(row.html_rel_path, 1200),
    createdAt: cleanText(row.created_at, 60),
    updatedAt: cleanText(row.updated_at, 60)
  };
}

async function clearEntryFiles(entryDir) {
  try {
    const files = await fs.readdir(entryDir);
    await Promise.all(files.map(async (fileName) => {
      const target = path.join(entryDir, fileName);
      await fs.rm(target, { recursive: true, force: true });
    }));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

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

async function getSequenceEntry({ storagePath, id, includeGbk = false, includeHtml = false }) {
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
    const result = { entry };
    if (includeGbk) {
      const gbkPath = ensurePathWithinRoot(paths.libraryRoot, entry.gbkRelPath);
      result.gbkText = await fs.readFile(gbkPath, 'utf8');
    }
    if (includeHtml) {
      const htmlPath = ensurePathWithinRoot(paths.libraryRoot, entry.htmlRelPath);
      result.htmlText = await fs.readFile(htmlPath, 'utf8');
    }
    return result;
  } finally {
    db.close();
  }
}

async function upsertSequenceEntry(payload = {}) {
  const storagePath = cleanText(payload.storagePath, 2000);
  const gbkText = String(payload.gbkText || '');
  const htmlText = String(payload.htmlText || '');
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
    const inputId = cleanText(payload.id, 200);
    const existingRow = inputId
      ? readSingleRow(db, 'SELECT * FROM sequence_entries WHERE id = ? LIMIT 1', [inputId])
      : null;
    const existing = normalizeEntryRow(existingRow);

    const status = normalizeStatus(payload.status || existing?.status || STATUS_TEMPORARY);
    const requestedName = normalizeName(payload.name || existing?.name || 'sequence', 'sequence');
    const resolvedName = status === STATUS_SAVED
      ? findNextSavedName(db, requestedName, existing?.id || '')
      : requestedName;
    const entryId = existing?.id || inputId || buildEntryId();
    const fileSafeName = sanitizeFileName(resolvedName, 'sequence');
    const entryDir = path.join(paths.entriesRoot, entryId);
    await fs.mkdir(entryDir, { recursive: true });
    await clearEntryFiles(entryDir);

    const gbkAbsPath = path.join(entryDir, `${fileSafeName}.gbk`);
    const htmlAbsPath = path.join(entryDir, `${fileSafeName}.html`);
    await fs.writeFile(gbkAbsPath, gbkText, 'utf8');
    await fs.writeFile(htmlAbsPath, htmlText, 'utf8');

    const now = new Date().toISOString();
    const createdAt = existing?.createdAt || now;
    const row = {
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
      createdAt,
      updatedAt: now
    };

    db.run(
      `INSERT INTO sequence_entries (
         id, name, normalized_name, status, source_format, topology, sequence_length, feature_count,
         gbk_rel_path, html_rel_path, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         updated_at = excluded.updated_at`,
      [
        row.id,
        row.name,
        row.normalizedName,
        row.status,
        row.sourceFormat,
        row.topology,
        row.sequenceLength,
        row.featureCount,
        row.gbkRelPath,
        row.htmlRelPath,
        row.createdAt,
        row.updatedAt
      ]
    );

    await persistDatabase(paths.sqlitePath, db);
    return {
      rootPath: paths.libraryRoot,
      sqlitePath: paths.sqlitePath,
      entry: row
    };
  } finally {
    db.close();
  }
}

async function promoteSequenceEntry(payload = {}) {
  const storagePath = cleanText(payload.storagePath, 2000);
  const entryId = cleanText(payload.id, 200);
  if (!entryId) {
    throw new Error('Missing sequence entry id.');
  }
  const current = await getSequenceEntry({
    storagePath,
    id: entryId,
    includeGbk: true,
    includeHtml: true
  });
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

async function deleteSequenceEntry({ storagePath, id }) {
  const safeId = cleanText(id, 200);
  if (!safeId) {
    throw new Error('Missing sequence entry id.');
  }
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    db.run('DELETE FROM sequence_entries WHERE id = ?', [safeId]);
    await persistDatabase(paths.sqlitePath, db);
  } finally {
    db.close();
  }
  const entryDir = path.join(paths.entriesRoot, safeId);
  await fs.rm(entryDir, { recursive: true, force: true });
  return { ok: true, id: safeId };
}

module.exports = {
  STATUS_SAVED,
  STATUS_TEMPORARY,
  LIBRARY_FOLDER_NAME,
  DB_FILE_NAME,
  listSequenceEntries,
  getSequenceEntry,
  upsertSequenceEntry,
  promoteSequenceEntry,
  deleteSequenceEntry,
  sanitizeFileName
};

