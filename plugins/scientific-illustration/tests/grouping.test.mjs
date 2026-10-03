import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, normalizeDocument, applyOperations, readDocument } from '../model.mjs';
import { selectionBounds, resizeSelection, transformSelection } from '../grouping.mjs';
import { RESIZE_HANDLES } from '../geometry.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>';
const fixture = () => applyOperations(createDocument(), [
  { op: 'upsert', object: { id: 'membrane', type: 'vector', x: 100, y: 150, width: 120, height: 80, rotation: 37, svg } },
  { op: 'upsert', object: { id: 'label', type: 'text', x: 240, y: 170, width: 100, height: 40, fontSize: 20, text: 'ER' } },
  { op: 'upsert', object: { id: 'other', type: 'vector', x: 140, y: 180, width: 30, height: 30, svg } },
  { op: 'upsert', object: { id: 'scratch', type: 'vector', canvas: 'scratch', svg } }
]);
const group = document => applyOperations(document, [{ op: 'group', id: 'er', name: 'ER and label', ids: ['membrane', 'label'] }]);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('group/ungroup preserve every property and paint order, including rotated members', () => {
  const before = fixture(), grouped = group(before);
  assert.deepEqual(grouped.objects, before.objects);
  assert.deepEqual(grouped.groups, [{ id: 'er', name: 'ER and label', canvas: 'main', ids: ['membrane', 'label'] }]);
  const reloaded = normalizeDocument(JSON.parse(JSON.stringify(grouped)));
  assert.deepEqual(reloaded.groups, grouped.groups);
  assert.deepEqual(readDocument(reloaded).groups[0].bounds, selectionBounds(before.objects.slice(0, 2)));
  const ungrouped = applyOperations(reloaded, [{ op: 'ungroup', id: 'er' }]);
  assert.deepEqual(ungrouped.objects, before.objects); assert.deepEqual(ungrouped.groups, []);
});

test('legacy documents default to no groups', () => {
  const old = fixture(); delete old.groups;
  assert.deepEqual(normalizeDocument(old).groups, []);
});

test('group validation rejects mixed canvases, duplicates, unknown members and partial regrouping atomically', () => {
  const before = group(fixture()), snapshot = JSON.stringify(before);
  for (const ids of [['membrane', 'scratch'], ['other', 'other'], ['other', 'missing'], ['membrane', 'other']]) {
    assert.throws(() => applyOperations(before, [{ op: 'title', title: 'Uncommitted' }, { op: 'group', id: 'bad', ids }]));
    assert.equal(JSON.stringify(before), snapshot);
  }
  const merged = applyOperations(before, [{ op: 'group', id: 'merged', ids: ['membrane', 'label', 'other'] }]);
  assert.equal(merged.groups.length, 1); assert.equal(merged.groups[0].id, 'merged');
  for (const groups of [[{ ...before.groups[0], ids: ['membrane', 'missing'] }], [...before.groups, { id: 'two', name: 'Two', canvas: 'main', ids: ['label', 'other'] }], [{ ...before.groups[0], id: 'membrane' }]]) {
    assert.throws(() => normalizeDocument({ ...before, groups }));
  }
});

test('moving a group translates its children once and leaves unrelated objects untouched', () => {
  const before = group(fixture()), bounds = readDocument(before).groups[0].bounds;
  const after = applyOperations(before, [{ op: 'transform', id: 'er', patch: { x: bounds.x + 80, y: bounds.y - 30 } }]);
  for (const object of before.objects.slice(0, 2)) {
    const moved = after.objects.find(item => item.id === object.id);
    close(moved.x, object.x + 80); close(moved.y, object.y - 30);
    assert.equal(moved.width, object.width); assert.equal(moved.rotation, object.rotation);
  }
  assert.deepEqual(after.objects.slice(2), before.objects.slice(2));
});

test('group resizing scales geometry, typography and rotated centers uniformly', () => {
  const before = group(fixture()), bounds = readDocument(before).groups[0].bounds;
  const after = applyOperations(before, [{ op: 'update', id: 'er', patch: { name: 'Large ER', width: bounds.width * 2 } }]);
  assert.equal(after.groups[0].name, 'Large ER');
  const newBounds = readDocument(after).groups[0].bounds;
  close(newBounds.x, bounds.x); close(newBounds.y, bounds.y); close(newBounds.width, bounds.width * 2); close(newBounds.height, bounds.height * 2);
  assert.equal(after.objects[1].fontSize, 40); assert.equal(after.objects[0].rotation, 37); assert.equal(after.objects[0].svg, svg);
  const ungrouped = applyOperations(after, [{ op: 'ungroup', id: 'er' }]);
  assert.deepEqual(ungrouped.objects, after.objects);
});

