'use strict';

// ponytail: no indexes here on purpose. Every read is either a full `SELECT *`
// load or `WHERE lower(search_text) LIKE '%term%'`, and EXPLAIN QUERY PLAN
// confirms both always SCAN. Add an index only alongside a query that can use
// it (equality/prefix on a bare column), or switch search_text to FTS5.

function applyChemicalSqliteSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_chemicals (
      id TEXT PRIMARY KEY,
      name TEXT,
      amount TEXT,
      cas TEXT,
      location TEXT,
      supplier TEXT,
      search_text TEXT,
      raw_json TEXT
    );
  `);
}

function applyCommonSqliteSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory_personal (
      zone TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT,
      quantity TEXT,
      location TEXT,
      search_text TEXT,
      raw_json TEXT,
      PRIMARY KEY (zone, id)
    );
    CREATE TABLE IF NOT EXISTS inventory_samples (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT,
      sample_type TEXT,
      lot TEXT,
      concentration TEXT,
      section TEXT,
      container_id TEXT,
      container_name TEXT,
      well_index INTEGER,
      location_text TEXT,
      notes TEXT,
      chemical_links_json TEXT,
      search_text TEXT,
      raw_json TEXT
    );
    CREATE TABLE IF NOT EXISTS protocol_index (
      id TEXT PRIMARY KEY,
      name TEXT,
      category TEXT,
      description TEXT,
      tags_json TEXT,
      linked_project TEXT,
      step_count INTEGER,
      steps_preview_json TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notebook_index (
      id TEXT PRIMARY KEY,
      protocol_id TEXT,
      protocol_name TEXT,
      project_id TEXT,
      project_name TEXT,
      result TEXT,
      notebook_state TEXT,
      executed_at TEXT,
      agent_draft_status TEXT,
      workflow_id TEXT,
      proposal_id TEXT,
      updated_at TEXT,
      created_at TEXT,
      linked_refs_json TEXT
    );
    CREATE TABLE IF NOT EXISTS paper_index (
      id TEXT PRIMARY KEY,
      title TEXT,
      file_name TEXT,
      linked_type TEXT,
      linked_id TEXT,
      linked_name TEXT,
      stored_relative_path TEXT,
      availability_status TEXT,
      ingestion_status TEXT,
      summary_status TEXT,
      methods_status TEXT,
      reagents_status TEXT,
      discovered_at TEXT,
      updated_at TEXT,
      raw_json TEXT
    );
    CREATE TABLE IF NOT EXISTS record_index (
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      raw_json TEXT,
      PRIMARY KEY (record_type, record_id)
    );
  `);
}

module.exports = {
  applyChemicalSqliteSchema,
  applyCommonSqliteSchema,
  applySqliteSchema: applyCommonSqliteSchema
};
