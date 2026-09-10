import assert from 'node:assert/strict';
import test from 'node:test';
import { reverseComplementDna as rc } from '../src/renderer/modules/sequence-viewer/calculations/sequence.js';
import { CLONING_PRIMER_TM_THRESHOLDS as levels } from '../src/renderer/modules/sequence-viewer/cloning-assembly/constants.js';
import { assembleCloningPlan } from '../src/renderer/modules/sequence-viewer/cloning-assembly/assembly-plan.js';
import { designCloningPrimers } from '../src/renderer/modules/sequence-viewer/cloning-assembly/primer-design.js';
import { designAssemblyPrimersForRoute } from '../src/renderer/modules/sequence-viewer/cloning-assembly/assembly-primers.js';
import { evaluateFragmentAssembly, evaluateJunction } from '../src/renderer/modules/sequence-viewer/cloning-assembly/overlap-evaluation.js';
import { selectEngineeredOverlap, selectBindingWindow } from '../src/renderer/modules/sequence-viewer/cloning-assembly/overlap-windows.js';
import { resolveFragmentPrimerTemplate } from '../src/renderer/modules/sequence-viewer/cloning-assembly/primer-records.js';

function dna(length, seed) {
  let state = seed >>> 0;
  let out = '';
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    out += 'ACGT'[state % 4];
  }
  return out;
}

const fragments = [
  { id: 'a', name: 'A', type: 'insert', sequence: dna(180, 24) },
  { id: 'b', name: 'B', type: 'insert', sequence: dna(180, 124) }
];
const wide = { primerLength: { min: 18, max: 32 }, primerTm: { min: 0, max: 100 }, overlapTm: { min: 0, max: 100 } };

test('multiple stocks require an explicit choice; unused stock ambiguity is ignored', () => {
  const hostVectors = [{ id: 'a', sequence: dna(500, 4) }, { id: 'unused', sequence: 'NNNN' }];
  const payload = { hostVectors, fragments, preferences: { allowRestrictionLigation: false } };
  for (const hostVectorId of ['', 'missing']) {
    const plan = assembleCloningPlan({ ...payload, hostVectorId });
    assert.equal(plan.feasible, false);
    assert.equal(plan.selectedHost, null);
    assert.match(plan.warnings.join(' '), /Select one available host/);
  }
  const chosen = assembleCloningPlan({ ...payload, hostVectorId: 'a' });
  assert.equal(chosen.selectedHost.id, 'a');
  assert.ok(!chosen.warnings.some((warning) => /unresolved/.test(warning)));
});

test('a tagged fragment needs an asymmetric split and reconstructs the exact product', () => {
  const tag = dna(32, 224);
  const right = { ...fragments[1], sequence: tag + fragments[1].sequence, metadata: { templateSequence: fragments[1].sequence } };
  const config = { maxPrimerLength: 60, minEngineeredOverlapLength: 20, maxEngineeredOverlapLength: 30 };
  const evaluation = evaluateFragmentAssembly([fragments[0], right], { thresholds: levels.relaxed, preferences: config });
  assert.equal(evaluation.feasible, true);
  const seam = evaluation.junctions[0];
  assert.ok(seam.rightForwardTail.length > 0);
  assert.notEqual(seam.rightForwardTail.length, Math.ceil(seam.overlapLength / 2));
  // The previous 50/50 fallback cannot fit the tag plus even the shortest binding window.
  assert.equal(selectBindingWindow(fragments[1].sequence, 'forward', levels.relaxed, tag.length + Math.ceil(seam.overlapLength / 2), config), null);
  const design = designAssemblyPrimersForRoute(evaluation.fragments, evaluation.junctions, levels.relaxed, config);
  assert.equal(design.feasible, true);
  assert.equal(design.primers.length, 4);
  for (const primer of design.primers) assert.ok(primer.length <= 60);
  const amplicon = (id, template) => {
    const pair = design.primers.filter((primer) => primer.templateId === id);
    return pair[0].tailSequence + template + rc(pair[1].tailSequence);
  };
  const leftProduct = amplicon('a', fragments[0].sequence);
  const rightProduct = amplicon('b', fragments[1].sequence);
  assert.equal(leftProduct.slice(-seam.overlapLength), rightProduct.slice(0, seam.overlapLength));
  assert.equal(leftProduct + rightProduct.slice(seam.overlapLength), fragments[0].sequence + right.sequence);
  const fallback = designCloningPrimers({ strategy: 'overlap-pcr', fragmentMap: { fragments: [fragments[0], right] }, preferences: config });
  assert.equal(fallback.feasible, true);
  assert.equal(fallback.selectedThresholdLevel, 'relaxed');
  assert.equal(fallback.attempts[0].feasible, false);
  assert.deepEqual(fallback.junctions, evaluation.junctions);
});

