// A PCR template is double-stranded. Vector Builder inserts a stored feature in
// the recipient site's orientation, so a minus-strand site (or a feature stored
// off a donor's minus strand) puts the reverse complement of the donor's plus
// strand into the record. A plus-strand-only containment scan called that the
// wrong donor and every insert route came back infeasible.
import assert from 'node:assert/strict';
import { resolveFragmentPrimerTemplate } from '../src/renderer/modules/sequence-viewer/cloning-assembly/primer-records.js';
import { selectBindingWindow } from '../src/renderer/modules/sequence-viewer/cloning-assembly/overlap-windows.js';

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

// The template is the user's declared choice, so an unrelated donor is named in
// a warning and the design still proceeds off the assembled fragment.
const wrongDonor = resolveFragmentPrimerTemplate({
  id: 'insert',
  name: 'Insert amplicon',
  sequence: insert,
  metadata: { source: 'donor_plasmid', templateName: 'pOther', templateSequence: dna(4000) }
});
assert.equal(wrongDonor.feasible, true, 'an unrelated donor must advise, not veto');
assert.deepEqual(wrongDonor.blockingWarnings, []);
assert.equal(wrongDonor.templateSequence, insert, 'primers fall back to the assembled fragment');
assert.match(wrongDonor.warnings.join(' '), /pOther does not visibly carry this fragment/);

// A window the donor carries twice is a second PCR product, not a stale record,
// so it still fails the route -- no note makes it work.
const repeatedDonor = `${insert}${dna(300)}${insert}`;
const thresholds = { primerLength: { min: 18, max: 30 }, primerTm: { min: 45, max: 75 }, overlapTm: { min: 45, max: 75 } };
assert.equal(
  selectBindingWindow(insert, 'forward', thresholds, 0, { specificitySequence: repeatedDonor }),
  null,
  'a repeated template must still block'
);
// ...while one the donor does not carry at all designs, and says so.
const absentWindow = selectBindingWindow(insert, 'forward', thresholds, 0, { specificitySequence: dna(2000) });
assert.ok(absentWindow, 'an absent template must not block');
assert.match(absentWindow.specificityWarning, /off the assembled sequence/);

console.log('cloning-donor-strand-selfcheck: ok');
