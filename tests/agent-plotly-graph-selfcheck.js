#!/usr/bin/env node
// Self-check for the agent plotly-graph tool: plate values arrive as TSV strings, so the
// tool has to turn them into real numbers and flag the assay-specific figure mistakes.
// Run: node tests/agent-plotly-graph-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');

const { createAgentPlotlyGraphRuntime } = require(
  path.join(__dirname, '..', 'src/main/agent/tools/agent-plotly-graph.js')
);

const runtime = createAgentPlotlyGraphRuntime();

async function main() {

  // --- numeric strings from the plate TSV become numbers; blank wells become gaps ---
  const doseResponse = await runtime.execute({
    action: 'create',
    name: 'dose response',
    data: [{
      type: 'scatter',
      mode: 'lines+markers',
      x: ['0.01', '0.1', '1', '10'],
      y: ['5.2', '18.4', '', '91.3'],
      error_y: { type: 'data', array: ['0.4', '1.1', '0.9', '2.2'], visible: true }
    }],
    layout: {
      title: { text: 'Dose response' },
      xaxis: { title: { text: 'Dose (uM)' }, type: 'log' },
      yaxis: { title: { text: 'Response (RFU)' } }
    }
  });
  assert.equal(doseResponse.ok, true, 'create succeeds');
  const doseTrace = doseResponse.graph.figure.data[0];
  assert.deepEqual(doseTrace.x, [0.01, 0.1, 1, 10], 'numeric x strings become numbers');
  assert.deepEqual(doseTrace.y, [5.2, 18.4, null, 91.3], 'blank well becomes a null gap');
  assert.deepEqual(doseTrace.error_y.array, [0.4, 1.1, 0.9, 2.2], 'error bar strings become numbers');
  assert.deepEqual(doseResponse.graph.inspection.issues, [], 'a clean dose response has no issues');

  // --- real category labels are left alone ---
  const conditions = await runtime.execute({
    action: 'create',
    name: 'conditions',
    data: [{ type: 'bar', x: ['control', 'treated'], y: [2, 5] }],
    layout: { title: { text: 'Response' }, xaxis: { title: { text: 'Condition' } }, yaxis: { title: { text: 'RFU' } } }
  });
  assert.deepEqual(conditions.graph.figure.data[0].x, ['control', 'treated'], 'labels survive');

  // --- an explicit category axis opts out of coercion ---
  const categorical = await runtime.execute({
    action: 'create',
    name: 'plate columns',
    data: [{ type: 'bar', x: ['1', '2', '3'], y: [1, 2, 3] }],
    layout: { title: { text: 'By column' }, xaxis: { title: { text: 'Column' }, type: 'category' }, yaxis: { title: { text: 'RFU' } } }
  });
  assert.deepEqual(categorical.graph.figure.data[0].x, ['1', '2', '3'], 'category axis keeps strings');

  // --- a line trace is sorted by x, and every per-point channel moves with it ---
  const scrambled = await runtime.execute({
    action: 'create',
    name: 'scrambled dose response',
    data: [{
      type: 'scatter',
      mode: 'lines+markers',
      x: ['10', '0.1', '1'],
      y: ['91.3', '18.4', '55.0'],
      text: ['C3', 'A1', 'B2'],
      customdata: [3, 1, 2],
      marker: { color: ['red', 'blue', 'green'], size: 9 },
      error_y: { type: 'data', array: ['2.2', '1.1', '1.6'], visible: true }
    }],
    layout: {
      title: { text: 'Scrambled' },
      xaxis: { title: { text: 'Dose (uM)' }, type: 'log' },
      yaxis: { title: { text: 'RFU' } }
    }
  });
  const sortedTrace = scrambled.graph.figure.data[0];
  assert.deepEqual(sortedTrace.x, [0.1, 1, 10], 'x is sorted ascending');
  assert.deepEqual(sortedTrace.y, [18.4, 55, 91.3], 'y follows x');
  assert.deepEqual(sortedTrace.text, ['A1', 'B2', 'C3'], 'point labels follow x');
  assert.deepEqual(sortedTrace.customdata, [1, 2, 3], 'customdata follows x');
  assert.deepEqual(sortedTrace.error_y.array, [1.1, 1.6, 2.2], 'error bars follow x');
  assert.deepEqual(sortedTrace.marker.color, ['blue', 'green', 'red'], 'per-point marker colors follow x');
  assert.equal(sortedTrace.marker.size, 9, 'scalar marker settings are untouched');
  assert.match(scrambled.normalization.join(' '), /reordered by ascending x/, 'the reorder is reported');
  assert.deepEqual(scrambled.graph.inspection.issues, [], 'the sorted figure inspects clean');

  // --- bars and marker-only scatters keep the order the model chose ---
  const barOrder = await runtime.execute({
    action: 'create',
    name: 'bar order',
    data: [{ type: 'bar', x: [10, 1, 5], y: [3, 1, 2] }],
    layout: { title: { text: 'Bars' }, xaxis: { title: { text: 'Dose' } }, yaxis: { title: { text: 'RFU' } } }
  });
  assert.deepEqual(barOrder.graph.figure.data[0].x, [10, 1, 5], 'bar order is deliberate');
  assert.equal(barOrder.normalization, undefined, 'nothing to report when nothing moved');

  // --- point indices would go stale, so that trace is flagged instead of sorted ---
  const selected = await runtime.execute({
    action: 'create',
    name: 'selection',
    data: [{ type: 'scatter', mode: 'lines', x: [3, 1, 2], y: [1, 2, 3], selectedpoints: [0] }],
    layout: { title: { text: 'Selection' }, xaxis: { title: { text: 'Dose' } }, yaxis: { title: { text: 'RFU' } } }
  });
  assert.deepEqual(selected.graph.figure.data[0].x, [3, 1, 2], 'a trace with selected points is left alone');
  assert.match(selected.graph.inspection.issues.join(' | '), /ascending order/, 'and the unsorted line is reported');

  // --- the assay mistakes inspect has to catch ---
  const messy = await runtime.execute({
    action: 'create',
    name: 'messy',
    data: [{
      type: 'scatter',
      mode: 'lines+markers',
      x: ['0', '10', '1'],
      y: ['1', '2', '3'],
      error_y: { type: 'data', array: ['0.1', '0.2'], visible: true }
    }],
    layout: {
      title: { text: 'Messy' },
      xaxis: { title: { text: 'Dose' }, type: 'log' },
      yaxis: { title: { text: 'RFU' } }
    }
  });
  const messyTrace = messy.graph.figure.data[0];
  assert.deepEqual(messyTrace.x, [0, 1, 10], 'x is sorted');
  assert.deepEqual(messyTrace.y, [1, 3, 2], 'y follows x');
  assert.deepEqual(messyTrace.error_y.array, [0.1, 0.2], 'a mismatched error array is left in place');
  const messyIssues = messy.graph.inspection.issues.join(' | ');
  assert.match(messyIssues, /error_y\.array has 2 value\(s\) but y has 3/, 'error bar length mismatch is reported');
  assert.match(messyIssues, /log scaled but 1 value/, 'non-positive value on a log axis is reported');

  // --- update re-normalizes replacement data ---
  const updated = await runtime.execute({
    action: 'update',
    id: messy.graph.id,
    data: [{ type: 'scatter', mode: 'lines+markers', x: ['1', '2', '3'], y: ['4', '5', '6'] }]
  });
  assert.deepEqual(updated.graph.figure.data[0].x, [1, 2, 3], 'updated traces are coerced too');
  assert.deepEqual(updated.graph.inspection.issues, [], 'the fixed figure inspects clean');

  console.log('agent-plotly-graph selfcheck: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
