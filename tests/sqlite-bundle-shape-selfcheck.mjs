// Guards the SQLite bundle shape: the chemicals index is the only save-time
// SQLite bundle, and the agent inventory lookup must read chemicals from it.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(root, 'vendor/sqljs/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'vendor/sqljs', f) });

const schema = require(path.join(root, 'src/main/storage/storage-sql-schema.js'));
const { applyChemicalSqliteSchema } = schema;
const { createAgentLookupSupport } = require(path.join(root, 'src/main/agent/tools/agent-lookup-support.js'));
const { createAgentInventoryLookupRuntime } = require(path.join(root, 'src/main/agent/tools/agent-inventory-lookup.js'));

// 1. Each module index holds exactly its own tables.
const tablesOf = (applySchema) => {
  const db = new SQL.Database();
  applySchema(db);
  const names = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0].values.flat();
  const indexes = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL");
  const searchCols = names.filter((t) => db.exec(`PRAGMA table_info(${t})`)[0].values.some((r) => r[1] === 'search_text'));
  db.close();
  return { names, indexes: indexes.length, searchCols };
};
const expected = {
  applyChemicalSqliteSchema: ['inventory_chemicals', 'inventory_meta']
};
assert.deepEqual(Object.keys(schema).sort(), Object.keys(expected).sort(), 'one schema per module index');
for (const [name, tables] of Object.entries(expected)) {
  const shape = tablesOf(schema[name]);
  assert.deepEqual(shape.names, tables, `${name} holds only its module's tables`);
  // 2. No index survives that the query planner cannot use.
  assert.equal(shape.indexes, 0, `${name} should carry no unusable indexes`);
  // 3. search_text exists only where the LIKE lookup reads it.
  const searched = tables.filter((t) => t === 'inventory_chemicals');
  assert.deepEqual(shape.searchCols, searched, `${name} carries search_text only on searched tables`);
}

const chemicals = new SQL.Database();
applyChemicalSqliteSchema(chemicals);
// 4. The search query still cannot use an index -- if that ever changes, revisit.
const explain = chemicals.exec(
  "EXPLAIN QUERY PLAN SELECT id FROM inventory_chemicals WHERE lower(search_text) LIKE '%x%' LIMIT 5"
)[0].values.flat().join(' ');
assert.match(explain, /SCAN/, 'search_text LIKE is a scan; an index here would be dead weight');
chemicals.close();

// 5. A chemical present only in the chemicals bundle must be findable.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-shape-'));
const chemPath = path.join(dir, 'chemicals.sqlite');
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

const support = createAgentLookupSupport({});
const runtime = createAgentInventoryLookupRuntime({
  withSqliteDatabase: support.withSqliteDatabase,
  readSqliteTables: support.readSqliteTables,
  collectLikeMatches: support.collectLikeMatches,
  rankRows: support.rankRows
});

const result = await runtime.searchInventorySqlite({
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
