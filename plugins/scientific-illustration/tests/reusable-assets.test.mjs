import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, encodeText } from '../workspace.mjs';
import { createDocument, normalizeObject } from '../model.mjs';
import { selectionBounds } from '../grouping.mjs';
import { ASSETS_PATH, snapshotAsset, instantiateAsset, normalizeAssetLibrary, validateAssetRequest } from '../reusable-assets.mjs';

function fixture() {
  const files = new Map(); let stored;
  const host = { files, writes: [], failPath: '', call: async (verb, params) => {
    if (verb === 'storage.get') return { value: stored };
    if (verb === 'storage.set') { stored = params.value; return {}; }
    if (verb === 'files.read') {
      if (!files.has(params.path)) throw new Error('Missing file');
      return { dataBase64: files.get(params.path) };
    }
    if (verb === 'files.write') {
      if (host.failPath && params.path.startsWith(host.failPath)) throw new Error('Injected disk failure');
      files.set(params.path, params.dataBase64); host.writes.push(params.path); return {};
    }
    return {};
  } };
  host.open = () => createWorkspace({ hikari: host });
  host.json = path => JSON.parse(Buffer.from(files.get(path), 'base64').toString());
  return host;
}
const apply = async (w, operations, extra = {}) => {
  const current = await w.request({ action: 'read' });
  return w.request({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
    request_id: crypto.randomUUID(), operations, ...extra });
};
const seed = w => apply(w, [
  { op: 'upsert', object: { id: 'a', name: 'First label', type: 'text', canvas: 'scratch', x: 80, y: 30, width: 160, height: 50, rotation: 35, text: 'α Cell', fontSize: 28, color: '#287c75' } },
  { op: 'upsert', object: { id: 'b', name: 'Second label', type: 'text', canvas: 'scratch', x: 270, y: 80, width: 80, height: 25, text: 'ATP', fontSize: 14, fontWeight: 700 } },
  { op: 'group', id: 'component', name: 'Labeled component', ids: ['b', 'a'] }
]);
const saveArgs = async (w, extra = {}) => {
  const r = await w.request({ action: 'read' });
  return { action: 'asset_save', illustration_id: r.illustration_id, expected_revision: r.revision,
    expected_assets_revision: r.assets_revision, request_id: crypto.randomUUID(), name: 'Labeled component', id: 'component', ...extra };
};

