import test from 'node:test';
import assert from 'node:assert/strict';
import { RESIZE_HANDLES, resizeObject, resizeCursor } from '../geometry.mjs';

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
for (const rotation of [0, 37, -135]) {
  test(`Shift resize at ${rotation}° keeps the ratio and the opposite anchor, and clamps proportionally`, () => {
    const object = { x: 150, y: 220, width: 160, height: 100, rotation }, angle = rotation * Math.PI / 180;
    for (const [direction, [horizontal, vertical]] of Object.entries(RESIZE_HANDLES)) {
      const anchor = worldPoint(object, -horizontal, -vertical);
      for (const delta of [40, -30, 20000, -20000]) {
        const localX = horizontal * delta, localY = vertical * delta * 0.3;
        const after = { ...object, ...resizeObject(object, direction,
          localX * Math.cos(angle) - localY * Math.sin(angle), localX * Math.sin(angle) + localY * Math.cos(angle), object, true) };
        close(after.width / after.height, object.width / object.height);
        assert.ok(after.width >= 1 && after.width <= 8000 && after.height >= 1 && after.height <= 8000);
        const fixed = worldPoint(after, -horizontal, -vertical);
        close(fixed.x, anchor.x); close(fixed.y, anchor.y);
      }
    }
  });
}
test('Shift resize follows the edge being dragged', () => {
  const object = { x: 0, y: 0, width: 160, height: 100, rotation: 0 };
  assert.deepEqual(resizeObject(object, 'e', 80, 999, object, true), { width: 240, height: 150, x: 0, y: -25 });
  assert.deepEqual(resizeObject(object, 's', 999, 50, object, true), { width: 240, height: 150, x: -40, y: 0 });
});
test('resize cursors follow the visible orientation', () => {
  assert.equal(resizeCursor('n', 0), 'ns-resize');
  assert.equal(resizeCursor('n', 90), 'ew-resize');
  assert.equal(resizeCursor('se', 0), 'nwse-resize');
  assert.equal(resizeCursor('se', 90), 'nesw-resize');
});

for (const rotation of [0, 37, 90, -135, 360]) {
  for (const [direction, [horizontal, vertical]] of Object.entries(RESIZE_HANDLES)) {
    test(`text ${direction} at ${rotation}° resizes its frame while preserving typography`, () => {
      const object = { type: 'text', x: 150, y: 220, width: 160, height: 100, rotation, fontSize: 20.5 };
      const anchor = worldPoint(object, -horizontal, -vertical), angle = rotation * Math.PI / 180;
      const localX = horizontal ? horizontal * 40 : 27, localY = vertical ? vertical * 20 : 31;
      const patch = resizeObject(object, direction,
        localX * Math.cos(angle) - localY * Math.sin(angle), localX * Math.sin(angle) + localY * Math.cos(angle));
      const after = { ...object, ...patch }, fixed = worldPoint(after, -horizontal, -vertical);
      close(after.width, object.width + (horizontal ? 40 : 0));
      close(after.height, object.height + (vertical ? 20 : 0));
      assert.equal(after.fontSize, 20.5);
      assert.ok(!Object.hasOwn(patch, 'fontSize'), 'Resizing does not write a font size');
      close(fixed.x, anchor.x); close(fixed.y, anchor.y);
      for (const fontSize of [4, 300]) for (const delta of [-20000, 20000]) {
        const localX = horizontal * delta, localY = vertical * delta;
        const limited = { ...object, fontSize, ...resizeObject({ ...object, fontSize }, direction,
          localX * Math.cos(angle) - localY * Math.sin(angle), localX * Math.sin(angle) + localY * Math.cos(angle)) };
        assert.ok(limited.width >= 1 && limited.width <= 8000 && limited.height >= 1 && limited.height <= 8000);
        assert.equal(limited.fontSize, fontSize, 'Font limits do not restrict the text box dimensions');
        const held = worldPoint(limited, -horizontal, -vertical);
        close(held.x, anchor.x); close(held.y, anchor.y);
      }
      const proportional = { ...object, ...resizeObject(object, direction,
        localX * Math.cos(angle) - localY * Math.sin(angle), localX * Math.sin(angle) + localY * Math.cos(angle), object, true) };
      close(proportional.width / proportional.height, object.width / object.height);
      assert.equal(proportional.fontSize, object.fontSize, 'Shift preserves the box ratio without scaling its font');
      const held = worldPoint(proportional, -horizontal, -vertical);
      close(held.x, anchor.x); close(held.y, anchor.y);
    });
  }
}

test('vector and raster width resizing remains independent of height', () => {
  for (const type of ['vector', 'raster']) {
    const object = { type, x: 40, y: 20, width: 160, height: 100, rotation: 0 };
    assert.deepEqual(resizeObject(object, 'e', 40, 20), { width: 200, height: 100, x: 40, y: 20 });
  }
});
