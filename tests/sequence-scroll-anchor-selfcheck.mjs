// Toggling the ORF view retags every sequence line with an extra amino-acid row,
// so holding the raw scrollTop silently moves the reader to a different base.
// These checks pin the anchor to the base, not to the pixel.
import assert from 'node:assert/strict';
import {
  captureScrollAnchor,
  restoreScrollAnchor
} from '../src/renderer/modules/sequence-viewer/detail-rendering.js';

// A host scrolled to `scrollTop` showing lines of `lineHeight` px each.
function makeHost({ lineCount, lineHeight, lineLength, scrollTop = 0, hostTop = 100 }) {
  const host = {
    scrollTop,
    getBoundingClientRect: () => ({ top: hostTop }),
    querySelectorAll() {
      return Array.from({ length: lineCount }, (unused, index) => ({
        dataset: { lineStart: String(index * lineLength) },
        getBoundingClientRect: () => {
          const top = hostTop + (index * lineHeight) - host.scrollTop;
          return { top, bottom: top + lineHeight };
        }
      }));
    }
  };
  return host;
}

// Scrolled 20 lines down at 40 px per line: the top of the viewport shows base 1200.
const before = makeHost({ lineCount: 100, lineHeight: 40, lineLength: 60, scrollTop: 800 });
const anchor = captureScrollAnchor(before);
assert.equal(anchor.baseIndex, 1200);
assert.equal(anchor.offsetPx, 0);

// Turning the ORF view on makes every line 58 px tall. Holding scrollTop at 800
// would drop the reader at base 780; the anchor puts base 1200 back on top.
const taller = makeHost({ lineCount: 100, lineHeight: 58, lineLength: 60, scrollTop: 800 });
assert.equal(restoreScrollAnchor(taller, anchor), true);
assert.equal(taller.scrollTop, 1160);
assert.equal(captureScrollAnchor(taller).baseIndex, 1200);

// A part-scrolled line keeps its sub-line offset too.
const partial = makeHost({ lineCount: 100, lineHeight: 40, lineLength: 60, scrollTop: 810 });
const partialAnchor = captureScrollAnchor(partial);
assert.equal(partialAnchor.baseIndex, 1200);
assert.equal(partialAnchor.offsetPx, -10);
const partialTaller = makeHost({ lineCount: 100, lineHeight: 58, lineLength: 60, scrollTop: 0 });
restoreScrollAnchor(partialTaller, partialAnchor);
assert.equal(partialTaller.scrollTop, 1170);

// A re-render that rewraps to a different line length still lands on the line
// holding the anchored base rather than giving up.
const rewrapped = makeHost({ lineCount: 100, lineHeight: 40, lineLength: 50, scrollTop: 0 });
assert.equal(restoreScrollAnchor(rewrapped, anchor), true);
assert.equal(rewrapped.scrollTop, 960);
assert.equal(captureScrollAnchor(rewrapped).baseIndex, 1200);

// Scrolled to the very top there is nothing to correct.
const top = makeHost({ lineCount: 100, lineHeight: 40, lineLength: 60, scrollTop: 0 });
assert.equal(captureScrollAnchor(top).baseIndex, 0);
assert.equal(restoreScrollAnchor(top, captureScrollAnchor(top)), true);
assert.equal(top.scrollTop, 0);

// Without a measurable DOM the caller falls back to its own scrollTop handling.
assert.equal(captureScrollAnchor({}), null);
assert.equal(restoreScrollAnchor({}, anchor), false);
assert.equal(restoreScrollAnchor(before, null), false);
assert.equal(restoreScrollAnchor(makeHost({ lineCount: 0, lineHeight: 40, lineLength: 60 }), anchor), false);

console.log('sequence-scroll-anchor-selfcheck: ok');
