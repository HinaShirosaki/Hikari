import assert from 'node:assert/strict';
import test from 'node:test';
import { reverseComplementDna as rc } from '../src/renderer/modules/sequence-viewer/calculations/sequence.js';
import { CLONING_PRIMER_TM_THRESHOLDS as levels } from '../src/renderer/modules/sequence-viewer/cloning-assembly/constants.js';
import { designCloningPrimers } from '../src/renderer/modules/sequence-viewer/cloning-assembly/primer-design.js';
import { countPrimerBindingSites } from '../src/renderer/modules/sequence-viewer/cloning-assembly/primer-quality.js';
import { selectBindingWindow } from '../src/renderer/modules/sequence-viewer/cloning-assembly/overlap-windows.js';
import { buildProteinBuilderCloningPlan, resolvePcrTargets } from '../src/renderer/modules/sequence-viewer/protein-builder-cloning/cloning-plan.js';
import { buildDisplayPlan } from '../src/renderer/modules/sequence-viewer/cloning-design/plan-building.js';

function dna(length, seed) {
  let state = seed >>> 0;
  let result = '';
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    result += 'ACGT'[state % 4];
  }
  return result;
}

const leftCore = dna(180, 24);
const rightCore = dna(180, 124);
const flank = dna(50, 224);

// Reconstruct from known physical cores and actual oligos, independently of the
// design's fragment geometry. Overlap sequence must exist on BOTH PCR products.
function verifyProducts(design, sources, expected, circular = false) {
  assert.equal(design.feasible, true, design.warnings?.join('\n'));
  assert.equal(design.primers.length, sources.length * 2);
  const products = sources.map(({ id, core, donor = core, circular: donorCircular = false }) => {
    const pair = design.primers.filter((primer) => primer.templateId === id);
    assert.equal(pair.length, 2);
    const [forward, reverse] = pair;
    assert.ok(core.startsWith(forward.bindingSequence));
    assert.ok(core.endsWith(rc(reverse.bindingSequence)));
    const product = forward.tailSequence + core + rc(reverse.tailSequence);
    for (const primer of pair) {
      assert.equal(primer.sequence, primer.tailSequence + primer.bindingSequence);
      assert.ok(primer.length <= 60);
      assert.equal(countPrimerBindingSites(donor, primer.bindingSequence, donorCircular), 1);
      assert.equal(primer.ampliconLength, product.length);
    }
    return product;
  });
  let assembled = products[0];
  for (let index = 1; index < products.length; index += 1) {
    const seam = design.junctions.find((junction) => junction.leftFragmentId === sources[index - 1].id && !junction.wrapAround);
    assert.equal(products[index - 1].slice(-seam.overlapLength), seam.overlapSequence);
    assert.equal(products[index].slice(0, seam.overlapLength), seam.overlapSequence);
    assembled += products[index].slice(seam.overlapLength);
  }
  if (circular) {
    const seam = design.junctions.find((junction) => junction.wrapAround);
    assert.equal(products.at(-1).slice(-seam.overlapLength), products[0].slice(0, seam.overlapLength));
    assembled = assembled.slice(0, -seam.overlapLength);
    assert.equal(assembled.length, expected.length);
    assert.ok((assembled + assembled).includes(expected));
  } else {
    assert.equal(assembled, expected);
  }
}

function fragment(id, sequence, core, donor = core, circular = false) {
  return { id, name: id, type: 'insert', sequence, metadata: {
    templateSequence: donor, specificitySequence: donor, specificityCircular: circular
  } };
}

for (const side of ['prefix', 'suffix', 'both']) {
  test(`added ${side} flank can move between neighboring PCR primers`, () => {
    const leftAddition = side === 'prefix' ? '' : side === 'suffix' ? flank : flank.slice(0, 25);
    const rightAddition = flank.slice(leftAddition.length);
    const fragments = [fragment('a', leftCore + leftAddition, leftCore), fragment('b', rightAddition + rightCore, rightCore)];
    const before = structuredClone(fragments);
    // One oligo cannot carry this whole flank even at the most relaxed limit.
    assert.equal(selectBindingWindow(rightCore, 'forward', levels.relaxed, flank.length), null);
    const design = designCloningPrimers({ strategy: 'overlap-pcr', fragmentMap: { fragments } });
    verifyProducts(design, [{ id: 'a', core: leftCore }, { id: 'b', core: rightCore }], leftCore + flank + rightCore);
    const seam = design.junctions[0];
    assert.ok(seam.leftReverseTargetTail.length > 0 && seam.leftReverseTargetTail.length < flank.length);
    assert.ok(seam.rightForwardTargetTail.length > 0 && seam.rightForwardTargetTail.length < flank.length);
    assert.deepEqual(fragments, before);
  });
}

