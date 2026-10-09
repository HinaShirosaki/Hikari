import assert from 'node:assert/strict';
import test from 'node:test';
import { reverseComplementDna as rc } from '../src/renderer/modules/sequence-viewer/calculations/sequence.js';
import { cloningPrimerTm } from '../src/renderer/modules/sequence-viewer/calculations/oligo.js';
import { CLONING_PRIMER_TM_THRESHOLDS as levels } from '../src/renderer/modules/sequence-viewer/cloning-assembly/constants.js';
import { designOligoAssembly } from '../src/renderer/modules/sequence-viewer/cloning-assembly/oligo-assembly.js';
import { designRestrictionLigationPrimers } from '../src/renderer/modules/sequence-viewer/cloning-assembly/assembly-primers.js';
import { buildOverlapExtensionLigationPlan } from '../src/renderer/modules/sequence-viewer/cloning-assembly/overlap-extension-ligation.js';
import { buildDisplayPlan } from '../src/renderer/modules/sequence-viewer/cloning-design/plan-building.js';
import { STRATEGIES } from '../src/renderer/modules/sequence-viewer/cloning-design/strategies.js';
import { buildProteinBuilderCloningPlan } from '../src/renderer/modules/sequence-viewer/protein-builder-cloning/cloning-plan.js';
import { assignPrimerTemplateEntries } from '../src/renderer/modules/sequence-viewer/primer-template-routing.js';
import { createSequenceViewerCloningDesignNotebookPage, buildSequenceViewerPcrPrograms } from '../src/renderer/modules/sequence-viewer/cloning-design-notebook.js';
import { buildCloningReactionSteps } from '../src/renderer/modules/sequence-viewer/cloning-reaction-steps.js';

function dna(length, seed) {
  let state = seed >>> 0;
  let result = '';
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    result += 'ACGT'[state % 4];
  }
  return result;
}

function reconstructOligos(primers, expected, thresholds = levels.relaxed, maxLength = 60) {
  const oligos = primers.filter((primer) => primer.pcrStage === 'oligo-assembly');
  assert.ok(oligos.length >= 2);
  assert.equal(oligos.length % 2, 0);
  let product = '';
  let previous = '';
  oligos.forEach((oligo, index) => {
    const reverse = index % 2 === 1;
    assert.equal(oligo.role, reverse ? 'insert-oligo-reverse' : 'insert-oligo-forward');
    assert.ok(oligo.length <= maxLength);
    assert.equal(oligo.templateEntryId, '');
    assert.ok(oligo.sequence.endsWith(oligo.bindingSequence), 'the priming overlap must reach the physical 3-prime end');
    assert.equal(oligo.qualityBlockingWarnings.length, 0);
    const strand = reverse ? rc(oligo.sequence) : oligo.sequence;
    if (!index) product = strand;
    else {
      let overlap = Math.min(previous.length, strand.length);
      while (overlap && previous.slice(-overlap) !== strand.slice(0, overlap)) overlap -= 1;
      assert.ok(overlap >= 15, 'actual ordered oligos must share a complementary overlap');
      const tm = cloningPrimerTm(strand.slice(0, overlap));
      assert.ok(tm >= thresholds.overlapTm.min && tm <= thresholds.overlapTm.max);
      product += strand.slice(overlap);
    }
    previous = strand;
  });
  assert.equal(product, expected, 'ordered oligos must reconstruct every intended insert base exactly once');
  return oligos;
}

for (const length of [30, 100, 180, 600, 1000]) {
  test(`${length} bp insert is reconstructed from bounded overlapping oligos`, () => {
    const sequence = dna(length, 124);
    const design = designOligoAssembly({ id: 'insert', name: 'Insert', sequence }, levels.relaxed);
    assert.equal(design.feasible, true, design.warnings.join('\n'));
    reconstructOligos(design.primers, sequence);
  });
}

test('unresolved or repetitive inserts remain blocked, and custom oligo length is honored', () => {
  for (const sequence of [dna(180, 124) + 'N', 'ACGT'.repeat(50), 'A'.repeat(180)]) {
    const design = designOligoAssembly({ sequence }, levels.relaxed);
    assert.equal(design.feasible, false);
    assert.equal(design.primers.length, 0);
  }
  const sequence = dna(180, 24);
  const design = designOligoAssembly({ sequence }, levels.relaxed, { maxPrimerLength: 50 });
  assert.equal(design.feasible, true, design.warnings.join('\n'));
  reconstructOligos(design.primers, sequence, levels.relaxed, 50);
});