test('snapshot and placement retain rotated vector/raster/text geometry and independent styling', () => {
  const doc = createDocument();
  doc.objects = [
    normalizeObject({ id: 'v', type: 'vector', x: 220, y: 80, width: 160, height: 90, rotation: 43, fill: '#123456', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><path d="M0 0L2 1"/></svg>' }),
    normalizeObject({ id: 'r', type: 'raster', x: 90, y: 200, width: 90, height: 100, rotation: -20, textFree: true, dataUrl: 'data:image/png;base64,AAAA' }),
    normalizeObject({ id: 't', type: 'text', x: 140, y: 370, width: 120, height: 40, text: 'Cell', fontSize: 20, anchor: 'middle', align: 'end', italic: true })
  ];
  const before = JSON.stringify(doc), box = selectionBounds(doc.objects);
  const asset = snapshotAsset(doc, { name: 'Mixed component', ids: ['t', 'r', 'v'] });
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(asset.objects.map(o => o.id), ['v', 'r', 't']);
  const placed = instantiateAsset(asset, { op: 'insert_asset', asset_id: 'saved', canvas: 'scratch', x: 40, y: 50, width: box.width * 2 }, doc);
  const copies = placed.operations.filter(o => o.op === 'upsert').map(o => o.object);
  assert.equal(copies.length, 3); assert.ok(placed.inserted.group_id);
  for (let i = 0; i < copies.length; i++) {
    const o = copies[i], old = doc.objects[i];
    assert.notEqual(o.id, old.id); assert.equal(o.rotation, old.rotation);
    assert.ok(Math.abs(o.x - (40 + (old.x - box.x) * 2)) < 1e-8);
    assert.ok(Math.abs(o.y - (50 + (old.y - box.y) * 2)) < 1e-8);
    assert.ok(Math.abs(o.width-old.width*2)<1e-8); assert.ok(Math.abs(o.height-old.height*2)<1e-8);
    assert.equal(o.canvas, 'scratch');
  }
  assert.equal(copies[0].svg, doc.objects[0].svg); assert.equal(copies[0].fill, '#123456');
  assert.equal(copies[1].dataUrl, doc.objects[1].dataUrl);
  assert.ok(Math.abs(copies[2].fontSize-40)<1e-8); assert.equal(copies[2].align, 'end'); assert.equal(copies[2].italic, true);
  assert.ok(Math.abs(placed.inserted.bounds.x - 40) < 1e-8);
  assert.ok(Math.abs(placed.inserted.bounds.y - 50) < 1e-8);
  assert.throws(() => instantiateAsset(asset, { op: 'insert_asset', asset_id: 'saved', canvas: 'main', width: 200, height: 200 }, doc), /proportionally/);
});

test('asset save is a durable snapshot shared across figures without changing canvas revision', async () => {
  const host = fixture(), w = host.open(); await w.ready; assert.ok((await seed(w)).ok);
  const before = await w.request({ action: 'read' });
  const saved = await w.request(await saveArgs(w)); assert.ok(saved.ok);
  const after = await w.request({ action: 'read' });
  assert.equal(after.revision, before.revision); assert.equal(after.library_revision, before.library_revision);
  assert.deepEqual(after.objects, before.objects); assert.equal(after.assets_revision, saved.assets_revision);
  const asset = (await w.request({ action: 'asset_read', asset_id: saved.asset_id })).component;
  await apply(w, [{ op: 'update', id: 'a', patch: { text: 'Changed later' } }]);
  assert.deepEqual((await w.request({ action: 'asset_read', asset_id: saved.asset_id })).component, asset);
  await w.manage('create');
  assert.equal((await w.request({ action: 'asset_list' })).reusable_assets[0].id, saved.asset_id);
  const reloaded = host.open(); await reloaded.ready;
  assert.deepEqual((await reloaded.request({ action: 'asset_read', asset_id: saved.asset_id })).component, asset);
  assert.equal(host.json(ASSETS_PATH).assets.length, 1);
});

test('asset insertion creates independent groups, honors preceding canvas changes, and supports undo/redo', async () => {
  const host = fixture(), w = host.open(); await w.ready; await seed(w);
  const saved = await w.request(await saveArgs(w)); await w.manage('create');
  const result = await apply(w, [{ op: 'canvas', canvas: 'main', patch: { width: 2400, height: 1200 } },
    { op: 'insert_asset', asset_id: saved.asset_id, canvas: 'main' }]);
  assert.ok(result.ok, result.error); const instance = result.inserted_assets[0];
  assert.equal(result.groups[0].name, 'Labeled component'); assert.deepEqual(result.groups[0].ids, instance.ids);
  assert.ok(Math.abs(instance.bounds.x - (2400 - instance.bounds.width) / 2) < 1e-8);
  assert.ok(Math.abs(instance.bounds.y - (1200 - instance.bounds.height) / 2) < 1e-8);
  const inserted = result.objects;
  const second = await apply(w, [{ op: 'insert_asset', asset_id: saved.asset_id, canvas: 'scratch', x: 10, y: 15 }]);
  assert.ok(second.ok); assert.equal(second.objects.length, 4);
  assert.ok(second.inserted_assets[0].ids.every(id => !instance.ids.includes(id)));
  await w.history('undo'); assert.deepEqual(w.getDocument().objects, inserted);
  await w.history('redo'); assert.equal(w.getDocument().objects.length, 4);
});

test('a single saved object stays a single independently editable layer', async () => {
  const host = fixture(), w = host.open(); await w.ready; await seed(w);
  const saved = await w.request(await saveArgs(w, { id: 'a', name: 'One label' }));
  await w.manage('create'); const placed = await apply(w, [{ op: 'insert_asset', asset_id: saved.asset_id, canvas: 'main', x: 100, y: 110 }]);
  assert.ok(placed.ok); assert.equal(placed.groups.length, 0); assert.equal(placed.objects.length, 1);
  assert.equal(placed.inserted_assets[0].group_id, null);
  const b = selectionBounds(placed.objects); assert.ok(Math.abs(b.x-100)<1e-8); assert.ok(Math.abs(b.y-110)<1e-8);
});

test('save guards revisions and active illustration and rejects mixed or nonexistent selections', async () => {
  const host = fixture(), w = host.open(); await w.ready; await seed(w);
  const args = await saveArgs(w), writes = host.writes.length;
  assert.equal((await w.request({ ...args, expected_revision: 'stale' })).status, 'revision_conflict');
  assert.equal((await w.request({ ...args, expected_assets_revision: 'stale' })).status, 'revision_conflict');
  assert.equal((await w.request({ ...args, id: 'missing' })).ok, false); assert.equal(host.writes.length, writes);
  await apply(w, [{ op: 'upsert', object: { id: 'main-label', type: 'text', canvas: 'main' } }]);
  const mixed = await saveArgs(w); delete mixed.id; mixed.ids = ['a', 'main-label'];
  assert.match((await w.request(mixed)).error, /one canvas/);
  const pinned = await saveArgs(w); await w.manage('create');
  assert.equal((await w.request(pinned)).status, 'illustration_changed');
});

test('save and delete retries are idempotent across reload and reject changed arguments', async () => {
  const host = fixture(), w = host.open(); await w.ready; await seed(w);
  const args = await saveArgs(w), saved = await w.request(args);
  const reload = host.open(); await reload.ready;
  assert.equal((await reload.request(args)).status, 'already_applied');
  assert.equal((await reload.request({ ...args, name: 'Other' })).status, 'request_id_conflict');
  assert.equal((await reload.request({ ...args, request_id: crypto.randomUUID() })).status, 'revision_conflict');
  const del = { action: 'asset_delete', asset_id: saved.asset_id, expected_assets_revision: saved.assets_revision, request_id: crypto.randomUUID() };
  assert.ok((await reload.request(del)).ok);
  const reload2 = host.open(); await reload2.ready;
  assert.equal((await reload2.request(del)).status, 'already_applied');
  assert.equal((await reload2.request({ action: 'asset_list' })).reusable_assets.length, 0);
});

test('placed copies remain usable after asset removal; insertion retries retain original IDs', async () => {
  const host = fixture(), w = host.open(); await w.ready; await seed(w);
  const saved = await w.request(await saveArgs(w)); await w.manage('create');
  const current = await w.request({ action: 'read' }), args = { action: 'apply', expected_revision: current.revision, request_id: crypto.randomUUID(),
    operations: [{ op: 'insert_asset', asset_id: saved.asset_id, canvas: 'main' }] };
  const placed = await w.request(args); assert.ok(placed.ok);
  await w.manageAsset('asset_delete', { asset_id: saved.asset_id });
  const reload = host.open(); await reload.ready;
  const repeated = await reload.request(args);
  assert.equal(repeated.status, 'already_applied'); assert.deepEqual(repeated.inserted_assets, placed.inserted_assets);
  assert.deepEqual(repeated.objects, placed.objects);
  assert.ok((await apply(reload, [{ op: 'update', id: placed.objects[0].id, patch: { text: 'Edited copy' } }])).ok);
  assert.equal((await apply(reload, [{ op: 'insert_asset', asset_id: saved.asset_id, canvas: 'main' }])).ok, false);
});

test('asset or index write failure preserves the committed library through reload', async () => {
  const host = fixture(), w = host.open(); await w.ready; await seed(w);
  const committed = host.json(ASSETS_PATH), args = await saveArgs(w);
  host.failPath = 'assets/';
  assert.equal((await w.request(args)).ok, false); assert.deepEqual(host.json(ASSETS_PATH), committed);
  host.failPath = ASSETS_PATH;
  assert.equal((await w.request(args)).ok, false); assert.deepEqual(host.json(ASSETS_PATH), committed);
  const reload = host.open(); await reload.ready; assert.equal(reload.getAssets().reusable_assets.length, 0);
  host.failPath = ''; assert.ok((await reload.request(args)).ok);
  const saved = reload.getAssets(), entry = host.json(ASSETS_PATH).assets[0];
  host.failPath = ASSETS_PATH; assert.equal((await reload.manageAsset('asset_delete', { asset_id: entry.id })).ok, false);
  const reload2 = host.open(); await reload2.ready; assert.deepEqual(reload2.getAssets(), saved);
  assert.equal((await reload2.request({ action: 'asset_read', asset_id: entry.id })).ok, true);
});

test('failed multi-operation insertion leaves all scene objects and files unchanged', async () => {
  const host = fixture(), w = host.open(); await w.ready; await seed(w);
  const saved = await w.request(await saveArgs(w)); await w.manage('create');
  const before = JSON.stringify(w.getDocument()), writes = host.writes.length;
  const failed = await apply(w, [{ op: 'title', title: 'Should not commit' },
    { op: 'insert_asset', asset_id: saved.asset_id, canvas: 'main', width: 8000 }]);
  assert.equal(failed.ok, false); assert.equal(JSON.stringify(w.getDocument()), before); assert.equal(host.writes.length, writes);
  const invalid = await apply(w, [{ op: 'insert_asset', asset_id: saved.asset_id, canvas: 'main', unexpected: true }]);
  assert.equal(invalid.ok, false); assert.equal(host.writes.length, writes);
});

test('asset persistence corruption is reported without silently clearing the library', async () => {
  const host = fixture(), w = host.open(); await w.ready; await seed(w); await w.request(await saveArgs(w));
  const bad = { ...host.json(ASSETS_PATH), assets: [{ ...host.json(ASSETS_PATH).assets[0], id: '../secret' }] };
  host.files.set(ASSETS_PATH, encodeText(JSON.stringify(bad))); const writes = host.writes.length;
  await assert.rejects(host.open().ready, /Invalid reusable asset entry/); assert.equal(host.writes.length, writes);
  assert.throws(() => normalizeAssetLibrary(bad), /Invalid reusable asset entry/);
});

test('asset requests validate fields, enforce deadlines, and advertise their schema', async () => {
  const host = fixture(), w = host.open(); await w.ready;
  const r = await w.request({ action: 'read' }), schema = r.agent_contract.request_schema;
  assert.ok(schema.properties.action.enum.includes('asset_save')); assert.ok(schema.properties.operations.items.properties.op.enum.includes('insert_asset'));
  assert.match(r.agent_contract.instructions, /Reusable components/);
  assert.equal((await w.request({ action: 'asset_list', include_assets: true })).status, 'invalid_arguments');
  assert.equal((await w.request({ action: 'asset_list' }, 0)).status, 'expired');
  assert.throws(() => validateAssetRequest({ action: 'asset_read', asset_id: '../bad' }), /asset_id/);
  await seed(w); const args = await saveArgs(w);
  assert.equal((await w.request({ ...args, ids: ['a'] })).status, 'invalid_arguments');
  assert.equal((await w.request({ ...args, name: ' ' })).status, 'invalid_arguments');
});
