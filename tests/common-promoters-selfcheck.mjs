import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { COMMON_PROMOTERS } from '../src/renderer/modules/sequence-viewer/data/common-promoters.js';

const require = createRequire(import.meta.url);
const {
  annotateCircularPlasmidSequenceSync,
  normalizeDnaSequence,
  reverseComplementDna
} = require('../src/renderer/modules/sequence-viewer/algorithms/circular-plasmid-annotation');
const { loadCommonPromoters } = require('../src/renderer/modules/sequence-viewer/algorithms/sequence-backbone-recognition/assets.js');
const { MIN_QUERY_LENGTH } = require('../src/renderer/modules/sequence-viewer/algorithms/sequence-backbone-recognition/constants.js');

// Backbone recognition matches each record whole and exactly, so every entry has
// to be strict unambiguous DNA and long enough to survive the loader's filters.
const labels = new Set();
const sequences = new Set();
for (const record of COMMON_PROMOTERS) {
  assert.match(record.sequence, /^[ACGT]+$/, `${record.label} is not strict ACGT`);
  assert.ok(record.sequence.length >= MIN_QUERY_LENGTH, `${record.label} is too short to match`);
  assert.ok(!labels.has(record.label), `duplicate label ${record.label}`);
  assert.ok(!sequences.has(record.sequence), `duplicate sequence on ${record.label}`);
  labels.add(record.label);
  sequences.add(record.sequence);
}

const loaded = await loadCommonPromoters(normalizeDnaSequence);
assert.equal(loaded.length, COMMON_PROMOTERS.length, 'the loader dropped promoter records');

// Each promoter is found, on either strand, inside a plasmid that carries it.
const filler = 'GATCTAGCCATGCAAGTTCGA';
for (const record of COMMON_PROMOTERS) {
  for (const strand of [1, -1]) {
    const insert = strand === 1 ? record.sequence : reverseComplementDna(record.sequence);
    const plasmid = `${filler}${insert}${filler}`;
    const hits = annotateCircularPlasmidSequenceSync(plasmid, [record], {
      maxWorkers: 1,
      maxHitsPerRecord: 16,
      minRecordLength: MIN_QUERY_LENGTH
    }).matches;
    assert.equal(hits.length, 1, `${record.label} matched ${hits.length} times on strand ${strand}`);
    assert.equal(hits[0].identity, 1, `${record.label} matched with mismatches`);
    assert.equal(hits[0].matchedLength, record.sequence.length, `${record.label} matched partially`);
  }
}

console.log(`common-promoters-selfcheck: ok (${COMMON_PROMOTERS.length} promoters)`);
