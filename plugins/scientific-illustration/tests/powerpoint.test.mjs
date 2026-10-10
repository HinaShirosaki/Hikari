import test from 'node:test';
import assert from 'node:assert/strict';
import { powerPointLayout, powerPointObject, powerPointPaint } from '../powerpoint.mjs';

test('figure units map uniformly into valid PowerPoint slide dimensions', () => {
  const layout = powerPointLayout({ width: 1200, height: 800 });
  assert.equal(layout.width, 12.5); assert.ok(Math.abs(layout.height - 800 / 96) < 1e-12);
  assert.equal(layout.x, 0); assert.equal(layout.y, 0);
  const large = powerPointLayout({ width: 8000, height: 6000 });
  assert.equal(large.width, 56); assert.equal(large.width / large.height, 4 / 3);
  const narrow = powerPointLayout({ width: 64, height: 8000 });
  assert.equal(narrow.width, 1); assert.equal(narrow.height, 56);
  assert.equal(narrow.x * 2 + 64 * narrow.scale, 1);
  assert.throws(() => powerPointLayout({ width: 0, height: 100 }), /valid canvas/);
});
test('native component transforms preserve signed placement, rotation, size, names and opacity', () => {
  const object = { id: 'v', name: 'Membrane & receptor', type: 'vector', x: -32, y: 48, width: 96, height: 144, rotation: -15, opacity: 0.625 };
  const before = structuredClone(object), options = powerPointObject(object, powerPointLayout({ width: 1200, height: 800 }));
  assert.equal(options.x, -1 / 3); assert.equal(options.y, 0.5);
  assert.equal(options.w, 1); assert.equal(options.h, 1.5);
  assert.equal(options.rotate, 345); assert.equal(options.transparency, 37.5);
  assert.equal(options.objectName, object.name); assert.deepEqual(object, before);
});
test('labels remain text boxes with figure typography and combined color/layer alpha', () => {
  const object = { id: 'label', type: 'text', text: 'A\nB', fontFamily: '"Inter", Arial', fontSize: 24, fontWeight: 700,
    color: '#11223380', x: 0, y: 0, width: 200, height: 60, rotation: 15, opacity: 0.8,
    italic: true, underline: true, align: 'end', anchor: 'middle' };
  const options = powerPointObject(object, powerPointLayout({ width: 1200, height: 800 }));
  assert.equal(options.fontSize, 18); assert.equal(options.fontFace, 'Inter');
  assert.ok(Math.abs(options.lineSpacing - 21.6) < 1e-12);
  assert.equal(options.align, 'right'); assert.equal(options.valign, 'middle');
  assert.equal(options.bold, true); assert.equal(options.italic, true); assert.equal(options.underline, true);
  assert.equal(options.color, '112233');
  assert.ok(Math.abs(options.transparency - (1 - 128 / 255 * 0.8) * 100) < 1e-10);
  assert.equal(options.isTextBox, true); assert.equal(options.wrap, false); assert.equal(options.margin, 0);
  assert.deepEqual(powerPointPaint('#aabbcc'), { color: 'AABBCC', transparency: 0 });
  assert.throws(() => powerPointPaint('url(https://example.com)'), /hex color/);
});
