#!/usr/bin/env node
// Self-check for structure-aware reverse translation: the protein has to survive the
// swaps, the mRNA has to end up less structured, and the constraints the usage-only
// reverse translation honoured (restriction sites, codon preference) have to hold.
// Run: node tests/codon-optimizer-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const calculations = path.join(root, 'src/renderer/modules/sequence-viewer/calculations');
const { reverseTranslateForExpression } = loadEsmStyleModule(path.join(calculations, 'codon-optimizer.js'));
const { reverseTranslateProteinSequence, translateDnaCodon, translateDnaSequence } = loadEsmStyleModule(
  path.join(calculations, 'sequence.js')
);
const { foldOligo } = loadEsmStyleModule(path.join(calculations, 'fold.js'));

const PROTEIN = 'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGE'; // structured 5' end in E. coli codons

const seed = reverseTranslateProteinSequence(PROTEIN, { organism: 'ecoli' });
const optimized = reverseTranslateForExpression(PROTEIN, { organism: 'ecoli' });
const report = optimized.structureOptimization;
const seedWindows = [];
for (let start = 0; start === 0 || start + 20 <= seed.dna.length; start += 20) {
  seedWindows.push(foldOligo(seed.dna.slice(start, start + 40), { type: 'RNA' }).deltaG);
}

// --- the protein is the one thing that may never change ---
assert.equal(optimized.ok, true, 'optimization succeeds on a normal protein');
assert.equal(translateDnaSequence(optimized.dna, 1, 'star').protein, PROTEIN, 'the DNA still codes the protein');
assert.equal(optimized.dna.length, PROTEIN.length * 3, 'no bases gained or lost');
assert.equal(optimized.codons.join(''), optimized.dna, 'the codon list matches the DNA');
report.swaps.forEach(({ from, to, codonIndex }) => {
  assert.equal(translateDnaCodon(from), translateDnaCodon(to), `swap at codon ${codonIndex} is synonymous`);
});

// --- and structure is what it buys ---
assert.ok(report.applied, 'a structured 5' + "' end gets optimized");
assert.ok(report.swaps.length > 0, 'optimization means swaps');
assert.ok(
  report.fivePrimeDeltaGAfter > report.fivePrimeDeltaGBefore,
  `5' window should relax: ${report.fivePrimeDeltaGBefore} -> ${report.fivePrimeDeltaGAfter}`
);
assert.ok(
  report.worstDeltaGAfter > report.worstDeltaGBefore,
  `worst window should relax: ${report.worstDeltaGBefore} -> ${report.worstDeltaGAfter}`
);
assert.equal(report.fivePrimeDeltaGBefore, seedWindows[0], 'the 5-prime baseline is measured on the usage-only seed');
assert.equal(
  report.worstDeltaGBefore,
  Math.min(0, ...seedWindows),
  'the reported worst baseline is measured before any synonymous swap'
);
report.swaps.forEach((swap) => assert.ok(
  swap.deltaGAfter > swap.deltaGBefore,
  `swap at codon ${swap.codonIndex} has to weaken its window, not pay structure for preference`
));
assert.ok(
  optimized.preferenceScorePercent < seed.preferenceScorePercent,
  'relief is paid for in codon preference, and the score says so'
);
assert.ok(optimized.preferenceScorePercent > 70, 'but the sequence stays close to the usage table');

// --- constraints inherited from the usage-only reverse translation ---
const guarded = reverseTranslateForExpression(PROTEIN, {
  organism: 'ecoli',
  restrictionSites: 'GAATTC GGATCC AAGCTT'
});
assert.equal(translateDnaSequence(guarded.dna, 1, 'star').protein, PROTEIN, 'guarded run still codes the protein');
['GAATTC', 'GGATCC', 'AAGCTT'].forEach((site) => {
  assert.ok(!guarded.dna.includes(site), `swaps must not introduce ${site}`);
});

// --- the knobs ---
const usageLocked = reverseTranslateForExpression(PROTEIN, { organism: 'ecoli', usageWeight: 1000 });
assert.equal(usageLocked.structureOptimization.swaps.length, 0, 'a high usage weight refuses to pay for relief');
assert.equal(usageLocked.dna, seed.dna, 'and hands back the usage-only sequence');
assert.equal(usageLocked.preferenceScorePercent, seed.preferenceScorePercent, 'with its preference intact');

// An unstructured transcript has nothing to buy, so the seed is returned untouched.
const flat = reverseTranslateForExpression('KKKKKKKKKKKKKKK', { organism: 'ecoli' });
assert.equal(flat.structureOptimization.applied, false, 'no structure, no optimization');
assert.equal(flat.dna, reverseTranslateProteinSequence('KKKKKKKKKKKKKKK', { organism: 'ecoli' }).dna, 'seed kept');

// Failures pass straight through from the reverse translation.
assert.equal(reverseTranslateForExpression('').ok, false, 'an empty protein still fails cleanly');
assert.equal(reverseTranslateForExpression('MVZK').reason, 'unsupported_residue', 'bad residues still reported');

console.log('codon optimizer self-check passed');
