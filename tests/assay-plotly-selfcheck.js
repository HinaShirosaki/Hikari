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
assert.equal(presets.listChartPresets().join('|'), '', 'no presets to start');
assert.equal(presets.saveChartPreset('  Publication  ', { pointSize: 11, chartType: 'bar' }), true, 'saving returns true');
assert.equal(presets.listChartPresets().join('|'), 'Publication', 'preset name is trimmed');
const loaded = presets.getChartPreset('Publication');
assert.equal(loaded.pointSize, 11, 'preset keeps its style');
assert.equal(loaded.chartType, 'bar', 'preset keeps the chart type');
assert.equal(loaded.lineWidth, 2.5, 'preset is normalized on read');
assert.equal(presets.getChartPreset('missing'), null, 'unknown preset reads as null');
assert.equal(presets.saveChartPreset('   ', {}), false, 'a blank name is rejected');
assert.equal(presets.deleteChartPreset('Publication'), true, 'deleting returns true');
assert.equal(presets.listChartPresets().join('|'), '', 'preset removed');
assert.equal(presets.deleteChartPreset('Publication'), false, 'deleting twice is a no-op');
storage.setItem('hikari_assay_chart_presets_v1', 'not json');
assert.equal(presets.listChartPresets().join('|'), '', 'corrupt storage reads as empty, not a throw');

// --- renderer: the Figure defaults (offset frame, no grid, plain tick numbers) ---
const plots = [];
const calls = [];
const { createAssayPlotlyRenderer, titleEditPatch } = loadEsmStyleModule(
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
assert.equal(bar.layout.bargap, 0.35, 'Figure bar spacing');
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
const sizedArea = {
  w: sized.layout.width - sized.layout.margin.l - sized.layout.margin.r,
  h: sized.layout.height - sized.layout.margin.t - sized.layout.margin.b
};
assert.deepEqual(sizedArea, { w: 640, h: 480 }, 'an explicit size is the plot area and still wins');
assert.ok(sized.layout.width > 640 && sized.layout.height > 480, 'the figure carries the margins on top');

// A reference line coexists with the offset frame instead of replacing it.
const withRefLine = draw(barModel, { refLineValue: 5 });
assert.equal(withRefLine.layout.shapes.length, 3, 'reference line adds to the frame shapes');

// Explicit opt-ins still win over the Figure defaults.
const boxed = draw(barModel, { frameStyle: 'box', showHorizontalGrid: true });
assert.equal(boxed.layout.shapes, undefined, 'box frame draws no offset arms');
assert.equal(boxed.layout.xaxis.showline, true, 'box frame uses Plotly axis lines');
assert.equal(boxed.layout.yaxis.showgrid, true, 'gridlines can be turned back on');
assert.equal(createDefaultChartStyle().frameStyle, 'offset', 'offset is the default frame');

// --- agent-authored figures pick up the same Figure defaults ---
const { applyFigureDefaults } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/assay/plotly/figure-theme.js')
);
const figureStyle = normalizeChartStyle({});
const agentBar = applyFigureDefaults({
  data: [{ type: 'bar', x: ['A', 'B'], y: [1, 2] }],
  layout: { title: { text: 'Agent figure' } }
}, figureStyle);
assert.equal(agentBar.layout.shapes.length, 2, 'agent figure gets the offset frame');
assert.equal(agentBar.layout.xaxis.showgrid, false, 'agent figure loses gridlines');
assert.equal(agentBar.layout.yaxis.ticks, 'outside', 'agent figure gets outward ticks');
assert.equal(agentBar.layout.xaxis.tickfont.weight, 400, 'agent tick numbers are not bold');
assert.equal(agentBar.layout.plot_bgcolor, '#ffffff', 'agent figure gets the white plot ground');
assert.equal(agentBar.layout.bargap, 0.35, 'agent bars get Figure spacing');
assert.equal(agentBar.layout.title.text, 'Agent figure', 'the agent title survives');
assert.equal(agentBar.data[0].marker.line.width, 1, 'agent bars are outlined');
assert.equal(agentBar.data[0].marker.color, normalizeChartStyle({}).palette[0], 'uncoloured traces take the palette');

