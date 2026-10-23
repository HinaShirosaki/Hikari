import assert from 'node:assert/strict';
import { findLaneDividerNearPointer } from '../src/plugins/gel/workspace/manual/divider-target.js';

function hit({ width = 900, boundaries = [100, 500, 800], x, y = 100 } = {}) {
  return findLaneDividerNearPointer({
    runtime: { currentImage: { width: 900 }, manualOverrides: { laneSegmentation: {
      gelLeft: boundaries[0], gelRight: boundaries.at(-1), dividers: boundaries.slice(1, -1)
    } } },
    canvas: { getBoundingClientRect: () => ({ left: 20, right: 20 + width, top: 30, bottom: 230, width, height: 200 }) },
    event: { clientX: 20 + x, clientY: y }
  });
}
for (const width of [900, 300]) {
  const line = 500.5 / 900 * width;
  for (const offset of [-12, 12]) assert.equal(hit({ width, x: line + offset }), 500, 'The screen grab radius includes both edges');
  assert.equal(hit({ width, x: line + 13 }), null, 'Clicks beyond the grab zone remain available for new dividers');
  for (const y of [30, 230]) assert.equal(hit({ width, x: line + 10, y }), 500, 'The grab zone spans the full canvas height');
}
assert.equal(hit({ boundaries: [100, 110, 800], x: 108.5 }), 110, 'The closer divider wins when grab zones overlap');
assert.equal(hit({ boundaries: [100, 110, 800], x: 102.5 }), 100);
assert.equal(hit({ boundaries: [0, 500, 899], x: .5 }), 0, 'The left image edge remains selectable');
assert.equal(hit({ x: 500.5, y: 29 }), null, 'The grab zone does not extend outside the canvas');
console.log('gel-divider-target-selfcheck: passed (12-pixel radius, image scaling, full height, nearest divider, outer edge, canvas bounds)');
