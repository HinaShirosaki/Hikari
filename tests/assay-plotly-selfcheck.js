#!/usr/bin/env node
// Self-check for the Assay Plotly model and style state (no DOM / Plotly needed).
// Run: node tests/assay-plotly-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { createMemoryStorage, loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const { createChartStyleStore } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/assay/plotly/chart-style-store.js')
);
const { buildAnalysisChartModel } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/assay/analysis-chart-model.js')
);
const { createDefaultChartStyle, normalizeChartStyle } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/assay/plotly/chart-style-model.js')
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

// --- store: the rendered-figure facts the controls hide settings on ---
assert.equal(store.getContext().chartType, '', 'chartType defaults empty');
assert.equal(store.getContext().hasErrorBars, false, 'hasErrorBars defaults false');
store.setContext({ headers: [], seriesLabels: [], chartType: 'bar', hasErrorBars: true, hasFittedCurve: true });
assert.equal(store.getContext().chartType, 'bar', 'chartType round-trips');
assert.equal(store.getContext().hasErrorBars, true, 'hasErrorBars round-trips');
assert.equal(store.getContext().hasFittedCurve, true, 'hasFittedCurve round-trips');

// --- store: onChange hands back the previous style so listeners can skip re-analysis ---
let previousSeen = 'unset';
const prevStore = createChartStyleStore({
  initialStyle: { pointSize: 5 },
  onChange: (_style, previous) => { previousSeen = previous; }
});
prevStore.setStyle({ pointSize: 7 });
assert.equal(previousSeen.pointSize, 5, 'onChange receives the pre-patch style');
assert.equal(prevStore.getStyle().pointSize, 7, 'and the new style is current');
assert.equal(prevStore.getDefaultStyle().pointSize, createDefaultChartStyle().pointSize, 'getDefaultStyle exposes defaults for per-tab reset');

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

// --- style model: new control fields normalize cleanly (regression guard for clampFinite null bug) ---
const def = createDefaultChartStyle();
assert.equal(normalizeChartStyle(def).refLineValue, null, 'default refLineValue stays null (no spurious reference line at 0)');
assert.equal(normalizeChartStyle(def).xTick, null, 'default xTick stays null (auto ticks)');
assert.equal(normalizeChartStyle({ refLineValue: 'x' }).refLineValue, null, 'non-numeric refLineValue -> null');
assert.equal(normalizeChartStyle({ refLineValue: 50 }).refLineValue, 50, 'numeric refLineValue preserved');
assert.equal(normalizeChartStyle({ opacity: 5 }).opacity, 1, 'opacity clamps to 1');
assert.equal(normalizeChartStyle({ xScale: 'log' }).xScale, 'log10', 'legacy "log" scale migrates to log10');
assert.equal(normalizeChartStyle({ mode: 'bogus' }).mode, def.mode, 'invalid display mode falls back to default');
// Note: objects from the vm-loaded module carry that realm's prototype, so compare
// keys/values directly rather than deepEqual against a test-realm literal.
assert.equal(Object.keys(normalizeChartStyle(def).seriesShapes).length, 0, 'default seriesShapes is empty');
const shp = normalizeChartStyle({ seriesShapes: { A: 'square', B: 'bogus', C: 'triangle' } }).seriesShapes;
assert.equal(shp.A, 'square', 'seriesShapes keeps a valid shape');
assert.equal(shp.C, 'triangle', 'seriesShapes keeps another valid shape');
assert.equal('B' in shp, false, 'seriesShapes drops an invalid shape');

// --- new style fields the redesigned panel writes ---
assert.equal(createDefaultChartStyle().chartType, 'auto', 'chart type defaults to auto');
assert.equal(normalizeChartStyle({ chartType: 'bar' }).chartType, 'bar', 'chart type override survives');
assert.equal(normalizeChartStyle({ chartType: 'pie' }).chartType, 'auto', 'unknown chart type falls back to auto');
assert.equal(normalizeChartStyle({ xTitle: 'Dose (nM)' }).xTitle, 'Dose (nM)', 'x axis title is editable');
assert.equal(normalizeChartStyle({ yTitle: 'Viability' }).yTitle, 'Viability', 'y axis title is editable');
assert.equal(normalizeChartStyle({ xTitle: 42 }).xTitle, '', 'non-string axis title is dropped');

// --- presets: named styles round-trip through storage ---
const storage = createMemoryStorage();
const presets = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/assay/plotly/chart-presets.js'),
  { localStorage: storage }
);
assert.deepEqual(presets.listChartPresets(), [], 'no presets to start');
assert.equal(presets.saveChartPreset('  Publication  ', { pointSize: 11, chartType: 'bar' }), true, 'saving returns true');
assert.equal(presets.listChartPresets().join('|'), 'Publication', 'preset name is trimmed');
const loaded = presets.getChartPreset('Publication');
assert.equal(loaded.pointSize, 11, 'preset keeps its style');
assert.equal(loaded.chartType, 'bar', 'preset keeps the chart type');
assert.equal(loaded.lineWidth, createDefaultChartStyle().lineWidth, 'preset is normalized on read');
assert.equal(presets.getChartPreset('missing'), null, 'unknown preset reads as null');
assert.equal(presets.saveChartPreset('   ', {}), false, 'a blank name is rejected');
assert.equal(presets.deleteChartPreset('Publication'), true, 'deleting returns true');
assert.deepEqual(presets.listChartPresets(), [], 'preset removed');
assert.equal(presets.deleteChartPreset('Publication'), false, 'deleting twice is a no-op');
storage.setItem('hikari_assay_chart_presets_v1', 'not json');
assert.deepEqual(presets.listChartPresets(), [], 'corrupt storage reads as empty, not a throw');

console.log('assay Plotly self-check passed');
