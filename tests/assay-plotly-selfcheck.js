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

// --- overriding a column keeps the SD error bars the analysis asked for ---
// The override path rebuilds the model from the rendered table, so it has to read the
// table's own SD column; otherwise picking an X/Y/series column silently dropped every
// error bar.
const summaryTable = {
  headers: ['Sample ID', 'Concentration', 'N', 'Mean', 'SD', 'Min', 'Max'],
  rows: [
    ['S1', '10', 3, '90.0000', '2.0000', '88.0000', '92.0000'],
    ['S1', '100', 3, '60.0000', '3.0000', '57.0000', '63.0000']
  ],
  chartModel: { showErrorBars: true }
};
const overridden = buildAnalysisChartModel(
  summaryTable,
  'summary',
  { xColumn: 'Concentration', yColumn: 'Mean', seriesColumn: 'Sample ID' }
);
assert.equal(overridden.showErrorBars, true, 'the override model still draws error bars');
assert.equal(
  overridden.series[0].data.map((p) => p.yVariance).join('|'),
  '2|3',
  'each bar carries its own row SD'
);

// A different Y column has no SD to speak of, so it gets no bar rather than the Mean's.
assert.equal(
  buildAnalysisChartModel(summaryTable, 'summary', { yColumn: 'Max' })
    .series[0].data.some((p) => 'yVariance' in p),
  false,
  'SD is not reused for a Y column it does not describe'
);

// Turning error bars off in the analysis still wins over the override.
assert.equal(
  buildAnalysisChartModel(
    { ...summaryTable, chartModel: { showErrorBars: false } },
    'summary',
    { yColumn: 'Mean' }
  ).showErrorBars,
  false,
  'the error-bar checkbox survives a column override'
);

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

// --- renderer: the Prism defaults (offset frame, no grid, plain tick numbers) ---
const plots = [];
const calls = [];
const { createAssayPlotlyRenderer } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/assay/plotly/plotly-renderer.js'),
  {
    window: {
      Plotly: {
        react: (target, traces, layout) => { plots.push({ traces, layout }); calls.push(['react', target]); },
        purge: (target) => { calls.push(['purge', target]); }
      }
    }
  }
);
const renderer = createAssayPlotlyRenderer();
const draw = (model, styleOverrides) => {
  plots.length = 0;
  renderer.render({}, model, normalizeChartStyle(styleOverrides || {}));
  return plots[0];
};

const barModel = {
  chartType: 'bar',
  xLabel: 'Group',
  yLabel: 'Mean',
  showErrorBars: true,
  series: [{
    label: 'Treated',
    data: [
      { x: 'DMSO', y: 10, yVariance: 2, points: [9, 10, 11] },
      { x: 'Drug', y: 4, yVariance: 1, points: [3, 4, 5] }
    ]
  }]
};

const bar = draw(barModel);
assert.equal(bar.layout.xaxis.showline, false, 'offset frame does not use Plotly axis lines');
assert.equal(bar.layout.shapes.length, 2, 'offset frame draws both axis arms as shapes');
assert.equal(bar.layout.shapes[0].x0 > 0, true, 'x arm starts past the origin corner');
assert.equal(bar.layout.shapes[1].y0 > 0, true, 'y arm starts past the origin corner');
assert.equal(bar.layout.xaxis.showgrid, false, 'no vertical gridlines by default');
assert.equal(bar.layout.yaxis.showgrid, false, 'no horizontal gridlines by default');
assert.equal(bar.layout.xaxis.tickfont.weight, 400, 'tick numbers are never bold');
assert.equal(bar.layout.xaxis.title.font.weight, 700, 'axis titles still follow the text style');
assert.equal(bar.layout.xaxis.tickangle, 0, 'short category labels stay horizontal');
assert.equal(bar.layout.bargap, 0.35, 'Prism bar spacing');
assert.equal(bar.traces[0].marker.line.width, 1, 'bars are outlined');
assert.equal(bar.traces.length, 2, 'single-series bar gets a replicate dot trace');
// vm-realm arrays are not deepStrictEqual to test-realm literals (see the note above).
assert.equal(bar.traces[1].x.join('|'), 'DMSO|DMSO|DMSO|Drug|Drug|Drug', 'dots sit on their own category');
assert.equal(bar.traces[1].y.join('|'), '9|10|11|3|4|5', 'dots carry every replicate');
assert.equal(bar.traces[1].showlegend, false, 'the dot trace stays out of the legend');

// Grouped bars: dots would land on the category centre, so they are skipped.
const grouped = draw({
  ...barModel,
  series: [barModel.series[0], { label: 'Control', data: [{ x: 'DMSO', y: 8, points: [7, 9] }] }]
});
assert.equal(grouped.traces.length, 2, 'grouped bars render one trace per series, no dots');

