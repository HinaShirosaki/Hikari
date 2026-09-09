// The base-to-column mapping is the whole feature: get it wrong and every
// letter in the primer sits over the wrong template base.
import assert from 'node:assert/strict';
import {
  OLIGO_PRIMER_STYLE,
  buildPrimerColumns,
  buildOligoPrimerHtml,
  withOligoPrimerGeometry
} from '../src/renderer/modules/sequence-viewer/primer-oligo.js';

assert.equal(OLIGO_PRIMER_STYLE === 0 || OLIGO_PRIMER_STYLE === 1, true);

//                0         1         2
//                0123456789012345678901234567
const TEMPLATE = 'GGTGGTGGACAAGAGCGACGAACCGCTG';

// Forward primer with an internal mismatch: AGC at 13-15 is ordered as TCT.
const forwardFeature = {
  primerSequence: 'GGTGGTGGACAAGTCTGACGAACCGCTG',
  segments: [{ start: 0, end: 28 }]
};
const forwardColumns = buildPrimerColumns({
  feature: forwardFeature,
  segment: forwardFeature.segments[0],
  direction: 1,
  templateSequence: TEMPLATE
});
assert.equal(forwardColumns.length, 28);
assert.equal(forwardColumns[0].column, 0);
assert.deepEqual(
  forwardColumns.filter((entry) => !entry.annealed).map((entry) => entry.column),
  [13, 14, 15]
);
assert.deepEqual(
  forwardColumns.slice(13, 16).map((entry) => entry.base),
  ['T', 'C', 'T']
);

// A 5' tail has no template to pair with, so it hangs off the 5' side unannealed.
const tailedFeature = {
  primerSequence: 'AAGCTTGGACAAGAGC',
  segments: [{ start: 7, end: 16 }]
};
const tailedColumns = buildPrimerColumns({
  feature: tailedFeature,
  segment: tailedFeature.segments[0],
  direction: 1,
  templateSequence: TEMPLATE
});
assert.equal(tailedColumns.length, 16);
assert.equal(tailedColumns[0].column, 0, 'the 7 nt tail starts seven columns left of the binding site');
assert.deepEqual(tailedColumns.slice(0, 7).map((entry) => entry.annealed), Array(7).fill(false));
assert.deepEqual(tailedColumns.slice(7).map((entry) => entry.annealed), Array(9).fill(true));

// A reverse primer reads along the bottom strand, so it is shown reversed and
// its tail hangs off the right end instead.
const reverseFeature = {
  // revcomp(GGTGGTGGA) with a 4 nt 5' tail in front of it.
  primerSequence: 'GGGGTCCACCACC',
  segments: [{ start: 0, end: 9 }]
};
const reverseColumns = buildPrimerColumns({
  feature: reverseFeature,
  segment: reverseFeature.segments[0],
  direction: -1,
  templateSequence: TEMPLATE
});
assert.equal(reverseColumns.length, 13);
assert.equal(reverseColumns[0].column, 0);
assert.equal(reverseColumns.map((entry) => entry.base).join('').slice(0, 9), 'CCACCACCT');
assert.deepEqual(reverseColumns.slice(0, 9).map((entry) => entry.annealed), Array(9).fill(true));
assert.deepEqual(reverseColumns.slice(9).map((entry) => entry.annealed), Array(4).fill(false));

// An imported primer_bind (a GenBank one, say) stores no oligo at all. Reading
// its footprint straight off the template would draw the template's own bases,
// which on the minus strand is the reverse of the strand the primer anneals to
// -- every third base pairing by luck and the rest bulging out. The real oligo
// is the reverse complement, and it anneals over its whole footprint.
const importedReverse = { name: 'imported_R', strand: -1, segments: [{ start: 4, end: 22 }] };
const importedColumns = buildPrimerColumns({
  feature: importedReverse,
  segment: importedReverse.segments[0],
  direction: -1,
  templateSequence: TEMPLATE
});
assert.equal(importedColumns.length, 18);
assert.deepEqual(importedColumns.map((entry) => entry.annealed), Array(18).fill(true));
assert.equal(
  importedColumns.map((entry) => entry.base).join(''),
  'CACCTGTTCTCGCTGCTT',
  'a reverse primer reads the bottom strand left to right, not the top strand backwards'
);

const importedForward = { name: 'imported_F', strand: 1, segments: [{ start: 4, end: 22 }] };
assert.deepEqual(
  buildPrimerColumns({
    feature: importedForward,
    segment: importedForward.segments[0],
    direction: 1,
    templateSequence: TEMPLATE
  }).map((entry) => entry.annealed),
  Array(18).fill(true)
);

// Geometry widens the fragment to cover the tail so lane packing still works.
const baseFragment = {
  feature: tailedFeature,
  index: 3,
  isPrimer: true,
  direction: 1,
  color: '#123456',
  title: 'primer (1..16)',
  leftPx: 70,
  widthPx: 90,
  rightPx: 160
};
const placed = withOligoPrimerGeometry(baseFragment, {
  segment: tailedFeature.segments[0],
  lineStart: 0,
  lineEnd: 60,
  templateSequence: TEMPLATE,
  charAdvancePx: 10
});
assert.equal(placed.leftPx, 0);
assert.equal(placed.widthPx, 160);
assert.equal(placed.oligo.hasThreePrime, true);