// Whatever the agent stated itself wins over the defaults.
const agentStated = applyFigureDefaults({
  data: [{ type: 'bar', x: ['A'], y: [1], marker: { color: '#123456', line: { width: 3, color: '#654321' } } }],
  layout: {
    xaxis: { showgrid: true, ticks: 'inside' },
    shapes: [{ type: 'line', x0: 0, x1: 1, y0: 1, y1: 1 }],
    paper_bgcolor: '#eeeeee'
  }
}, figureStyle);
assert.equal(agentStated.layout.xaxis.showgrid, true, 'an agent that asks for gridlines keeps them');
assert.equal(agentStated.layout.xaxis.ticks, 'inside', 'agent tick direction wins');
assert.equal(agentStated.layout.paper_bgcolor, '#eeeeee', 'agent background wins');
assert.equal(agentStated.data[0].marker.color, '#123456', 'agent bar colour wins');
assert.equal(agentStated.data[0].marker.line.width, 3, 'agent bar outline wins');
assert.equal(agentStated.layout.shapes.length, 3, 'agent shapes are kept alongside the frame arms');

// Subplot axes are themed too; non-cartesian figures are left alone.
const subplot = applyFigureDefaults({
  data: [{ type: 'scatter', x: [1], y: [1] }],
  layout: { xaxis2: { anchor: 'y2' }, yaxis2: {} }
}, figureStyle);
assert.equal(subplot.layout.xaxis2.ticks, 'outside', 'secondary axes are themed');
assert.equal(subplot.layout.xaxis2.anchor, 'y2', 'secondary axis settings survive');
const pie = applyFigureDefaults({ data: [{ type: 'pie', values: [1, 2] }], layout: {} }, figureStyle);
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

// Axis titles are draggable annotations, never Plotly axis titles: annotations[0] is X
// and annotations[1] is Y, which is the order a drag reports them back in.
const autoTitles = draw(fittedModel, { xTitle: 'Dose', yTitle: 'Signal' });
assert.equal(autoTitles.layout.xaxis.title.text, '', 'the axis itself carries no title');
assert.equal(autoTitles.layout.annotations[0].text, 'Dose', 'the X title is the first annotation');
assert.equal(autoTitles.layout.annotations[1].text, 'Signal', 'the Y title is the second');
assert.equal(autoTitles.layout.annotations[0].x, 0.5, 'an unmoved title centres on its axis');
assert.equal(autoTitles.layout.annotations[1].textangle, -90, 'the Y title reads up the axis');

const movedTitles = draw(fittedModel, { xTitle: 'Dose', xTitlePos: 0.1, yTitle: 'Signal', yTitleOffset: 70 });
assert.equal(movedTitles.layout.annotations[0].x, 0.1, 'the X title sits where it was asked to');
assert.ok(movedTitles.layout.margin.l >= 96, 'the margin grows so a pushed-out title is not clipped');
const movedArea = plotArea(movedTitles.layout);
const unmovedArea = plotArea(autoTitles.layout);
assert.deepEqual(movedArea, unmovedArea, 'pushing a title out grows the figure, never the plot');

// A drag round-trips: the paper coordinates Plotly reports back become the same numbers
// the Text tab's boxes hold.
const dragged = titleEditPatch({
  'annotations[0].x': 0.25,
  'annotations[0].y': -0.2,
  'annotations[1].x': -0.1,
  'annotations[1].y': 0.75,
  'annotations[1].text': 'Renamed'
}, { plotWidth: 400, plotHeight: 300 });
// JSON, not deepEqual: the loader evaluates the module in its own realm, so the patch
// object's prototype is not this file's Object.prototype.
assert.equal(JSON.stringify(dragged), JSON.stringify({
  xTitlePos: 0.25,
  xTitleOffset: 60,
  yTitlePos: 0.75,
  yTitleOffset: 40,
  yTitle: 'Renamed'
}), 'a dropped title reads back as position, distance and name');
assert.equal(
  Object.keys(titleEditPatch({ 'xaxis.range[0]': 2 }, { plotWidth: 400, plotHeight: 300 })).length,
  0,
  'an unrelated relayout (zoom, pan) is not a title edit'
);

