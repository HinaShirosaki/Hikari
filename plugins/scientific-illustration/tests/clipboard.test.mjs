import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  chemicalStructureSnapshot, copyComponents, installCanvasClipboard, instantiateClipboard, normalizeClipboard, parseClipboard
} from '../clipboard.mjs';
import {
  MAX_DOCUMENT_CHARS, MAX_OBJECTS, applyOperations, createDocument, normalizeDocument, normalizeObject
} from '../model.mjs';
import { assetContent, snapshotAsset } from '../reusable-assets.mjs';
import { createWorkspace } from '../workspace.mjs';

describe('Component clipboard', () => {
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
    const instance = instantiateClipboard(snapshot, 'main', 30), pasted = applyOperations(original, instance.operations);
    const copies = pasted.objects.filter(object => instance.ids.includes(object.id));
    assert.equal(new Set(pasted.objects.map(object => object.id)).size, 8);
    copies.forEach((copy, index) => {
      const source = original.objects[index], { id, canvas, x, y, ...content } = copy;
      assert.notEqual(id, source.id); assert.equal(canvas, 'main'); assert.equal(x, source.x + 30); assert.equal(y, source.y + 30);
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
      { ...snapshot, objects: snapshot.objects.map((object, index) => ({ ...object, canvas: index ? 'unknown' : 'main' })) }]) {
      assert.equal(parseClipboard(JSON.stringify(raw)), null); assert.throws(() => normalizeClipboard(raw));
    }
    assert.equal(parseClipboard('x'.repeat(MAX_DOCUMENT_CHARS + 1)), null);
    assert.throws(() => instantiateClipboard(snapshot, 'invalid', 15));
    assert.throws(() => instantiateClipboard(snapshot, 'main', Infinity));
  });

  function fixture() {
    const files = new Map();
    let stored;
    const host = {
      failSave: false,
      async call(verb, params) {
        if (verb === 'storage.get') return { value: stored };
        if (verb === 'storage.set') {
          stored = params.value;
          return {};
        }
        if (verb === 'files.read') {
          if (!files.has(params.path)) throw new Error('Plugin file not found.');
          return { dataBase64: files.get(params.path) };
        }
        if (verb === 'files.write') {
          if (host.failSave) throw new Error('Injected paste disk failure');
          files.set(params.path, params.dataBase64);
        }
        return {};
      }
    };
    host.workspace = createWorkspace({ hikari: host });
    return host;
  }

  test('queued pastes survive source deletion, support one-step undo, and guard illustration changes and failures', async () => {
    const host = fixture(), w = host.workspace;
    await w.ready;
    const snapshot = copyComponents(normalizeDocument({ ...createDocument(), objects: [{ id: 'label', type: 'text', text: 'Frozen label' }] }), ['label']);
    const id = w.getLibrary().active_illustration_id;
    const before = structuredClone(w.getDocument());
    const options = { illustrationId: id, canvas: 'main' };
    const first = await w.paste(snapshot, options);
    assert.ok(first.ok, first.error);
    const second = await w.paste(snapshot, { ...options, offset: 30 });
    assert.ok(second.ok, second.error);
    assert.equal(w.getDocument().objects.length, 2);
    await w.history('undo'); assert.deepEqual(w.getDocument().objects.map(object => object.id), first.pasted_ids);
    await w.history('undo');
    assert.deepEqual(w.getDocument().objects, before.objects);
    await w.history('redo'); assert.deepEqual(w.getDocument().objects.map(object => object.id), first.pasted_ids);
    const concurrent = await Promise.all([w.paste(snapshot, options), w.paste(snapshot, options)]);
    assert.ok(concurrent.every(result => result.ok)); assert.equal(w.getDocument().objects.length, 3);
    host.failSave = true; const saved = structuredClone(w.getDocument());
    assert.equal((await w.paste(snapshot, options)).ok, false); assert.deepEqual(w.getDocument(), saved);
    host.failSave = false; await w.manage('create');
    assert.equal((await w.paste(snapshot, options)).status, 'illustration_changed'); assert.equal(w.getDocument().objects.length, 0);
  });

  test('one paste action supports every copied component at capacity and fails atomically when the scene is full', async () => {
    const host = fixture(), w = host.workspace;
    await w.ready;
    const doc = normalizeDocument({ ...createDocument(), objects: Array.from({ length: MAX_OBJECTS }, (_, index) => ({ id: `label-${index}`, type: 'text', text: `${index}`, x: index })) });
    doc.groups = [{ id: 'all', canvas: 'main', name: 'All components', ids: doc.objects.map(object => object.id) }];
    const snapshot = copyComponents(doc, doc.objects.map(object => object.id));
    const options = { illustrationId: w.getLibrary().active_illustration_id, canvas: 'main' };
    const result = await w.paste(snapshot, options); assert.ok(result.ok, result.error);
    assert.equal(result.objects.length, MAX_OBJECTS); assert.equal(result.groups[0].ids.length, MAX_OBJECTS);
    const before = structuredClone(w.getDocument());
    assert.equal((await w.paste(snapshot, options)).ok, false); assert.deepEqual(w.getDocument(), before);
    await w.history('undo'); assert.equal(w.getDocument().objects.length, 0); assert.equal(w.getDocument().groups.length, 0);
  });
});

