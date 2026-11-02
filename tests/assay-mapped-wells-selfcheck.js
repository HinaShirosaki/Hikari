#!/usr/bin/env node
// Self-check: isMappedWell runs once per result-grid cell, so its well set must
// be built once per layout, not per call (a 1536-well plate was O(n^2)).
// Run: node tests/assay-mapped-wells-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const { createAxisValues } = loadEsmStyleModule(path.join(root, 'src/renderer/modules/assay/layout/axis-values.js'));

const runtime = { currentLayout: [{ well: 'A1', sampleId: 'S1', concentration: '1' }] };
const axis = createAxisValues({ runtime, getCurrentDefinition: () => ({ rows: 32, columns: 48 }), getSampleAxis: () => 'row' });

assert.equal(axis.getMappedWellSet(), axis.getMappedWellSet(), 'same layout reuses one well set');
assert.ok(axis.isMappedWell('a1'), 'lookup is case-insensitive');
assert.ok(!axis.isMappedWell('A2'));

runtime.currentLayout = [{ well: 'A2', sampleId: 'S2', concentration: '' }];
assert.ok(!axis.isMappedWell('A1'), 'a new layout array drops the old wells');
assert.ok(axis.isMappedWell('A2'), 'a new layout array is picked up');

console.log('assay mapped-wells selfcheck passed');
