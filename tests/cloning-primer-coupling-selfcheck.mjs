import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQ5KldPlan } from '../src/renderer/modules/sequence-viewer/cloning-assembly/q5-kld-mutagenesis.js';
import { designCloningPrimers } from '../src/renderer/modules/sequence-viewer/cloning-assembly/primer-design.js';
import { reverseComplementDna as rc } from '../src/renderer/modules/sequence-viewer/calculations/sequence.js';
import { reconstructPcrProduct } from '../src/renderer/modules/sequence-viewer/mcp/primer-products.js';
import { buildProteinBuilderCloningPlan } from '../src/renderer/modules/sequence-viewer/protein-builder-cloning/cloning-plan.js';
import { alignPrimerToDna, buildPrimerReferenceFrame, primerAlignmentInReferenceFrame, primerResizeWindow, primerWithTemplateBinding, replacePlanPrimers, resizePrimerInterval } from '../src/renderer/modules/sequence-viewer/cloning-design/primer-annealing-model.js';
import { buildPrimerCouplings, resizeCoupledPrimerEnd } from '../src/renderer/modules/sequence-viewer/cloning-design/primer-coupling.js';

function dna(length, seed) {
  let state = seed >>> 0, text = '';
  for (let i = 0; i < length; i++) {
    state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    text += 'ACGT'[state % 4];
  }
  return text;
}
const record = (sequence, topology = 'circular') => ({ sequence, topology });

function editor(plan, product, templates) {
  const links = buildPrimerCouplings(plan, product);
  const windows = plan.primers.map(primer => primerResizeWindow(primer, product));
  const ranges = plan.primers.map(primer => ({ start: 0, end: primer.sequence.length }));
  const templateFrames = plan.primers.map((primer, i) => buildPrimerReferenceFrame(templates[i], alignPrimerToDna(primer.sequence, templates[i]), windows[i].maxLength, windows[i]));
  const move = (index, side, position) => resizeCoupledPrimerEnd({ index, side, position, links,
    getRange: i => ranges[i], getWindow: i => windows[i] });
  const materialize = changes => changes.map(change => {
    const i = change.index, primer = resizePrimerInterval(plan.primers[i], change.range, windows[i]);
    const alignment = primerAlignmentInReferenceFrame(primer.sequence, templates[i], templateFrames[i], alignPrimerToDna(primer.sequence, templates[i]), change.range.start);
    return { ...change, primer: primerWithTemplateBinding(primer, alignment, plan.primers[i], change.range.start), templateAlignment: alignment, startDelta: change.range.start - ranges[i].start };
  });
  return { links, windows, ranges, move, materialize };
}

const template = record(dna(900, 24));
function q5Fixture(length = 24, at = 450) {
  const insert = dna(length, 124);
  const product = record(template.sequence.slice(0, at) + insert + template.sequence.slice(at));
  const plan = { strategy: 'q5-kld', ...buildQ5KldPlan({ originalSequence: template.sequence, editedSequence: product.sequence,
    editRequest: { type: 'insertion', start: at + 1, end: at, editedSequence: insert }, topology: 'circular' }) };
  assert.equal(plan.feasible, true, plan.warnings.join('\n'));
  return { plan, product, insert };
}

for (const at of [0, 450, 900]) {
  for (const length of [12, 24, 50]) {
    test(`Q5/KLD keeps exactly one complete ${length} nt insertion at ${at} when either 5′ end moves`, () => {
      const { plan, product } = q5Fixture(length, at);
      const edit = editor(plan, product, [template, template]);
      assert.equal(edit.links.length, 1);
      assert.equal(edit.links[0].sum, 0);
      const before = structuredClone(plan);
      for (const index of [0, 1]) {
        for (const delta of [-3, 3]) {
          const changes = edit.move(index, '5', delta);
          assert.equal(changes.length, 2);
          assert.equal(changes.find(change => change.index === index).range.start, delta);
          assert.equal(changes.find(change => change.index !== index).range.start, -delta);
          const updates = edit.materialize(changes), updated = replacePlanPrimers(plan, updates, { links: edit.links, product });
          const actual = reconstructPcrProduct(updated.primers[0], updated.primers[1], template);
          assert.equal(actual.length, product.sequence.length, 'neither insertion gaps nor duplicated overhangs are allowed');
          assert.ok((actual + actual).includes(product.sequence));
          for (const update of updates) {
            assert.equal(updated.plans[0].plan.primerOligoPlan.primers[update.index].sequence, update.primer.sequence);
            assert.equal(updated.primers[update.index].ampliconLength, product.sequence.length);
          }
        }
      }
      assert.deepEqual(plan, before, 'preview and batch replacement do not mutate the previous plan');
    });
  }
}

