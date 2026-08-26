#!/usr/bin/env node
// Self-check for the Assay analysis spec: grouping, legacy migration, and the shared
// curve runner. No DOM / Plotly needed.
// Run: node tests/assay-analysis-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const {
  analyzeAssayData,
  describeAnalysisSpec,
  normalizeAnalysisSpec,
  specFromLegacyMethod
} = loadEsmStyleModule(path.join(root, 'src/renderer/modules/assay/analysis/index.js'));

const ROWS = ['A', 'B', 'C', 'D'];

// Mirrors the observation shape collectNumericObservations builds from the plate.
function obs(rowLabel, columnNumber, sampleId, concentration, response) {
  const rowIndex = ROWS.indexOf(rowLabel);
  return {
    well: `${rowLabel}${columnNumber}`,
    response,
    rowIndex,
    rowLabel,
    columnIndex: columnNumber - 1,
    columnNumber,
    rawSampleId: sampleId,
    sampleId: sampleId || '(unmapped)',
    sampleValue: Number.parseFloat(sampleId),
    rawConcentration: String(concentration),
    concentrationLabel: String(concentration),
    concentrationValue: Number.parseFloat(concentration)
  };
}

// --- legacy method strings all migrate onto the spec ---
const LEGACY = [
  'grouped_summary', 'nested_summary', 'row_summary', 'column_summary',
  'linear_regression', 'ec50', 'ic50', 'survival',
  'standard_curve_line', 'standard_curve_semilog_line',
  'standard_curve_4pl_log_concentration', 'standard_curve_4pl_concentration',
  'standard_curve_5pl_log_concentration', 'standard_curve_5pl_concentration',
  'standard_curve_hyperbola', 'standard_curve_quadratic',
  'standard_curve_cubic', 'standard_curve_pade_11'
];
LEGACY.forEach((method) => {
  const spec = specFromLegacyMethod(method);
  assert.ok(spec.analysis, `${method} migrates to an analysis`);
});
assert.equal(specFromLegacyMethod('ec50').analysis, 'sigmoidal', 'ec50 -> sigmoidal');
assert.equal(specFromLegacyMethod('ec50').xTransform, 'log10', 'ec50 keeps its log dose axis');
assert.equal(
  JSON.stringify(specFromLegacyMethod('ec50')),
  JSON.stringify(specFromLegacyMethod('ic50')),
  'ec50 and ic50 were always the same fit'
);
assert.equal(specFromLegacyMethod('standard_curve_cubic').polyOrder, 3, 'cubic -> polynomial order 3');
assert.equal(specFromLegacyMethod('standard_curve_5pl_concentration').asymmetric, true, '5PL -> asymmetric');
assert.equal(specFromLegacyMethod('nested_summary').subtotals, true, 'nested summary -> subtotal rows');
assert.equal(specFromLegacyMethod('row_summary').groupBy, 'row', 'row summary -> groupBy row');
assert.equal(normalizeAnalysisSpec({ analysis: 'bogus' }).analysis, 'summary', 'unknown analysis falls back');
assert.equal(normalizeAnalysisSpec({ polyOrder: 9 }).polyOrder, 2, 'polyOrder clamps out of range');
assert.ok(describeAnalysisSpec({ analysis: 'sigmoidal', asymmetric: true }).includes('5PL'), 'spec describes itself');

// --- summary: two grouping keys become two leading columns, plus SD error bars ---
const twoFactor = [
  obs('A', 1, 'S1', '10', 100), obs('A', 2, 'S1', '10', 110),
  obs('B', 1, 'S1', '20', 60), obs('B', 2, 'S1', '20', 64),
  obs('C', 1, 'S2', '10', 200), obs('C', 2, 'S2', '10', 190),
  obs('D', 1, 'S2', '20', 90), obs('D', 2, 'S2', '20', 96)
];

