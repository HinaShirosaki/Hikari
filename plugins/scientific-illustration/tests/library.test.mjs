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
    assert.equal(read.scratch_visible, false); assert.deepEqual(read.objects, []);
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
    assert.match(instructions, /render BOTH canvases/);
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

test('scratch is summoned on demand without saving or changing artwork revisions', async () => {
  const host = fixture(), changes = [];
  const workspace = createWorkspace({ hikari: host, onViewChange: view => changes.push(view.scratch_visible) });
  await workspace.ready;
  const current = await workspace.request({ action: 'read' }), writes = host.writes.length;
  assert.equal(current.scratch_visible, false);
  const args = { action: 'scratch', illustration_id: current.illustration_id, visible: true };
  const summoned = await workspace.request(args); assert.equal(summoned.status, 'view_updated');
  assert.equal(summoned.scratch_visible, true); assert.equal(summoned.revision, current.revision);
  assert.equal((await workspace.request(args)).scratch_visible, true);
  assert.equal((await workspace.request({ ...args, visible: false })).scratch_visible, false);
  assert.equal(host.writes.length, writes);
  assert.equal((await workspace.request({ action: 'read' })).library_revision, current.library_revision);
  assert.deepEqual(changes, [false, true, true, false]);
});

test('hidden scratch contents survive edits, selection, and reload without reopening the panel', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const current = await workspace.request({ action: 'read' });
  await workspace.request({ action: 'apply', illustration_id: current.illustration_id,
    expected_revision: current.revision, request_id: crypto.randomUUID(),
    operations: [{ op: 'upsert', object: { id: 'component', type: 'text', canvas: 'scratch', text: 'Component label' } }] });
  assert.equal(workspace.getView().scratch_visible, false);
  await workspace.request({ action: 'scratch', visible: true });
  await workspace.manage('create'); assert.equal(workspace.getView().scratch_visible, false);
  const restored = await workspace.manage('open', current.illustration_id);
  assert.equal(restored.objects[0].canvas, 'scratch'); assert.equal(workspace.getView().scratch_visible, false);
  await workspace.request({ action: 'scratch', visible: true });
  const reloaded = host.open(); await reloaded.ready;
  const afterReload = await reloaded.request({ action: 'read' });
  assert.equal(afterReload.scratch_visible, false); assert.equal(afterReload.objects[0].text, 'Component label');
  assert.equal(afterReload.revision, restored.revision);
});

test('scratch requests reject invalid values, expired calls, and changed illustration targets', async () => {
  const host = fixture(), workspace = host.open(); await workspace.ready;
  const current = await workspace.request({ action: 'read' });
  assert.equal((await workspace.request({ action: 'scratch', visible: 'true' })).status, 'invalid_arguments');
  assert.equal((await workspace.request({ action: 'scratch' })).status, 'invalid_arguments');
  assert.equal((await workspace.request({ action: 'scratch', visible: true, operations: [] })).status, 'invalid_arguments');
  assert.equal((await workspace.request({ action: 'read', visible: true })).status, 'invalid_arguments');
  assert.equal((await workspace.request({ action: 'scratch', visible: true }, 0)).status, 'expired');
  await workspace.manage('create');
  assert.equal((await workspace.request({ action: 'scratch', visible: true, illustration_id: current.illustration_id })).status, 'illustration_changed');
  assert.equal(workspace.getView().scratch_visible, false);
});
