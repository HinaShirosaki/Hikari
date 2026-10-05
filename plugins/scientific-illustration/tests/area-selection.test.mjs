import test from 'node:test';
import assert from 'node:assert/strict';
import { rectanglePoints, regionSelection } from '../area-selection.mjs';

const object = (id, x, y, width = 10, height = 10, extra = {}) => ({ id, x, y, width, height, rotation: 0, canvas: 'main', visible: true, ...extra });
const rectangle = (x, y, width, height) => rectanglePoints({ x, y }, { x: x + width, y: y + height });
const document = (...objects) => ({ objects, groups: [] });

test('rectangle selects touched, contained and enclosing components in either drag direction', () => {
  const scene = document(object('inside', 10, 10), object('touch', 30, 30), object('outside', 80, 80), object('enclosing', 0, 0, 100, 100));
  for (const region of [rectangle(5, 5, 25, 25), rectangle(30, 30, -25, -25)]) {
    assert.deepEqual(regionSelection(scene, 'main', region), ['inside', 'touch', 'enclosing']);
  }
});

test('selection includes crossing edges even when neither region contains a vertex of the other', () => {
  assert.deepEqual(regionSelection(document(object('horizontal', 0, 45, 100, 10)), 'main', rectangle(45, 0, 10, 100)), ['horizontal']);
});

test('rotated boxes are tested exactly, excluding empty corners of their bounding rectangle', () => {
  const scene = document(object('rotated', 40, 40, 20, 20, { rotation: 45 }));
  assert.deepEqual(regionSelection(scene, 'main', rectangle(35, 35, 3, 3)), []);
  assert.deepEqual(regionSelection(scene, 'main', rectangle(49, 35, 2, 2)), ['rotated']);
});

test('concave freehand region excludes objects in its notch', () => {
  const lasso = [[0, 0], [100, 0], [100, 25], [25, 25], [25, 100], [0, 100]].map(([x, y]) => ({ x, y }));
  const scene = document(object('top', 45, 5), object('left', 5, 50), object('notch', 50, 50));
  assert.deepEqual(regionSelection(scene, 'main', lasso), ['top', 'left']);
});

test('self-crossing lasso follows even-odd fill, matching the preview', () => {
  const lasso = [[0, 0], [100, 100], [0, 100], [100, 0]].map(([x, y]) => ({ x, y }));
  assert.deepEqual(regionSelection(document(object('top', 45, 5), object('bottom', 45, 85), object('gap', 5, 45)), 'main', lasso), ['top', 'bottom']);
});

test('groups expand in paint order; individual selection preserves member independence', () => {
  const scene = { objects: [object('label', 300, 300), object('cell', 10, 10), object('other', 400, 400)], groups: [{ ids: ['cell', 'label'] }] };
  const original = JSON.stringify(scene);
  assert.deepEqual(regionSelection(scene, 'main', rectangle(5, 5, 30, 30)), ['label', 'cell']);
  assert.deepEqual(regionSelection(scene, 'main', rectangle(5, 5, 30, 30), { individual: true }), ['cell']);
  assert.equal(JSON.stringify(scene), original, 'Selection does not mutate scene geometry or group membership');
});

test('hidden components and the other canvas are excluded, with separate main and scratch results', () => {
  const scene = document(object('main', 10, 10), object('hidden', 10, 10, 10, 10, { visible: false }), object('scratch', 10, 10, 10, 10, { canvas: 'scratch' }));
  assert.deepEqual(regionSelection(scene, 'main', rectangle(0, 0, 40, 40)), ['main']);
  assert.deepEqual(regionSelection(scene, 'scratch', rectangle(0, 0, 40, 40)), ['scratch']);
});

test('empty, single-point and collinear gestures select nothing', () => {
  const scene = document(object('cell', 0, 0, 100, 100));
  for (const polygon of [[], [{ x: 10, y: 10 }], rectangle(10, 10, 0, 60), [{ x: 0, y: 0 }, { x: 30, y: 30 }, { x: 90, y: 90 }]]) {
    assert.deepEqual(regionSelection(scene, 'main', polygon), []);
  }
});

test('measured text bounds exclude blank layout space and include overflowing glyphs without mutating the model', () => {
  const scene = document(object('label', 10, 10, 300, 160, { type: 'text' }));
  const before = JSON.stringify(scene);
  const getBounds = o => ({ ...o, x: 290, y: 30, width: 80, height: 24 });
  assert.deepEqual(regionSelection(scene, 'main', rectangle(15, 15, 100, 100), { getBounds }), []);
  assert.deepEqual(regionSelection(scene, 'main', rectangle(340, 30, 10, 10), { getBounds }), ['label']);
  assert.equal(JSON.stringify(scene), before);
});
