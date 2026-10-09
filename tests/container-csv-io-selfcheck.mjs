// Run: node tests/container-csv-io-selfcheck.mjs
import assert from 'node:assert/strict';
import {
  containerToCsv,
  mergeContainerCsv,
  parseContainerCsv
} from '../src/renderer/modules/personal-inventory/csv-io.js';

const section = '-80 Freezer #1';
const makeBox = (id) => ({ id, name: 'Box A', type: 'box81', wells: Array.from({ length: 81 }, (_v, i) => ({ name: `W${i + 1}`, content: '' })) });
const box = makeBox('cont-1');
const at = (wellIndex) => ({ section, containerId: 'cont-1', wellIndex });
const samples = [
  { code: 'C-1', name: 'Alpha', type: 'plasmid', lot: 'A1', concentration: '2 mg/mL', notes: 'has, comma and "quote"', inventoryLink: at(4) },
  { code: 'C-2', name: 'Beta', type: 'cell_line', notes: 'line\nbreak', inventoryLink: at(4) },
  { code: 'P-1', name: 'GFP-F', type: 'primer', details: { sequence: 'ATGGTG', direction: 'Forward', tm: '62' }, inventoryLink: at(0) },
  { code: 'ELSEWHERE', name: 'Other box', type: 'plasmid', inventoryLink: { section, containerId: 'cont-2', wellIndex: 0 } }
];

// Export covers only this box, every well (empty ones as blank rows), and
// round-trips quoting, newlines, two samples in one well, and detail columns.
const csv = containerToCsv(samples, section, box);
assert.equal(csv.split('\r\n')[0].split(',')[0], 'well');
const parsed = parseContainerCsv(csv);
assert.deepEqual(parsed.map((row) => `${row.well}:${row.code}`), ['W1:P-1', 'W5:C-1', 'W5:C-2']);
assert.equal(parsed[1].notes, 'has, comma and "quote"');
assert.equal(parsed[2].notes, 'line\nbreak');
assert.equal(parsed[0].sequence, 'ATGGTG');
assert.equal(csv.includes('ELSEWHERE'), false);
assert.equal(parseContainerCsv(csv.replace(/\r\n[^\r\n]*$/, '')).length, 3, 'empty well rows are dropped on parse');

// Import into an empty box places each row in its well.
let n = 0;
const makeId = () => `t${(n += 1)}`;
const fresh = { samples: [] };
const freshBox = makeBox('cont-9');
assert.deepEqual(mergeContainerCsv(fresh, section, freshBox, parsed, makeId), { created: 3, updated: 0, skipped: 0, recoded: [] });
const alpha = fresh.samples.find((s) => s.code === 'C-1');
assert.deepEqual(alpha.inventoryLink, { section, containerId: 'cont-9', wellIndex: 4 });
assert.equal(alpha.location.box, 'Box A');
assert.equal(alpha.location.position, 'W5');
assert.deepEqual(fresh.samples.find((s) => s.code === 'P-1').details, { sequence: 'ATGGTG', direction: 'Forward', tm: '62' });
assert.equal(alpha.details, null); // no plasmid columns filled

// Re-import updates in place by code: no duplicates.
assert.deepEqual(mergeContainerCsv(fresh, section, freshBox, parsed, makeId), { created: 0, updated: 3, skipped: 0, recoded: [] });
assert.equal(fresh.samples.length, 3);

// Well labels match case-insensitively; unknown wells are skipped, not guessed.
const labels = { samples: [] };
const labelResult = mergeContainerCsv(labels, section, makeBox('b'), parseContainerCsv('well,name\nw2,ok\nZ9,lost\n'), makeId);
assert.equal(labelResult.created, 1);
assert.equal(labelResult.skipped, 1);
assert.equal(labels.samples[0].inventoryLink.wellIndex, 1);

// Without a well column nothing could be placed, so the import is refused.
assert.throws(() => parseContainerCsv('code,name\nX,x\n'), /"well" column/);

// A CSV that only renames keeps everything it does not mention, including the
// type: falling back to plasmid would drop every antibody field.
const kept = { samples: [{ id: 's1', code: 'AB-1', name: 'anti-GFP', type: 'antibody', lot: 'L123', concentration: '1 mg/mL', notes: 'WB only', details: { target: 'GFP', dilution: '1:1000' } }] };
mergeContainerCsv(kept, section, box, parseContainerCsv('well,code,name\nW1,AB-1,anti-GFP (renamed)\n'), makeId);
assert.deepEqual(
  (({ name, type, lot, concentration, notes, details }) => ({ name, type, lot, concentration, notes, details }))(kept.samples[0]),
  { name: 'anti-GFP (renamed)', type: 'antibody', lot: 'L123', concentration: '1 mg/mL', notes: 'WB only', details: { target: 'GFP', dilution: '1:1000' } }
);
mergeContainerCsv(kept, section, box, parseContainerCsv('well,code,name,lot\nW1,AB-1,anti-GFP,\n'), makeId);
assert.equal(kept.samples[0].lot, ''); // a present-but-blank column still clears
mergeContainerCsv(kept, section, box, parseContainerCsv('well,code,name,tm\nW1,AB-1,anti-GFP,\n'), makeId);
assert.deepEqual(kept.samples[0].details, { target: 'GFP', dilution: '1:1000' });

// Detail values are stored whole, e.g. an 800 nt oligo.
const longOligo = 'ACGT'.repeat(200);
const oligo = { samples: [] };
mergeContainerCsv(oligo, section, box, parseContainerCsv(`well,code,name,type,sequence\nW1,P-9,gBlock,primer,${longOligo}\n`), makeId);
assert.equal(oligo.samples[0].details.sequence, longOligo);

// Two different codes that reduce to the same allowed characters stay two samples.
const clash = { samples: [] };
const clashResult = mergeContainerCsv(clash, section, box, parseContainerCsv('well,code,name\nW1,α-1,alpha\nW2,β-1,beta\nW3,β-1,beta again\n'), makeId);
assert.deepEqual(clash.samples.map((s) => `${s.code}:${s.name}`), ['-1:alpha', '-1-2:beta again']);
assert.deepEqual(clashResult.recoded, [{ from: 'β-1', to: '-1-2' }]);

// Rows without a name are skipped; header-only yields nothing.
assert.deepEqual(parseContainerCsv('well,code,name\nW1,X,'), []);
assert.deepEqual(parseContainerCsv('well,name'), []);

console.log('container csv-io self-check passed');
