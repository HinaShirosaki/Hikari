import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { agentInstructions } from '../agent/figure-agent.mjs';
import {
  RESIZE_HANDLES, angleDelta, objectCorners, rectanglePoints, regionSelection, resizeCursor, resizeObject, resizeSelection, rotateComponents, selectionBounds, transformSelection
} from '../geometry.mjs';
import { MAX_GROUPS, MAX_OBJECTS, applyOperations, createDocument, normalizeDocument, readDocument } from '../model.mjs';

describe('Resize geometry', () => {
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
});

describe('Groups', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>';
  const fixture = () => applyOperations(createDocument(), [
    { op: 'upsert', object: { id: 'membrane', type: 'vector', x: 100, y: 150, width: 120, height: 80, rotation: 37, svg } },
    { op: 'upsert', object: { id: 'label', type: 'text', x: 240, y: 170, width: 100, height: 40, fontSize: 20, text: 'ER' } },
    { op: 'upsert', object: { id: 'other', type: 'vector', x: 140, y: 180, width: 30, height: 30, svg } },
    { op: 'upsert', object: { id: 'spare', type: 'vector', canvas: 'main', svg } }
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

  test('group validation rejects duplicates, unknown members and partial regrouping atomically', () => {
    const before = group(fixture()), snapshot = JSON.stringify(before);
    for (const ids of [['other', 'other'], ['other', 'missing'], ['membrane', 'other']]) {
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

  test('mixed selections resize around their visible bounds rather than oversized text layout boxes', () => {
    const objects = fixture().objects.slice(0, 2);
    const glyph = { ...objects[1], x: 260, y: 180, width: 25, height: 24 };
    const visible = selectionBounds([objects[0], glyph]), original = selectionBounds(objects);
    for (const [direction, [hx, hy]] of Object.entries(RESIZE_HANDLES)) {
      const patch = resizeSelection(objects, direction, hx * visible.width / 2, hy * visible.height / 2, visible);
      const after = transformSelection(objects, patch), scale = after[1].fontSize / objects[1].fontSize;
      close(scale, 1.5);
      const glyphAfter = { ...glyph, x: patch.x + (glyph.x - original.x) * scale, y: patch.y + (glyph.y - original.y) * scale, width: glyph.width * scale, height: glyph.height * scale };
      const bounds = selectionBounds([after[0], glyphAfter]);
      close(visible.x + (1 - hx) * visible.width / 2, bounds.x + (1 - hx) * bounds.width / 2);
      close(visible.y + (1 - hy) * visible.height / 2, bounds.y + (1 - hy) * bounds.height / 2);
      close(after[1].width / after[1].height, objects[1].width / objects[1].height);
    }
  });

  test('individual editing stays independent and deleting a member prunes stale groups', () => {
    const before = group(fixture());
    const edited = applyOperations(before, [{ op: 'update', id: 'label', patch: { text: 'Rough ER', x: 280 } }]);
    assert.deepEqual(edited.objects[0], before.objects[0]); assert.equal(edited.groups.length, 1);
    for (const operation of [{ op: 'delete', id: 'label' }]) {
      const after = applyOperations(edited, [operation]); assert.deepEqual(after.groups, []);
      assert.deepEqual(after.objects.find(object => object.id === 'membrane'), before.objects[0]);
    }
  });

  test('group copies and transfers preserve geometry and membership on the canvas', () => {
    const before = group(fixture());
    const copied = applyOperations(before, [{ op: 'transfer', id: 'er', canvas: 'main', copy: true, new_id: 'er-copy' }]);
    const copy = copied.groups.find(group => group.id === 'er-copy');
    assert.equal(copy.canvas, 'main'); assert.equal(copy.ids.length, 2);
    assert.ok(copy.ids.every(id => !before.objects.some(object => object.id === id)));
    for (const [index, id] of copy.ids.entries()) {
      const object = copied.objects.find(object => object.id === id), original = before.objects[index];
      assert.deepEqual({ ...object, id: original.id, canvas: original.canvas }, original);
    }
    const moved = applyOperations(before, [{ op: 'transfer', id: 'er', canvas: 'main' }]);
    assert.equal(moved.groups[0].canvas, 'main'); assert.ok(moved.objects.slice(0, 2).every(object => object.canvas === 'main'));
    const deleted = applyOperations(copied, [{ op: 'delete', id: 'er-copy' }]);
    assert.deepEqual(deleted.objects, before.objects); assert.deepEqual(deleted.groups, before.groups);
  });

  test('a maximum-size group moves and ungroups in single atomic operations', () => {
    const document = createDocument();
    document.objects = Array.from({ length: MAX_OBJECTS }, (_, i) => ({ id: `part-${i}`, type: 'vector', canvas: 'main', x: (i % 10) * 30, y: Math.floor(i / 10) * 30, width: 20, height: 20, svg }));
    const before = normalizeDocument(document), grouped = applyOperations(before, [{ op: 'group', id: 'large', ids: before.objects.map(object => object.id) }]);
    const moved = applyOperations(grouped, [{ op: 'transform', id: 'large', patch: { x: 100, y: 120 } }]);
    assert.ok(moved.objects.every((object, i) => object.x === before.objects[i].x + 100 && object.y === before.objects[i].y + 120));
    assert.throws(() => applyOperations(grouped, [{ op: 'transfer', id: 'large', canvas: 'main', copy: true, new_id: 'too-many' }]), new RegExp(`maximum ${MAX_OBJECTS}`));
    assert.deepEqual(applyOperations(moved, [{ op: 'ungroup', id: 'large' }]).objects, moved.objects);
    assert.deepEqual(applyOperations(moved, [{ op: 'delete', id: 'large' }]).objects, []);
  });

  test('agent instructions state the validator limits for every detail level', () => {
    for (const level of ['simple', 'standard', 'detailed']) {
      const instructions = agentInstructions(level);
      assert.match(instructions, new RegExp(`at most ${MAX_OBJECTS} objects and ${MAX_GROUPS} groups`));
      assert.match(instructions, /Groups do not nest/);
      assert.match(instructions, /arrowheads as path or polygon/);
      assert.match(instructions, /Text objects never wrap; break lines with \\n/);
      assert.match(instructions, /hex only/);
    }
    const document = createDocument();
    document.objects = Array.from({ length: MAX_OBJECTS + 1 }, (_, i) => ({ id: `part-${i}`, type: 'text', canvas: 'main' }));
    assert.throws(() => normalizeDocument(document), new RegExp(`maximum ${MAX_OBJECTS}`));
    // Regrouping is flat: the outer group replaces the member groups.
    const nested = applyOperations(fixture(), [{ op: 'group', id: 'inner', ids: ['membrane', 'label'] }, { op: 'group', id: 'outer', ids: ['membrane', 'label', 'other'] }]);
    assert.deepEqual(nested.groups.map(group => group.id), ['outer']);
  });
});

describe('Rotation', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
  const objects = [
    { id: 'art', type: 'vector', canvas: 'main', x: 100, y: 120, width: 120, height: 80, rotation: 37, svg },
    { id: 'text', type: 'text', canvas: 'main', x: 260, y: 170, width: 200, height: 50, rotation: -23, fontSize: 24, text: 'Cell', italic: true }
  ];
  test('angular differences cross the signed-angle seam smoothly and normalize multiple turns', () => {
    assert.equal(angleDelta(179, -179), 2); assert.equal(angleDelta(-179, 179), -2);
    assert.equal(angleDelta(0, 450), 90); assert.equal(angleDelta(0, -450), -90);
    assert.equal(angleDelta(0, 720), 0);
  });
  test('rotation applies a rigid transform to every corner and preserves component size, text and source state', () => {
    const before = structuredClone(objects), pivot = { x: 250, y: 200 };
    for (const degrees of [-190, -90, -15, 15, 179, 270, 450]) {
      const rotated = rotateComponents(objects, degrees, pivot), radians = degrees * Math.PI / 180;
      rotated.forEach((object, i) => {
        assert.equal(object.width, objects[i].width); assert.equal(object.height, objects[i].height);
        assert.equal(object.fontSize, objects[i].fontSize); assert.equal(object.text, objects[i].text);
        objectCorners(object).forEach((point, index) => {
          const original = objectCorners(objects[i])[index], dx = original.x - pivot.x, dy = original.y - pivot.y;
          close(point.x, pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians));
          close(point.y, pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians));
        });
      });
    }
    assert.deepEqual(objects, before); assert.deepEqual(rotateComponents(objects, 360, pivot), objects);
  });
  test('a visible text pivot compensates for blank layout space without changing typography', () => {
    const object = objects[1], pivot = { x: object.x + 45, y: object.y + 18 };
    const rotated = rotateComponents([object], 90, pivot)[0];
    const cx = object.x + object.width / 2, cy = object.y + object.height / 2;
    close(rotated.x + rotated.width / 2, pivot.x - (cy - pivot.y));
    close(rotated.y + rotated.height / 2, pivot.y + (cx - pivot.x));
    assert.equal(rotated.fontSize, object.fontSize); assert.equal(rotated.italic, true);
  });
  test('one model operation rotates all 200 components, preserving group membership and paint order', () => {
    let document = createDocument();
    document = applyOperations(document, Array.from({ length: 200 }, (_, i) => ({ op: 'upsert', object: { id: `art-${i}`, type: 'vector', x: i * 30, y: 200, width: 20, height: 10, svg } })));
    document = applyOperations(document, [{ op: 'group', id: 'all', ids: document.objects.map(object => object.id) }]);
    const before = structuredClone(document), after = applyOperations(document, [{ op: 'rotate', id: 'all', degrees: 45 }]);
    assert.deepEqual(after.groups, before.groups); assert.deepEqual(after.objects.map(o => o.id), before.objects.map(o => o.id));
    assert.ok(after.objects.every(object => object.rotation === 45)); assert.deepEqual(document, before);
  });
  test('rotation rejects invalid selectors, mixed canvases, bad pivots and out-of-range results atomically', () => {
    const before = applyOperations(createDocument(), objects.map(object => ({ op: 'upsert', object })));
    const snapshot = structuredClone(before);
    for (const operation of [
      { op: 'rotate', id: 'art', ids: ['text'], degrees: 30 },
      { op: 'rotate', ids: ['art', 'art'], degrees: 30 },
      { op: 'rotate', id: 'missing', degrees: 30 },
      { op: 'rotate', id: 'art', degrees: Infinity },
      { op: 'rotate', id: 'art', degrees: 361 },
      { op: 'rotate', id: 'art', degrees: 20, pivot: { x: 0, y: '0' } },
      { op: 'rotate', id: 'art', degrees: 20, pivot: { x: 0, y: 0, other: true } },
      { op: 'rotate', id: 'art', degrees: 180, pivot: { x: 100000, y: 0 } }
    ]) { assert.throws(() => applyOperations(before, [{ op: 'title', title: 'Uncommitted' }, operation])); assert.deepEqual(before, snapshot); }
    assert.throws(() => rotateComponents([objects[0], { ...objects[1], canvas: 'scratch' }], 30), /one canvas/);
  });
});

describe('Area selection', () => {
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
});
