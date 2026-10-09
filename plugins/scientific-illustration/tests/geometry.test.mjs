import test from 'node:test';
import assert from 'node:assert/strict';
import { RESIZE_HANDLES, resizeObject, resizeCursor, scaleTextObject } from '../geometry.mjs';

function worldPoint(object, horizontal, vertical) {
  const angle = object.rotation * Math.PI / 180;
  const x = horizontal * object.width / 2, y = vertical * object.height / 2;
  return { x: object.x + object.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    y: object.y + object.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

for (const rotation of [0, 37, 90, -135, 360]) {
  for (const [direction, [horizontal, vertical]] of Object.entries(RESIZE_HANDLES)) {
    test(`${direction} handle at ${rotation}° keeps its opposite anchor and follows the pointer`, () => {
      const object = { x: 150, y: 220, width: 160, height: 100, rotation };
      const anchor = worldPoint(object, -horizontal, -vertical), start = worldPoint(object, horizontal, vertical);
      // Drag along the handle's two active axes; edge handles ignore the
      // perpendicular pointer motion and keep the other dimension unchanged.
      const angle = rotation * Math.PI / 180, localX = horizontal ? horizontal * 40 : 27, localY = vertical ? vertical * 20 : 31;
      const dx = localX * Math.cos(angle) - localY * Math.sin(angle), dy = localX * Math.sin(angle) + localY * Math.cos(angle);
      const after = { ...object, ...resizeObject(object, direction, dx, dy) };
      const fixed = worldPoint(after, -horizontal, -vertical), moved = worldPoint(after, horizontal, vertical);
      close(fixed.x, anchor.x); close(fixed.y, anchor.y);
      close(after.width, object.width + (horizontal ? 40 : 0));
      close(after.height, object.height + (vertical ? 20 : 0));
      const activeX = horizontal * 40, activeY = vertical * 20;
      close(moved.x - start.x, activeX * Math.cos(angle) - activeY * Math.sin(angle));
      close(moved.y - start.y, activeX * Math.sin(angle) + activeY * Math.cos(angle));
    });
    test(`${direction} handle at ${rotation}° clamps without flipping or moving the opposite anchor`, () => {
      const object = { x: -100, y: 10, width: 160, height: 100, rotation };
      const anchor = worldPoint(object, -horizontal, -vertical), angle = rotation * Math.PI / 180;
      for (const delta of [-20000, 20000]) {
        const localX = horizontal * delta, localY = vertical * delta;
        const after = { ...object, ...resizeObject(object, direction,
          localX * Math.cos(angle) - localY * Math.sin(angle), localX * Math.sin(angle) + localY * Math.cos(angle)) };
        assert.ok(after.width >= 1 && after.width <= 8000 && after.height >= 1 && after.height <= 8000);
        const fixed = worldPoint(after, -horizontal, -vertical);
        close(fixed.x, anchor.x); close(fixed.y, anchor.y);
      }
    });
  }
}
test('resize cursors follow the visible orientation', () => {
  assert.equal(resizeCursor('n', 0), 'ns-resize');
  assert.equal(resizeCursor('n', 90), 'ew-resize');
  assert.equal(resizeCursor('se', 0), 'nwse-resize');
  assert.equal(resizeCursor('se', 90), 'nesw-resize');
});

for (const rotation of [0, 37, 90, -135, 360]) {
  for (const [direction, [horizontal, vertical]] of Object.entries(RESIZE_HANDLES)) {
    test(`text ${direction} at ${rotation}° scales proportionally around its opposite anchor`, () => {
      const object = { type: 'text', x: 150, y: 220, width: 160, height: 100, rotation, fontSize: 20 };
      const anchor = worldPoint(object, -horizontal, -vertical), angle = rotation * Math.PI / 180;
      const vectorX = horizontal * object.width, vectorY = vertical * object.height;
      // Motion perpendicular to a corner diagonal or edge axis must not stretch text.
      const localX = vectorX / 4 - vectorY / 10, localY = vectorY / 4 + vectorX / 10;
      const patch = resizeObject(object, direction,
        localX * Math.cos(angle) - localY * Math.sin(angle), localX * Math.sin(angle) + localY * Math.cos(angle));
      const after = { ...object, ...patch }, fixed = worldPoint(after, -horizontal, -vertical);
      close(after.width, 200); close(after.height, 125); close(after.fontSize, 25);
      close(fixed.x, anchor.x); close(fixed.y, anchor.y);
      for (const distance of [-20000, 20000]) {
        const limited = { ...object, ...resizeObject(object, direction,
          distance * (vectorX * Math.cos(angle) - vectorY * Math.sin(angle)),
          distance * (vectorX * Math.sin(angle) + vectorY * Math.cos(angle))) };
        close(limited.width / limited.height, object.width / object.height);
        close(limited.fontSize / limited.width, object.fontSize / object.width);
        assert.ok(limited.width >= 1 && limited.width <= 8000 && limited.height >= 1 && limited.height <= 8000);
        assert.ok(limited.fontSize >= 4 && limited.fontSize <= 300);
        const held = worldPoint(limited, -horizontal, -vertical);
        close(held.x, anchor.x); close(held.y, anchor.y);
      }
    });
  }
}

test('text scaling respects the dimension limit before the font limit', () => {
  const object = { width: 4000, height: 1000, fontSize: 24 };
  assert.deepEqual(scaleTextObject(object, 10), { width: 8000, height: 2000, fontSize: 48 });
});
test('text scaling respects the smallest dimension without changing the ratio', () => {
  const object = { width: 2, height: 10, fontSize: 24 };
  assert.deepEqual(scaleTextObject(object, -10), { width: 1, height: 5, fontSize: 12 });
});
test('vector and raster width resizing remains independent of height', () => {
  for (const type of ['vector', 'raster']) {
    const object = { type, x: 40, y: 20, width: 160, height: 100, rotation: 0 };
    assert.deepEqual(resizeObject(object, 'e', 40, 20), { width: 200, height: 100, x: 40, y: 20 });
  }
});

test('all text handles resize from tight, offset glyph bounds while preserving the authored layout', () => {
  for (const rotation of [0, 37, 90]) for (const [direction, [hx, hy]] of Object.entries(RESIZE_HANDLES)) {
    const object = { type: 'text', x: 150, y: 220, width: 300, height: 160, fontSize: 20, rotation };
    const box = { x: 210, y: 250, width: 50, height: 24, rotation };
    const anchor = worldPoint(box, -hx, -hy), angle = rotation * Math.PI / 180;
    const dx = hx * box.width / 2, dy = hy * box.height / 2;
    const after = { ...object, ...resizeObject(object, direction, dx * Math.cos(angle) - dy * Math.sin(angle), dx * Math.sin(angle) + dy * Math.cos(angle), box) };
    const scale = after.fontSize / object.fontSize;
    close(scale, 1.5); close(after.width, object.width * scale); close(after.height, object.height * scale);
    close(after.x, anchor.x + (object.x - anchor.x) * scale);
    close(after.y, anchor.y + (object.y - anchor.y) * scale);
    const glyphAfter = { ...box, x: anchor.x + (box.x - anchor.x) * scale, y: anchor.y + (box.y - anchor.y) * scale, width: box.width * scale, height: box.height * scale };
    const fixed = worldPoint(glyphAfter, -hx, -hy);
    close(fixed.x, anchor.x); close(fixed.y, anchor.y);
  }
});