describe('Chemical clipboard', () => {
  const image = { dataUrl: 'data:image/png;base64,AAAA', width: 800, height: 400 };
  test('pasted structures preserve atomic labels without weakening normal image validation', () => {
    const snapshot = chemicalStructureSnapshot(image, { width: 1200, height: 800 });
    const object = normalizeObject(snapshot.objects[0]);
    assert.equal(object.textFree, false); assert.equal(object.chemicalStructure, true);
    assert.equal(object.width / object.height, 2);
    assert.ok(object.width <= 360 && object.x > 0 && object.y > 0);
    const scene = { objects: [object], groups: [] };
    const copy = instantiateClipboard(copyComponents(scene, [object.id]), 'main');
    assert.equal(copy.operations[0].object.chemicalStructure, true);
    assert.equal(copy.operations[0].object.textFree, false);
    const asset = snapshotAsset(scene, { id: object.id, name: 'Compound' });
    assert.equal(asset.objects[0].chemicalStructure, true);
    const normal = { ...object, textFree: true }; delete normal.chemicalStructure;
    assert.notDeepEqual(assetContent(asset), assetContent({ objects: [normal] }));
    assert.throws(() => normalizeObject({ ...object, chemicalStructure: false }), /chemicalStructure/);
    const missing = { ...object }; delete missing.chemicalStructure;
    assert.throws(() => normalizeObject(missing), /text-free/);
    assert.throws(() => normalizeObject({ id: 'text', type: 'text', chemicalStructure: true }), /chemicalStructure/);
  });

  test('vector structures retain their SVG and chemical identity through copy and asset storage', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 90"><path d="M10 40L50 20"/><text x="55" y="25">OH</text></svg>';
    const snapshot = chemicalStructureSnapshot({ svg: source, width: 220, height: 90 }, { width: 1200, height: 800 });
    let validatedOptions;
    const object = normalizeObject(snapshot.objects[0], (svg, options) => { validatedOptions = options; return svg; });
    assert.equal(object.type, 'vector'); assert.equal(object.svg, source);
    assert.equal(object.chemicalStructure, true); assert.deepEqual(validatedOptions, { chemical: true });
    assert.ok(!Object.hasOwn(object, 'dataUrl') && !Object.hasOwn(object, 'textFree'));
    const scene = { objects: [object], groups: [] };
    const copy = instantiateClipboard(copyComponents(scene, [object.id]), 'main');
    assert.equal(copy.operations[0].object.svg, source);
    assert.equal(copy.operations[0].object.chemicalStructure, true);
    assert.equal(snapshotAsset(scene, { id: object.id, name: 'Structure' }).objects[0].svg, source);
  });

  test('native paste replaces stale copied components and does not cross an illustration switch', async () => {
    const listeners = {}, inserted = [], external = [];
    let context = 'figure-a', nextRead, finishRead;
    const source = { objects: [normalizeObject({ id: 'a', type: 'text', text: 'Copied' })], groups: [] };
    const document = { activeElement: {}, addEventListener: (name, fn) => { listeners[name] = fn; }, execCommand: () => false };
    const controls = installCanvasClipboard({ document, canHandle: () => true, getSelection: () => ({ scene: source, ids: ['a'] }),
      getPasteContext: () => context, paste: async value => inserted.push(value), pasteExternal: async value => external.push(value),
      readExternal: () => nextRead, status: () => {} });
    controls.copy();
    nextRead = Promise.resolve({ text: '', images: [image.dataUrl] });
    controls.paste(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(inserted.length, 0); assert.equal(external.length, 1);
    controls.copy(); nextRead = new Promise(resolve => { finishRead = resolve; });
    controls.paste(); context = 'figure-b'; finishRead({ text: '', images: [image.dataUrl] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(inserted.length, 0); assert.equal(external.length, 1);
    assert.ok(listeners.paste);
  });

  test('a sandbox-refused paste command leaves the native shortcut active and cancels its fallback when paste arrives', async () => {
    const listeners = {}, external = [], fallbackReads = [];
    let finish;
    const document = { activeElement: {}, addEventListener: (name, fn) => { listeners[name] = fn; }, execCommand: () => false };
    const controls = installCanvasClipboard({ document, canHandle: () => true, getSelection: () => ({ scene: {}, ids: [] }),
      paste: async () => assert.fail('No private component snapshot should be inserted'),
      readExternal: data => {
        if (data) return Promise.resolve({ text: '', images: [image.dataUrl] });
        fallbackReads.push(true); return new Promise(resolve => { finish = resolve; });
      }, pasteExternal: async clipboard => external.push(clipboard), status: () => {} });
    let prevented = false;
    controls.handleKey({ key: 'v', metaKey: true, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false, 'The real OS paste shortcut must not be swallowed');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fallbackReads.length, 1);
    listeners.paste({ clipboardData: { getData: () => '' }, preventDefault() {} });
    finish({ text: '', images: [image.dataUrl] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(external.length, 1, 'Only the real native paste inserts, even if a fallback read was already pending');
  });
});