const summary = analyzeAssayData({
  spec: { analysis: 'summary', groupBy: 'sample_concentration' },
  observations: twoFactor
});
assert.equal(
  summary.headers.join('|'),
  'Sample ID|Concentration|N|Mean|SD|Min|Max',
  'both grouping keys lead the summary table'
);
assert.equal(summary.rows.length, 4, 'four sample/concentration groups');
assert.equal(summary.chartModel.chartType, 'bar', 'summary charts as bars');
assert.equal(summary.chartModel.series.length, 2, 'first key becomes the series');
assert.ok(
  summary.chartModel.series[0].data.every((point) => Number.isFinite(point.yVariance)),
  'SD error bars reach the chart model for a grouped summary (not just row/column)'
);
assert.equal(
  analyzeAssayData({
    spec: { analysis: 'summary', groupBy: 'sample_concentration', errorBars: false },
    observations: twoFactor
  }).chartModel.series[0].data.some((point) => 'yVariance' in point),
  false,
  'error bars can be turned off'
);

// subtotals add one extra row per leading key
const nested = analyzeAssayData({
  spec: { analysis: 'summary', groupBy: 'sample_concentration', subtotals: true },
  observations: twoFactor
});
assert.equal(nested.rows.length, 6, 'two subtotal rows added');
assert.equal(nested.rows[0][1], 'All', 'subtotal row marks the pooled level');

// plate-position grouping shares the same code path
const byRow = analyzeAssayData({ spec: { analysis: 'summary', groupBy: 'row' }, observations: twoFactor });
assert.equal(byRow.headers[0], 'Row', 'row grouping leads with Row');
assert.equal(byRow.rows.length, 4, 'one row per plate row');

// --- the X-axis factor is dropped from the grouping, so series stay multi-point ---
const doseCurve = [];
[0.1, 1, 10, 100, 1000].forEach((conc, index) => {
  const decreasing = [100, 96, 50, 12, 6][index];
  const increasing = [5, 12, 48, 92, 99][index];
  doseCurve.push(obs('A', index + 1, 'S1', String(conc), decreasing));
  doseCurve.push(obs('B', index + 1, 'S1', String(conc), decreasing + 2));
  doseCurve.push(obs('C', index + 1, 'S2', String(conc), increasing));
  doseCurve.push(obs('D', index + 1, 'S2', String(conc), increasing + 2));
});

const sigmoid = analyzeAssayData({
  spec: {
    analysis: 'sigmoidal',
    groupBy: 'sample_concentration',
    xAxis: 'concentration',
    xTransform: 'log10'
  },
  observations: doseCurve
});
assert.equal(sigmoid.rows.length, 2, 'concentration is the X axis, so only sample survives as a series');
assert.equal(sigmoid.headers[0], 'Sample ID', 'series header drops the concentration key');
const potencyIndex = sigmoid.headers.indexOf('Potency');
assert.ok(potencyIndex > 0, 'sigmoidal reports a potency column');
assert.equal(sigmoid.rows[0][potencyIndex], 'IC50', 'a falling curve is an IC50');
assert.equal(sigmoid.rows[1][potencyIndex], 'EC50', 'a rising curve is an EC50');
const x50Index = sigmoid.headers.indexOf('x50');
assert.ok(
  Number(sigmoid.rows[0][x50Index]) > 1 && Number(sigmoid.rows[0][x50Index]) < 100,
  'x50 is reported back in concentration units, not log units'
);
assert.equal(sigmoid.chartModel.chartType, 'line', 'fits chart as lines');
assert.equal(sigmoid.chartModel.series.length, 2, 'one fitted line per series');
assert.ok(sigmoid.chartModel.series[0].markers.length >= 5, 'observed means are kept as markers');

// --- custom groups now reach a fit, not just the summary table ---
const customGroups = analyzeAssayData({
  spec: { analysis: 'linear', groupBy: 'custom', xAxis: 'concentration' },
  observations: doseCurve,
  options: {
    rowGroups: { groupSpec: 'Treated: A,B\nControl: C,D', maxMemberCount: 4 },
    columnGroups: { groupSpec: '', maxMemberCount: 12 }
  }
});
assert.equal(customGroups.rows.length, 2, 'a custom row group is a fit series');
assert.equal(
  customGroups.rows.map((row) => row[0]).sort().join('|'),
  'Control|Treated',
  'series are named after the custom groups'
);
assert.equal(customGroups.headers[0], 'Row Group', 'series column is named for the grouping');

// a one-member control group is legitimate
const singleMember = analyzeAssayData({
  spec: { analysis: 'summary', groupBy: 'custom' },
  observations: twoFactor,
  options: {
    rowGroups: { groupSpec: 'Control: A\nTreated: B,C,D', maxMemberCount: 4 },
    columnGroups: { groupSpec: '', maxMemberCount: 12 }
  }
});
assert.equal(
  singleMember.rows.map((row) => row[0]).sort().join('|'),
  'Control|Treated',
  'a single-row group is accepted'
);

