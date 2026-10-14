import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, encodeText } from '../workspace.mjs';
import { createDocument } from '../model.mjs';
import { normalizeLibrary } from '../library.mjs';
import { COMPLEXITY_LEVELS, COMPLEXITY_PROFILES } from '../complexity.mjs';

function fixture(legacy) {
  const files = new Map(legacy ? [['workspace.json', encodeText(JSON.stringify(legacy))]] : []);
  let stored = legacy ? { version: 1, workspacePath: 'workspace.json' } : null;
  const writes = [];
  const host = { files, writes, failIndex: false, call: async (verb, params) => {
    if (verb === 'storage.get') return { value: stored };
    if (verb === 'storage.set') { stored = params.value; return {}; }
    if (verb === 'files.read') {
      if (!files.has(params.path)) throw new Error('Missing file');
      return { dataBase64: files.get(params.path) };
    }
    if (verb === 'files.write') {
      if (host.failIndex && params.path === 'library.json') throw new Error('Index disk failure');
      files.set(params.path, params.dataBase64); writes.push(params.path); return {};
    }
    return {};
  } };
  host.open = () => createWorkspace({ hikari: host });
  host.json = path => JSON.parse(Buffer.from(files.get(path), 'base64').toString());
  return host;
}
async function title(workspace, name, extra = {}) {
  const current = await workspace.request({ action: 'read' });
  return workspace.request({ action: 'apply', illustration_id: current.illustration_id,
    expected_revision: current.revision, request_id: crypto.randomUUID(), operations: [{ op: 'title', title: name }], ...extra });
}

test('image generation preference follows the figure through history, duplication and reload', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const empty = await workspace.request({ action: 'read' });
  assert.ok((await workspace.request({ action: 'apply', expected_revision: empty.revision,
    request_id: crypto.randomUUID(), operations: [{ op: 'upsert', object: { id: 'existing-label', type: 'text', text: 'Keep this label', x: 75, y: 80 } }] })).ok);
  const original = await workspace.request({ action: 'read' });
  assert.equal(original.imageGenerationPercent, null);
  for (const percent of [0, 75, 100, null, 60]) {
    const current = await workspace.request({ action: 'read' });
    const changed = await workspace.request({ action: 'apply', illustration_id: original.illustration_id,
      expected_revision: current.revision, request_id: crypto.randomUUID(), operations: [{ op: 'image_generation', imageGenerationPercent: percent }] });
    assert.ok(changed.ok, changed.error);
    const read = await workspace.request({ action: 'read' });
    assert.equal(read.imageGenerationPercent, percent);
    assert.match(read.agent_contract.instructions, percent === null ? /Image generation: Automatic/ : new RegExp(`Image generation target: ${percent}%`));
    assert.deepEqual(read.objects, original.objects);
    assert.deepEqual(read.canvases, original.canvases);
  }
  await workspace.history('undo'); assert.equal(workspace.getDocument().imageGenerationPercent, null);
  await workspace.history('redo'); assert.equal(workspace.getDocument().imageGenerationPercent, 60);
  const copy = await workspace.manage('duplicate', original.illustration_id);
  assert.equal(copy.imageGenerationPercent, 60);
  assert.equal((await workspace.manage('create')).imageGenerationPercent, null);
  await workspace.manage('open', original.illustration_id);
  const reloaded = host.open(); await reloaded.ready;
  assert.equal((await reloaded.request({ action: 'read' })).imageGenerationPercent, 60);
  assert.equal((await reloaded.manage('open', copy.illustration_id)).imageGenerationPercent, 60);
});

test('migrates a legacy scene without changing its artwork or original file', async () => {
  const legacy = createDocument(); legacy.title = 'Existing figure';
  delete legacy.complexity;
  legacy.objects = [{ id: 'label', type: 'text', text: 'α Cell', fontSize: 32 }];
  const host = fixture(legacy), original = host.files.get('workspace.json');
  const workspace = host.open(); await workspace.ready;
  const current = await workspace.request({ action: 'read' });
  assert.equal(current.title, 'Existing figure'); assert.equal(current.objects[0].text, 'α Cell');
  assert.equal(current.complexity, 'standard');
  assert.equal(current.revision, legacy.revision);
  assert.equal(host.files.get('workspace.json'), original);
  assert.equal(host.json('library.json').illustrations[0].path, 'workspace.json');
  assert.ok((await title(workspace, 'Renamed')).ok);
  assert.equal(host.files.get('workspace.json'), original);
  const reloaded = host.open(); await reloaded.ready;
  assert.equal(reloaded.getDocument().title, 'Renamed');
});

