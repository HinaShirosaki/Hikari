import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentOperations, selectionLayoutUnits } from '../alignment.mjs';
import { createDocument, applyOperations, validateRequest } from '../model.mjs';
import { selectionBounds } from '../grouping.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const fixture = (canvas = 'main') => applyOperations(createDocument(), [
  { op: 'upsert', object: { id: 'a', canvas, type: 'vector', x: 40, y: 80, width: 120, height: 60, rotation: 30, svg } },
  { op: 'upsert', object: { id: 'b', canvas, type: 'text', x: 230, y: 190, width: 200, height: 80, text: 'Cell', fontSize: 24, rotation: -15 } },
  { op: 'upsert', object: { id: 'c', canvas, type: 'vector', x: 520, y: 360, width: 80, height: 40, svg } },
  { op: 'upsert', object: { id: 'other', type: 'vector', x: 700, y: 400, svg } }
]);
// Simulate measured glyph bounds without importing browser-only SVG measuring.
const measured = object => object.type === 'text' ? { ...object, x: object.x + 32, y: object.y + 20, width: 48, height: 28 } : object;
const ids = ['a', 'b', 'c'];

for (const [action, axis, size, factor] of [
  ['left', 'x', 'width', 0], ['right', 'x', 'width', 1], ['horizontal-center', 'x', 'width', .5],
  ['top', 'y', 'height', 0], ['bottom', 'y', 'height', 1], ['vertical-center', 'y', 'height', .5]
]) test(`${action} aligns rotated visual bounds without resizing or changing artwork`, () => {
  const before = fixture(), union = selectionBounds(before.objects.slice(0, 3).map(measured));
  const operations = alignmentOperations(before, ids, action, measured), after = applyOperations(before, operations);
  for (let i = 0; i < 3; i++) {
    const bounds = selectionBounds([measured(after.objects[i])]);
    close(bounds[axis] + bounds[size] * factor, union[axis] + union[size] * factor);
    const unchanged = { ...after.objects[i], x: before.objects[i].x, y: before.objects[i].y };
    assert.deepEqual(unchanged, before.objects[i]);
  }
  assert.deepEqual(after.objects[3], before.objects[3]);
  assert.notEqual(after.revision, before.revision);
});

for (const [action, axis, size] of [['distribute-horizontal', 'x', 'width'], ['distribute-vertical', 'y', 'height']]) {
  test(`${action} gives differently sized rotated items equal gaps with endpoints fixed`, () => {
    const before = fixture(), after = applyOperations(before, alignmentOperations(before, ['c', 'a', 'b'], action, measured));
    const bounds = after.objects.slice(0, 3).map(object => selectionBounds([measured(object)]));
    close(bounds[1][axis] - bounds[0][axis] - bounds[0][size], bounds[2][axis] - bounds[1][axis] - bounds[1][size]);
    assert.deepEqual(after.objects[0], before.objects[0]);
    assert.deepEqual(after.objects[2], before.objects[2]);
    assert.deepEqual(after.objects[3], before.objects[3]);
  });
}

test('complete groups translate rigidly and count once, while a selected child stays independent', () => {
  const before = applyOperations(fixture(), [{ op: 'group', id: 'cell', ids: ['a', 'b'], name: 'Cell and label' }]);
  assert.equal(selectionLayoutUnits(before, ids, measured).length, 2);
  assert.deepEqual(alignmentOperations(before, ids, 'distribute-horizontal', measured), []);
  const after = applyOperations(before, alignmentOperations(before, ids, 'right', measured));
  close(after.objects[0].x - before.objects[0].x, after.objects[1].x - before.objects[1].x);
  assert.deepEqual(after.groups, before.groups);
  const partial = applyOperations(before, alignmentOperations(before, ['b', 'c'], 'top', measured));
  assert.deepEqual(partial.objects[0], before.objects[0]);
  assert.deepEqual(partial.groups, before.groups);
});

test('overlapping items can be distributed with equal negative gaps without resizing', () => {
  const before = { objects: [0, 30, 60].map((x, i) => ({ id: String(i), canvas: 'main', x, y: 0, width: [80, 40, 80][i], height: 40, rotation: 0 })), groups: [] };
  const operations = alignmentOperations(before, ['0', '1', '2'], 'distribute-horizontal');
  assert.deepEqual(operations, [{ op: 'update', id: '1', patch: { x: 50 } }]);
});

test('insufficient selections and already aligned items are no-ops; mixed canvases are rejected', () => {
  const before = fixture();
  for (const selected of [[], ['a'], ['missing']]) assert.deepEqual(alignmentOperations(before, selected, 'left'), []);
  const aligned = applyOperations(before, alignmentOperations(before, ids, 'left', measured));
  assert.deepEqual(alignmentOperations(aligned, ids, 'left', measured), []);
  const mixed = { ...before, objects: before.objects.map(o => o.id === 'c' ? { ...o, canvas: 'unknown' } : o) };
  assert.throws(() => alignmentOperations(mixed, ids, 'left'), /one canvas/);
  assert.throws(() => alignmentOperations(before, ids, 'unknown'), /Unknown alignment/);
});

test('a maximum-size figure aligns in one accepted batch, including every child of a large group', () => {
  const before = applyOperations(createDocument(), Array.from({ length: 200 }, (_, index) => ({ op: 'upsert', object: {
    id: `item-${index}`, type: 'vector', x: index * 10, y: 20, width: 20, height: 20, svg
  } })));
  const selected = before.objects.map(object => object.id);
  const operations = alignmentOperations(before, selected, 'right');
  assert.equal(operations.length, 199);
  assert.doesNotThrow(() => validateRequest({ action: 'apply', expected_revision: before.revision, request_id: 'align', operations }));
  const after = applyOperations(before, operations);
  assert.ok(after.objects.every(object => object.x === 1990));
  const grouped = applyOperations(before, [{ op: 'group', id: 'large', ids: selected.slice(0, 199) }]);
  const groupedOperations = alignmentOperations(grouped, selected, 'right');
  assert.equal(groupedOperations.length, 199);
  const moved = applyOperations(grouped, groupedOperations);
  assert.ok(moved.objects.slice(0, 199).every((object, index) => object.x === before.objects[index].x + 10));
  assert.deepEqual(moved.groups, grouped.groups);
  assert.throws(() => validateRequest({ action: 'apply', expected_revision: before.revision, request_id: 'too-large', operations: Array(201).fill(operations[0]) }), /1–200/);
});
