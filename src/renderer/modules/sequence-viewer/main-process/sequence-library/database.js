'use strict';
const fs = require('fs/promises');
const path = require('path');
const { resolveSqlJsWasmJsPath } = require('../../../../../main/lib/sqljs-path.js');
const { FEATURE_INDEX_VERSION } = require('./constants');
const {
  cleanText,
  normalizeStatus
} = require('./utils');
const SQLJS_WASM_JS_PATH = resolveSqlJsWasmJsPath(__dirname);
let sqlJsInitPromise = null;
let cdsSequenceTableRebuilder = null;
function setCdsSequenceTableRebuilder(rebuilder) {
  cdsSequenceTableRebuilder = typeof rebuilder === 'function' ? rebuilder : null;
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
  const hadFolderTable = Boolean(readSingleRow(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name = 'sequence_folders'
     LIMIT 1`
  ));
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sequence_folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sequence_folders_name
      ON sequence_folders(normalized_name);
    CREATE TABLE IF NOT EXISTS sequence_entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      status TEXT NOT NULL,
      source_format TEXT NOT NULL DEFAULT '',
      topology TEXT NOT NULL DEFAULT 'linear',
      sequence_length INTEGER NOT NULL DEFAULT 0,
      feature_count INTEGER NOT NULL DEFAULT 0,
      feature_index_version INTEGER NOT NULL DEFAULT 0,
      gbk_rel_path TEXT NOT NULL,
      html_rel_path TEXT NOT NULL,
      folder_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sequence_entries_status
      ON sequence_entries(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sequence_entries_name
      ON sequence_entries(normalized_name);
    CREATE TABLE IF NOT EXISTS sequence_features (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      feature_type TEXT NOT NULL DEFAULT '',
      sequence TEXT NOT NULL,
      sequence_length INTEGER NOT NULL DEFAULT 0,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sequence_features_name
      ON sequence_features(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_sequence_features_type
      ON sequence_features(feature_type);
    CREATE TABLE IF NOT EXISTS sequence_feature_cds_sequences (
      feature_id TEXT PRIMARY KEY,
      dna_sequence TEXT NOT NULL,
      dna_length INTEGER NOT NULL DEFAULT 0,
      amino_acid_sequence TEXT NOT NULL,
      amino_acid_length INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(feature_id) REFERENCES sequence_features(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sequence_feature_proteins (
      feature_id TEXT PRIMARY KEY,
      protein_sequence TEXT NOT NULL,
      protein_length INTEGER NOT NULL DEFAULT 0,
      translation_source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(feature_id) REFERENCES sequence_features(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sequence_feature_occurrences (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      host_vector_id TEXT NOT NULL,
      host_vector_name TEXT NOT NULL,
      host_vector_status TEXT NOT NULL DEFAULT '',
      host_topology TEXT NOT NULL DEFAULT 'linear',
      host_sequence_length INTEGER NOT NULL DEFAULT 0,
      source_format TEXT NOT NULL DEFAULT '',
      annotation_source TEXT NOT NULL DEFAULT '',
      strand INTEGER NOT NULL DEFAULT 1,
      start_pos INTEGER NOT NULL DEFAULT 1,
      end_pos INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sequence_feature_occurrences_feature
      ON sequence_feature_occurrences(feature_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sequence_feature_occurrences_host
      ON sequence_feature_occurrences(host_vector_id, updated_at DESC);
  `);

  const entryColumns = readRows(db, 'PRAGMA table_info(sequence_entries)');
  const hadFolderIdColumn = entryColumns.some((row) => String(row?.name || '') === 'folder_id');
  const hadFeatureIndexVersionColumn = entryColumns.some((row) => String(row?.name || '') === 'feature_index_version');
  if (!hadFolderIdColumn) {
    db.run("ALTER TABLE sequence_entries ADD COLUMN folder_id TEXT NOT NULL DEFAULT ''");
  }
  if (!hadFeatureIndexVersionColumn) {
    db.run('ALTER TABLE sequence_entries ADD COLUMN feature_index_version INTEGER NOT NULL DEFAULT 0');
  }
  db.run(
    `UPDATE sequence_entries
     SET feature_index_version = ?
     WHERE feature_index_version < ?
       AND EXISTS (
         SELECT 1
         FROM sequence_feature_occurrences o
         WHERE o.host_vector_id = sequence_entries.id
       )`,
    [FEATURE_INDEX_VERSION, FEATURE_INDEX_VERSION]
  );
  const featureIndexMarkersChanged = Math.max(0, Number(db.getRowsModified?.() || 0));
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_sequence_entries_folder
      ON sequence_entries(folder_id, status, updated_at DESC);
  `);
  return !hadFolderTable || !hadFolderIdColumn || !hadFeatureIndexVersionColumn || featureIndexMarkersChanged > 0;
}
async function openDatabase(sqlitePath) {
  const SQL = await loadSqlJs();
  let db;
  try {
    const bytes = await fs.readFile(sqlitePath);
    db = bytes.length > 0 ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      db = new SQL.Database();
    } else {
      throw error;
    }
  }
  const hadCdsSequenceTable = Boolean(readSingleRow(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name = 'sequence_feature_cds_sequences'
     LIMIT 1`
  ));
  const schemaChanged = applySchema(db);
  const cdsTableChanges = cdsSequenceTableRebuilder ? cdsSequenceTableRebuilder(db) : 0;
  if (schemaChanged || !hadCdsSequenceTable || cdsTableChanges > 0) {
    await persistDatabase(sqlitePath, db);
  }
  return db;
}
async function persistDatabase(sqlitePath, db) {
  const bytes = db.export();
  await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
  const temporaryPath = `${sqlitePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, Buffer.from(bytes));
    await fs.rename(temporaryPath, sqlitePath);
  } finally { await fs.rm(temporaryPath, { force: true }); }
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
    featureIndexVersion: Math.max(0, Number(row.feature_index_version) || 0),
    gbkRelPath: cleanText(row.gbk_rel_path, 1200),
    htmlRelPath: cleanText(row.html_rel_path, 1200),
    folderId: cleanText(row.folder_id, 200),
    createdAt: cleanText(row.created_at, 60),
    updatedAt: cleanText(row.updated_at, 60)
  };
}
module.exports = {
  normalizeEntryRow,
  openDatabase,
  persistDatabase,
  readRows,
  readSingleRow,
  setCdsSequenceTableRebuilder
};
