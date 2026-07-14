// Run: node tests/sample-registry-csv-io-selfcheck.mjs
import assert from 'node:assert/strict';
import {
  mergeSamplesFromCsv,
  parseSamplesCsv,
  toSamplesCsv
} from '../src/renderer/modules/sample-registry/csv-io.js';

// A box with one placed sample, and a single-slot container.
const box = { id: 'cont-1', name: 'Box A', type: 'box81', wells: Array.from({ length: 81 }, (_v, i) => ({ name: `W${i + 1}`, content: '' })) };
const inventory = { '-80 Freezer #1': [box] };
const samples = [
  { code: 'C-1', name: 'Alpha', type: 'plasmid', lot: 'A1', concentration: '2 mg/mL', notes: 'has, comma and "quote"', inventoryLink: { section: '-80 Freezer #1', containerId: 'cont-1', wellIndex: 4 } },
  { code: 'C-2', name: 'Beta', type: 'cell_line', notes: 'line\nbreak', inventoryLink: null }
];

// Round-trip: export -> parse preserves flat columns AND container placement.
const parsed = parseSamplesCsv(toSamplesCsv(samples, inventory));
assert.equal(parsed.length, 2);
assert.equal(parsed[0].notes, 'has, comma and "quote"');
assert.equal(parsed[0].section, '-80 Freezer #1');
assert.equal(parsed[0].container, 'Box A');
assert.equal(parsed[0].container_type, 'box81');
assert.equal(parsed[0].well, '5'); // wellIndex 4 -> slot 5 (1-based)
assert.equal(parsed[1].section, ''); // unplaced sample

// Import into an EMPTY db re-creates the container and re-places the sample.
const fresh = { samples: [], inventory: {} };
let n = 0;
const makeId = () => `t${(n += 1)}`;
const result = mergeSamplesFromCsv(fresh, parsed, makeId);
assert.equal(result.created, 2);
const box2 = fresh.inventory['-80 Freezer #1'][0];
assert.equal(box2.name, 'Box A');
assert.equal(box2.type, 'box81');
assert.equal(box2.wells.length, 81);
const alpha = fresh.samples.find((s) => s.code === 'C-1');
assert.equal(alpha.inventoryLink.containerId, box2.id);
assert.equal(alpha.inventoryLink.wellIndex, 4);
assert.equal(alpha.location.box, 'Box A'); // location derived from the link
assert.equal(fresh.samples.find((s) => s.code === 'C-2').inventoryLink, null);

// Re-import reuses the same container (matched by name) and updates in place — no duplicates.
const again = mergeSamplesFromCsv(fresh, parsed, makeId);
assert.equal(again.updated, 2);
assert.equal(again.created, 0);
assert.equal(fresh.inventory['-80 Freezer #1'].length, 1);

// Out-of-range slot links to the container but no well.
const oob = { samples: [], inventory: {} };
mergeSamplesFromCsv(oob, [{ code: 'X', name: 'X', section: 'S', container: 'B', container_type: 'box81', well: '999' }], makeId);
assert.equal(oob.samples[0].inventoryLink.wellIndex, null);

// Rows without a name are skipped; header-only yields nothing.
assert.deepEqual(parseSamplesCsv('code,name\nX,'), []);
assert.deepEqual(parseSamplesCsv('code,name'), []);

console.log('csv-io self-check passed');
