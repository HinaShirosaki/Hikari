// Guards the two durability properties of the sql.js storage layer:
//   1. Knowledge-database writes are serialized, so concurrent paper ingests
//      cannot each start from the same image and overwrite one another.
//   2. Database images are swapped in by rename, so a crash mid-write cannot
//      truncate a live database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

const {
  openKnowledgeDatabase,
  persistKnowledgeDatabase,
  queryRows,
  runStatement,
  withKnowledgeDatabaseWrite
} = require(path.join(root, 'src/main/papers/store/paper-knowledge-store.js'));
const { persistSqliteDatabase } = require(path.join(root, 'src/main/lib/sqlite-persist.js'));

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-sqlite-durability-'));

// 1. Concurrent ingests all survive.
// paper-acquisition.js runs DEFAULT_DOWNLOAD_CONCURRENCY (4) ingests at a time;
// each one is an open -> mutate -> persist cycle over the whole database image.
{
  const sqlitePath = path.join(workDir, 'knowledge.sqlite');
  const ids = ['p1', 'p2', 'p3', 'p4'];
  await Promise.all(ids.map((id) => withKnowledgeDatabaseWrite(sqlitePath, async (db) => {
    runStatement(db, 'INSERT OR REPLACE INTO papers (id, title) VALUES (?, ?)', [id, `Paper ${id}`]);
    await persistKnowledgeDatabase(sqlitePath, db);
  })));

  const db = await openKnowledgeDatabase(sqlitePath);
  const stored = queryRows(db, 'SELECT id FROM papers ORDER BY id').map((row) => row.id);
  db.close();
  assert.deepEqual(stored, ids, 'every concurrently ingested paper must survive');
}

// A rejected write must not wedge the queue for later writes on the same path.
{
  const sqlitePath = path.join(workDir, 'recovers.sqlite');
  await assert.rejects(
    withKnowledgeDatabaseWrite(sqlitePath, async () => { throw new Error('boom'); }),
    /boom/,
    'the action error must reach the caller'
  );
  const value = await withKnowledgeDatabaseWrite(sqlitePath, async () => 'ran');
  assert.equal(value, 'ran', 'a failed write must not poison the queue');
}

// 2. Saves swap a new file in rather than truncating the live one.
// A direct writeFile keeps the inode and truncates in place; rename replaces it,
// so a changed inode is what proves the write was atomic.
{
  const sqlitePath = path.join(workDir, 'atomic.sqlite');
  const first = await openKnowledgeDatabase(sqlitePath);
  runStatement(first, 'INSERT INTO papers (id, title) VALUES (?, ?)', ['a', 'A']);
  await persistSqliteDatabase(sqlitePath, first);
  first.close();
  const beforeInode = fs.statSync(sqlitePath).ino;

  const second = await openKnowledgeDatabase(sqlitePath);
  runStatement(second, 'INSERT INTO papers (id, title) VALUES (?, ?)', ['b', 'B']);
  await persistSqliteDatabase(sqlitePath, second);
  second.close();

  assert.notEqual(
    fs.statSync(sqlitePath).ino,
    beforeInode,
    'saving must rename a fresh file into place, not truncate the live database'
  );
  assert.deepEqual(
    fs.readdirSync(workDir).filter((name) => name.endsWith('.tmp')),
    [],
    'no temporary image may be left behind'
  );

  const reopened = await openKnowledgeDatabase(sqlitePath);
  const rows = queryRows(reopened, 'SELECT id FROM papers ORDER BY id').map((row) => row.id);
  reopened.close();
  assert.deepEqual(rows, ['a', 'b'], 'the swapped-in image must carry both writes');
}

// 3. An unreadable index degrades instead of failing the whole load.
// The bundle and workflow indexes are derived from the sidecars and rewritten on
// every save, so corruption must read like a missing file, not throw.
{
  const { readSqliteBundleIndex } = require(path.join(root, 'src/main/storage/storage-sql-read.js'));
  const { readWorkflowStatusIndex } = require(path.join(root, 'src/main/storage/workflow/read-root.js'));
  const { createAgentLookupSupport } = require(path.join(root, 'src/main/agent/tools/agent-lookup-support.js'));

  const healthy = path.join(workDir, 'healthy.sqlite');
  const seed = await openKnowledgeDatabase(healthy);
  runStatement(seed, 'INSERT INTO papers (id, title) VALUES (?, ?)', ['a', 'A']);
  await persistKnowledgeDatabase(healthy, seed);
  seed.close();
  const healthyBytes = fs.readFileSync(healthy);

  const garbage = path.join(workDir, 'garbage.sqlite');
  fs.writeFileSync(garbage, Buffer.from('not a database at all'.repeat(80)));
  const truncated = path.join(workDir, 'truncated.sqlite');
  fs.writeFileSync(truncated, healthyBytes.subarray(0, Math.floor(healthyBytes.length / 2)));

  for (const [label, target] of [['garbage', garbage], ['truncated', truncated]]) {
    const bundle = await readSqliteBundleIndex(target);
    assert.equal(bundle.exists, false, `${label} bundle index must read as absent`);
    assert.deepEqual(bundle.protocolRows, [], `${label} bundle index must yield no rows`);
    assert.match(String(bundle.warning || ''), /unreadable/i, `${label} bundle index must warn`);

    const workflow = await readWorkflowStatusIndex(target);
    assert.equal(workflow.exists, false, `${label} workflow index must read as absent`);
    assert.match(String(workflow.warnings?.[0] || ''), /unreadable/i, `${label} workflow index must warn`);

    const support = createAgentLookupSupport({});
    const lookup = await support.withSqliteDatabase(target, async () => 'ran');
    assert.equal(lookup.ok, false, `${label} must not reach the agent lookup callback`);
    assert.equal(lookup.reason, 'sqlite_unreadable');
  }

  // A healthy index still reads normally.
  const good = await readSqliteBundleIndex(healthy);
  assert.equal(good.exists, true, 'a healthy index must still load');
}