const vector = dna(500, 24);
const insert = dna(180, 124);
const sequence = vector + insert;
const source = { originalSequence: vector, editedSequence: sequence, parentEntryId: 'parent',
  editRequest: { type: 'insertion', start: vector.length + 1, end: vector.length, originalSequence: '', editedSequence: insert } };
const record = { name: 'Product', topology: 'circular', sequence };
const range = { start: vector.length, end: sequence.length };

for (const strategy of ['gibson', 'in-fusion', 'golden-gate']) {
  test(`${strategy} includes insert preparation while keeping its own cloning route`, () => {
    const display = buildDisplayPlan({ strategy, source, record, range });
    assert.equal(display.feasible, true, display.warnings.join('\n'));
    assert.equal(display.strategy, strategy);
    if (strategy !== 'golden-gate') {
      assert.ok(display.plans[0].plan.primerOligoPlan.overlapSummary.some((overlap) => overlap.overlapGroup),
        'preparation overlap temperatures retain their separate reaction identity');
    }
    reconstructOligos(display.primers, insert);
    const outer = display.primers.filter((primer) => primer.template_kind === 'hypothetical_intermediate');
    assert.equal(outer.length, 2);
    assert.ok(outer.every((primer) => primer.templateEntryId === '' && primer.templateSourceLabel));
    assert.equal(display.primers.filter((primer) => primer.templateEntryId === 'parent').length, 2);
    assert.match(display.plans[0].plan.stepByStepProcedure[0].title, /oligo assembly/);
    assert.ok(!display.warnings.some((warning) => /names no PCR template|must be ordered as synthetic DNA/.test(warning)));
    const programs = buildSequenceViewerPcrPrograms({ displayPlan: display, source, record });
    assert.equal(programs.length, 2);
    assert.ok(programs.every((program) => program.primerNames.length === 2));
    assert.ok(programs.some((program) => /oligo assembly product/.test(program.notes.join(' '))));
  });
}

test('an available donor keeps its ordinary PCR pair without an oligo pool', () => {
  const display = buildDisplayPlan({ strategy: 'gibson', source, record, range,
    donor: { id: 'donor', name: 'Donor', topology: 'linear', sequence: insert } });
  assert.equal(display.feasible, true);
  assert.equal(display.primers.length, 4);
  assert.equal(display.primers.filter((primer) => primer.templateEntryId === 'donor').length, 2);
  assert.ok(display.primers.every((primer) => !primer.pcrStage));
  assert.ok(!STRATEGIES.some((strategy) => /oligo/.test(strategy.id)));
});

test('restriction-tailed outer primers amplify the prepared insert', () => {
  const fragment = { id: 'insert', name: 'Insert', role: 'insert', sequence: insert, metadata: { source: 'sequence_viewer_edit' } };
  const design = designRestrictionLigationPrimers({ fragments: [fragment] }, { selectedSites: [
    { name: 'EcoRI', site: 'GAATTC' }, { name: 'BamHI', site: 'GGATCC' }
  ] }, levels.relaxed, { maxPrimerLength: 60 });
  assert.equal(design.feasible, true, design.warnings.join('\n'));
  reconstructOligos(design.primers, insert);
  const outer = design.primers.slice(-2);
  assert.equal(outer[0].sequence + insert.slice(outer[0].bindingSequence.length) + rc(outer[1].tailSequence),
    'GCGCGCGAATTC' + insert + rc('GCGCGCGGATCC'));
  assert.ok(assignPrimerTemplateEntries(design.primers, { parentEntryId: 'parent' }).every((primer) => !primer.templateEntryId));
});

test('Protein Builder prepares a long untemplated block while preserving its gene donor', () => {
  const gene = dna(180, 224);
  const plan = buildProteinBuilderCloningPlan({ strategy: 'gibson',
    backbone: { backboneSequence: vector, entryId: 'parent', topology: 'circular' },
    dnaConstruct: { sequence: insert + gene, parts: [
      { label: 'Long tag', dnaSequence: insert },
      { label: 'Gene', dnaSequence: gene, templateSequence: gene, templateEntryId: 'donor' }
    ] }, assembledRecord: { name: 'Product', sequence: vector + insert + gene } });
  assert.equal(plan.feasible, true, plan.warnings.join('\n'));
  reconstructOligos(plan.primerOligoPlan.primers, insert);
  assert.equal(plan.primerOligoPlan.primers.filter((primer) => primer.templateEntryId === 'donor').length, 2);
  assert.ok(!plan.warnings.some((warning) => /must be ordered as synthetic DNA/.test(warning)));
});

