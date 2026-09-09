// A PCR template is double-stranded. Vector Builder inserts a stored feature in
// the recipient site's orientation, so a minus-strand site (or a feature stored
// off a donor's minus strand) puts the reverse complement of the donor's plus
// strand into the record. A plus-strand-only containment scan called that the
// wrong donor and every insert route came back infeasible.
import assert from 'node:assert/strict';
import { resolveFragmentPrimerTemplate } from '../src/renderer/modules/sequence-viewer/cloning-assembly/primer-records.js';

let seed = 20260909;
function dna(length) {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'[Math.floor((seed / 0x7fffffff) * 4)];
  }
  return out;
}

function reverseComplement(sequence) {
  const complement = { A: 'T', T: 'A', G: 'C', C: 'G' };
  return [...sequence].reverse().map((base) => complement[base]).join('');
}

const insert = dna(600);
const donor = `${dna(1500)}${insert}${dna(2200)}`;

function resolve(desiredSequence) {
  return resolveFragmentPrimerTemplate({
    id: 'insert',
    name: 'Insert amplicon',
    sequence: desiredSequence,
    metadata: { source: 'donor_plasmid', templateName: 'pDonor', templateSequence: donor }
  });
}

const sameStrand = resolve(insert);
assert.equal(sameStrand.feasible, true, 'plus-strand insert must amplify off the donor');
assert.equal(sameStrand.templateSequence, insert);

const flipped = resolve(reverseComplement(insert));
assert.equal(flipped.feasible, true, 'minus-strand insert must amplify off the same donor');
assert.equal(flipped.templateSequence, reverseComplement(insert));
assert.deepEqual(flipped.blockingWarnings, []);

// A genuinely unrelated donor still has to be rejected.
const wrongDonor = resolveFragmentPrimerTemplate({
  id: 'insert',
  name: 'Insert amplicon',
  sequence: insert,
  metadata: { source: 'donor_plasmid', templateName: 'pOther', templateSequence: dna(4000) }
});
assert.equal(wrongDonor.feasible, false, 'an unrelated donor must still be reported');

console.log('cloning-donor-strand-selfcheck: ok');