test('complexity drives agent instructions and persists independently with each illustration', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const id = workspace.getLibrary().active_illustration_id;
  for (const complexity of COMPLEXITY_LEVELS) {
    const current = await workspace.request({ action: 'read' });
    const result = await workspace.request({ action: 'apply', illustration_id: id, expected_revision: current.revision,
      request_id: crypto.randomUUID(), operations: [{ op: 'complexity', complexity }] });
    assert.ok(result.ok);
    const read = await workspace.request({ action: 'read' });
    assert.equal(read.complexity, complexity);
    assert.ok(read.agent_contract.instructions.includes(COMPLEXITY_PROFILES[complexity].guidance));
    assert.equal('scratch_visible' in read, false); assert.deepEqual(read.objects, []);
  }
  await workspace.history('undo'); assert.equal(workspace.getDocument().complexity, 'standard');
  await workspace.history('redo'); assert.equal(workspace.getDocument().complexity, 'detailed');
  assert.equal((await workspace.manage('duplicate', id)).complexity, 'detailed');
  assert.equal((await workspace.manage('create')).complexity, 'standard');
  await workspace.manage('open', id);
  const reloaded = host.open(); await reloaded.ready;
  assert.equal((await reloaded.request({ action: 'read' })).complexity, 'detailed');
});

test('invalid complexity rejects the entire edit without writing', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const current = await workspace.request({ action: 'read' }), writes = host.writes.length;
  const result = await workspace.request({ action: 'apply', expected_revision: current.revision,
    request_id: crypto.randomUUID(), operations: [{ op: 'title', title: 'Should not save' }, { op: 'complexity', complexity: 'automatic' }] });
  assert.equal(result.ok, false);
  assert.equal(host.writes.length, writes);
  assert.equal(workspace.getDocument().revision, current.revision);
  assert.equal(workspace.getDocument().title, current.title);
});

test('every complexity exposes drawing and inspection rules through the canvas contract', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  for (const complexity of COMPLEXITY_LEVELS) {
    const current = await workspace.request({ action: 'read' });
    assert.ok((await workspace.request({ action: 'apply', expected_revision: current.revision,
      request_id: crypto.randomUUID(), operations: [{ op: 'complexity', complexity }] })).ok);
    const { instructions } = (await workspace.request({ action: 'read' })).agent_contract;
    assert.ok(instructions.includes(`Complexity: ${COMPLEXITY_PROFILES[complexity].label}.`));
    assert.match(instructions, /every label must be an independent text object/);
    assert.match(instructions, /Use SVG by default/);
    assert.match(instructions, /Codex-provided built-in image_gen/);
    assert.match(instructions, /render the canvas/);
    assert.match(instructions, /call action:"inspect"/);
  }
});

test('new and duplicated illustrations remain independent and persist their selection', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const originalId = workspace.getLibrary().active_illustration_id;
  await title(workspace, 'First');
  const duplicate = await workspace.manage('duplicate', originalId);
  assert.ok(duplicate.ok); assert.notEqual(duplicate.illustration_id, originalId);
  assert.equal(duplicate.title, 'First copy'); await title(workspace, 'Copy edited');
  const created = await workspace.manage('create'); assert.ok(created.ok); assert.equal(created.objects.length, 0);
  const first = await workspace.manage('open', originalId); assert.equal(first.title, 'First');
  const reloaded = host.open(); await reloaded.ready;
  assert.equal(reloaded.getLibrary().active_illustration_id, originalId);
  assert.equal(reloaded.getLibrary().illustrations.length, 3);
  assert.equal((await reloaded.manage('open', duplicate.illustration_id)).title, 'Copy edited');
});

test('a dropped storage pointer adopts the indexes on disk instead of overwriting them', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  await title(workspace, 'Kept'); await workspace.manage('create');
  const library = host.files.get('library.json'), assets = host.files.get('reusable-assets.json');
  await host.call('storage.set', { value: null });
  const reopened = host.open(); await reopened.ready;
  assert.equal(reopened.getLibrary().illustrations.length, 2);
  assert.equal(host.files.get('library.json'), library);
  assert.equal(host.files.get('reusable-assets.json'), assets);
  assert.ok((await host.call('storage.get')).value?.libraryPath);
  host.files.set('library.json', encodeText('{'));
  await host.call('storage.set', { value: null });
  await assert.rejects(host.open().ready);
  assert.equal(host.files.get('library.json'), encodeText('{'));
});

test('a failed index commit preserves the committed scene across reload and retry', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  await title(workspace, 'Committed');
  const committed = await workspace.request({ action: 'read' });
  const index = host.json('library.json'), scene = host.files.get(index.illustrations[0].path);
  host.failIndex = true;
  assert.equal((await title(workspace, 'Uncommitted')).ok, false);
  assert.deepEqual(host.json('library.json'), index);
  assert.equal(host.files.get(index.illustrations[0].path), scene);
  assert.equal(workspace.getDocument().revision, committed.revision);
  const reloaded = host.open(); await reloaded.ready; assert.equal(reloaded.getDocument().title, 'Committed');
  host.failIndex = false; assert.ok((await title(reloaded, 'Retry')).ok);
  assert.equal(reloaded.getDocument().title, 'Retry');
});