test('shifted flanks preserve reverse-strand and circular-origin donor binding', () => {
  const donor = dna(800, 81);
  const core = rc(donor.slice(-100) + donor.slice(0, 100));
  // Avoid an incidental matching base extending the physical core into the tag.
  const addedFlank = flank.slice(0, -1) + (rc(donor[100]) === 'A' ? 'C' : 'A');
  const fragments = [fragment('a', leftCore, leftCore), fragment('b', addedFlank + core, core, donor, true)];
  const design = designCloningPrimers({ strategy: 'overlap-pcr', fragmentMap: { fragments } });
  verifyProducts(design, [{ id: 'a', core: leftCore }, { id: 'b', core, donor, circular: true }], leftCore + addedFlank + core);
});

test('a repeated donor binding region remains blocking after moving the flank', () => {
  const fragments = [fragment('a', leftCore, leftCore), fragment('b', flank + rightCore, rightCore, rightCore + rightCore)];
  const design = designCloningPrimers({ strategy: 'overlap-pcr', fragmentMap: { fragments } });
  assert.equal(design.feasible, false);
});

test('flanks that exceed the combined oligo budgets are not silently omitted', () => {
  const longFlank = dna(100, 224);
  const fragments = [fragment('a', leftCore + longFlank.slice(0, 50), leftCore), fragment('b', longFlank.slice(50) + rightCore, rightCore)];
  assert.equal(designCloningPrimers({ strategy: 'overlap-pcr', fragmentMap: { fragments } }).feasible, false);
});

function builderPlan(prefix = flank, suffix = '') {
  return buildProteinBuilderCloningPlan({
    strategy: 'gibson',
    backbone: { backboneSequence: leftCore, entryId: 'vector-record', topology: 'circular' },
    dnaConstruct: { sequence: prefix + rightCore + suffix, parts: [
      { label: 'N tag', dnaSequence: prefix },
      { label: 'Gene', dnaSequence: rightCore, templateSequence: rightCore, templateEntryId: 'donor-record' },
      { label: 'C tag', dnaSequence: suffix }
    ] },
    assembledRecord: { sequence: leftCore + prefix + rightCore + suffix }
  });
}

test('Protein Builder uses four template-bound primers for a short flank instead of requiring synthesis', () => {
  const plan = builderPlan();
  assert.equal(plan.feasible, true);
  assert.equal(plan.orderedFragmentMap.fragments.length, 2);
  verifyProducts(plan.primerOligoPlan, [{ id: 'host_backbone', core: leftCore }, { id: 'protein_builder_insert_1', core: rightCore }], leftCore + flank + rightCore, true);
  assert.deepEqual(plan.primerOligoPlan.primers.map((primer) => primer.templateEntryId), ['vector-record', 'vector-record', 'donor-record', 'donor-record']);
  assert.ok(!plan.warnings.some((warning) => /must be ordered|ordered synthetic/i.test(warning)));
  assert.deepEqual(plan.expectedJunctionLogic, plan.primerOligoPlan.junctions);
  for (const [index, target] of resolvePcrTargets(plan).entries()) {
    assert.equal(target.length, plan.primerOligoPlan.primers[index * 2].ampliconLength);
  }
});

test('a C-terminal flank is shared across the circular closing junction', () => {
  const plan = builderPlan('', flank);
  verifyProducts(plan.primerOligoPlan, [{ id: 'host_backbone', core: leftCore }, { id: 'protein_builder_insert_1', core: rightCore }], leftCore + rightCore + flank, true);
  assert.equal(plan.primerOligoPlan.junctions.find((junction) => junction.wrapAround).redistributedFlankLength, flank.length);
});

test('Cloning Design compares the final sequence with the selected donor before distributing the flank', () => {
  const insert = flank + rightCore;
  const display = buildDisplayPlan({
    strategy: 'gibson',
    source: { originalSequence: leftCore, editedSequence: leftCore + insert, parentEntryId: 'vector-record' },
    record: { name: 'Product', topology: 'circular', sequence: leftCore + insert },
    range: { start: leftCore.length, end: leftCore.length + insert.length },
    donor: { id: 'donor-record', name: 'Chosen donor', topology: 'linear', sequence: rightCore }
  });
  assert.equal(display.feasible, true);
  const plan = display.plans[0].plan;
  verifyProducts(plan.primerOligoPlan, [{ id: 'host_backbone', core: leftCore }, { id: 'edited_amplicon', core: rightCore }], leftCore + insert, true);
  assert.deepEqual(display.primers.map((primer) => primer.templateEntryId), ['vector-record', 'vector-record', 'donor-record', 'donor-record']);
});
