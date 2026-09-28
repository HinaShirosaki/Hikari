'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { querySqlRows: rows } = require('../../lib/sqlite.js');
const { ensurePathWithinRoot } = require('../../lib/path-safety.js');

const PAPER_COLUMNS = ['id', 'doi', 'pmid', 'pmcid', 'title', 'pdf_sha256', 'wiki_path'];
const LOCATION_COLUMNS = ['id', 'paper_id', 'scope', 'container', 'pdf_path'];
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY, doi TEXT UNIQUE, pmid TEXT, pmcid TEXT,
    title TEXT, pdf_sha256 TEXT UNIQUE, wiki_path TEXT
  );
  CREATE TABLE IF NOT EXISTS paper_locations (
    id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, scope TEXT, container TEXT, pdf_path TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_knowledge_locations_paper ON paper_locations(paper_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_papers_pmid ON papers(pmid);
  CREATE INDEX IF NOT EXISTS idx_knowledge_papers_pmcid ON papers(pmcid);
`;

function paperMetadataPath(storagePath, paper) {
  if (!paper.wiki_path) return '';
  return ensurePathWithinRoot(storagePath, path.resolve(storagePath, path.dirname(paper.wiki_path), 'meta.json'));
}

async function readPaperMetadata(storagePath, paper) {
  const file = paperMetadataPath(storagePath, paper);
  if (!file) return {};
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Invalid paper metadata: ${file}`);
    }
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writePaperMetadata(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

// Reads never migrate files. At the next write, preserve legacy-only metadata
// before replacing the wide tables; retain a one-time original image for recovery.
async function compactKnowledgeIndex(sqlitePath, db) {
  const paperColumns = rows(db, 'PRAGMA table_info(papers)').map((row) => row.name);
  const locationColumns = rows(db, 'PRAGMA table_info(paper_locations)').map((row) => row.name);
  const chunks = rows(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'paper_chunks'").length;
  if (!chunks && paperColumns.every((name) => PAPER_COLUMNS.includes(name))
    && locationColumns.every((name) => LOCATION_COLUMNS.includes(name))) return false;

  const storagePath = path.dirname(path.dirname(sqlitePath));
  const papers = rows(db, 'SELECT * FROM papers');
  const locations = rows(db, 'SELECT * FROM paper_locations');
  // Validate every sidecar before making any change. Malformed JSON must not
  // silently become an empty object and erase existing metadata.
  const updates = [];
  for (const paper of papers) {
    const removed = Object.fromEntries(Object.entries(paper)
      .filter(([key, value]) => !PAPER_COLUMNS.includes(key) && value != null && value !== ''));
    if (removed.authors_json) {
      removed.authors = JSON.parse(removed.authors_json);
      delete removed.authors_json;
    }
    const paperLocations = locations.filter((location) => location.paper_id === paper.id);
    const file = paperMetadataPath(storagePath, paper);
    if (!file) {
      if (Object.keys(removed).length) throw new Error(`Cannot migrate metadata without a Markdown path: ${paper.id}`);
      continue;
    }
    const current = await readPaperMetadata(storagePath, paper);
    const next = { ...current };
    for (const [key, value] of Object.entries({ ...removed, paper_id: paper.id, locations: paperLocations })) {
      if (next[key] == null || next[key] === '' || (Array.isArray(next[key]) && !next[key].length)) next[key] = value;
    }
    if (JSON.stringify(next) !== JSON.stringify(current)) updates.push({ file, next });
  }
  try {
    await fs.copyFile(sqlitePath, `${sqlitePath}.pre-compact.bak`, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'ENOENT') throw error;
  }
  for (const { file, next } of updates) await writePaperMetadata(file, next);

  db.run('BEGIN');
  try {
    db.run(`ALTER TABLE papers RENAME TO legacy_papers;
      ALTER TABLE paper_locations RENAME TO legacy_paper_locations;
      DROP INDEX IF EXISTS idx_knowledge_locations_paper;
      DROP INDEX IF EXISTS idx_knowledge_papers_pmid;
      DROP INDEX IF EXISTS idx_knowledge_papers_pmcid;`);
    db.run(SCHEMA);
    const select = (columns, existing) => columns.map((name) => existing.includes(name) ? name : 'NULL').join(', ');
    db.run(`INSERT INTO papers (${PAPER_COLUMNS.join(', ')}) SELECT ${select(PAPER_COLUMNS, paperColumns)} FROM legacy_papers;
      INSERT INTO paper_locations (${LOCATION_COLUMNS.join(', ')}) SELECT ${select(LOCATION_COLUMNS, locationColumns)} FROM legacy_paper_locations;
      DROP TABLE legacy_papers; DROP TABLE legacy_paper_locations; DROP TABLE IF EXISTS paper_chunks;`);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  db.run('VACUUM');
  return true;
}

module.exports = { SCHEMA, compactKnowledgeIndex, paperMetadataPath, readPaperMetadata, writePaperMetadata };