test('an impossible overlap minimum is never silently shortened', () => {
  assert.equal(selectEngineeredOverlap(...fragments, wide, { minEngineeredOverlapLength: 25, maxEngineeredOverlapLength: 20 }), null);
});

test('junction feasibility requires both PCR binding windows even for one-sided tails', () => {
  const result = evaluateFragmentAssembly([
    { id: 'a', sequence: 'ATATATATATATGGGGGGGGGGGGGGAAAA' },
    { id: 'b', sequence: 'GCGCGCGCGCGCGCGCGTTTAAAATTTAAA' }
  ]);
  assert.equal(result.feasible, false);
});

test('a weak declared overlap cannot be duplicated by an engineered seam', () => {
  const overlap = 'ATATATATATATATATATAT';
  const left = { id: 'a', sequence: dna(100, 12) + overlap, metadata: { sharedOverlapWithNext: true } };
  const right = { id: 'b', sequence: overlap + dna(100, 22) };
  const junction = evaluateJunction(left, right, levels.strict);
  assert.equal(junction.feasible, false);
  assert.equal(junction.mode, 'weak-existing');
  assert.match(junction.warnings[0], /Adjust the fragment boundaries/);
});

test('fragment order must reproduce the requested product, with circular rotation allowed', () => {
  const product = fragments.map((fragment) => fragment.sequence).join('');
  const options = { thresholds: wide, resultSequence: product };
  assert.equal(evaluateFragmentAssembly(fragments, options).feasible, true);
  assert.equal(evaluateFragmentAssembly([...fragments].reverse(), options).feasible, false);
  assert.equal(evaluateFragmentAssembly([...fragments].reverse(), { ...options, circular: true }).feasible, true);
  const wrongBase = product[0] === 'A' ? 'C' : 'A';
  const wrong = evaluateFragmentAssembly(fragments, { ...options, resultSequence: wrongBase + product.slice(1) });
  assert.equal(wrong.feasible, false);
  assert.match(wrong.warnings.join(' '), /does not reconstruct/);
});

test('primer design recomputes stale junction metadata from the intended fragment sequences', () => {
  const args = { strategy: 'overlap-pcr', fragmentMap: { fragments } };
  const expected = designCloningPrimers(args);
  const stale = designCloningPrimers({ ...args, routeEvaluations: { overlapPCR: { junctions: [{ leftFragmentId: 'a', rightFragmentId: 'b', overlapTm: 999, mode: 'primer-introduced', leftReverseTail: 'AAAA' }] } } });
  assert.equal(stale.feasible, true);
  assert.deepEqual(stale.primers, expected.primers);
  assert.deepEqual(stale.junctions, expected.junctions);
});

test('chosen circular donors support origin-spanning cores and terminal additions on either strand', () => {
  const donor = dna(800, 81);
  const core = donor.slice(-100) + donor.slice(0, 100);
  for (const target of [core, rc(core)]) {
    const desired = 'CATCATCATCATCAC' + target;
    const design = resolveFragmentPrimerTemplate({ sequence: desired, metadata: { templateSequence: donor, specificityCircular: true } });
    assert.equal(design.templateSequence, target);
    assert.equal(design.forwardAddedSequence, 'CATCATCATCATCAC');
    assert.equal(design.reverseAddedSequence, '');
  }
});

test('arbitrary internal stock similarity cannot redefine fragment geometry', () => {
  const desired = dna(1500, 31);
  const donor = dna(600, 41) + desired.slice(200, 900) + dna(600, 43);
  const design = resolveFragmentPrimerTemplate({ sequence: desired, metadata: { templateSequence: donor, templateName: 'Chosen donor' } });
  assert.equal(design.templateSequence, desired);
  assert.equal(design.forwardAddedSequence, '');
  assert.equal(design.reverseAddedSequence, '');
  assert.match(design.warnings.join(' '), /Confirm the template/);
});

test('duplicate fragment IDs cannot attach both junctions to one PCR', () => {
  const result = evaluateFragmentAssembly([fragments[0], { ...fragments[1], id: 'a' }], { thresholds: wide });
  assert.equal(result.feasible, false);
  assert.match(result.warnings[0], /unique ID/);
});
