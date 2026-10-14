import test from 'node:test';
import assert from 'node:assert/strict';
import { CANVASES, createDocument, normalizeDocument, applyOperations, validateRequest } from '../model.mjs';
import { normalizeClipboard, instantiateClipboard, CLIPBOARD_FORMAT } from '../clipboard.mjs';
import { CANVAS_TOOL_CONTRACT } from '../agent/canvas-contract.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><ellipse cx="50" cy="40" rx="50" ry="40"/></svg>';
const document = () => applyOperations(createDocument(), [
  { op: 'upsert', object: { id: 'existing', type: 'text', text: 'Keep main', x: 20, y: 30 } },
  { op: 'upsert', object: { id: 'vector', type: 'vector', name: 'Cell', x: 100, y: 150, width: 100, height: 80, rotation: 37, svg } },
  { op: 'upsert', object: { id: 'label', type: 'text', name: 'Cell label', text: 'α Cell', x: 220, y: 170, width: 150, height: 60, rotation: -18, fontSize: 26, color: '#287c75' } },
  { op: 'upsert', object: { id: 'raster', type: 'raster', x: 60, y: 80, width: 80, height: 40, rotation: 15, textFree: true, dataUrl: 'data:image/png;base64,YWJj' } },
  { op: 'group', id: 'assembly', name: 'Cell assembly', ids: ['vector', 'label', 'raster'] }
]);

test('legacy artwork, raster pixels, independent labels and groups survive normalization unchanged', () => {
  const expected = document(), legacy = structuredClone(expected);
  legacy.canvases.scratch = { width: 500, height: 350, background: '#ffffff' };
  legacy.objects.forEach(object => { if (object.id !== 'existing') object.canvas = 'scratch'; });
  legacy.groups[0].canvas = 'scratch';
  const snapshot = structuredClone(legacy), restored = normalizeDocument(legacy);
  assert.deepEqual(restored, expected);
  assert.deepEqual(legacy, snapshot, 'Normalization does not rewrite the source');
  assert.deepEqual(normalizeDocument(restored), restored, 'Migration is idempotent');
  assert.deepEqual(CANVASES, ['main']);
});

test('new requests and every canvas mutation reject scratch atomically', () => {
  const before = document(), snapshot = structuredClone(before);
  for (const operation of [
    { op: 'upsert', object: { id: 'obsolete', type: 'text', canvas: 'scratch' } },
    { op: 'update', id: 'label', patch: { canvas: 'scratch' } },
    { op: 'transfer', id: 'assembly', canvas: 'scratch', copy: true, new_id: 'copy' },
    { op: 'canvas', canvas: 'scratch', patch: { width: 400 } },
    { op: 'order', canvas: 'scratch', ids: [] }
  ]) {
    assert.throws(() => applyOperations(before, [{ op: 'title', title: 'Uncommitted' }, operation]));
    assert.deepEqual(before, snapshot);
  }
  assert.throws(() => validateRequest({ action: 'scratch', visible: true }));
  assert.throws(() => validateRequest({ action: 'render', canvas: 'scratch' }));
  const schema = CANVAS_TOOL_CONTRACT.inputSchema.properties;
  assert.deepEqual(schema.canvas.enum, ['main']);
  assert.deepEqual(schema.operations.items.properties.object.properties.canvas.enum, ['main']);
  assert.ok(!schema.action.enum.includes('scratch'));
  assert.equal('visible' in schema, false);
});

test('migration still rejects legacy groups spanning two canvases', () => {
  const legacy = document(); legacy.objects.find(object => object.id === 'label').canvas = 'scratch';
  assert.throws(() => normalizeDocument(legacy), /same canvas/);
});

test('legacy clipboard assemblies paste on main with fresh IDs and intact editable layers', () => {
  const source = document(), objects = source.objects.slice(1).map(object => ({ ...object, canvas: 'scratch' }));
  const raw = { format: CLIPBOARD_FORMAT, version: 1, objects, groups: [{ ...source.groups[0], canvas: 'scratch' }] };
  const snapshot = normalizeClipboard(raw), instance = instantiateClipboard(snapshot, 'main', 30);
  const after = applyOperations(createDocument(), instance.operations);
  assert.equal(after.objects.length, 3); assert.equal(after.groups.length, 1);
  assert.ok(after.objects.every(object => object.canvas === 'main' && !objects.some(original => original.id === object.id)));
  for (let i = 0; i < objects.length; i++) assert.deepEqual({ ...after.objects[i], id: objects[i].id, canvas: 'scratch', x: objects[i].x, y: objects[i].y }, objects[i]);
  assert.throws(() => instantiateClipboard(snapshot, 'scratch'), /Invalid paste destination/);
});
