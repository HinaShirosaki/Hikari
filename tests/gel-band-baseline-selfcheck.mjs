import assert from 'node:assert/strict';
import { analyzeGelImage } from '../src/plugins/gel/workspace/analysis/analysis-core.js';
import { computeCellIntensity, estimateBandBaselineFromFlanks } from '../src/plugins/gel/workspace/analysis/lane-signal.js';
import { applyNormalization } from '../src/plugins/gel/workspace/analysis/calibration.js';
import { createBandsCsv } from '../src/plugins/gel/workspace/export.js';

const width = 40, height = 200, top = 100, bottom = 109;
const lane = { xStart: 0, xEnd: 39 };
function measure({ dense = null, bright = true, baselines = [], slope = 0, signalValue = .02 } = {}) {
  const signal = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    signal[y * width + x] = .1 + slope * y + (y >= top && y <= bottom ? signalValue : 0);
    if (dense && y >= dense[0] && y <= dense[1]) signal[y * width + x] += .65;
  }
  const gray = bright ? signal : Float32Array.from(signal, value => 1 - value);
  const result = analyzeGelImage({ gray, width, height, imageName: 'baseline-test',
    preprocessed: { cleanNormalized: gray, preprocessing: { backend: 'fixture' } },
    params: { analysisType: 'western', ladderLane: 1, ladderStandards: [], normalization: 'none', enhancement: {},
      manualOverrides: { laneSegmentation: { gelLeft: 0, gelRight: 39, dividerDone: true, bandTop: top, bandBottom: bottom }, peakIntegrations: baselines } }
  });
  return result.report;
}
const close = (actual, expected, epsilon = .002) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should equal ${expected}`);
for (const bright of [true, false]) {
  const alone = measure({ bright }).lanes[0].targetBand;
  for (const dense of [[20, 29], [87, 96], [113, 122]]) {
    const target = measure({ bright, dense }).lanes[0].targetBand;
    close(target.correctedIntensity, alone.correctedIntensity);
    assert.equal(target.intensityStatus, 'ok');
    assert.ok(target.correctedIntensity > 0, 'An unchanged faint band survives a dense neighboring band');
  }
}
close(measure({ slope: .001 }).lanes[0].targetBand.correctedIntensity, measure().lanes[0].targetBand.correctedIntensity);
assert.equal(measure({ signalValue: 0 }).lanes[0].targetBand.correctedIntensity, 0, 'A flat blank remains zero');

const manual = [{ laneIndex: 1, left: { row: 99, value: 999 }, right: { row: 110, value: 999 }, dividers: [] }];
const manualReport = measure({ dense: [87, 96], baselines: manual });
assert.equal(manualReport.lanes[0].targetBand.baselineMode, 'manual-peak');
close(manualReport.lanes[0].targetBand.correctedIntensity, measure().lanes[0].targetBand.correctedIntensity);
assert.ok(manualReport.lanes[0].targetBand.baselineAnchors.every(point => point.value < 1), 'Stored plot values are never trusted instead of current source pixels');
for (const baselines of [[{ ...manual[0], laneIndex: 2 }], [{ ...manual[0], right: null }], [{ ...manual[0], right: { row: 105 } }]]) {
  assert.equal(measure({ baselines }).lanes[0].targetBand.baselineMode, 'local-edge', 'Unrelated, unfinished or too-short baselines cannot override the selected band');
}
const elevatedManual = measure({ dense: [87, 96], baselines: [{ laneIndex: 1, left: { row: 87 }, right: { row: 120 } }] });
assert.equal(elevatedManual.lanes[0].targetBand.baselineMode, 'manual-peak');
assert.ok(elevatedManual.lanes[0].targetBand.correctedIntensity < 0, 'A user baseline changes the quantitative value even when it gives a negative net');
assert.equal(elevatedManual.lanes[0].targetBand.intensityStatus, 'negative-net');
const nested = [...manual, { laneIndex: 1, left: { row: 98 }, right: { row: 111 }, dividers: [] }];
assert.deepEqual(measure({ baselines: nested }).lanes[0].targetBand.baselineAnchors.map(point => point.row), [99, 110], 'The most specific spanning baseline wins');

const negative = measure({ signalValue: -.02 });
assert.ok(negative.lanes[0].targetBand.correctedIntensity < 0, 'Negative net signal is not clamped to zero');
assert.equal(negative.lanes[0].targetBand.intensityStatus, 'negative-net');
assert.match(negative.warnings.join(' '), /Review the band background/);
assert.match(createBandsCsv(negative), /local-edge,negative-net/);
assert.match(createBandsCsv(manualReport), /manual-peak,ok/);
const normalization = [{ bands: [{ rawIntensity: 10, intensityStatus: 'ok' }, { rawIntensity: -5, intensityStatus: 'negative-net' }] }];
applyNormalization(normalization, 'total-lane');
assert.equal(normalization[0].bands[0].normalizedIntensity, 1);
assert.equal(normalization[0].bands[1].normalizedIntensity, null);

const all = new Float32Array(width * 5).fill(.1);
const missing = computeCellIntensity({ signal: all, rawGray: all, width, height: 5, lane, bandTop: 0, bandBottom: 4 });
assert.equal(missing.correctedIntensity, null, 'A selection with no surrounding background is not assigned a quantitative zero');
assert.equal(missing.intensityStatus, 'unavailable');
const oneSide = computeCellIntensity({ signal: all, rawGray: all, width, height: 5, lane, bandTop: 0, bandBottom: 1 });
assert.equal(oneSide.intensityStatus, 'one-sided');

// Independent analytic integral on a broad sloping baseline with two peaks.
const profile = Float32Array.from({ length: 180 }, (_, y) => .1 + y * .0004
  + .02 * Math.exp(-((y - 100) ** 2) / 18) + .65 * Math.exp(-((y - 65) ** 2) / 72));
const baseline = estimateBandBaselineFromFlanks({ rowMeans: profile, top: 91, bottom: 109 });
const net = Array.from(profile.slice(91, 110)).reduce((sum, value, index) => sum + value - baseline.values[index], 0);
assert.ok(net > .08, 'A faint peak beside a broad strong peak retains an integrated signal');

// A flat noisy background is not forced nonnegative; the signed results retain
// both signs, rather than rectifying every blank into a positive measurement.
let seed = 179;
const blanks = Array.from({ length: 200 }, () => {
  const signal = Float32Array.from({ length: width * height }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return .1 + (seed / 2 ** 32 - .5) * .006;
  });
  return computeCellIntensity({ signal, rawGray: signal, width, height, lane, bandTop: top, bandBottom: bottom }).correctedIntensity;
});
assert.ok(blanks.some(value => value < 0) && blanks.some(value => value > 0));
assert.ok(Math.abs(blanks.reduce((sum, value) => sum + value, 0) / blanks.length) < .03, 'Blank noise has no material positive offset');

// SNR uses the lane's row noise, so a blank window is never called a band. A
// 5-row window (a clicked band with no target window) once gave noiseStd 0.
for (const [bandTop, bandBottom] of [[100, 104], [top, bottom]]) {
  for (let trial = 0; trial < 100; trial++) {
    const signal = Float32Array.from({ length: width * height }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return .1 + (seed / 2 ** 32 - .5) * .006;
    });
    const blank = computeCellIntensity({ signal, rawGray: signal, width, height, lane, bandTop, bandBottom });
    assert.ok(blank.backgroundStd > 0 && Math.abs(blank.snr) < 3, `Blank ${bandBottom - bandTop + 1}-row window has SNR ${blank.snr}`);
  }
}
assert.ok(measure().lanes[0].targetBand.snr >= 3, 'A real band still clears the SNR threshold');

// The slope kernel moves a ±1σ window out to the band edges; the drawn window
// alone kept 34% of a faint (≈7× row noise) and 71% of a bright σ=6 band.
for (const [amplitude, minimum] of [[.002, .6], [.2, .95]]) {
  let total = 0;
  for (let trial = 0; trial < 20; trial++) {
    const signal = Float32Array.from({ length: width * height }, (_, index) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return .1 + amplitude * Math.exp(-((Math.floor(index / width) - 100) ** 2) / 72) + (seed / 2 ** 32 - .5) * .006;
    });
    const band = computeCellIntensity({ signal, rawGray: signal, width, height, lane, bandTop: 94, bandBottom: 106 });
    total += band.correctedIntensity / (amplitude * 6 * Math.sqrt(2 * Math.PI) * width);
  }
  assert.ok(total / 20 > minimum, `A ±1σ window measures ${total / 20} of a ${amplitude} band`);
}
// The drawn edge box: the kernel's steepest rise and fall hug the band on both
// axes; a band that fills its lane keeps the lane sides. A loose window once
// set a kernel as wide as the lane, so every real-gel box spanned its lane.
const edgesOf = ([first, last], pad = 2) => {
  const signal = new Float32Array(width * height).fill(.1);
  for (let y = top; y <= bottom; y++) for (let x = first; x <= last; x++) signal[y * width + x] += .3;
  return computeCellIntensity({ signal, rawGray: signal, width, height, lane, bandTop: top - pad, bandBottom: bottom + pad }).edges;
};
const fullWidth = edgesOf([0, 39]);
assert.deepEqual([fullWidth.top, fullWidth.bottom, fullWidth.left, fullWidth.right], [top, bottom, 0, 1]);
for (const pad of [2, 15]) {
  const narrowBand = edgesOf([10, 29], pad);
  assert.deepEqual([narrowBand.top, narrowBand.bottom, narrowBand.left * 39, narrowBand.right * 39], [top, bottom, 10, 29], `window padded ${pad}`);
}
console.log('gel-band-baseline-selfcheck: passed (dense neighbors, both polarities, slope, manual overrides, signed negatives, missing background, normalization, CSV, broad tails and noisy blanks, blank-window SNR, band edges, edge box)');