test('Q5/KLD 3′ binding edits leave the partner independent', () => {
  const { plan, product } = q5Fixture();
  const edit = editor(plan, product, [template, template]);
  const changes = edit.move(0, '3', plan.primers[0].sequence.length - 2);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].index, 0);
});

test('a linked endpoint stops when its partner reaches the length cap and never commits a partial transfer', () => {
  const { plan, product } = q5Fixture();
  const edit = editor(plan, product, [template, template]);
  edit.windows[1].maxLength = plan.primers[1].sequence.length + 2;
  const changes = edit.move(0, '5', 20);
  assert.equal(changes[0].range.start, 2);
  assert.equal(changes[1].range.start, -2);
  edit.windows[1].minStart = 10;
  edit.windows[0].minStart = 0;
  assert.deepEqual(edit.move(0, '5', 1), []);
});

test('the Q5 junction also repairs an older manually shortened primer instead of preserving its missing bases', () => {
  const { plan, product } = q5Fixture();
  const broken = { ...plan, primers: [{ ...plan.primers[0], sequence: plan.primers[0].sequence.slice(2) }, plan.primers[1]] };
  const edit = editor(broken, product, [template, template]);
  assert.equal(edit.links[0].sum, -2);
  const changes = edit.move(0, '5', 1);
  assert.equal(changes[1].range.start, -3);
  const actual = replacePlanPrimers(broken, edit.materialize(changes), { links: edit.links, product });
  const pcr = reconstructPcrProduct(actual.primers[0], actual.primers[1], template);
  assert.equal(pcr.length, product.sequence.length);
  assert.ok((pcr + pcr).includes(product.sequence));
  assert.ok(actual.primers.every(primer => primer.ampliconLength === product.sequence.length));
});

const leftCore = dna(180, 24), rightCore = dna(180, 124), added = dna(50, 224);
function overlapFixture(strategy) {
  const fragments = [{ id: 'left', name: 'left', type: 'insert', sequence: leftCore, metadata: { templateSequence: leftCore } },
    { id: 'right', name: 'right', type: 'insert', sequence: added + rightCore, metadata: { templateSequence: rightCore } }];
  const design = designCloningPrimers({ strategy: 'overlap-pcr', fragmentMap: { fragments } });
  assert.equal(design.feasible, true, design.warnings.join('\n'));
  return { product: record(leftCore + added + rightCore, 'linear'), plan: { strategy, feasible: true, primers: design.primers,
    plans: [{ plan: { primerOligoPlan: design, orderedFragmentMap: { fragments } } }], warnings: [] } };
}

for (const strategy of ['gibson', 'in-fusion', 'overlap-extension', 'overlap-pcr']) {
  test(`${strategy} transfers the shared flank to the neighboring PCR while retaining the complete assembled product`, () => {
    const { plan, product } = overlapFixture(strategy);
    const templates = [record(leftCore, 'linear'), record(leftCore, 'linear'), record(rightCore, 'linear'), record(rightCore, 'linear')];
    const edit = editor(plan, product, templates);
    assert.equal(edit.links.length, 1);
    const length = plan.plans[0].plan.primerOligoPlan.junctions[0].overlapLength;
    for (const index of [1, 2]) {
      for (const delta of [-3, 3]) {
        const updates = edit.materialize(edit.move(index, '5', delta));
        const updated = replacePlanPrimers(plan, updates, { links: edit.links, product });
        const left = reconstructPcrProduct(updated.primers[0], updated.primers[1], templates[0]);
        const right = reconstructPcrProduct(updated.primers[2], updated.primers[3], templates[2]);
        assert.equal(left.slice(-length), right.slice(0, length));
        assert.equal(left + right.slice(length), product.sequence);
        assert.equal(updated.primers[0].ampliconLength, left.length);
        assert.equal(updated.primers[1].ampliconLength, left.length);
        assert.equal(updated.primers[2].ampliconLength, right.length);
        assert.equal(updated.primers[3].ampliconLength, right.length);
        assert.equal(updated.plans[0].plan.primerOligoPlan.junctions[0].overlapSequence, right.slice(0, length));
        assert.equal(updated.primers[index === 1 ? 0 : 3].sequence, plan.primers[index === 1 ? 0 : 3].sequence, 'the unrelated primer is untouched');
      }
    }
  });
}

