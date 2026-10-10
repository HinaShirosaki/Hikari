import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDelta, rotateComponents } from '../rotation.mjs';
import { objectCorners } from '../grouping.mjs';
import { createDocument, applyOperations } from '../model.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
const objects = [
  { id: 'art', type: 'vector', canvas: 'main', x: 100, y: 120, width: 120, height: 80, rotation: 37, svg },
  { id: 'text', type: 'text', canvas: 'main', x: 260, y: 170, width: 200, height: 50, rotation: -23, fontSize: 24, text: 'Cell', italic: true }
];
test('angular differences cross the signed-angle seam smoothly and normalize multiple turns', () => {
  assert.equal(angleDelta(179, -179), 2); assert.equal(angleDelta(-179, 179), -2);
  assert.equal(angleDelta(0, 450), 90); assert.equal(angleDelta(0, -450), -90);
  assert.equal(angleDelta(0, 720), 0);
});
test('rotation applies a rigid transform to every corner and preserves component size, text and source state', () => {
  const before = structuredClone(objects), pivot = { x: 250, y: 200 };
  for (const degrees of [-190, -90, -15, 15, 179, 270, 450]) {
    const rotated = rotateComponents(objects, degrees, pivot), radians = degrees * Math.PI / 180;
    rotated.forEach((object, i) => {
      assert.equal(object.width, objects[i].width); assert.equal(object.height, objects[i].height);
      assert.equal(object.fontSize, objects[i].fontSize); assert.equal(object.text, objects[i].text);
      objectCorners(object).forEach((point, index) => {
        const original = objectCorners(objects[i])[index], dx = original.x - pivot.x, dy = original.y - pivot.y;
        close(point.x, pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians));
        close(point.y, pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians));
      });
    });
  }
  assert.deepEqual(objects, before); assert.deepEqual(rotateComponents(objects, 360, pivot), objects);
});
test('a visible text pivot compensates for blank layout space without changing typography', () => {
  const object = objects[1], pivot = { x: object.x + 45, y: object.y + 18 };
  const rotated = rotateComponents([object], 90, pivot)[0];
  const cx = object.x + object.width / 2, cy = object.y + object.height / 2;
  close(rotated.x + rotated.width / 2, pivot.x - (cy - pivot.y));
  close(rotated.y + rotated.height / 2, pivot.y + (cx - pivot.x));
  assert.equal(rotated.fontSize, object.fontSize); assert.equal(rotated.italic, true);
});
test('one model operation rotates all 200 components, preserving group membership and paint order', () => {
  let document = createDocument();
  document = applyOperations(document, Array.from({ length: 200 }, (_, i) => ({ op: 'upsert', object: { id: `art-${i}`, type: 'vector', x: i * 30, y: 200, width: 20, height: 10, svg } })));
  document = applyOperations(document, [{ op: 'group', id: 'all', ids: document.objects.map(object => object.id) }]);
  const before = structuredClone(document), after = applyOperations(document, [{ op: 'rotate', id: 'all', degrees: 45 }]);
  assert.deepEqual(after.groups, before.groups); assert.deepEqual(after.objects.map(o => o.id), before.objects.map(o => o.id));
  assert.ok(after.objects.every(object => object.rotation === 45)); assert.deepEqual(document, before);
});
test('rotation rejects invalid selectors, mixed canvases, bad pivots and out-of-range results atomically', () => {
  const before = applyOperations(createDocument(), objects.map(object => ({ op: 'upsert', object })));
  const snapshot = structuredClone(before);
  for (const operation of [
    { op: 'rotate', id: 'art', ids: ['text'], degrees: 30 },
    { op: 'rotate', ids: ['art', 'art'], degrees: 30 },
    { op: 'rotate', id: 'missing', degrees: 30 },
    { op: 'rotate', id: 'art', degrees: Infinity },
    { op: 'rotate', id: 'art', degrees: 361 },
    { op: 'rotate', id: 'art', degrees: 20, pivot: { x: 0, y: '0' } },
    { op: 'rotate', id: 'art', degrees: 20, pivot: { x: 0, y: 0, other: true } },
    { op: 'rotate', id: 'art', degrees: 180, pivot: { x: 100000, y: 0 } }
  ]) { assert.throws(() => applyOperations(before, [{ op: 'title', title: 'Uncommitted' }, operation])); assert.deepEqual(before, snapshot); }
  assert.throws(() => rotateComponents([objects[0], { ...objects[1], canvas: 'scratch' }], 30), /one canvas/);
});
