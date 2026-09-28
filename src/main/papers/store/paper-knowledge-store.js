'use strict';

/**
 * Thin SQLite identity and location index for the paper knowledge database.
 *
 * Paper text lives in Markdown; descriptive metadata lives in meta.json.
 * Reads leave legacy files untouched; writes compact them after preserving metadata.
 */

const crypto = require('node:crypto');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const { loadSqlJs } = require('../../storage/storage-utils.js');
const { persistSqliteDatabase } = require('../../lib/sqlite-persist.js');
const { pathExists } = require('../../lib/path-safety.js');
const { normalizeDoi, sanitizeStorageName } = require('./paper-knowledge-paths.js');
const { normalizePmid, normalizePmcid } = require('../identity/paper-identity.js');
const { SCHEMA, compactKnowledgeIndex } = require('./knowledge-index-schema.js');

function asArrayDefault(value) {
  return Array.isArray(value) ? value : [];
}

function looksLikePdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function queryRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows;
}

function runStatement(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.run(params);
  } finally {
    stmt.free();
  }
}

/**
 * Add columns introduced after the original schema to pre-existing databases.
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so identifier
 * columns added later (pmid, pmcid) must be backfilled with ALTER TABLE.
 */
function migratePaperColumns(db) {
  const existing = new Set(
    queryRows(db, 'PRAGMA table_info(papers)').map((row) => String(row.name || ''))
  );
  if (!existing.has('pmid')) {
    db.run('ALTER TABLE papers ADD COLUMN pmid TEXT');
  }
  if (!existing.has('pmcid')) {
    db.run('ALTER TABLE papers ADD COLUMN pmcid TEXT');
  }
}

function applyKnowledgeDatabaseSchema(db) {
  if (queryRows(db, 'PRAGMA table_info(papers)').length) migratePaperColumns(db);
  db.run(SCHEMA);
}

async function openKnowledgeDatabase(sqlitePath) {
  const SQL = await loadSqlJs();
  let db = null;
  try {
    const bytes = await fsPromises.readFile(sqlitePath);
    db = bytes.length ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
    db = new SQL.Database();
  }
  try {
    applyKnowledgeDatabaseSchema(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

async function persistKnowledgeDatabase(sqlitePath, db) {
  await compactKnowledgeIndex(sqlitePath, db);
  await persistSqliteDatabase(sqlitePath, db);
}

// sql.js loads the whole database image, so open -> mutate -> persist is a
// read-modify-write. paper-acquisition.js ingests DEFAULT_DOWNLOAD_CONCURRENCY
// papers at once; unserialized, they all start from the same image and only the
// last one to persist survives. Every write path runs through here so the
// critical section covers identity lookup (findExistingPaperRow) and the
// metadata sidecars as well, not just the INSERT.
//
// ponytail: in-process queue, keyed by path. Swap in the directory lock from
// sequence-library/operation-lock.js if a separate process ever opens this
// database.
const knowledgeWriteQueues = new Map();

function withKnowledgeDatabaseWrite(sqlitePath, action) {
  const key = path.resolve(String(sqlitePath || ''));
  const previous = knowledgeWriteQueues.get(key) || Promise.resolve();
  const current = previous.then(async () => {
    const db = await openKnowledgeDatabase(sqlitePath);
    try {
      await compactKnowledgeIndex(sqlitePath, db);
      return await action(db);
    } finally {
      db.close();
    }
  });
  // A rejected turn must not poison the queue, and the map entry is dropped once
  // this turn is the last one so repeated storage paths cannot accumulate.
  const settled = current.then(() => {}, () => {});
  knowledgeWriteQueues.set(key, settled);
  settled.then(() => {
    if (knowledgeWriteQueues.get(key) === settled) {
      knowledgeWriteQueues.delete(key);
    }
  });
  return current;
}

function findExistingPaperRow(db, { doi = '', pmid = '', pmcid = '', pdfSha256 = '', title = '' } = {}) {
  const normalizedDoi = normalizeDoi(doi);
  if (normalizedDoi) {
    const rows = queryRows(db, 'SELECT * FROM papers WHERE lower(doi) = lower(?) LIMIT 1', [normalizedDoi]);
    if (rows[0]) {
      return rows[0];
    }
  }
  const normalizedPmid = normalizePmid(pmid);
  if (normalizedPmid) {
    const rows = queryRows(db, 'SELECT * FROM papers WHERE pmid = ? LIMIT 1', [normalizedPmid]);
    if (rows[0]) {
      return rows[0];
    }
  }
  const normalizedPmcid = normalizePmcid(pmcid);
  if (normalizedPmcid) {
    const rows = queryRows(db, 'SELECT * FROM papers WHERE pmcid = ? LIMIT 1', [normalizedPmcid]);
    if (rows[0]) {
      return rows[0];
    }
  }
  if (pdfSha256) {
    const rows = queryRows(db, 'SELECT * FROM papers WHERE pdf_sha256 = ? LIMIT 1', [pdfSha256]);
    if (rows[0]) {
      return rows[0];
    }
  }
  const normalizedTitle = String(title || '').trim();
  if (normalizedTitle) {
    const rows = queryRows(db, 'SELECT * FROM papers WHERE lower(title) = lower(?) LIMIT 1', [normalizedTitle]);
    if (rows[0]) {
      return rows[0];
    }
  }
  return null;
}

function buildPaperId({ existing = null, doi = '', pdfSha256 = '', title = '' } = {}) {
  if (existing?.id) {
    return String(existing.id);
  }
  const normalizedDoi = normalizeDoi(doi);
  if (normalizedDoi) {
    return `paper-doi-${sanitizeStorageName(normalizedDoi.replace(/\//g, '_'), 'paper')}`;
  }
  if (pdfSha256) {
    return `paper-sha256-${String(pdfSha256).slice(0, 16)}`;
  }
  return `paper-title-${sanitizeStorageName(title, 'paper')}`;
}

function chooseLocation(locations = [], scope = '', container = '') {
  const normalizedScope = String(scope || '').trim().toLowerCase();
  const normalizedContainer = String(container || '').trim().toLowerCase();
  return asArrayDefault(locations).find((location) => (
    String(location.scope || '').trim().toLowerCase() === normalizedScope
    && String(location.container || '').trim().toLowerCase() === normalizedContainer
  )) || asArrayDefault(locations)[0] || null;
}

module.exports = {
  looksLikePdfBuffer,
  sha256Buffer,
  queryRows,
  runStatement,
  migratePaperColumns,
  applyKnowledgeDatabaseSchema,
  openKnowledgeDatabase,
  persistKnowledgeDatabase,
  withKnowledgeDatabaseWrite,
  findExistingPaperRow,
  buildPaperId,
  pathExists,
  chooseLocation
};
