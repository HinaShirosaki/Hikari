import test from 'node:test';
import assert from 'node:assert/strict';
import { movingLayerIds, reorderedLayers } from '../layer-order.mjs';

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
