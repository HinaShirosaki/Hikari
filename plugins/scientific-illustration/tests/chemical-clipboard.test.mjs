import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObject } from '../model.mjs';
import { chemicalStructureSnapshot } from '../chemical-clipboard.mjs';
import { copyComponents, instantiateClipboard, installCanvasClipboard } from '../clipboard.mjs';
import { assetContent, snapshotAsset } from '../reusable-assets.mjs';

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
