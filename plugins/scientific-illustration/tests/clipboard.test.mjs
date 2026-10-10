import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, normalizeDocument, applyOperations, MAX_DOCUMENT_CHARS } from '../model.mjs';
import { copyComponents, instantiateClipboard, parseClipboard, normalizeClipboard, CLIPBOARD_FORMAT } from '../clipboard.mjs';
import { createWorkspace } from '../workspace.mjs';

const scene = () => normalizeDocument({ ...createDocument(), objects: [
  { id: 'vector', type: 'vector', name: 'Membrane', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><path d="M0 0L2 1"/></svg>', x: 200, y: 100, width: 140, height: 80, rotation: 37, fill: '#123456', strokeWidth: 2, opacity: 0.6 },
  { id: 'raster', type: 'raster', name: 'Cargo', dataUrl: 'data:image/png;base64,AAAA', textFree: true, x: 400, y: 150, width: 90, height: 60, rotation: -20, visible: false },
  { id: 'text', type: 'text', name: 'Label', text: 'α Receptor\nATP', x: 240, y: 220, width: 160, height: 80, fontSize: 28, italic: true, align: 'end', anchor: 'bottom' },
  { id: 'other', type: 'text', text: 'Independent', x: 40, y: 30 }
], groups: [{ id: 'assembly', name: 'Labeled membrane', canvas: 'main', ids: ['text', 'vector', 'raster'] }] });

test('copy is an immutable snapshot of selected paint order, media, labels and full groups', () => {
  const original = scene(), before = structuredClone(original), snapshot = copyComponents(original, ['text', 'raster', 'vector']);
  assert.deepEqual(original, before); assert.deepEqual(snapshot.objects, original.objects.slice(0, 3));
  assert.deepEqual(snapshot.groups, original.groups);
  original.objects[0].x = 999; original.groups[0].ids.pop();
  assert.equal(snapshot.objects[0].x, 200); assert.equal(snapshot.groups[0].ids.length, 3);
  assert.deepEqual(copyComponents(before, ['vector']).groups, []);
  assert.deepEqual(copyComponents(before, ['text', 'other']).groups, []);
});

test('paste remaps IDs and full group membership, retaining exact editable content and relative geometry', () => {
  const original = scene(), snapshot = copyComponents(original, ['text', 'vector', 'raster', 'other']);
  const instance = instantiateClipboard(snapshot, 'scratch', 30), pasted = applyOperations(original, instance.operations);
  const copies = pasted.objects.filter(object => instance.ids.includes(object.id));
  assert.equal(new Set(pasted.objects.map(object => object.id)).size, 8);
  copies.forEach((copy, index) => {
    const source = original.objects[index], { id, canvas, x, y, ...content } = copy;
    assert.notEqual(id, source.id); assert.equal(canvas, 'scratch'); assert.equal(x, source.x + 30); assert.equal(y, source.y + 30);
    assert.deepEqual(content, (({ id, canvas, x, y, ...content }) => content)(source));
  });
  assert.equal(pasted.groups[1].name, original.groups[0].name);
  assert.deepEqual(pasted.groups[1].ids, [copies[2].id, copies[0].id, copies[1].id]);
  assert.ok(!pasted.groups[1].ids.includes(copies[3].id));
  assert.deepEqual(snapshot, copyComponents(original, original.objects.map(object => object.id)));
});

test('paste clamps translation as an assembly and rejects malformed clipboard payloads', () => {
  const original = scene(); original.objects[0].x = 15999;
  const snapshot = copyComponents(original, ['vector', 'text']), pasted = instantiateClipboard(snapshot, 'main', 15);
  assert.deepEqual(pasted.operations.map(operation => operation.object.x), [16000, original.objects[2].x + 1]);
  assert.equal(parseClipboard(JSON.stringify(snapshot)).objects.length, 2);
  for (const raw of [null, 'text', { ...snapshot, version: 2 }, { ...snapshot, objects: [] },
    { ...snapshot, unknown: true }, { ...snapshot, groups: scene().groups },
    { ...snapshot, objects: snapshot.objects.map((object, index) => ({ ...object, canvas: index ? 'scratch' : 'main' })) }]) {
    assert.equal(parseClipboard(JSON.stringify(raw)), null); assert.throws(() => normalizeClipboard(raw));
  }
  assert.equal(parseClipboard('x'.repeat(MAX_DOCUMENT_CHARS + 1)), null);
  assert.throws(() => instantiateClipboard(snapshot, 'invalid', 15));
  assert.throws(() => instantiateClipboard(snapshot, 'main', Infinity));
});

function fixture() {
  const files = new Map(); let stored;
  const host = { failSave: false, call: async (verb, params) => {
    if (verb === 'storage.get') return { value: stored };
    if (verb === 'storage.set') { stored = params.value; return {}; }
    if (verb === 'files.read') return { dataBase64: files.get(params.path) };
    if (verb === 'files.write') {
      if (host.failSave) throw new Error('Injected paste disk failure');
      files.set(params.path, params.dataBase64);
    }
    return {};
  } };
  host.workspace = createWorkspace({ hikari: host }); return host;
}

test('queued pastes survive source deletion, support one-step undo, and guard illustration changes and failures', async () => {
  const host = fixture(), w = host.workspace; await w.ready;
  const snapshot = copyComponents(normalizeDocument({ ...createDocument(), objects: [{ id: 'label', type: 'text', text: 'Frozen label' }] }), ['label']);
  const id = w.getLibrary().active_illustration_id;
  const before = structuredClone(w.getDocument());
  const options = { illustrationId: id, canvas: 'main' };
  const first = await w.paste(snapshot, options); assert.ok(first.ok, first.error);
  const second = await w.paste(snapshot, { ...options, offset: 30 }); assert.ok(second.ok, second.error);
  assert.equal(w.getDocument().objects.length, 2);
  await w.history('undo'); assert.deepEqual(w.getDocument().objects.map(object => object.id), first.pasted_ids);
  await w.history('undo'); assert.deepEqual(w.getDocument().objects, before.objects);
  await w.history('redo'); assert.deepEqual(w.getDocument().objects.map(object => object.id), first.pasted_ids);
  const concurrent = await Promise.all([w.paste(snapshot, options), w.paste(snapshot, options)]);
  assert.ok(concurrent.every(result => result.ok)); assert.equal(w.getDocument().objects.length, 3);
  host.failSave = true; const saved = structuredClone(w.getDocument());
  assert.equal((await w.paste(snapshot, options)).ok, false); assert.deepEqual(w.getDocument(), saved);
  host.failSave = false; await w.manage('create');
  assert.equal((await w.paste(snapshot, options)).status, 'illustration_changed'); assert.equal(w.getDocument().objects.length, 0);
});

test('one paste action supports all 200 copied components and fails atomically when the scene is full', async () => {
  const host = fixture(), w = host.workspace; await w.ready;
  const doc = normalizeDocument({ ...createDocument(), objects: Array.from({ length: 200 }, (_, index) => ({ id: `label-${index}`, type: 'text', text: `${index}`, x: index })) });
  doc.groups = [{ id: 'all', canvas: 'main', name: 'All components', ids: doc.objects.map(object => object.id) }];
  const snapshot = copyComponents(doc, doc.objects.map(object => object.id));
  const options = { illustrationId: w.getLibrary().active_illustration_id, canvas: 'main' };
  const result = await w.paste(snapshot, options); assert.ok(result.ok, result.error);
  assert.equal(result.objects.length, 200); assert.equal(result.groups[0].ids.length, 200);
  const before = structuredClone(w.getDocument());
  assert.equal((await w.paste(snapshot, options)).ok, false); assert.deepEqual(w.getDocument(), before);
  await w.history('undo'); assert.equal(w.getDocument().objects.length, 0); assert.equal(w.getDocument().groups.length, 0);
});