// missing custom groups fall back rather than producing nothing
const noGroups = analyzeAssayData({
  spec: { analysis: 'summary', groupBy: 'custom' },
  observations: twoFactor,
  options: { rowGroups: { groupSpec: '' }, columnGroups: { groupSpec: '' } }
});
assert.ok(noGroups.rows.length, 'custom grouping with no groups falls back to auto');

// --- polynomial order is a modifier, not a separate analysis ---
const quadratic = analyzeAssayData({
  spec: { analysis: 'polynomial', polyOrder: 2, xAxis: 'concentration' },
  observations: doseCurve
});
const cubic = analyzeAssayData({
  spec: { analysis: 'polynomial', polyOrder: 3, xAxis: 'concentration' },
  observations: doseCurve
});
const quartic = analyzeAssayData({
  spec: { analysis: 'polynomial', polyOrder: 4, xAxis: 'concentration' },
  observations: doseCurve
});
// The label comes from the spec, so it reports the real order. The fitter only ever
// says "second"/"third", which mislabelled order 4 as a cubic.
assert.equal(quadratic.rows[0][2], 'Polynomial (order 2)', 'order 2 fits a quadratic');
assert.equal(cubic.rows[0][2], 'Polynomial (order 3)', 'order 3 fits a cubic');
assert.equal(quartic.rows[0][2], 'Polynomial (order 4)', 'order 4 is not called a cubic');

// --- normalize keeps the lowest X level as the baseline ---
const normalized = analyzeAssayData({
  spec: { analysis: 'normalize', xAxis: 'concentration' },
  observations: doseCurve
});
const percentIndex = normalized.headers.indexOf('Normalized %');
assert.equal(Number(normalized.rows[0][percentIndex]), 100, 'the baseline level normalizes to 100%');

// --- empty and impossible inputs stay graceful ---
assert.equal(analyzeAssayData({ spec: {}, observations: [] }).rows.length, 0, 'no observations -> no rows');
const noNumericX = analyzeAssayData({
  spec: { analysis: 'linear', xAxis: 'concentration' },
  observations: [obs('A', 1, 'S1', 'high', 10), obs('B', 1, 'S1', 'low', 20)]
});
assert.equal(noNumericX.rows.length, 0, 'a non-numeric X axis reports instead of throwing');
assert.ok(noNumericX.summary.includes('numeric'), 'and says why');

// --- row/column groups apply on 'auto', not only on an explicit 'custom' ---
// Without this the Groups panel silently did nothing: every well stayed its own bucket
// (n = 1), so the chart never changed and no SD error bar could be drawn.
const replicates = [];
['A', 'B', 'C'].forEach((row) => [1, 2, 3].forEach((column) => {
  replicates.push(obs(row, column, '', '', 10 + ROWS.indexOf(row) * 5 + column));
}));
const groupOptions = {
  rowGroups: { groupSpec: 'Treated: A,B\nControl: C', maxMemberCount: 4 },
  columnGroups: { groupSpec: '', maxMemberCount: 12 }
};
const autoGrouped = analyzeAssayData({
  spec: { analysis: 'summary', groupBy: 'auto' },
  observations: replicates,
  options: groupOptions
});
assert.equal(
  autoGrouped.rows.map((row) => row[0]).join('|'),
  'Treated|Control',
  'auto grouping pools the defined row groups'
);
assert.equal(
  autoGrouped.chartModel.series[0].data.map((point) => point.x).join('|'),
  'Treated|Control',
  'and the chart plots those groups'
);
// Error bar length is exactly the SD reported in the table, not a multiple of it.
const sdIndex = autoGrouped.headers.indexOf('SD');
assert.equal(
  autoGrouped.chartModel.series[0].data[0].yVariance.toFixed(4),
  autoGrouped.rows[0][sdIndex],
  'the error bar is one SD'
);
assert.equal(
  analyzeAssayData({
    spec: { analysis: 'summary', groupBy: 'row' },
    observations: replicates,
    options: groupOptions
  }).rows.length,
  3,
  'an explicit groupBy still wins over the defined groups'
);

console.log('assay analysis self-check passed');
