import assert from 'node:assert/strict';
import { buildPageRecords } from '../src/renderer/modules/papers/pdf-viewer/pdf-viewer-page-records.js';

// A dropped canvas backing store keeps the canvas size, so the page records
// have to hear about it or the "already rendered" check skips the repaint and
// the page stays black.
const listeners = new Map();
const stubDocument = {
  createElement: (tag) => ({
    tag,
    className: '',
    dataset: {},
    style: { setProperty() {} },
    setAttribute() {},
    append() {},
    addEventListener(type, handler) {
      if (tag === 'canvas') {
        listeners.set(type, handler);
      }
    }
  })
};

const lost = [];
const [record] = buildPageRecords({
  doc: stubDocument,
  pageMetrics: [{ width: 612, height: 792 }],
  onCanvasContextLost: (target) => lost.push(target)
});

assert.deepEqual([...listeners.keys()].sort(), ['contextlost', 'contextrestored']);

record.renderedScale = 1.5;
listeners.get('contextlost')();
assert.deepEqual(lost, [record], 'the losing page record must be reported');

listeners.get('contextrestored')();
assert.equal(lost.length, 2, 'a restored context must also trigger a repaint');

console.log('pdf viewer canvas recovery selfcheck passed');
