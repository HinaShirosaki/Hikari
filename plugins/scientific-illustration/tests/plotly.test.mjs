import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, applyOperations, normalizeObject } from '../model.mjs';
import { EMPTY_PLOT_SVG, normalizePlotly, preparePlots } from '../plotly.mjs';
import { copyComponents, instantiateClipboard } from '../clipboard.mjs';
import { snapshotAsset, instantiateAsset, assetContent } from '../reusable-assets.mjs';
import { agentInstructions } from '../agent/workflow.mjs';
const figure = () => ({ data: [{ type: 'scatter', x: [0, 1, 2], y: [2, 4, 3] }], layout: { xaxis: { title: { text: 'Time (min)' } } }, source: 'Supplied observations; no normalization.' });
const object = () => ({ id: 'plot', name: 'Measured response', type: 'plot', x: 25, y: 35, width: 800, height: 500, svg: EMPTY_PLOT_SVG, plotly: figure() });

test('plots retain canonical data, layout and provenance without adopting raster properties', () => {
  const plot = normalizeObject(object());
  assert.deepEqual(plot.plotly, figure());
  for (const extra of [{ text: 'Baked label' }, { textFree: true }, { dataUrl: 'anything' }, { fill: '#ff0000' }]) assert.throws(() => normalizeObject({ ...object(), ...extra }), /plot property/);
  assert.throws(() => normalizeObject({ id: 'label', type: 'text', plotly: figure() }), /only supported on plot/);
  for (const value of [null, { data: [] }, { data: [null] }, { data: [{}], layout: [] }, { ...figure(), script: 'code' }, { data: [{ x: [Infinity] }] }, { data: [{ y: [NaN] }] }, { data: [{ x: () => 3 }] }]) assert.throws(() => normalizePlotly(value));
});

test('plot edits rerender changed sources and sizes, but movement preserves the cached SVG', async () => {
  const before = applyOperations(createDocument(), [{ op: 'upsert', object: object() }]);
  const calls = [];
  const hikari = { call: async (verb, args) => { calls.push({ verb, args }); return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${args.width} ${args.height}"><text>Plot labels</text></svg>` }; } };
  const next = applyOperations(before, [{ op: 'update', id: 'plot', patch: { plotly: { ...figure(), data: [{ type: 'bar', y: [3, 5] }] } } }]);
  await preparePlots(next, before, hikari, value => value);
  assert.equal(calls.length, 1); assert.equal(calls[0].verb, 'plotly.render');
  assert.deepEqual(calls[0].args.figure.data[0].y, [3, 5]);
  const moved = applyOperations(next, [{ op: 'update', id: 'plot', patch: { x: 200, y: 100 } }]);
  await preparePlots(moved, next, hikari, value => value); assert.equal(calls.length, 1);
  const resized = applyOperations(moved, [{ op: 'transform', ids: ['plot'], patch: { width: 1600 } }]);
  await preparePlots(resized, moved, hikari, value => value); assert.equal(calls[1].args.width, 1600);
  assert.deepEqual(before.objects[0].plotly, figure());
});

test('clipboard and reusable assets keep independently editable plot specifications', () => {
  const document = applyOperations(createDocument(), [{ op: 'upsert', object: object() }]);
  const snapshot = copyComponents(document, ['plot']);
  const pasted = applyOperations(document, instantiateClipboard(snapshot, 'main').operations);
  assert.equal(pasted.objects.length, 2);
  assert.deepEqual(pasted.objects[1].plotly, figure());
  assert.notEqual(pasted.objects[1].id, 'plot');
  const asset = snapshotAsset(document, { id: 'plot', name: 'Measured response' });
  const alternate = structuredClone(asset); alternate.objects[0].svg = '<svg viewBox="0 0 800 500"><defs id="new-plotly-id"/></svg>';
  assert.deepEqual(assetContent(alternate), assetContent(asset));
  const instance = instantiateAsset(asset, { op: 'insert_asset', asset_id: 'plot-asset', canvas: 'main' }, createDocument());
  const inserted = applyOperations(createDocument(), instance.operations);
  assert.deepEqual(inserted.objects[0].plotly, figure());
  assert.match(agentInstructions('standard', 100), /locally vendored Plotly.js/);
  assert.match(agentInstructions('standard', 100), /Never infer an error bar from an average alone/);
});