// Category labels tilt on collision -- long labels in narrow slots, or many short ones.
const longLabels = draw({
  ...barModel,
  series: [{
    label: 'Treated',
    data: [{ x: 'Vehicle control 0.1%', y: 1 }, { x: 'Compound A 10 uM', y: 2 }]
  }]
});
assert.equal(longLabels.layout.xaxis.tickangle, -35, 'long category labels tilt');
const manyShort = draw({
  ...barModel,
  series: [{ label: 'Treated', data: Array.from({ length: 24 }, (_, i) => ({ x: `Group ${i + 1}`, y: i })) }]
});
assert.equal(manyShort.layout.xaxis.tickangle, -35, 'labels tilt once the slots get tight');
const manyTiny = draw({
  ...barModel,
  series: [{ label: 'Treated', data: Array.from({ length: 24 }, (_, i) => ({ x: `G${i + 1}`, y: i })) }]
});
assert.equal(manyTiny.layout.xaxis.tickangle, 0, 'but short labels that still fit stay horizontal');
assert.equal(bar.layout.xaxis.tickangle, 0, 'two roomy categories stay horizontal');

// --- the auto frame follows the data instead of a fixed floor ---
// A two-bar summary used to be padded out to 420x280, leaving the axis running well past
// the last bar; a 24-bar summary used to stay 280 tall and turn into a letterbox.
assert.equal(bar.layout.width < 420, true, 'a two-bar frame is no wider than its data needs');
assert.equal(manyShort.layout.width > bar.layout.width, true, '24 bars get a wider frame');
assert.equal(manyShort.layout.height > bar.layout.height, true, 'and a taller one, so it is not a letterbox');
assert.equal(manyShort.layout.width / manyShort.layout.height < 3, true, 'the widest auto frame stays under 3:1');
const sized = draw(barModel, { sizeAuto: false, frameWidth: 640, frameHeight: 480 });
assert.equal(`${sized.layout.width}x${sized.layout.height}`, '640x480', 'an explicit frame size still wins');

// A reference line coexists with the offset frame instead of replacing it.
const withRefLine = draw(barModel, { refLineValue: 5 });
assert.equal(withRefLine.layout.shapes.length, 3, 'reference line adds to the frame shapes');

// Explicit opt-ins still win over the Prism defaults.
const boxed = draw(barModel, { frameStyle: 'box', showHorizontalGrid: true });
assert.equal(boxed.layout.shapes, undefined, 'box frame draws no offset arms');
assert.equal(boxed.layout.xaxis.showline, true, 'box frame uses Plotly axis lines');
assert.equal(boxed.layout.yaxis.showgrid, true, 'gridlines can be turned back on');
assert.equal(createDefaultChartStyle().frameStyle, 'offset', 'offset is the default frame');

// --- agent-authored figures pick up the same Prism defaults ---
const { applyPrismDefaults } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/assay/plotly/prism-theme.js')
);
const prismStyle = normalizeChartStyle({});
const agentBar = applyPrismDefaults({
  data: [{ type: 'bar', x: ['A', 'B'], y: [1, 2] }],
  layout: { title: { text: 'Agent figure' } }
}, prismStyle);
assert.equal(agentBar.layout.shapes.length, 2, 'agent figure gets the offset frame');
assert.equal(agentBar.layout.xaxis.showgrid, false, 'agent figure loses gridlines');
assert.equal(agentBar.layout.yaxis.ticks, 'outside', 'agent figure gets outward ticks');
assert.equal(agentBar.layout.xaxis.tickfont.weight, 400, 'agent tick numbers are not bold');
assert.equal(agentBar.layout.plot_bgcolor, '#ffffff', 'agent figure gets the white plot ground');
assert.equal(agentBar.layout.bargap, 0.35, 'agent bars get Prism spacing');
assert.equal(agentBar.layout.title.text, 'Agent figure', 'the agent title survives');
assert.equal(agentBar.data[0].marker.line.width, 1, 'agent bars are outlined');
assert.equal(agentBar.data[0].marker.color, normalizeChartStyle({}).palette[0], 'uncoloured traces take the palette');