// --- renderer: a custom size is the plot area, so equal numbers give a square plot
// (Plotly's own width/height include the margins, which are asymmetric) ---
function plotArea(layout) {
  return {
    w: layout.width - layout.margin.l - layout.margin.r,
    h: layout.height - layout.margin.t - layout.margin.b
  };
}
const squared = draw(barModel, { sizeAuto: false, frameWidth: 500, frameHeight: 500 });
assert.deepEqual(plotArea(squared.layout), { w: 500, h: 500 }, 'equal width/height give a square plot area');
assert.equal(squared.layout.xaxis.automargin, false, 'an exact size owns its margins');
const titledSize = draw(barModel, {
  sizeAuto: false, frameWidth: 500, frameHeight: 500, title: 'T', yTitleOffset: 120
});
assert.deepEqual(plotArea(titledSize.layout), { w: 500, h: 500 }, 'titles grow the figure, never the plot area');
const autoSized = draw(barModel, {});
assert.equal(autoSized.layout.xaxis.automargin, true, 'auto sizing keeps automargin on');

console.log('assay Plotly self-check passed');

// v2: typography, migration and independent target edits.
const targets = loadEsmStyleModule(path.join(root, 'src/renderer/modules/assay/plotly/chart-style-targets.js'));
const fresh = createDefaultChartStyle();
assert.equal(fresh.styleVersion, 2);
assert.equal(fresh.textStyles.title.fontSize, 14 * 4 / 3);
assert.equal(fresh.textStyles.xTitle.fontSize, 16);
assert.equal(fresh.textStyles.legend.bold, false);
assert.equal(fresh.lineWidth, 2);
const legacy = normalizeChartStyle({ text: { fontSize: 21, bold: true, italic: true }, lineWidth: 3.7 });
assert.equal(legacy.textStyles.title.fontSize, 21, 'legacy dimensions remain pixels');
assert.equal(legacy.textStyles.xTicks.bold, false, 'legacy regular ticks are materialized');
assert.equal(legacy.textStyles.legend.bold, true, 'legacy bold legends are preserved');
assert.equal(legacy.lineWidth, 3.7);
assert.deepEqual(JSON.parse(JSON.stringify(normalizeChartStyle(legacy))), JSON.parse(JSON.stringify(legacy)), 'migration is idempotent');

const independent = createChartStyleStore({ initialStyle: fresh });
independent.setStyle(targets.seriesStylePatch(independent.getStyle(), 'A', 'pointSize', 12));
independent.setStyle(targets.seriesStylePatch(independent.getStyle(), 'B', 'color', '#ff0000'));
independent.setStyle(targets.seriesStylePatch(independent.getStyle(), null, 'color', '#123456'));
assert.equal(independent.getStyle().seriesStyles.A.pointSize, 12, 'global color preserves individual size');
assert.equal(Object.hasOwn(independent.getStyle().seriesStyles.B, 'color'), false, 'global color clears only color overrides');
assert.equal(targets.resolveSeriesStyle(independent.getStyle(), 'A').color, '#123456');
independent.setStyle(targets.axisStylePatch(independent.getStyle(), 'x', 'tickDir', 'inside'));
assert.equal(targets.resolveAxisStyle(independent.getStyle(), 'x').tickDir, 'inside');
assert.equal(targets.resolveAxisStyle(independent.getStyle(), 'y').tickDir, 'outside');

