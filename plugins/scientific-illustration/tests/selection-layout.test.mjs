import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { alignmentOperations, selectionBounds, selectionLayoutUnits, smartGuideTargets, snapTranslation } from '../geometry.mjs';
import { movingLayerIds, reorderedLayers } from '../layers-panel.mjs';
import { MAX_OBJECTS, applyOperations, createDocument, validateRequest } from '../model.mjs';

describe('Alignment', () => {
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

  test('insufficient selections and already aligned items are no-ops', () => {
    const before = fixture();
    for (const selected of [[], ['a'], ['missing']]) assert.deepEqual(alignmentOperations(before, selected, 'left'), []);
    const aligned = applyOperations(before, alignmentOperations(before, ids, 'left', measured));
    assert.deepEqual(alignmentOperations(aligned, ids, 'left', measured), []);
    assert.throws(() => alignmentOperations(before, ids, 'unknown'), /Unknown alignment/);
  });

  test('a maximum-size figure aligns in one accepted batch, including every child of a large group', () => {
    const before = applyOperations(createDocument(), Array.from({ length: MAX_OBJECTS }, (_, index) => ({ op: 'upsert', object: {
      id: `item-${index}`, type: 'vector', x: index * 10, y: 20, width: 20, height: 20, svg
    } })));
    const selected = before.objects.map(object => object.id);
    const operations = alignmentOperations(before, selected, 'right');
    assert.equal(operations.length, MAX_OBJECTS - 1);
    assert.doesNotThrow(() => validateRequest({ action: 'apply', expected_revision: before.revision, request_id: 'align', operations }));
    const after = applyOperations(before, operations);
    assert.ok(after.objects.every(object => object.x === (MAX_OBJECTS - 1) * 10));
    const grouped = applyOperations(before, [{ op: 'group', id: 'large', ids: selected.slice(0, MAX_OBJECTS - 1) }]);
    const groupedOperations = alignmentOperations(grouped, selected, 'right');
    assert.equal(groupedOperations.length, MAX_OBJECTS - 1);
    const moved = applyOperations(grouped, groupedOperations);
    assert.ok(moved.objects.slice(0, MAX_OBJECTS - 1).every((object, index) => object.x === before.objects[index].x + 10));
    assert.deepEqual(moved.groups, grouped.groups);
    assert.throws(() => validateRequest({ action: 'apply', expected_revision: before.revision, request_id: 'too-large', operations: Array(MAX_OBJECTS + 1).fill(operations[0]) }), new RegExp(`1–${MAX_OBJECTS}`));
  });
});