test('overlap-extension prepares its insert before flank fusion and digestion-ligation', () => {
  const sequence = dna(306, 7) + insert + dna(306, 11) + dna(1200, 31);
  const display = buildOverlapExtensionLigationPlan({ sequence, range: { start: 306, end: 486 },
    recordName: 'Vector', topology: 'circular', vectorSequence: sequence.slice(0, 306) + sequence.slice(486) });
  assert.equal(display.feasible, true, display.warnings.join('\n'));
  reconstructOligos(display.primers, insert);
  assert.equal(display.primers.filter((primer) => primer.pcrStage !== 'oligo-assembly').length, 6);
  assert.match(display.plans[0].plan.stepByStepProcedure[0].title, /oligo assembly/);
});

test('two untemplated blocks keep separate oligo pools and outer-primer PCRs', () => {
  const gene = dna(180, 224);
  const suffix = dna(180, 324);
  const plan = buildProteinBuilderCloningPlan({ strategy: 'gibson',
    backbone: { backboneSequence: vector, entryId: 'parent', topology: 'circular' },
    dnaConstruct: { sequence: insert + gene + suffix, parts: [
      { dnaSequence: insert }, { label: 'Gene', dnaSequence: gene, templateSequence: gene, templateEntryId: 'donor' }, { dnaSequence: suffix }
    ] }, assembledRecord: { sequence: vector + insert + gene + suffix } });
  assert.equal(plan.feasible, true, plan.warnings.join('\n'));
  const displayPlan = { primers: plan.primerOligoPlan.primers, plans: [{ plan }] };
  const groups = [...new Set(displayPlan.primers.filter((primer) => primer.pcrStage).map((primer) => primer.groupLabel))];
  assert.equal(groups.length, 2);
  reconstructOligos(displayPlan.primers.filter((primer) => primer.groupLabel === groups[0]), insert);
  reconstructOligos(displayPlan.primers.filter((primer) => primer.groupLabel === groups[1]), suffix);
  const programs = buildSequenceViewerPcrPrograms({ displayPlan });
  assert.equal(programs.length, 4);
  assert.ok(programs.every((program) => program.primerNames.length === 2));
  const steps = buildCloningReactionSteps({ strategy: 'gibson', displayPlan, pcrPrograms: programs });
  assert.equal(steps.length, 3);
  assert.equal(steps[0].reagents.length, 9);
  assert.equal(steps[1].reagents.length, 9);
  assert.equal(steps[2].reagents.length, 5);
});

test('the notebook gives the oligo pool its own reaction and excludes it from cloning inputs', () => {
  const displayPlan = buildDisplayPlan({ strategy: 'gibson', source, record, range });
  const programs = buildSequenceViewerPcrPrograms({ displayPlan, source, record });
  const steps = buildCloningReactionSteps({ strategy: 'gibson', displayPlan, pcrPrograms: programs });
  assert.equal(steps.length, 2);
  const oligos = displayPlan.primers.filter((primer) => primer.pcrStage === 'oligo-assembly');
  assert.deepEqual(steps[0].reagents.slice(3).map((reagent) => reagent.name), oligos.map((oligo) => oligo.name));
  assert.ok(steps[0].reagents.every((reagent) => !/Template|Forward primer|Reverse primer/.test(reagent.name)));
  assert.equal(steps[1].reagents.length, 3, 'Gibson consumes only backbone and amplified insert');
  const state = { notebookEntries: [] };
  let id = 0;
  const created = createSequenceViewerCloningDesignNotebookPage({ state, createId: () => `record-${++id}`, source, record, displayPlan });
  assert.ok(created);
  assert.equal(created.stepEntries.length, 2);
  assert.match(created.entry.result, /template-free/);
  assert.ok(created.stepEntries[0].toolCalculations[0].inputs.reagents.some((reagent) => reagent.name === oligos[0].name));
});