for (const scale of ['linear', 'log10', 'log2', 'ln']) {
  const result = draw(fittedModel, { ...fresh, xScale: scale, yScale: scale,
    xRange: { auto: false, min: 1, max: 100 }, yRange: { auto: false, min: 1, max: 1000 } });
  assert.equal(result.layout.xaxis.range.join(','), scale === 'linear' ? '1,100' : '0,2');
  assert.equal(result.layout.yaxis.range.join(','), scale === 'linear' ? '1,1000' : '0,3');
}
assert.ok(targets.validateAxisRange('log2', { auto: false, min: 0, max: 8 }));
assert.ok(targets.validateAxisRange('linear', { auto: false, min: 10, max: 1 }));
assert.equal(targets.validateAxisRange('ln', { auto: true, min: -1, max: null }), '');
const axisTarget = draw(fittedModel, { ...fresh, axisStyles: { x: { tickDir: 'inside', tickAngle: 25 }, y: { tickLen: 12 } },
  textStyles: { ...fresh.textStyles, yTicks: { ...fresh.textStyles.yTicks, bold: true, color: '#ff0000' } } });
assert.equal(axisTarget.layout.xaxis.ticks, 'inside');
assert.equal(axisTarget.layout.yaxis.ticks, 'outside');
assert.equal(axisTarget.layout.xaxis.tickangle, 25);
assert.equal(axisTarget.layout.yaxis.ticklen, 12);
assert.equal(axisTarget.layout.yaxis.tickfont.weight, 700, 'tick font is now independently controllable');
assert.equal(axisTarget.layout.xaxis.tickfont.weight, 400);
const logReference = draw(fittedModel, { ...fresh, yScale: 'log10', refLineValue: 100 });
assert.equal(logReference.layout.shapes[2].y0, 100, 'shape endpoints remain data values on log axes');

const modelSnapshot = JSON.stringify(fittedModel);
const styledFit = draw(fittedModel, { ...fresh, seriesStyles: { S1: {
  color: '#123456', pointSize: 11, lineWidth: 4, lineStyle: 'dashed', errorColor: '#ff0000', errorThickness: 3
} } });
assert.equal(styledFit.traces[0].line.width, 4);
assert.equal(styledFit.traces[0].line.dash, 'dash');
assert.equal(styledFit.traces[1].marker.size, 11);
assert.equal(styledFit.traces[1].error_y.color, '#ff0000');
assert.equal(styledFit.traces[1].error_y.thickness, 3);
assert.equal(JSON.stringify(fittedModel), modelSnapshot, 'formatting does not mutate scientific results');
assert.equal(draw(fittedModel, { ...fresh, mode: 'markers' }).traces.length, 1, 'points-only fitted graph shows observations only');
assert.equal(draw(fittedModel, { ...fresh, mode: 'lines' }).traces.length, 1, 'line-only fitted graph shows the fitted line only');
const barsStyled = draw(barModel, { ...fresh, seriesStyles: { Treated: { barOutlineColor: '#123456', barOutlineWidth: 4 } } });
assert.equal(barsStyled.traces[0].marker.line.color, '#123456');
assert.equal(barsStyled.traces[0].marker.line.width, 4);

const beforePreset = normalizeChartStyle({ ...fresh, title: 'Keep title', xTitle: 'Keep axis',
  xColumn: 'Concentration', xRange: { auto: false, min: 1, max: 10 }, xScale: 'log2', frameStyle: 'box' });
const afterPreset = normalizeChartStyle({ ...beforePreset, ...targets.figureClassicPatch() });
assert.equal(afterPreset.title, beforePreset.title);
assert.equal(afterPreset.xTitle, beforePreset.xTitle);
assert.equal(afterPreset.xColumn, beforePreset.xColumn);
assert.equal(JSON.stringify(afterPreset.xRange), JSON.stringify(beforePreset.xRange));
assert.equal(afterPreset.xScale, 'log2');
assert.equal(afterPreset.frameStyle, 'offset');
assert.equal(presets.deleteChartPreset('Figure Classic'), false);
assert.equal(presets.saveChartPreset('Figure Classic', {pointSize: 13}), true, 'an existing name never collides with the built-in preset');
assert.equal(presets.getChartPreset('Figure Classic').pointSize, 13);
assert.equal(presets.saveChartPreset('Targets', independent.getStyle()), true);
assert.equal(JSON.stringify(presets.getChartPreset('Targets')), JSON.stringify(independent.getStyle()), 'all targets survive preset storage');
console.log('assay Figure formatting target checks passed');
