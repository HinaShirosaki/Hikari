'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { loadSqlJs, querySqlRows } = require('../../../../lib/sqlite.js');
const { KNOWLEDGE_BASE_ROOT_FOLDER_NAME } = require('../../../../storage/storage-paths.js');
const { intakeRelativePath } = require('./paths.js');

const EXPERIMENT_DATABASE_FILE_NAME = 'experiments.sqlite';
const SCHEMA_VERSION = 1;
const SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS papers (
    paper_id TEXT PRIMARY KEY,
    title TEXT NOT NULL, doi TEXT NOT NULL, doc_type TEXT NOT NULL,
    one_sentence_summary TEXT NOT NULL, project_ids_json TEXT NOT NULL,
    intake_path TEXT NOT NULL, paper_md TEXT NOT NULL,
    figures_dir TEXT NOT NULL, pdf_path TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS experiments (
    paper_id TEXT NOT NULL REFERENCES papers(paper_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL, id TEXT NOT NULL,
    title TEXT NOT NULL, technique TEXT NOT NULL, variables TEXT NOT NULL,
    figure_ref TEXT NOT NULL, outcome TEXT NOT NULL, evidence TEXT NOT NULL,
    PRIMARY KEY (paper_id, ordinal)
  );
  CREATE INDEX IF NOT EXISTS idx_experiments_id ON experiments(paper_id, id);
  CREATE INDEX IF NOT EXISTS idx_experiments_technique ON experiments(technique);
  CREATE INDEX IF NOT EXISTS idx_experiment_papers_doi ON papers(doi);
`;

function experimentDatabasePath(workspacePath) {
  return path.join(workspacePath, KNOWLEDGE_BASE_ROOT_FOLDER_NAME, EXPERIMENT_DATABASE_FILE_NAME);
}

// Include the JSON read/merge/write and the SQLite update in one critical
// section. sql.js exports whole images; concurrent stores must not lose rows.
const writeQueues = new Map();
function withExperimentDatabaseWrite(workspacePath, action) {
  const key = path.resolve(experimentDatabasePath(workspacePath));
  const current = (writeQueues.get(key) || Promise.resolve()).then(action);
  const settled = current.then(() => {}, () => {});
  writeQueues.set(key, settled);
  settled.then(() => {
    if (writeQueues.get(key) === settled) writeQueues.delete(key);
  });
  return current;
}

function replacePaper(db, record) {
  const source = record.source_paths;
  db.run('DELETE FROM papers WHERE paper_id = ?', [record.paper_id]);
  db.run(`INSERT INTO papers (paper_id, title, doi, doc_type, one_sentence_summary,
    project_ids_json, intake_path, paper_md, figures_dir, pdf_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    record.paper_id, record.title, record.doi, record.doc_type, record.one_sentence_summary,
    JSON.stringify(record.project_ids), intakeRelativePath(record.paper_id), source.paper_md,
    source.figures_dir, source.pdf_path, record.created_at, record.updated_at
  ]);
  const statement = db.prepare(`INSERT INTO experiments
    (paper_id, ordinal, id, title, technique, variables, figure_ref, outcome, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  try {
    record.experiments.forEach((experiment, index) => {
      statement.run([record.paper_id, index + 1, experiment.id, experiment.title,
        experiment.technique, experiment.variables, experiment.figure_ref,
        experiment.outcome, experiment.evidence || '']);
    });
  } finally {
    statement.free();
  }
}

// Caller holds withExperimentDatabaseWrite. JSON remains the recoverable source;
// a missing database is bootstrapped from every saved intake without LLM calls.
async function syncExperimentDatabase({ workspacePath, fs, record, loadRecords, rebuild = false }) {
  const sqlitePath = experimentDatabasePath(workspacePath);
  const SQL = await loadSqlJs();
  let bytes = null;
  if (!rebuild) {
    try {
      bytes = await fs.readFile(sqlitePath);
      if (!bytes.length) throw new Error('The experiment database is empty; rebuild it from saved intake records.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const db = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
  try {
    const version = querySqlRows(db, 'PRAGMA user_version')[0].user_version;
    if (version > SCHEMA_VERSION) throw new Error('The experiment database was created by a newer Hikari version.');
    db.run(SCHEMA);
    const records = bytes ? [record] : await loadRecords();
    db.run('BEGIN');
    try {
      records.forEach((entry) => replacePaper(db, entry));
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    const paperCount = querySqlRows(db, 'SELECT COUNT(*) AS count FROM papers')[0].count;
    const experimentCount = querySqlRows(db, 'SELECT COUNT(*) AS count FROM experiments')[0].count;
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    const temporary = `${sqlitePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, Buffer.from(db.export()));
      await fs.rename(temporary, sqlitePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return { sqlite_path: sqlitePath, paper_count: paperCount, experiment_count: experimentCount };
  } finally {
    db.close();
  }
}

module.exports = { experimentDatabasePath, withExperimentDatabaseWrite, syncExperimentDatabase };
