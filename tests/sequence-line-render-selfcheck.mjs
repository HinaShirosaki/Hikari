// Line rendering buckets features by line so a long plasmid does not re-test
// every feature for every line. The bucketing has to be exactly equivalent to
// the old full scan, and the case that is easy to get wrong is a feature that
// wraps the origin: its segments run in descending order.
import assert from 'node:assert/strict';
import { renderDualStrandSequenceLinesHtml } from '../src/renderer/modules/sequence-viewer/rendering.js';

const SEQUENCE = 'ACGT'.repeat(60);   // 240 nt, 4 lines of 60
const render = (features) => renderDualStrandSequenceLinesHtml(SEQUENCE, [], {
  lineLength: 60, charAdvancePx: 10, sequenceLineHeightPx: 18, features, selectedFeatureIndex: -1
});

const linesOf = (html) => html.split('<div class="sequence-viewer-dual-line"').slice(1);
const nameCount = (html, name) => (html.match(new RegExp(`>${name}<`, 'g')) || []).length;

// A feature confined to one line is drawn on that line and nowhere else.
const single = linesOf(render([
  { id: 'a', name: 'midline', type: 'CDS', strand: 1, segments: [{ start: 70, end: 100 }] }
]));
assert.equal(single.length, 4);
assert.deepEqual(single.map((line) => line.includes('midline')), [false, true, false, false]);

// A feature spanning several lines appears on each of them.
const spanning = linesOf(render([
  { id: 'b', name: 'spanning', type: 'CDS', strand: 1, segments: [{ start: 50, end: 190 }] }
]));
assert.deepEqual(spanning.map((line) => line.includes('spanning')), [true, true, true, true]);

// An origin-wrapped feature has its segments in descending order. Both ends must
// still be drawn -- walking the segments and deduping as it goes would drop the
// second one entirely.
const wrapped = linesOf(render([
  { id: 'c', name: 'wrapped', type: 'CDS', strand: 1, segments: [{ start: 200, end: 240 }, { start: 0, end: 30 }] }
]));
assert.deepEqual(wrapped.map((line) => line.includes('wrapped')), [true, false, false, true]);

// A feature is listed once per line however many of its segments land there, so
// two segments sharing a line do not draw the feature's bar twice.
const sameLine = render([
  { id: 'd', name: 'twoparts', type: 'CDS', strand: 1, segments: [{ start: 5, end: 15 }, { start: 25, end: 35 }] }
]);
assert.equal(nameCount(sameLine, 'twoparts'), 2, 'one label per segment, not per segment per pass');

// Restriction sites ride their own track and are bucketed the same way.
const cutters = linesOf(render([
  { id: 'e', name: 'EcoRI', type: 'restriction_site', strand: 1, site: 'GAATTC', segments: [{ start: 130, end: 136 }] }
]));
assert.deepEqual(cutters.map((line) => line.includes('EcoRI')), [false, false, true, false]);

// Segments outside the sequence, or empty ones, are ignored rather than throwing.
assert.doesNotThrow(() => render([
  { id: 'f', name: 'empty', type: 'CDS', strand: 1, segments: [{ start: 40, end: 40 }] },
  { id: 'g', name: 'past', type: 'CDS', strand: 1, segments: [{ start: 900, end: 1000 }] },
  { id: 'h', name: 'nosegs', type: 'CDS', strand: 1 }
]));

// Off-screen lines are skipped by content-visibility, so every line has to
// declare the height it would have taken. Get that wrong and the scrollbar is a
// guess that shifts under the reader as they scroll.
const declaredHeights = (features) => (render(features)
  .match(/contain-intrinsic-size:auto ([\d.]+)px/g) || [])
  .map((match) => Number(match.match(/([\d.]+)px/)[1]));

// Two strand rows and the gap between them.
const BARE = (18 * 2) + 2;
const FEATURE_BAR = 16;
const PRIMER_BAR = 42;
const BLOCK_GAP = 6;
const PAIR_GAP = 2;

assert.deepEqual(declaredHeights([]), Array(4).fill(BARE), 'every line declares a height');

// A feature track is a sibling of the strand pair, so it brings a block gap.
assert.equal(
  declaredHeights([{ id: 'a', name: 'x', type: 'CDS', strand: 1, segments: [{ start: 0, end: 60 }] }])[0],
  BARE + FEATURE_BAR + BLOCK_GAP
);

// So is the forward primer track.
assert.equal(
  declaredHeights([{ id: 'b', name: 'p', type: 'primer_bind', strand: 1, segments: [{ start: 0, end: 24 }] }])[0],
  BARE + PRIMER_BAR + BLOCK_GAP
);

// The reverse primer track is a row inside the strand pair, gapped differently.
assert.equal(
  declaredHeights([{ id: 'c', name: 'p', type: 'primer_bind', strand: -1, segments: [{ start: 0, end: 24 }] }])[0],
  BARE + PRIMER_BAR + PAIR_GAP
);

// All three together, each gapped by its own rule.
assert.equal(
  declaredHeights([
    { id: 'a', name: 'x', type: 'CDS', strand: 1, segments: [{ start: 0, end: 60 }] },
    { id: 'b', name: 'p', type: 'primer_bind', strand: 1, segments: [{ start: 0, end: 24 }] },
    { id: 'c', name: 'q', type: 'primer_bind', strand: -1, segments: [{ start: 30, end: 54 }] }
  ])[0],
  BARE + FEATURE_BAR + PRIMER_BAR + PRIMER_BAR + PAIR_GAP + (2 * BLOCK_GAP)
);

// A line with nothing on it must not be padded for tracks it does not have.
assert.equal(
  declaredHeights([{ id: 'a', name: 'x', type: 'CDS', strand: 1, segments: [{ start: 0, end: 60 }] }])[1],
  BARE
);

console.log('sequence-line-render-selfcheck: ok');
