#!/usr/bin/env node
// Self-check for paper identity normalization + knowledge-database dedup by
// DOI / PMID / PMCID, including the ALTER TABLE migration that adds the pmid /
// pmcid columns to a pre-existing schema.
// Run: node tests/paper-dedup-identity-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  normalizeDoi,
  normalizePmid,
  normalizePmcid,
  buildPaperIdentity,
  identitiesMatch
} = require(path.join(root, 'src/main/helpers/agent/shared/paper-identity.js'));
const {
  openKnowledgeDatabase,
  migratePaperColumns,
  findExistingPaperRow,
  queryRows,
  runStatement
} = require(path.join(root, 'src/main/helpers/agent/tools/agent-paper-knowledge-database.js'));

async function main() {
  // --- identity normalization ------------------------------------------------
  assert.equal(normalizeDoi('https://doi.org/10.1/AbC'), '10.1/abc');
  assert.equal(normalizeDoi('doi: 10.1/x'), '10.1/x');
  assert.equal(normalizePmid('PMID: 12345678'), '12345678');
  assert.equal(normalizePmid('pmid31000000'), '31000000');
  assert.equal(normalizePmid('not a pmid'), '');
  assert.equal(normalizePmcid('PMC0001234'), 'PMC1234');
  assert.equal(normalizePmcid('1234567'), 'PMC1234567');

  // strong ids win; mismatched DOIs are never merged even with equal titles
  assert.equal(
    identitiesMatch(buildPaperIdentity({ doi: '10.1/x', title: 'A' }), buildPaperIdentity({ doi: '10.1/x', title: 'B' })),
    true
  );
  assert.equal(
    identitiesMatch(buildPaperIdentity({ doi: '10.1/x', title: 'Same' }), buildPaperIdentity({ doi: '10.1/y', title: 'Same' })),
    false
  );
  // pmid match
  assert.equal(
    identitiesMatch(buildPaperIdentity({ pmid: '999' }), buildPaperIdentity({ pmid: 'PMID: 999' })),
    true
  );
  // title only used when neither side has a strong id
  assert.equal(
    identitiesMatch(buildPaperIdentity({ title: 'Hello World!' }), buildPaperIdentity({ title: 'hello   world' })),
    true
  );
  assert.equal(
    identitiesMatch(buildPaperIdentity({ doi: '10.1/x', title: 'T' }), buildPaperIdentity({ title: 'T' })),
    false
  );

  // --- fresh DB has the new columns and dedups by pmid / pmcid ----------------
  const db = await openKnowledgeDatabase('/nonexistent/knowledge.index.sqlite');
  const cols = new Set(queryRows(db, 'PRAGMA table_info(papers)').map((row) => String(row.name)));
  assert.ok(cols.has('pmid') && cols.has('pmcid'), 'fresh schema must include pmid/pmcid');

  runStatement(db, "INSERT INTO papers (id, doi, pmid, pmcid, title) VALUES ('p1', '10.1/a', '12345678', 'PMC1234', 'Paper One')");

  assert.equal(findExistingPaperRow(db, { pmid: 'PMID: 12345678' })?.id, 'p1', 'dedup by pmid');
  assert.equal(findExistingPaperRow(db, { pmcid: 'PMC0001234' })?.id, 'p1', 'dedup by pmcid');
  assert.equal(findExistingPaperRow(db, { doi: '10.1/A' })?.id, 'p1', 'dedup by doi (case-insensitive)');
  assert.equal(findExistingPaperRow(db, { pmid: '0000' }), null, 'no false match');
  db.close();

  // --- migration adds columns to a legacy (pre-pmid) table --------------------
  const legacy = await openKnowledgeDatabase('/nonexistent/legacy.index.sqlite');
  legacy.run('DROP TABLE papers');
  legacy.run('CREATE TABLE papers (id TEXT PRIMARY KEY, doi TEXT, title TEXT)');
  legacy.run("INSERT INTO papers (id, doi, title) VALUES ('old1', '10.9/z', 'Legacy')");
  migratePaperColumns(legacy);
  migratePaperColumns(legacy); // idempotent: second run must not throw
  const legacyCols = new Set(queryRows(legacy, 'PRAGMA table_info(papers)').map((row) => String(row.name)));
  assert.ok(legacyCols.has('pmid') && legacyCols.has('pmcid'), 'migration adds pmid/pmcid');
  runStatement(legacy, "UPDATE papers SET pmid = '555' WHERE id = 'old1'");
  assert.equal(findExistingPaperRow(legacy, { pmid: '555' })?.id, 'old1', 'lookup works after migration');
  legacy.close();

  console.log('PASS paper-dedup-identity-selfcheck');
}

main().catch((error) => {
  console.error('FAIL paper-dedup-identity-selfcheck');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