test('failed library creation and selection leave the existing library usable', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const id = workspace.getLibrary().active_illustration_id;
  const copy = await workspace.manage('duplicate', id);
  host.failIndex = true;
  assert.equal((await workspace.manage('create')).ok, false);
  assert.equal((await workspace.manage('open', id)).ok, false);
  assert.equal(workspace.getLibrary().active_illustration_id, copy.illustration_id);
  assert.equal(workspace.getLibrary().illustrations.length, 2);
  const reloaded = host.open(); await reloaded.ready;
  assert.equal(reloaded.getLibrary().active_illustration_id, copy.illustration_id);
});

test('agent requests pin the intended illustration when the user changes selection', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const before = await workspace.request({ action: 'read' });
  await workspace.manage('create');
  const writes = host.writes.length;
  const result = await title(workspace, 'Wrong figure', { illustration_id: before.illustration_id, expected_revision: before.revision });
  assert.equal(result.status, 'illustration_changed');
  assert.equal(host.writes.length, writes);
  assert.equal((await workspace.request({ action: 'render', illustration_id: before.illustration_id })).status, 'illustration_changed');
});

test('library mutations guard revisions, are idempotent after reload, and reject reused IDs', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const list = await workspace.request({ action: 'list' });
  const args = { action: 'create', title: 'Agent figure', expected_library_revision: list.library_revision, request_id: crypto.randomUUID() };
  const created = await workspace.request(args); assert.ok(created.ok);
  assert.equal((await workspace.request(args)).status, 'already_applied');
  assert.equal((await workspace.request({ ...args, title: 'Different' })).status, 'request_id_conflict');
  assert.equal((await workspace.request({ ...args, request_id: crypto.randomUUID() })).status, 'revision_conflict');
  const reloaded = host.open(); await reloaded.ready;
  assert.equal((await reloaded.request(args)).illustration_id, created.illustration_id);
  assert.equal(reloaded.getLibrary().illustrations.length, 2);
});

test('expired and invalid requests do not write', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const list = await workspace.request({ action: 'list' }), writes = host.writes.length;
  const args = { action: 'create', expected_library_revision: list.library_revision, request_id: crypto.randomUUID() };
  assert.equal((await workspace.request(args, 0)).status, 'expired');
  assert.equal((await workspace.request({ action: 'open', illustration_id: '../other' })).status, 'invalid_arguments');
  assert.equal((await workspace.request({ action: 'list', title: 'ignored' })).status, 'invalid_arguments');
  assert.equal((await workspace.request({ ...args, illustration_id: 'existing' })).status, 'invalid_arguments');
  assert.equal((await workspace.request({ action: 'read', illustration_id: '' })).status, 'invalid_arguments');
  assert.equal(host.writes.length, writes);
});

test('undo history belongs to the active illustration and resets on selection', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const id = workspace.getLibrary().active_illustration_id;
  await title(workspace, 'First edit'); await title(workspace, 'Second edit');
  await workspace.history('undo'); assert.equal(workspace.getDocument().title, 'First edit');
  await workspace.manage('create'); await workspace.history('undo');
  assert.equal(workspace.getDocument().title, 'Untitled figure');
  await workspace.manage('open', id); await workspace.history('redo');
  assert.equal(workspace.getDocument().title, 'First edit');
});

test('stored entries cannot redirect a figure to another scene or outside its namespace', () => {
  const raw = { version: 1, revision: 'rev', activeId: 'one', illustrations: [{ id: 'one', title: 'One', path: 'illustrations/two/scene-a.json' }] };
  assert.throws(() => normalizeLibrary(raw), /Invalid illustration entry/);
  raw.illustrations[0].path = '../scene.json'; assert.throws(() => normalizeLibrary(raw), /Invalid illustration entry/);
});

function legacyScratch() {
  const legacy = createDocument();
  legacy.canvases.scratch = { width: 500, height: 350, background: '#f7faf8' };
  legacy.objects = [
    { id: 'existing', type: 'text', text: 'Keep main', canvas: 'main', x: 100, y: 120 },
    { id: 'component', type: 'text', text: 'Component label', canvas: 'scratch', x: 45, y: 60, width: 130, height: 40, fontSize: 28, rotation: 37, color: '#287c75' },
    { id: 'second', type: 'text', text: 'ATP', canvas: 'scratch', x: 230, y: 90, width: 80, height: 30 }
  ];
  legacy.groups = [{ id: 'legacy-group', name: 'Saved assembly', canvas: 'scratch', ids: ['component', 'second'] }];
  return legacy;
}