// Clipping at a line wrap keeps only the visible columns and drops the arrow
// when the 3' end is on the next line.
const clipped = withOligoPrimerGeometry(baseFragment, {
  segment: tailedFeature.segments[0],
  lineStart: 0,
  lineEnd: 10,
  templateSequence: TEMPLATE,
  charAdvancePx: 10
});
assert.equal(clipped.oligo.columns.length, 10);
assert.equal(clipped.oligo.hasThreePrime, false);

// An origin-wrapped primer is left to the original renderer untouched.
const wrapped = withOligoPrimerGeometry(
  { ...baseFragment, feature: { ...tailedFeature, segments: [{ start: 20, end: 28 }, { start: 0, end: 4 }] } },
  { segment: { start: 20, end: 28 }, lineStart: 0, lineEnd: 60, templateSequence: TEMPLATE, charAdvancePx: 10 }
);
assert.equal(wrapped.oligo, undefined);

// The drawn outline steps out of the duplex exactly over the mismatch run.
const html = buildOligoPrimerHtml(
  withOligoPrimerGeometry(
    { ...baseFragment, feature: forwardFeature },
    {
      segment: forwardFeature.segments[0],
      lineStart: 0,
      lineEnd: 60,
      templateSequence: TEMPLATE,
      charAdvancePx: 10
    }
  ),
  { topPx: 0, isActive: false, label: 'ISG15 S89C F' }
);
assert.match(html, /data-feature-index="3"/);
assert.match(html, /<polygon class="sequence-viewer-primer-outline"/);
assert.equal((html.match(/sequence-viewer-primer-nt-unannealed/g) || []).length, 3);
assert.equal((html.match(/<text class="sequence-viewer-primer-nt/g) || []).length, 28);
assert.match(html, /ISG15 S89C F/);

// The outline is one closed polygon: it runs left to right along the top edge,
// turns at the 3' arrow, and comes back right to left. Any wobble in that order
// means the shape crosses itself.
const outlineXs = html
  .match(/<polygon class="sequence-viewer-primer-outline" points="([^"]+)"/)[1]
  .split(' ')
  .map((point) => Number(point.split(',')[0]));
const turn = outlineXs.indexOf(Math.max(...outlineXs));
assert.equal(outlineXs.slice(0, turn + 1).every((x, i, list) => i === 0 || x >= list[i - 1]), true);
assert.equal(outlineXs.slice(turn).every((x, i, list) => i === 0 || x <= list[i - 1]), true);

// The primer's name sits in a row of its own above the outline, so it must be
// free to overflow the primer's width: designed names run longer than the 18-26
// nt they annotate, and gating the label on width dropped them entirely while
// the hover readout still showed them.
function primerHtml({ name, segment, direction, lineStart = 0, lineEnd = 60, lineWidthPx = 620 }) {
  const feature = { name, segments: [segment] };
  const fragment = withOligoPrimerGeometry(
    { feature, index: 0, isPrimer: true, direction, color: '#123456', title: name, leftPx: 0, widthPx: 0, rightPx: 0 },
    { segment, lineStart, lineEnd, templateSequence: 'ACGT'.repeat(45), charAdvancePx: 10 }
  );
  return buildOligoPrimerHtml(fragment, { topPx: 0, isActive: false, label: name, lineWidthPx });
}

const LONG_NAME = 'pYDL Q35A C1306G F';

// A primer narrower than its own name still gets the name.
assert.match(primerHtml({ name: LONG_NAME, segment: { start: 20, end: 30 }, direction: 1 }), /primer-svg-label/);
assert.match(primerHtml({ name: LONG_NAME, segment: { start: 20, end: 38 }, direction: 1 }), /primer-svg-label/);

// Only the fragment carrying the 3' end is named, so a wrapped primer is not
// labelled twice.
const wrappedFirstLine = primerHtml({ name: LONG_NAME, segment: { start: 50, end: 74 }, direction: 1, lineStart: 0, lineEnd: 60 });
const wrappedSecondLine = primerHtml({ name: LONG_NAME, segment: { start: 50, end: 74 }, direction: 1, lineStart: 60, lineEnd: 120 });
assert.doesNotMatch(wrappedFirstLine, /primer-svg-label/, "the forward 5' fragment carries no name");
assert.match(wrappedSecondLine, /primer-svg-label/);

// The name hangs off the 3' end, and only swaps ends to stay inside the line.
const anchorOf = (html) => html.match(/primer-svg-label[^>]*text-anchor="(\w+)"/)[1];
assert.equal(anchorOf(primerHtml({ name: LONG_NAME, segment: { start: 20, end: 44 }, direction: 1 })), 'end');
assert.equal(anchorOf(primerHtml({ name: LONG_NAME, segment: { start: 20, end: 44 }, direction: -1 })), 'start');
// A forward 3' end too close to the line start would push the name off the left.
assert.equal(anchorOf(primerHtml({ name: LONG_NAME, segment: { start: 0, end: 8 }, direction: 1 })), 'start');
// A reverse 3' end too close to the line end would push it off the right.
assert.equal(anchorOf(primerHtml({ name: LONG_NAME, segment: { start: 52, end: 60 }, direction: -1 })), 'end');

// No name, no label element.
assert.doesNotMatch(primerHtml({ name: '', segment: { start: 20, end: 44 }, direction: 1 }), /primer-svg-label/);

console.log('primer-oligo-selfcheck: ok');
