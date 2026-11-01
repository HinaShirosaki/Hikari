import test from 'node:test';
import assert from 'node:assert/strict';
import { smartGuideTargets, snapTranslation } from '../smart-guides.mjs';
import { selectionBounds } from '../grouping.mjs';

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