describe('Smart guides', () => {
  const canvas = { width: 1200, height: 800 };
  const box = (x, y, width = 80, height = 60) => ({ x, y, width, height, rotation: 0 });
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

  for (const [axis, size, cross, crossSize] of [['x', 'width', 'y', 'height'], ['y', 'height', 'x', 'width']]) {
    for (const factor of [0, .5, 1]) test(`${axis} snaps matching ${factor} edges/centers and draws a guide`, () => {
      const moving = box(400, 400), target = box(143, 171, 127, 97);
      target[cross] = moving[cross] + moving[crossSize] + 30;
      const delta = target[axis] + target[size] * factor - moving[axis] - moving[size] * factor;
      const result = snapTranslation(moving, [target], canvas, axis === 'x' ? delta + 3 : 0, axis === 'y' ? delta + 3 : 0);
      close(result[axis === 'x' ? 'dx' : 'dy'], delta);
      assert.ok(result.guides.some(guide => guide.kind === 'alignment' && guide.axis === axis));
    });
    for (const factor of [0, .5, 1]) test(`${axis} snaps to the canvas ${factor} anchor without other components`, () => {
      const moving = box(327, 267), delta = (canvas[size] - moving[size]) * factor - moving[axis];
      const result = snapTranslation(moving, [], canvas, axis === 'x' ? delta - 2 : 0, axis === 'y' ? delta - 2 : 0);
      close(result[axis === 'x' ? 'dx' : 'dy'], delta);
    });
    for (const placement of ['before', 'between', 'after']) test(`${axis} equal spacing ${placement} differently sized neighbors`, () => {
      const a = box(157, 157, 61, 61), b = box(338, 338, 83, 83), moving = box(710, 710, 43, 43);
      a[cross] = b[cross] = moving[cross] = 257;
      const gap = b[axis] - a[axis] - a[size];
      const position = placement === 'before' ? a[axis] - gap - moving[size]
        : placement === 'after' ? b[axis] + b[size] + gap : (a[axis] + a[size] + b[axis] - moving[size]) / 2;
      const delta = position - moving[axis];
      const result = snapTranslation(moving, [a, b], canvas, axis === 'x' ? delta + 2 : 0, axis === 'y' ? delta + 2 : 0);
      close(result[axis === 'x' ? 'dx' : 'dy'], delta);
      const guide = result.guides.find(guide => guide.kind === 'spacing' && guide.axis === axis);
      assert.ok(guide);
      close(guide.segments[0].to - guide.segments[0].from, guide.segments[1].to - guide.segments[1].from);
    });
  }

  test('six-screen-pixel threshold stays constant across zoom levels, and releasing removes guides', () => {
    const moving = box(357, 267, 180, 180), target = box(157, 267, 180, 180);
    for (const scale of [.1, .5, 1, 2, 8]) {
      const within = snapTranslation(moving, [target], canvas, -200 + 5 / scale, 0, { scale });
      close(within.dx, -200);
      const outside = snapTranslation(moving, [], { width: 100000, height: 100000 }, 8 / scale, 0, { scale });
      close(outside.dx, 8 / scale);
      assert.deepEqual(outside.guides, []);
    }
  });

  test('Alt/Option or the disabled setting bypasses snapping and all guides', () => {
    assert.deepEqual(snapTranslation(box(557, 367), [], canvas, 0, 0, { disabled: true }), { dx: 0, dy: 0, guides: [] });
  });

  test('axis-constrained movement never snaps its fixed coordinate', () => {
    const horizontal = snapTranslation(box(180, 180, 100, 60), [box(400, 184, 100, 60)], canvas, 119, 0, { axis: 'x' });
    close(horizontal.dx, 120); close(horizontal.dy, 0);
    assert.ok(horizontal.guides.length && horizontal.guides.every(guide => guide.axis === 'x'));
    const vertical = snapTranslation(box(180, 180, 60, 100), [box(184, 400, 60, 100)], canvas, 0, 119, { axis: 'y' });
    close(vertical.dx, 0); close(vertical.dy, 120);
    assert.ok(vertical.guides.length && vertical.guides.every(guide => guide.axis === 'y'));
  });

  test('far perpendicular references do not attract, and separate rows do not suggest equal gaps', () => {
    const moving = box(357, 600);
    const result = snapTranslation(moving, [box(157, 0)], canvas, -198, 0);
    close(result.dx, -198);
    assert.equal(result.guides.length, 0);
    const otherRows = snapTranslation(box(457, 267), [box(157, 100), box(337, 500)], canvas, 2, 0);
    assert.ok(otherRows.guides.every(guide => guide.kind !== 'spacing'));
  });

  test('references exclude selected/hidden items and other canvases, and combine complete groups', () => {
    const objects = ['moving', 'a', 'b', 'hidden', 'transparent', 'other'].map((id, index) => ({
      ...box(157 + index * 100, 257), id, canvas: id === 'other' ? 'scratch' : 'main',
      visible: id !== 'hidden', opacity: id === 'transparent' ? 0 : 1
    }));
    const state = { objects, groups: [{ id: 'pair', ids: ['a', 'b'] }] };
    assert.deepEqual(smartGuideTargets(state, ['moving']), [selectionBounds(objects.slice(1, 3))]);
    assert.equal(smartGuideTargets(state, ['a']).length, 2);
  });

  test('rotated objects and measured text attract by their rendered axis-aligned bounds', () => {
    const text = { ...box(100, 100, 500, 200), type: 'text', canvas: 'main', id: 'text', rotation: 30 };
    const moving = { ...box(300, 300), canvas: 'main', id: 'moving' };
    const measured = object => object.type === 'text' ? { ...object, x: 200, y: 200, width: 60, height: 30 } : object;
    const targets = smartGuideTargets({ objects: [moving, text], groups: [] }, ['moving'], measured);
    const expected = selectionBounds([measured(text)]);
    assert.deepEqual(targets, [expected]);
    const delta = expected.x - moving.x;
    close(snapTranslation(moving, targets, canvas, delta + 2, -15).dx, delta);
  });

  test('extending a row never suggests equal spacing through another neighbor', () => {
    const targets = [box(100, 257, 40), box(180, 257, 40), box(245, 257, 100)];
    const result = snapTranslation(box(400, 257, 40), targets, canvas, -138, 0);
    assert.ok(result.guides.every(guide => guide.kind !== 'spacing'));
  });

  test('maximum-size scenes keep bounded reference and guide counts', () => {
    const targets = Array.from({ length: 499 }, (_, index) => box(40 + index % 20 * 50, 40 + Math.floor(index / 20) * 28, 20, 20));
    const result = snapTranslation(box(457, 267, 20, 20), targets, canvas, 1, 2);
    assert.ok(Number.isFinite(result.dx) && Number.isFinite(result.dy));
    assert.ok(result.guides.length <= 8);
  });
});

