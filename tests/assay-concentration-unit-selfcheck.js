#!/usr/bin/env node
// Self-check: concentration axis unit + serial-dilution unit conversion.
// Run: node tests/assay-concentration-unit-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const conc = loadEsmStyleModule(path.join(root, 'src/renderer/modules/assay/concentration-utils.js'));
const dilution = loadEsmStyleModule(path.join(root, 'src/renderer/modules/assay/serial-dilution-model.js'));

const {
  parseConcentrationMagnitude, formatConcentrationLabel, hasExplicitUnit,
  buildDilutionSeries, buildInterpolatedSeries, isKnownUnit, splitConcentrationValue
} = conc;

// --- default unit fallback for bare numbers; inline unit always wins ---
assert.equal(parseConcentrationMagnitude('100'), 100, 'bare number = Molar when no axis unit');
assert.ok(Math.abs(parseConcentrationMagnitude('100', 'nM') - 1e-7) < 1e-18, 'bare number takes axis unit');
assert.ok(Math.abs(parseConcentrationMagnitude('1 mM', 'nM') - 1e-3) < 1e-15, 'inline unit overrides axis unit');
assert.equal(parseConcentrationMagnitude('1e3', 'nM'), 1e3 * 1e-9, 'scientific notation not mistaken for a unit');

// --- a present-but-unknown unit is rejected, not silently treated as base units ---
assert.equal(parseConcentrationMagnitude('10 millimolar', 'nM'), null, 'spelled-out unit rejected (no silent base-unit fallback)');
assert.equal(parseConcentrationMagnitude('5 nMM'), null, 'typo unit rejected');
assert.equal(parseConcentrationMagnitude('100 xyz'), null, 'gibberish unit rejected');

// --- display labels ---
assert.equal(formatConcentrationLabel('100', 'nM'), '100 nM', 'appends axis unit to bare number');
assert.equal(formatConcentrationLabel('1 µM', 'nM'), '1 µM', 'keeps an explicit unit as-is');
assert.equal(hasExplicitUnit('1e3'), false, 'exponent is not a unit');
assert.equal(hasExplicitUnit('5 pM'), true, 'pM detected as a unit');

// --- in-cell unit recognition (drives adopting a typed unit as the axis unit) ---
assert.equal(splitConcentrationValue('100 nM').unit, 'nM', 'unit text preserved with case');
assert.equal(isKnownUnit('nM'), true, 'nM is recognized');
assert.equal(isKnownUnit('µM'), true, 'µM is recognized');
assert.equal(isKnownUnit('n'), false, 'partial "100 n" typing is not recognized yet');
assert.equal(isKnownUnit('abc'), false, 'gibberish unit is not recognized');
assert.equal(isKnownUnit(''), false, 'bare number has no unit to recognize');

// --- dilution-factor auto-fill series (keeps the start cell's unit) ---
assert.equal(
  JSON.stringify(buildDilutionSeries('1000 nM', 10, 4)),
  JSON.stringify(['1000 nM', '100 nM', '10 nM', '1 nM']),
  '10x series keeps unit'
);
assert.equal(
  JSON.stringify(buildDilutionSeries('300', 3, 3)),
  JSON.stringify(['300', '100', '33.33']),
  'bare 3x series, compact rounding'
);
assert.equal(buildDilutionSeries('', 10, 4), null, 'no start value -> null');
assert.equal(buildDilutionSeries('100 nM', 0, 4), null, 'non-positive factor -> null');

// --- start/end interpolation, linear vs log ---
assert.equal(
  JSON.stringify(buildInterpolatedSeries({ startValue: '0', endValue: '100', count: 5, mode: 'linear' })),
  JSON.stringify(['0', '25', '50', '75', '100']),
  'linear range is evenly spaced (0 allowed)'
);
assert.equal(
  JSON.stringify(buildInterpolatedSeries({ startValue: '1000', endValue: '10', count: 3, mode: 'log', axisUnit: 'nM' })),
  JSON.stringify(['1000 nM', '100 nM', '10 nM']),
  'log range is geometric and inherits the axis unit'
);
assert.equal(
  buildInterpolatedSeries({ startValue: '1000', endValue: '0', count: 4, mode: 'log' }),
  null,
  'log range cannot include 0'
);
// mixed end units convert through magnitude; output is uniform in the start unit
// (10 nM = 0.01 µM), midpoint 0.1 µM = 100 nM.
assert.equal(
  JSON.stringify(buildInterpolatedSeries({ startValue: '1 µM', endValue: '10 nM', count: 3, mode: 'log' })),
  JSON.stringify(['1 µM', '0.1 µM', '0.01 µM']),
  'log range across mixed units converts and uses one display unit'
);

// --- serial dilution converts a mixed stock unit against unit-less axis values ---
const layout = [
  { well: 'A1', sampleId: 'S1', concentration: '1000' },
  { well: 'A2', sampleId: 'S1', concentration: '100' },
  { well: 'A3', sampleId: 'S1', concentration: '10' }
];
const groups = dilution.buildSerialDilutionGroups({
  layout,
  sampleAxis: 'row',
  concentrationUnit: 'nM',
  findInventorySampleRecordBySampleId: () => null
});
assert.equal(groups.length, 1, 'one sample group');
// JSON-compare: loadEsmStyleModule runs the module in a vm realm, so its arrays
// fail assert/strict's cross-realm deepEqual even when contents match.
assert.equal(
  JSON.stringify(groups[0].entries.map((e) => e.concentrationDisplay)),
  JSON.stringify(['1000 nM', '100 nM', '10 nM']),
  'entry display labels carry the axis unit'
);

const plan = dilution.calculateSerialDilutionPlan({
  group: groups[0],
  volumePerWellUl: 100,
  stockConcentrationText: '10 µM', // 10 µM = 1e-5 M > 1000 nM = 1e-6 M
  concentrationUnit: 'nM'
});
assert.equal(plan.error, '', `plan should compute (got: ${plan.error})`);
assert.equal(plan.rows.length, 3, 'three dilution rows');
assert.ok(plan.rows[0].inputVolume > 0, 'stock transfer volume computed');

// Same numbers but a too-low stock unit must be rejected (proves unit is honoured).
const badPlan = dilution.calculateSerialDilutionPlan({
  group: groups[0],
  volumePerWellUl: 100,
  stockConcentrationText: '100 nM', // below the 1000 nM first target
  concentrationUnit: 'nM'
});
assert.notEqual(badPlan.error, '', 'stock below first target is rejected');

// An unknown stock unit must be rejected, not silently scaled to base molar
// (which would pass the >0 guard and emit a wrong-by-orders-of-magnitude recipe).
const unknownUnitPlan = dilution.calculateSerialDilutionPlan({
  group: groups[0],
  volumePerWellUl: 100,
  stockConcentrationText: '10 millimolar',
  concentrationUnit: 'nM'
});
assert.notEqual(unknownUnitPlan.error, '', 'unknown stock unit is rejected, not silently treated as base molar');

console.log('assay concentration-unit self-check passed');
