'use strict';

/**
 * SQLite + JSON-index storage layer for the paper knowledge database.
 *
 * Owns the schema, migrations, low-level query/run helpers, identity lookup,
 * and the mirror index.json. Split out of `agent-paper-knowledge-database.js`
 * so the ingest runtime and the wiki chunker/search share one storage surface
 * instead of reaching into the runtime module for these primitives.
 */

const crypto = require('node:crypto');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const { loadSqlJs } = require('../../storage/storage-utils.js');
const { persistSqliteDatabase } = require('../../lib/sqlite-persist.js');
const { normalizeDoi, sanitizeStorageName } = require('./paper-knowledge-paths.js');
const { normalizePmid, normalizePmcid } = require('../identity/paper-identity.js');

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
  db.run(`
    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      doi TEXT UNIQUE,
      pmid TEXT,
      pmcid TEXT,
      title TEXT,
      abstract TEXT,
      authors_json TEXT,
      journal TEXT,
      year TEXT,
      url TEXT,
      pdf_sha256 TEXT UNIQUE,
      added_at TEXT,
      updated_at TEXT,
      source TEXT,
      wiki_status TEXT,
      wiki_path TEXT,
      extraction_status TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS paper_locations (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      scope TEXT,
      container TEXT,
      folder_path TEXT,
      pdf_filename TEXT,
      pdf_path TEXT,
      discovered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_locations_paper ON paper_locations(paper_id);
  `);
  migratePaperColumns(db);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_papers_pmid ON papers(pmid);
    CREATE INDEX IF NOT EXISTS idx_knowledge_papers_pmcid ON papers(pmcid);
  `);
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
  applyKnowledgeDatabaseSchema(db);
  return db;
}

async function persistKnowledgeDatabase(sqlitePath, db) {
  await persistSqliteDatabase(sqlitePath, db);
}

// sql.js loads the whole database image, so open -> mutate -> persist is a
// read-modify-write. paper-acquisition.js ingests DEFAULT_DOWNLOAD_CONCURRENCY
// papers at once; unserialized, they all start from the same image and only the
// last one to persist survives. Every write path runs through here so the
// critical section covers identity lookup (findExistingPaperRow) and the
// index.json mirror as well, not just the INSERT.
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

async function readJsonObject(filePath) {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeJsonFile(filePath, payload) {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function normalizeIndexEntry(entry = {}) {
  return {
    id: String(entry.id || ''),
    doi: normalizeDoi(entry.doi),
    title: String(entry.title || ''),
    pdf_sha256: String(entry.pdf_sha256 || ''),
    wiki_status: String(entry.wiki_status || ''),
    wiki_path: String(entry.wiki_path || ''),
    extraction_status: String(entry.extraction_status || ''),
    updated_at: String(entry.updated_at || '')
  };
}

async function updateJsonIndex(indexPath, paperRow = {}, locationRow = {}) {
  const current = await readJsonObject(indexPath);
  const papers = asArrayDefault(current.papers).map(normalizeIndexEntry).filter((entry) => entry.id);
  const locations = asArrayDefault(current.locations)
    .map((entry) => ({
      id: String(entry.id || ''),
      paper_id: String(entry.paper_id || ''),
      scope: String(entry.scope || ''),
      container: String(entry.container || ''),
      folder_path: String(entry.folder_path || ''),
      pdf_filename: String(entry.pdf_filename || ''),
      pdf_path: String(entry.pdf_path || ''),
      discovered_at: String(entry.discovered_at || '')
    }))
    .filter((entry) => entry.id);
  const paperEntry = normalizeIndexEntry(paperRow);
  const locationEntry = {
    id: String(locationRow.id || ''),
    paper_id: String(locationRow.paper_id || ''),
    scope: String(locationRow.scope || ''),
    container: String(locationRow.container || ''),
    folder_path: String(locationRow.folder_path || ''),
    pdf_filename: String(locationRow.pdf_filename || ''),
    pdf_path: String(locationRow.pdf_path || ''),
    discovered_at: String(locationRow.discovered_at || '')
  };
  const nextPapers = papers.filter((entry) => entry.id !== paperEntry.id);
  if (paperEntry.id) {
    nextPapers.push(paperEntry);
  }
  const nextLocations = locations.filter((entry) => entry.id !== locationEntry.id);
  if (locationEntry.id) {
    nextLocations.push(locationEntry);
  }
  await writeJsonFile(indexPath, {
    version: 1,
    updated_at: new Date().toISOString(),
    papers: nextPapers,
    locations: nextLocations
  });
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
  readJsonObject,
  writeJsonFile,
  pathExists,
  normalizeIndexEntry,
  updateJsonIndex,
  chooseLocation
};