describe('Layer order', () => {
  const scene = { objects: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id })), groups: [] };
  test('dragging to either side of a row converts list order to paint order', () => {
    assert.deepEqual(reorderedLayers(scene, ['a'], 'e'), ['b', 'c', 'd', 'e', 'a']);
    assert.deepEqual(reorderedLayers(scene, ['e'], 'b', true), ['a', 'e', 'b', 'c', 'd']);
    assert.deepEqual(reorderedLayers(scene, ['a'], 'c', true), ['b', 'a', 'c', 'd', 'e']);
  });
  test('multiple selected layers retain their relative paint order', () => {
    const moving = movingLayerIds(scene, 'b', ['d', 'b']);
    assert.deepEqual(moving, ['b', 'd']);
    assert.deepEqual(reorderedLayers(scene, moving, 'e'), ['a', 'c', 'e', 'b', 'd']);
    assert.deepEqual(movingLayerIds(scene, 'a', ['b', 'd']), ['a']);
  });
  test('group headers and members move whole groups and target the whole destination group', () => {
    const grouped = { ...scene, groups: [{ id: 'group', ids: ['d', 'b'] }] };
    const original = JSON.stringify(grouped);
    assert.deepEqual(movingLayerIds(grouped, 'group', []), ['b', 'd']);
    assert.deepEqual(movingLayerIds(grouped, 'b', ['b']), ['b', 'd']);
    assert.deepEqual(reorderedLayers(grouped, ['a'], 'group'), ['b', 'c', 'd', 'a', 'e']);
    assert.deepEqual(reorderedLayers(grouped, ['e'], 'b', true), ['a', 'e', 'b', 'c', 'd']);
    assert.equal(JSON.stringify(grouped), original, 'reordering never mutates objects or membership');
  });
  test('same position, moving targets, and missing rows produce no edit', () => {
    assert.equal(reorderedLayers(scene, ['a'], 'b', true), null);
    assert.equal(reorderedLayers(scene, ['b'], 'b'), null);
    assert.equal(reorderedLayers(scene, [], 'b'), null);
    assert.equal(reorderedLayers(scene, ['a'], 'missing'), null);
  });
});
