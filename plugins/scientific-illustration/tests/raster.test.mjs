import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaBounds, fitRasterBox, cropRasterPatch } from '../raster.mjs';
import { assetContent, compoundGroups, normalizeAssetLibrary, validateAssetRequest } from '../reusable-assets.mjs';
import { createDocument, normalizeDocument, normalizeObject } from '../model.mjs';
import { agentInstructions } from '../agent/workflow.mjs';

test('transparent margins are removed without clipping faint edge pixels', () => {
  const pixels = new Uint8ClampedArray(8 * 6 * 4);
  for (let y = 2; y <= 4; y++) for (let x = 3; x <= 5; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
  pixels[(1 * 8 + 2) * 4 + 3] = 1;
  assert.deepEqual(alphaBounds(pixels, 8, 6), { x: 2, y: 1, width: 4, height: 4 });
});
test('opaque images retain their full bounds; empty images have no drawable bounds', () => {
  assert.deepEqual(alphaBounds(new Uint8ClampedArray(4 * 3 * 4).fill(255), 4, 3), { x: 0, y: 0, width: 4, height: 3 });
  assert.equal(alphaBounds(new Uint8ClampedArray(16), 2, 2), null);
  assert.throws(() => alphaBounds(new Uint8ClampedArray(4), 2, 2), /Invalid raster/);
});
test('cropped raster placement preserves aspect ratio even at object size limits', () => {
  assert.deepEqual(fitRasterBox(34, 21, 102), { width: 102, height: 63 });
  assert.deepEqual(fitRasterBox(34, 21, 1), { width: 34 / 21, height: 1 });
  assert.deepEqual(fitRasterBox(10000, 5000), { width: 8000, height: 4000 });
  assert.throws(() => fitRasterBox(9000, 1), /aspect ratio/);
});
test('cropping preserves the world positions of every retained corner on stretched and rotated layers', () => {
  const point = (object, x, y) => {
    const angle = object.rotation * Math.PI / 180, dx = x - object.width / 2, dy = y - object.height / 2;
    return [object.x + object.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
      object.y + object.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)];
  };
  for (const rotation of [0, 30, 90, -60, 180]) {
    const object = { x: 70, y: 90, width: 300, height: 150, rotation };
    for (const crop of [{ x: 80, y: 20, width: 160, height: 100 }, { x: 0, y: 0, width: 400, height: 200 }, { x: 300, y: 150, width: 100, height: 50 }]) {
      const next = { ...object, ...cropRasterPatch(object, { width: 400, height: 200 }, crop) };
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const expected = point(object, (crop.x + x * crop.width) / 400 * object.width, (crop.y + y * crop.height) / 200 * object.height);
        const actual = point(next, x * next.width, y * next.height);
        assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 1e-8));
      }
    }
  }
});
test('empty, outside, non-finite, and visually tiny crops fail before updating a layer', () => {
  const object = { x: 0, y: 0, width: 20, height: 10, rotation: 0 }, image = { width: 400, height: 200 };
  for (const crop of [{ x: -1, y: 0, width: 100, height: 100 }, { x: 350, y: 0, width: 100, height: 100 },
    { x: 0, y: 0, width: 0, height: 100 }, { x: NaN, y: 0, width: 100, height: 100 }]) assert.throws(() => cropRasterPatch(object, image, crop), /inside the image/);
  assert.throws(() => cropRasterPatch(object, image, { x: 0, y: 0, width: 1, height: 1 }), /too small/);
});
test('direct image saves require exactly one selector and explicit text-free confirmation', () => {
  const args = { action: 'asset_save', illustration_id: 'figure', expected_revision: 'scene', expected_assets_revision: 'library', request_id: 'one', name: 'Organelle', raster_asset: 'image', textFree: true };
  validateAssetRequest(args);
  assert.throws(() => validateAssetRequest({ ...args, textFree: false }), /textFree/);
  assert.throws(() => validateAssetRequest({ ...args, id: 'placed' }), /Save takes/);
});
test('raster content identity ignores placement scale but retains rotation and intentional distortion', () => {
  const object = normalizeObject({ id: 'one', type: 'raster', dataUrl: 'data:image/png;base64,AAAA', textFree: true, width: 200, height: 100 });
  const content = value => assetContent({ objects: [value] });
  assert.deepEqual(content(object), content({ ...object, id: 'copy', x: 200, width: 400, height: 200 }));
  assert.notDeepEqual(content(object), content({ ...object, rotation: 45 }));
  assert.notDeepEqual(content(object), content({ ...object, height: 150 }));
});
test('compound groups contain multiple artwork layers and keep text separate', () => {
  const doc = createDocument();
  doc.objects = [{ id: 'a', type: 'vector' }, { id: 'b', type: 'raster' }, { id: 'label', type: 'text' }];
  doc.groups = [{ id: 'assembly', ids: ['a', 'b', 'label'] }, { id: 'labeled-part', ids: ['a', 'label'] }];
  assert.deepEqual(compoundGroups(doc).map(group => group.id), ['assembly']);
});
test('pending group saves persist in the scene and are pruned when groups disappear', () => {
  const doc = createDocument();
  doc.objects = ['a', 'b'].map(id => ({ id, type: 'text', text: id }));
  doc.groups = [{ id: 'assembly', canvas: 'main', ids: ['a', 'b'] }];
  doc.pendingAssetGroups = ['assembly'];
  assert.deepEqual(normalizeDocument(doc).pendingAssetGroups, ['assembly']);
  assert.deepEqual(normalizeDocument({ ...doc, groups: [] }).pendingAssetGroups, []);
  assert.throws(() => normalizeDocument({ ...doc, pendingAssetGroups: ['assembly', 'assembly'] }), /pending asset groups/);
});
test('legacy asset indexes remain readable and automatic saves are not limited to 100 entries', () => {
  const entry = { name: 'Component', width: 20, height: 30, objectCount: 1 };
  assert.equal(normalizeAssetLibrary({ version: 1, revision: 'one', assets: Array.from({ length: 101 }, (_, id) => ({ ...entry, id: `asset-${id}` })) }).assets.length, 101);
  assert.throws(() => normalizeAssetLibrary({ version: 1, revision: 'one', assets: [{ ...entry, id: 'asset', fingerprint: 'bad' }] }), /fingerprint/);
});
test('all detail levels require checking reusable assets before generation or edits and saving every output', () => {
  for (const level of ['simple', 'standard', 'detailed']) {
    const instructions = agentInstructions(level);
    assert.match(instructions, /before generating or modifying an illustration, call asset_list/);
    assert.match(instructions, /Save EVERY text-free image_gen output, including unused candidates/);
    assert.match(instructions, /Final inspect automatically saves groups/);
  }
});
