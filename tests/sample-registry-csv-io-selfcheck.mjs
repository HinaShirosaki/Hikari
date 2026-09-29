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
  { code: 'C-2', name: 'Beta', type: 'cell_line', notes: 'line\nbreak', inventoryLink: null },
  { code: 'P-1', name: 'GFP-F', type: 'primer', details: { sequence: 'ATGGTG', direction: 'Forward', tm: '62' } }
];

// Round-trip: export -> parse preserves flat columns AND container placement.
const parsed = parseSamplesCsv(toSamplesCsv(samples, inventory));
assert.equal(parsed.length, 3);
assert.equal(parsed[2].sequence, 'ATGGTG'); // type-specific detail column
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
assert.equal(result.created, 3);
const primer = fresh.samples.find((s) => s.code === 'P-1');
assert.deepEqual(primer.details, { sequence: 'ATGGTG', direction: 'Forward', tm: '62' });
assert.equal(fresh.samples.find((s) => s.code === 'C-1').details, null); // no plasmid columns filled
// A CSV without detail columns keeps stored details; a present-but-blank column clears it.
mergeSamplesFromCsv(fresh, [{ code: 'P-1', name: 'GFP-F', type: 'primer' }], makeId);
assert.equal(primer.details.sequence, 'ATGGTG');
mergeSamplesFromCsv(fresh, [{ code: 'P-1', name: 'GFP-F', type: 'primer', tm: '' }], makeId);
assert.deepEqual(fresh.samples.find((s) => s.code === 'P-1').details, { sequence: 'ATGGTG', direction: 'Forward' });
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
assert.equal(again.updated, 3);
assert.equal(again.created, 0);
assert.equal(fresh.inventory['-80 Freezer #1'].length, 1);

// Out-of-range slot links to the container but no well.
const oob = { samples: [], inventory: {} };
mergeSamplesFromCsv(oob, [{ code: 'X', name: 'X', section: 'S', container: 'B', container_type: 'box81', well: '999' }], makeId);
assert.equal(oob.samples[0].inventoryLink.wellIndex, null);

// A CSV that only renames keeps everything it does not mention, including the
// type: falling back to plasmid would drop every antibody field.
const kept = { samples: [{ id: 's1', code: 'AB-1', name: 'anti-GFP', type: 'antibody', lot: 'L123', concentration: '1 mg/mL', notes: 'WB only', details: { target: 'GFP', dilution: '1:1000' } }] };
mergeSamplesFromCsv(kept, parseSamplesCsv('code,name\nAB-1,anti-GFP (renamed)\n'), makeId);
assert.deepEqual(
  (({ name, type, lot, concentration, notes, details }) => ({ name, type, lot, concentration, notes, details }))(kept.samples[0]),
  { name: 'anti-GFP (renamed)', type: 'antibody', lot: 'L123', concentration: '1 mg/mL', notes: 'WB only', details: { target: 'GFP', dilution: '1:1000' } }
);
mergeSamplesFromCsv(kept, parseSamplesCsv('code,name,lot\nAB-1,anti-GFP,\n'), makeId);
assert.equal(kept.samples[0].lot, ''); // a present-but-blank column still clears

// Detail values are stored whole, e.g. an 800 nt oligo.
const longOligo = 'ACGT'.repeat(200);
const oligo = { samples: [] };
mergeSamplesFromCsv(oligo, parseSamplesCsv(`code,name,type,sequence\nP-9,gBlock,primer,${longOligo}\n`), makeId);
assert.equal(oligo.samples[0].details.sequence, longOligo);

// Two different codes that reduce to the same allowed characters stay two samples.
const clash = { samples: [] };
const clashResult = mergeSamplesFromCsv(clash, parseSamplesCsv('code,name\nα-1,alpha\nβ-1,beta\nβ-1,beta again\n'), makeId);
assert.deepEqual(clash.samples.map((s) => `${s.code}:${s.name}`), ['-1:alpha', '-1-2:beta again']);
assert.deepEqual(clashResult.recoded, [{ from: 'β-1', to: '-1-2' }]);

// Rows without a name are skipped; header-only yields nothing.
assert.deepEqual(parseSamplesCsv('code,name\nX,'), []);
assert.deepEqual(parseSamplesCsv('code,name'), []);

console.log('csv-io self-check passed');