test('read advertises one canvas and rejects obsolete scratch actions without edits', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const current = await workspace.request({ action: 'read' }), writes = host.writes.length;
  assert.deepEqual(Object.keys(current.canvases), ['main']);
  assert.equal('scratch_visible' in current, false);
  const schema = current.agent_contract.request_schema.properties;
  assert.deepEqual(schema.canvas.enum, ['main']);
  assert.ok(!schema.action.enum.includes('scratch'));
  assert.doesNotMatch(current.agent_contract.instructions, /scratch|both canvases/i);
  for (const request of [{ action: 'scratch', visible: true }, { action: 'render', canvas: 'scratch' }, { action: 'read', visible: true },
    { action: 'apply', expected_revision: current.revision, request_id: 'obsolete', operations: [{ op: 'upsert', object: { id: 'bad', type: 'text', canvas: 'scratch' } }] }]) {
    assert.equal((await workspace.request(request)).ok, false);
  }
  assert.equal(host.writes.length, writes);
  assert.equal((await workspace.request({ action: 'read' })).revision, current.revision);
});

test('legacy scratch components migrate to main with their geometry and groups intact', async () => {
  const legacy = legacyScratch(), host = fixture(legacy), original = host.files.get('workspace.json');
  const workspace = host.open(); await workspace.ready;
  const current = await workspace.request({ action: 'read' });
  assert.deepEqual(Object.keys(current.canvases), ['main']);
  assert.deepEqual(current.canvases.main, legacy.canvases.main);
  assert.ok(current.objects.every(object => object.canvas === 'main'));
  assert.deepEqual(current.groups[0].ids, legacy.groups[0].ids);
  assert.equal(current.groups[0].canvas, 'main');
  assert.equal(current.groups[0].name, legacy.groups[0].name);
  for (const object of legacy.objects) for (const [key, value] of Object.entries(object)) {
    assert.equal(current.objects.find(item => item.id === object.id)[key], key === 'canvas' ? 'main' : value);
  }
  assert.notEqual(current.revision, legacy.revision);
  assert.equal(host.files.get('workspace.json'), original, 'The original file stays recoverable');
  const entry = host.json('library.json').illustrations[0];
  assert.notEqual(entry.path, 'workspace.json');
  assert.deepEqual(Object.keys(host.json(entry.path).canvases), ['main']);
  assert.ok((await title(workspace, 'Migrated figure')).ok);
  await workspace.history('undo');
  assert.ok(workspace.getDocument().objects.every(object => object.canvas === 'main'));
  await workspace.history('redo');
  const reloaded = host.open(); await reloaded.ready;
  assert.deepEqual(reloaded.getDocument().objects, workspace.getDocument().objects);
  assert.deepEqual(reloaded.getDocument().groups, workspace.getDocument().groups);
});

test('indexed scenes migrate through a new file and failed index writes leave the legacy file committed', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const entry = host.json('library.json').illustrations[0], legacy = legacyScratch();
  host.files.set(entry.path, encodeText(JSON.stringify(legacy)));
  const original = host.files.get(entry.path), index = host.files.get('library.json');
  host.failIndex = true;
  await assert.rejects(host.open().ready, /Index disk failure/);
  assert.equal(host.files.get(entry.path), original);
  assert.equal(host.files.get('library.json'), index);
  host.failIndex = false;
  const restored = host.open(); await restored.ready;
  const changed = host.json('library.json').illustrations[0];
  assert.notEqual(changed.path, entry.path);
  assert.equal(host.files.get(entry.path), original);
  assert.ok(restored.getDocument().objects.every(object => object.canvas === 'main'));
  const writes = host.writes.length, reloaded = host.open(); await reloaded.ready;
  assert.equal(host.writes.length, writes, 'Already migrated scenes are not rewritten again');
  assert.deepEqual(reloaded.getDocument(), restored.getDocument());
});

test('opening an inactive legacy illustration migrates only that figure before selection', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const entry = host.json('library.json').illustrations[0];
  const other = await workspace.manage('create');
  host.files.set(entry.path, encodeText(JSON.stringify(legacyScratch())));
  const original = host.files.get(entry.path);
  const reloaded = host.open(); await reloaded.ready;
  assert.equal(reloaded.getLibrary().active_illustration_id, other.illustration_id);
  const opened = await reloaded.manage('open', entry.id);
  assert.ok(opened.ok, opened.error);
  assert.equal(opened.illustration_id, entry.id);
  assert.ok(opened.objects.every(object => object.canvas === 'main'));
  assert.equal(host.files.get(entry.path), original);
  assert.notEqual(host.json('library.json').illustrations.find(item => item.id === entry.id).path, entry.path);
  const afterReload = host.open(); await afterReload.ready;
  assert.deepEqual(afterReload.getDocument().objects, reloaded.getDocument().objects);
});
