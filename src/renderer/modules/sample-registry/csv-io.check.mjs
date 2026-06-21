// Run: node src/renderer/modules/sample-registry/csv-io.check.mjs
import assert from 'node:assert/strict';
import { mergeSamplesFromCsv, parseSamplesCsv, toSamplesCsv } from './csv-io.js';

const samples = [
  { code: 'C-1', name: 'Alpha', type: 'plasmid', lot: 'A1', concentration: '2 mg/mL', notes: 'has, comma and "quote"' },
  { code: 'C-2', name: 'Beta', type: 'cell_line', lot: '', concentration: '', notes: 'line\nbreak' }
];

// Round-trip: export -> parse preserves the flat columns, including quoted commas/newlines in notes.
const parsed = parseSamplesCsv(toSamplesCsv(samples));
assert.equal(parsed.length, 2);
assert.equal(parsed[0].notes, 'has, comma and "quote"');
assert.equal(parsed[1].notes, 'line\nbreak');
assert.equal(parsed[1].type, 'cell_line');

// Upsert by code: C-1 updates in place, C-3 is appended; type gets formatted, blank type defaults.
const { samples: merged, created, updated } = mergeSamplesFromCsv(
  samples,
  [{ code: 'C-1', name: 'Alpha v2', type: 'Plasmid' }, { code: 'C-3', name: 'Gamma', type: '' }]
);
assert.equal(created, 1);
assert.equal(updated, 1);
assert.equal(merged.length, 3);
assert.equal(merged.find((item) => item.code === 'C-1').name, 'Alpha v2');
assert.equal(merged.find((item) => item.code === 'C-1').type, 'plasmid');
assert.equal(merged.find((item) => item.code === 'C-3').type, 'plasmid');

// Rows without a name are skipped; a header-only file yields nothing.
assert.deepEqual(parseSamplesCsv('code,name\nX,'), []);
assert.deepEqual(parseSamplesCsv('code,name'), []);

console.log('csv-io self-check passed');
