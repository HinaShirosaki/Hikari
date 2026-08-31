// Guards the SQLite bundle shape: chemicals live in their own bundle file, and
// the agent inventory lookup must read them from there, not the common bundle.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(root, 'vendor/sqljs/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'vendor/sqljs', f) });

const { applyChemicalSqliteSchema, applyCommonSqliteSchema } = require(path.join(root, 'src/main/storage/storage-sql-schema.js'));
const { createAgentLookupSupport } = require(path.join(root, 'src/main/agent/tools/agent-lookup-support.js'));
const { createAgentInventoryLookupRuntime } = require(path.join(root, 'src/main/agent/tools/agent-inventory-lookup.js'));

// 1. The two bundles are disjoint.
const common = new SQL.Database();
applyCommonSqliteSchema(common);
const commonTables = common.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.flat();
assert.ok(!commonTables.includes('inventory_chemicals'), 'common bundle must not hold inventory_chemicals');
assert.ok(commonTables.includes('inventory_personal'), 'common bundle holds inventory_personal');

const chem = new SQL.Database();
applyChemicalSqliteSchema(chem);
const chemTables = chem.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.flat();
assert.ok(chemTables.includes('inventory_chemicals'), 'chemical bundle holds inventory_chemicals');

// 2. No index survives that the query planner cannot use.
for (const [label, db] of [['common', common], ['chemical', chem]]) {
  const idx = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL");
  assert.equal(idx.length, 0, `${label} bundle should carry no unusable indexes`);
}

// 3. search_text exists only where it is actually queried.
{
  const cols = (db, table) => db.exec(`PRAGMA table_info(${table})`)[0].values.map((r) => r[1]);
  for (const t of ['inventory_personal', 'inventory_samples']) {
    assert.ok(cols(common, t).includes('search_text'), `${t} keeps search_text (LIKE lookup reads it)`);
  }
  assert.ok(cols(chem, 'inventory_chemicals').includes('search_text'), 'inventory_chemicals keeps search_text');
  for (const t of ['protocol_index', 'notebook_index', 'paper_index', 'record_index']) {
    assert.ok(!cols(common, t).includes('search_text'), `${t} must not carry write-only search_text`);
  }
}

// 4. record_index carries only what hydration reads, plus its composite PK.
{
  const cols = common.exec('PRAGMA table_info(record_index)')[0].values.map((r) => r[1]);
  assert.deepEqual(cols, ['record_type', 'record_id', 'raw_json'], 'record_index stays minimal');
}

// 5. The search query still cannot use an index -- if that ever changes, revisit.
const explain = common.exec(
  "EXPLAIN QUERY PLAN SELECT id FROM inventory_personal WHERE lower(search_text) LIKE '%x%' LIMIT 5"
)[0].values.flat().join(' ');
assert.match(explain, /SCAN/, 'search_text LIKE is a scan; an index here would be dead weight');
common.close();
chem.close();

// 6. A chemical present only in the chemicals bundle must be findable.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-shape-'));
const chemPath = path.join(dir, 'chemicals.sqlite');
const commonPath = path.join(dir, 'common.sqlite');
{
  const db = new SQL.Database();
  applyChemicalSqliteSchema(db);
  db.run(
    `INSERT INTO inventory_chemicals (id, name, amount, cas, location, supplier, search_text, raw_json)
     VALUES ('c1','Tris base','500 g','77-86-1','Shelf A','Sigma','tris base 77-86-1 sigma','{}')`
  );
  await fs.writeFile(chemPath, Buffer.from(db.export()));
  db.close();
}
{
  const db = new SQL.Database();
  applyCommonSqliteSchema(db);
  await fs.writeFile(commonPath, Buffer.from(db.export()));
  db.close();
}

const support = createAgentLookupSupport({});
const runtime = createAgentInventoryLookupRuntime({
  withSqliteDatabase: support.withSqliteDatabase,
  readSqliteTables: support.readSqliteTables,
  collectLikeMatches: support.collectLikeMatches,
  querySqlRows: support.querySqlRows,
  rankRows: support.rankRows
});

const result = await runtime.searchInventorySqlite({
  sqlitePath: commonPath,
  chemicalsSqlitePath: chemPath,
  searchTerms: ['tris'],
  limit: 5
});
const names = (result.items ?? []).map((row) => row.name);
assert.ok(
  names.includes('Tris base'),
  `chemical lookup must read the chemicals bundle; got ${JSON.stringify(names)}`
);

await fs.rm(dir, { recursive: true, force: true });
console.log('sqlite-bundle-shape-selfcheck: ok');
