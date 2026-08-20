#!/usr/bin/env node
// Self-check for oligo MFE folding: hand-computed hairpin energies, structure
// invariants, and the knobs (type, temperature, salt) actually moving the answer.
// Run: node tests/oligo-fold-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const { foldOligo } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/sequence-viewer/calculations/fold.js')
);

const close = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) < 0.02,
  `${message}: expected ~${expected}, got ${actual}`
);

// Every reported structure has to be a legal one: balanced, self-consistent,
// complementary, and with loops long enough to close.
function checkInvariants(result) {
  const { sequence, structure, pairs, type } = result;
  const pairable = type === 'RNA'
    ? ['AU', 'UA', 'GC', 'CG', 'GU', 'UG']
    : ['AT', 'TA', 'GC', 'CG'];
  assert.equal(structure.length, sequence.length, 'structure covers the sequence');
  const open = [];
  const derived = [];
  [...structure].forEach((symbol, index) => {
    if (symbol === '(') {
      open.push(index);
    } else if (symbol === ')') {
      assert.ok(open.length, `unbalanced ")" at ${index} in ${structure}`);
      derived.push([open.pop(), index]);
    }
  });
  assert.equal(open.length, 0, `unbalanced "(" in ${structure}`);
  // JSON, because the module under test runs in its own vm realm and its arrays
  // fail a strict prototype comparison.
  assert.equal(
    JSON.stringify(derived.sort((a, b) => a[0] - b[0])),
    JSON.stringify([...pairs].sort((a, b) => a[0] - b[0])),
    'dot-bracket and pair list agree'
  );
  pairs.forEach(([i, j]) => {
    assert.ok(j - i > 3, `pair ${i}-${j} leaves no room for a hairpin loop`);
    assert.ok(pairable.includes(sequence[i] + sequence[j]), `${sequence[i]}-${sequence[j]} is not a pair`);
  });
}

// --- hand-computed hairpins ---

// DNA GGGG/CCCC stem: three GG stacks (dH -8.0, dS -19.9 => dG37 -1.828) and a
// 4 nt hairpin loop (3.4).
const dnaHairpin = foldOligo('GGGGAAAACCCC');
assert.equal(dnaHairpin.type, 'DNA', 'no U means DNA');
assert.equal(dnaHairpin.structure, '((((....))))', 'four-base stem closing a tetraloop');
close(dnaHairpin.deltaG, 3 * -1.8285 + 3.4, 'DNA hairpin dG37');
checkInvariants(dnaHairpin);

// Same fold as RNA: three 5'GG3'/3'CC5' stacks (-3.3) and Turner's 4 nt loop (5.6).
const rnaHairpin = foldOligo('GGGGAAAACCCC', { type: 'RNA' });
assert.equal(rnaHairpin.sequence, 'GGGGAAAACCCC', 'RNA keeps the input bases');
assert.equal(rnaHairpin.structure, '((((....))))', 'same stem in the RNA model');
close(rnaHairpin.deltaG, 3 * -3.3 + 5.6, 'RNA hairpin dG37');

// --- input handling ---
assert.equal(foldOligo('gggguuuuccc c').type, 'RNA', 'U without T is read as RNA');
assert.equal(foldOligo('GGGGTTTTCCCC', { type: 'RNA' }).sequence, 'GGGGUUUUCCCC', 'T is transcribed for RNA');
assert.equal(foldOligo('GGGGAAAACCCC ').sequence.length, 12, 'whitespace is ignored');
assert.equal(foldOligo('AAAAAAAAAAAA').pairs.length, 0, 'poly-A cannot fold');
assert.equal(foldOligo('AAAAAAAAAAAA').deltaG, 0, 'an unfolded oligo is 0 kcal/mol, not positive');
assert.equal(foldOligo('NNNNAAAANNNN').pairs.length, 0, 'unknown bases never pair');
assert.equal(foldOligo('GGGGNNNNCCCC').structure, '((((....))))', 'unknown bases can still sit in a loop');
assert.throws(() => foldOligo('A'.repeat(40), { maxLength: 20 }), /exceeds maxLength/, 'long input is refused, not hung on');

// --- conditions move the answer in the right direction ---
assert.ok(
  foldOligo('GGGGAAAACCCC', { temperatureCelsius: 75 }).deltaG > dnaHairpin.deltaG,
  'the hairpin is less stable when hot'
);
assert.ok(
  foldOligo('GGGGAAAACCCC', { sodiumMolar: 0.05 }).deltaG > dnaHairpin.deltaG,
  'less salt destabilises the stem'
);

// --- loops beyond a plain stem ---
// A bulged stem: the inserted A cannot pair, so the fold has to buy a bulge loop.
const bulged = foldOligo('GGGCAGGGAAAACCCTCCC');
checkInvariants(bulged);
assert.ok(bulged.deltaG < -3, `expected a stable bulged stem, got ${bulged.deltaG}`);
assert.ok(bulged.structure.includes('.('), `expected an unpaired base inside the stem: ${bulged.structure}`);

// Two hairpins under one stem: keeps the multibranch recursion and its traceback covered.
const multiloop = foldOligo('ACCUGCGCCAUCAUGCCCCCAGAAACAAUCUUGCUGGCUUGAACAGCAUAUCCAUGACCGUAGGAAGA', { type: 'RNA' });
checkInvariants(multiloop);
assert.match(multiloop.structure, /\)[^()]*\(/, `expected sibling branches inside a stem: ${multiloop.structure}`);

// A hairpin with a mismatch in the stem, and a longer primer-sized oligo, both have to
// come back as legal structures.
checkInvariants(foldOligo('GCGCTTGCGCAAAAGCGCAAGCGC'));
checkInvariants(foldOligo('CAGGAAACAGCTATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGAC', { type: 'DNA' }));
checkInvariants(foldOligo('GGCUAGCUCAGUCGGUAGAGCAGGGGAUUGAAAAUCCCCGUGUCCUUGGUUCGAUUCCGAGUCUGGGCA', { type: 'RNA' }));

console.log('oligo fold self-check passed');