// Whatever the agent stated itself wins over the defaults.
const agentStated = applyPrismDefaults({
  data: [{ type: 'bar', x: ['A'], y: [1], marker: { color: '#123456', line: { width: 3, color: '#654321' } } }],
  layout: {
    xaxis: { showgrid: true, ticks: 'inside' },
    shapes: [{ type: 'line', x0: 0, x1: 1, y0: 1, y1: 1 }],
    paper_bgcolor: '#eeeeee'
  }
}, prismStyle);
assert.equal(agentStated.layout.xaxis.showgrid, true, 'an agent that asks for gridlines keeps them');
assert.equal(agentStated.layout.xaxis.ticks, 'inside', 'agent tick direction wins');
assert.equal(agentStated.layout.paper_bgcolor, '#eeeeee', 'agent background wins');
assert.equal(agentStated.data[0].marker.color, '#123456', 'agent bar colour wins');
assert.equal(agentStated.data[0].marker.line.width, 3, 'agent bar outline wins');
assert.equal(agentStated.layout.shapes.length, 3, 'agent shapes are kept alongside the frame arms');

// Subplot axes are themed too; non-cartesian figures are left alone.
const subplot = applyPrismDefaults({
  data: [{ type: 'scatter', x: [1], y: [1] }],
  layout: { xaxis2: { anchor: 'y2' }, yaxis2: {} }
}, prismStyle);
assert.equal(subplot.layout.xaxis2.ticks, 'outside', 'secondary axes are themed');
assert.equal(subplot.layout.xaxis2.anchor, 'y2', 'secondary axis settings survive');
const pie = applyPrismDefaults({ data: [{ type: 'pie', values: [1, 2] }], layout: {} }, prismStyle);
assert.equal(pie.layout.shapes, undefined, 'a pie gets no floating axis arms');
assert.equal(pie.layout.xaxis, undefined, 'a pie gets no cartesian axes');

// --- renderer: a style redraw reuses the live host (purging it collapsed the
// workspace scroll back to the top on every chart tweak) ---
calls.length = 0;
const scrollRenderer = createAssayPlotlyRenderer();
const hostA = { parentElement: { clientWidth: 800 } };
const hostB = { parentElement: { clientWidth: 800 } };
const simpleModel = { chartType: 'bar', series: [{ label: 'A', data: [{ x: 'A', y: 1 }] }] };
scrollRenderer.render(hostA, simpleModel, createDefaultChartStyle());
scrollRenderer.render(hostA, simpleModel, { ...createDefaultChartStyle(), pointSize: 12 });
assert.deepEqual(calls.map((call) => call[0]), ['react', 'react'], 'redraw on the same host never purges');
scrollRenderer.render(hostB, simpleModel, createDefaultChartStyle());
assert.deepEqual(calls[2], ['purge', hostA], 'a new host purges the old one');
assert.deepEqual(calls[3], ['react', hostB], 'the new host is drawn');
scrollRenderer.render(hostB, null, createDefaultChartStyle());
assert.deepEqual(calls[4], ['purge', hostB], 'an empty model tears the chart down');

// --- renderer: a fitted curve carries its spread on the observed markers, not on the
// sampled line, and the axis titles only leave Plotly's own placement when moved ---
const fittedModel = {
  chartType: 'line',
  xLabel: 'Dose',
  yLabel: 'Response',
  showErrorBars: true,
  series: [{
    label: 'S1',
    data: [{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 30 }],
    markers: [{ x: 1, y: 10, yVariance: 1.5 }, { x: 3, y: 30, yVariance: 2 }]
  }]
};
const fitted = draw(fittedModel, { pointShape: 'square' });
assert.equal(fitted.traces[0].error_y, undefined, 'the sampled fitted line gets no error bars');
assert.deepEqual(fitted.traces[1].error_y.array, [1.5, 2], 'observed markers carry the spread');
assert.equal(fitted.traces[1].marker.symbol, 'square', 'observed markers follow the point shape');
const fittedOff = draw({ ...fittedModel, showErrorBars: false }, {});
assert.equal(fittedOff.traces[1].error_y, undefined, 'showErrorBars:false turns them off');

const autoTitles = draw(fittedModel, { xTitle: 'Dose', yTitle: 'Signal' });
assert.equal(autoTitles.layout.xaxis.title.text, 'Dose', 'an unmoved title stays a Plotly axis title');
assert.equal(autoTitles.layout.annotations, undefined, 'an unmoved title needs no annotation');
const movedTitles = draw(fittedModel, { xTitle: 'Dose', xTitlePos: 0.1, yTitle: 'Signal', yTitleOffset: 70 });
assert.equal(movedTitles.layout.xaxis.title.text, '', 'a moved X title hands over to the annotation');
assert.equal(movedTitles.layout.annotations[0].x, 0.1, 'the annotation sits where it was asked to');
assert.equal(movedTitles.layout.yaxis.title.standoff, 70, 'a distance alone stays a native standoff');
assert.ok(movedTitles.layout.margin.l >= 96, 'the margin grows so a pushed-out title is not clipped');

console.log('assay Plotly self-check passed');
