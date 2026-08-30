// pETDuet's second T7 promoter is annotated join(5701..5717,1..2): it crosses
// the origin, so a min/max midpoint anchors its label at the antipode while the
// arc sits at 12 o'clock. Pins the circular-mean anchor.
import assert from 'node:assert/strict';
import { featureLabelBase } from '../src/renderer/modules/sequence-viewer/vector-builder/sequence-map/geometry.js';
import { buildLinearMapSvg } from '../src/renderer/modules/sequence-viewer/vector-builder/sequence-map/linear-map.js';
import { LINEAR_TRACK_X0, LINEAR_TRACK_X1 } from '../src/renderer/modules/sequence-viewer/vector-builder/sequence-map/map-constants.js';

const LENGTH = 5717;

// Wraps the origin: mid base is ~5709.5, i.e. just before 5717/0.
const wrapped = featureLabelBase({ segments: [{ start: 5700, end: 5717 }, { start: 0, end: 2 }] }, LENGTH);
assert.ok(wrapped > LENGTH - 20 || wrapped < 20, `origin-crossing label anchored at ${wrapped}`);

// Plain feature keeps the ordinary midpoint.
assert.ok(Math.abs(featureLabelBase({ segments: [{ start: 213, end: 232 }] }, LENGTH) - 222.5) < 0.5);
assert.ok(Math.abs(featureLabelBase({ segments: [{ start: 2000, end: 3000 }] }, LENGTH) - 2500) < 0.5);

assert.equal(featureLabelBase({ segments: [] }, LENGTH), null);

// The linear map has no leader lines, so the same feature's name has to sit over
// one of its two bands rather than in the empty middle of the track.
const svg = buildLinearMapSvg(
  { name: 'pETDuet', sequence: 'a'.repeat(LENGTH), topology: 'circular' },
  {
    features: [{
      name: 'T7 promoter',
      type: 'promoter',
      strand: 1,
      segments: [{ start: 5700, end: 5717 }, { start: 0, end: 2 }]
    }]
  }
);
const labelX = Number(svg.match(/class="vector-map__label-text"[^]*?\n\s+x="(-?[\d.]+)"/)[1]);
assert.ok(labelX > LINEAR_TRACK_X1 - 20, `origin-crossing label placed at x=${labelX}`);
assert.ok(labelX <= LINEAR_TRACK_X1 && labelX >= LINEAR_TRACK_X0);

console.log('map label anchor self-check passed');
