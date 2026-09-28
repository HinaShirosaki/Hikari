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

module.exports = {
  applyChemicalSqliteSchema
};