// 4. Crash wreckage is swept, but a save still in flight is not.
{
  const target = path.join(workDir, 'sweep', 'index.sqlite');
  const db = await openKnowledgeDatabase(target);
  runStatement(db, 'INSERT INTO papers (id, title) VALUES (?, ?)', ['s', 'S']);
  await persistSqliteDatabase(target, db);

  const folder = path.dirname(target);
  const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
  const stale = `${target}.111.deadbeef.tmp`;
  fs.writeFileSync(stale, 'wreckage');
  fs.utimesSync(stale, twoHoursAgo, twoHoursAgo);
  const inFlight = `${target}.222.feedface.tmp`;
  fs.writeFileSync(inFlight, 'still being written');
  const otherDb = path.join(folder, 'other.sqlite.333.cafebabe.tmp');
  fs.writeFileSync(otherDb, 'belongs to another database');
  fs.utimesSync(otherDb, twoHoursAgo, twoHoursAgo);

  await persistSqliteDatabase(target, db);
  db.close();

  const left = fs.readdirSync(folder);
  assert.equal(left.includes(path.basename(stale)), false, 'a crashed save\'s temporary must be swept');
  assert.equal(left.includes(path.basename(inFlight)), true, 'a save still in flight must be left alone');
  assert.equal(left.includes(path.basename(otherDb)), true, 'another database\'s temporary must be left alone');

  const reopened = await openKnowledgeDatabase(target);
  assert.deepEqual(queryRows(reopened, 'SELECT id FROM papers').map((row) => row.id), ['s']);
  reopened.close();
}

// 5. A failed workflow sync still closes its database.
// sql.js holds the whole image in the WASM heap, so a sync that throws part way
// through the folder writes leaks megabytes unless the close runs in a finally.
{
  const { loadSqlJs } = require(path.join(root, 'src/main/storage/storage-utils.js'));
  const { syncWorkflowRootFromSnapshot } = require(path.join(root, 'src/main/storage/workflow/sync-root.js'));

  const storagePath = path.join(workDir, 'workflow-leak');
  fs.mkdirSync(storagePath, { recursive: true });
  const snapshot = {
    settings: { storagePath },
    workflowTemplates: [{ id: 't1', name: 'T', steps: [{ id: 's1', text: 'step' }] }],
    workflows: [{ id: 'w1', templateId: 't1' }]
  };

  const SQL = await loadSqlJs();
  const RealDatabase = SQL.Database;
  const realClose = RealDatabase.prototype.close;
  let opened = 0;
  let closed = 0;
  RealDatabase.prototype.close = function countedClose(...args) {
    closed += 1;
    return realClose.apply(this, args);
  };
  SQL.Database = function CountedDatabase(...args) {
    opened += 1;
    return new RealDatabase(...args);
  };
  SQL.Database.prototype = RealDatabase.prototype;

  // Make the folder writes fail after the database has been built. If the
  // filesystem ignores the mode (running as root) the sync simply succeeds,
  // and the close must have happened on that path too.
  const workflowRoot = path.join(storagePath, 'Workflow');
  fs.mkdirSync(workflowRoot, { recursive: true });
  fs.chmodSync(workflowRoot, 0o500);
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await syncWorkflowRootFromSnapshot({ storagePath, snapshot }).catch(() => {});
    }
  } finally {
    fs.chmodSync(workflowRoot, 0o700);
    SQL.Database = RealDatabase;
    RealDatabase.prototype.close = realClose;
  }

  assert.ok(opened > 0, 'the sync must have opened at least one database');
  assert.equal(closed, opened, 'every database a workflow sync opens must be closed');
}

fs.rmSync(workDir, { recursive: true, force: true });
console.log('sqlite durability selfcheck passed');