for (const [direction, [hx, hy]] of Object.entries(RESIZE_HANDLES)) test(`group ${direction} handle keeps its opposite anchor and text proportions`, () => {
  const objects = fixture().objects.slice(0, 2), before = selectionBounds(objects);
  const patch = resizeSelection(objects, direction, hx * 40, hy * 30), after = selectionBounds(transformSelection(objects, patch));
  close(before.x + (1 - hx) * before.width / 2, after.x + (1 - hx) * after.width / 2);
  close(before.y + (1 - hy) * before.height / 2, after.y + (1 - hy) * after.height / 2);
  close(after.width / before.width, after.height / before.height);
});

test('group resize rejects stretching and out-of-limit fonts instead of silently changing the request', () => {
  const before = group(fixture()), bounds = readDocument(before).groups[0].bounds;
  assert.throws(() => applyOperations(before, [{ op: 'transform', id: 'er', patch: { width: bounds.width * 2, height: bounds.height } }]), /proportionally/);
  assert.throws(() => applyOperations(before, [{ op: 'transform', id: 'er', patch: { width: bounds.width * 20 } }]), /font limit/);
  const objects = before.objects.slice(0, 2), tiny = resizeSelection(objects, 'nw', 10000, 10000);
  const resized = transformSelection(objects, tiny); close(resized[1].fontSize, 4);
});

test('individual editing stays independent and moving/deleting a member prunes stale groups', () => {
  const before = group(fixture());
  const edited = applyOperations(before, [{ op: 'update', id: 'label', patch: { text: 'Rough ER', x: 280 } }]);
  assert.deepEqual(edited.objects[0], before.objects[0]); assert.equal(edited.groups.length, 1);
  for (const operation of [{ op: 'delete', id: 'label' }, { op: 'transfer', id: 'label', canvas: 'scratch' }, { op: 'update', id: 'label', patch: { canvas: 'scratch' } }]) {
    const after = applyOperations(edited, [operation]); assert.deepEqual(after.groups, []);
    assert.deepEqual(after.objects.find(object => object.id === 'membrane'), before.objects[0]);
  }
});

test('group copies and transfers preserve geometry and membership on either canvas', () => {
  const before = group(fixture());
  const copied = applyOperations(before, [{ op: 'transfer', id: 'er', canvas: 'scratch', copy: true, new_id: 'er-copy' }]);
  const copy = copied.groups.find(group => group.id === 'er-copy');
  assert.equal(copy.canvas, 'scratch'); assert.equal(copy.ids.length, 2);
  assert.ok(copy.ids.every(id => !before.objects.some(object => object.id === id)));
  for (const [index, id] of copy.ids.entries()) {
    const object = copied.objects.find(object => object.id === id), original = before.objects[index];
    assert.deepEqual({ ...object, id: original.id, canvas: original.canvas }, original);
  }
  const moved = applyOperations(before, [{ op: 'transfer', id: 'er', canvas: 'scratch' }]);
  assert.equal(moved.groups[0].canvas, 'scratch'); assert.ok(moved.objects.slice(0, 2).every(object => object.canvas === 'scratch'));
  const deleted = applyOperations(copied, [{ op: 'delete', id: 'er-copy' }]);
  assert.deepEqual(deleted.objects, before.objects); assert.deepEqual(deleted.groups, before.groups);
});

test('a maximum-size group moves and ungroups in single atomic operations', () => {
  const document = createDocument();
  document.objects = Array.from({ length: 200 }, (_, i) => ({ id: `part-${i}`, type: 'vector', canvas: 'main', x: (i % 10) * 30, y: Math.floor(i / 10) * 30, width: 20, height: 20, svg }));
  const before = normalizeDocument(document), grouped = applyOperations(before, [{ op: 'group', id: 'large', ids: before.objects.map(object => object.id) }]);
  const moved = applyOperations(grouped, [{ op: 'transform', id: 'large', patch: { x: 100, y: 120 } }]);
  assert.ok(moved.objects.every((object, i) => object.x === before.objects[i].x + 100 && object.y === before.objects[i].y + 120));
  assert.throws(() => applyOperations(grouped, [{ op: 'transfer', id: 'large', canvas: 'scratch', copy: true, new_id: 'too-many' }]), /maximum 200/);
  assert.deepEqual(applyOperations(moved, [{ op: 'ungroup', id: 'large' }]).objects, moved.objects);
  assert.deepEqual(applyOperations(moved, [{ op: 'delete', id: 'large' }]).objects, []);
});
