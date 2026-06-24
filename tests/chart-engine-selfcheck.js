#!/usr/bin/env node
// Self-check for the extracted chart engine's pure logic (no DOM / Plotly needed).
// Run: node tests/chart-engine-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const { createChartStyleStore } = loadEsmStyleModule(
  path.join(root, 'src/renderer/lib/chart-engine/chart-style-store.js')
);
const { buildAnalysisChartModel } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/assay/analysis-chart-renderer.js')
);

// --- store: setStyle merges + emits; setStyleSilent does not emit; reset emits defaults ---
let emitted = 0;
let lastStyle = null;
const store = createChartStyleStore({
  initialStyle: { pointSize: 9 },
  onChange: (s) => { emitted += 1; lastStyle = s; }
});
assert.equal(store.getStyle().pointSize, 9, 'initialStyle applied');

store.setStyle({ lineWidth: 4 });
assert.equal(emitted, 1, 'setStyle emits onChange');
assert.equal(lastStyle.lineWidth, 4, 'patch applied');
assert.equal(store.getStyle().pointSize, 9, 'setStyle merges (keeps prior fields)');

store.setStyleSilent({ pointSize: 2 });
assert.equal(emitted, 1, 'setStyleSilent does NOT emit');
assert.equal(store.getStyle().pointSize, 2, 'silent style replaced');

store.resetStyle();
assert.equal(emitted, 2, 'resetStyle emits');
assert.notEqual(store.getStyle().pointSize, 2, 'reset restored defaults');

// getContext returns a defensive copy
store.setContext({ headers: ['Conc', 'Mean'], seriesLabels: ['A'] });
const ctx = store.getContext();
ctx.headers.push('mutated');
assert.deepEqual(store.getContext().headers, ['Conc', 'Mean'], 'getContext copies headers');

// --- moved model-builder still produces a line model for numeric-x dose-response ---
const model = buildAnalysisChartModel(
  {
    headers: ['Concentration', 'Mean'],
    rows: [['10', '90'], ['100', '60'], ['1000', '20']]
  },
  'ec50',
  { xColumn: 'Concentration', yColumn: 'Mean', seriesColumn: 'auto' }
);
assert.equal(model.chartType, 'line', 'numeric-x ec50 -> line chart');
assert.equal(model.series[0].data.length, 3, 'three points bucketed');
assert.deepEqual(model.series[0].data.map((p) => p.x), [10, 100, 1000], 'points sorted by x');
assert.deepEqual(model.series[0].data.map((p) => p.y), [90, 60, 20], 'y follows the chosen column');

console.log('chart-engine self-check passed');
