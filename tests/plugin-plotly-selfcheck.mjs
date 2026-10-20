import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePluginPlot } from '../src/renderer/app/plugin-bridge/plotly-render.js';

test('the plot bridge accepts finite JSON observations without changing them', () => {
  const figure = { data: [{ type: 'histogram', x: [1, 1, 2, 2, 2, 3] }], layout: { xaxis: { title: { text: 'Value' } } } };
  const result = normalizePluginPlot({ figure, width: 1200.2, height: 800 });
  assert.deepEqual(result.figure, figure); assert.equal(result.width, 1200);
  result.figure.data[0].x.push(4); assert.equal(figure.data[0].x.length, 6);
});

test('the plot bridge refuses malformed, executable, oversized or remote specifications', () => {
  for (const figure of [{ data: [] }, { data: [null] }, { data: [{ type: 'scattergeo' }] }, { data: [{ type: 'scatter', y: [Infinity] }] }, { data: [{ y: () => 3 }] }, { data: [{}], layout: { images: [{ source: 'https://example.com/image.png' }] } }, { data: [{}], layout: { mapbox: {} } }, { data: [{}], layout: { title: { text: 'x'.repeat(2000001) } } }]) assert.throws(() => normalizePluginPlot({ figure }));
  assert.throws(() => normalizePluginPlot({ figure: { data: [{}] }, width: 9000 }));
});