test('complementary whole-plasmid primer endpoints stay reverse complements', () => {
  const product = record(dna(300, 73));
  const sequence = product.sequence.slice(100, 140);
  const primers = [{ name: 'F', role: 'mutagenesis-forward', sequence }, { name: 'R', role: 'mutagenesis-reverse', sequence: rc(sequence) }];
  const plan = { strategy: 'whole-plasmid', primers, plans: [], feasible: true, warnings: [] };
  const edit = editor(plan, product, [product, product]);
  assert.equal(edit.links.length, 2);
  for (const index of [0, 1]) for (const side of ['5', '3']) {
    const position = side === '5' ? 3 : 37;
    const updated = replacePlanPrimers(plan, edit.materialize(edit.move(index, side, position)));
    assert.equal(updated.primers[0].sequence, rc(updated.primers[1].sequence));
  }
});

test('both Gibson junctions, including the circular closing junction, retain the complete Protein Builder product', () => {
  const product = record(leftCore + added + rightCore);
  const assembly = buildProteinBuilderCloningPlan({ strategy:'gibson', backbone:{backboneSequence:leftCore,entryId:'vector',topology:'circular'},
    dnaConstruct:{sequence:added+rightCore,parts:[{label:'Tag',dnaSequence:added},{label:'Gene',dnaSequence:rightCore,templateSequence:rightCore,templateEntryId:'donor'}]},
    assembledRecord:product });
  assert.equal(assembly.feasible, true);
  const plan = {strategy:'gibson',feasible:true,primers:assembly.primerOligoPlan.primers,plans:[{plan:assembly}],warnings:[]};
  const templates=[record(leftCore),record(leftCore),record(rightCore),record(rightCore)];
  const edit=editor(plan,product,templates);
  assert.equal(edit.links.length,2);
  const inside=edit.links.find(link=>!link.junction.wrapAround).overlapLength;
  const closing=edit.links.find(link=>link.junction.wrapAround).overlapLength;
  for(const index of [0,1,2,3]) {
    const updates=edit.materialize(edit.move(index,'5',3));
    const updated=replacePlanPrimers(plan,updates,{links:edit.links,product});
    const left=reconstructPcrProduct(updated.primers[0],updated.primers[1],templates[0]);
    const right=reconstructPcrProduct(updated.primers[2],updated.primers[3],templates[2]);
    assert.equal(left.slice(-inside),right.slice(0,inside));
    assert.equal(right.slice(-closing),left.slice(0,closing));
    const result=(left+right.slice(inside)).slice(0,-closing);
    assert.equal(result.length,product.sequence.length);
    assert.ok((result+result).includes(product.sequence));
    assert.deepEqual(updated.primers.map(primer=>primer.templateEntryId),['vector','vector','donor','donor']);
  }
});

test('ordinary and restriction PCR pairs are not linked by sequence similarity alone', () => {
  const { plan, product } = q5Fixture();
  for (const strategy of ['golden-gate', 'two-step-ligation', 'restriction-ligation']) {
    assert.deepEqual(buildPrimerCouplings({ ...plan, strategy }, product), []);
  }
});

test('ambiguous product sites cannot silently fall back to independent edits at a Q5 junction', () => {
  const { plan, product } = q5Fixture();
  const repeated = record(product.sequence + product.sequence);
  const links = buildPrimerCouplings(plan, repeated);
  assert.equal(links.length, 1);
  assert.equal(links[0].unavailable, true);
  const ranges = plan.primers.map(primer => ({start:0,end:primer.sequence.length}));
  const windows = plan.primers.map(primer => primerResizeWindow(primer, repeated));
  assert.deepEqual(resizeCoupledPrimerEnd({ index:0,side:'5',position:3,links,getRange:i=>ranges[i],getWindow:i=>windows[i] }), []);
});
