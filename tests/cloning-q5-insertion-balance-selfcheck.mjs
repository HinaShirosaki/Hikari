import assert from 'node:assert/strict';
import test from 'node:test';
import { reverseComplementDna as rc, translateDnaSequence } from '../src/renderer/modules/sequence-viewer/calculations/sequence.js';
import { cloningPrimerTm } from '../src/renderer/modules/sequence-viewer/calculations/oligo.js';
import { countPrimerBindingSites } from '../src/renderer/modules/sequence-viewer/cloning-assembly/primer-quality.js';
import { buildQ5KldPlan } from '../src/renderer/modules/sequence-viewer/cloning-assembly/q5-kld-mutagenesis.js';
import { CLONING_PRIMER_TM_THRESHOLDS as levels } from '../src/renderer/modules/sequence-viewer/cloning-assembly/constants.js';
import { selectBindingWindow } from '../src/renderer/modules/sequence-viewer/cloning-assembly/overlap-windows.js';
import { reconstructPcrProduct } from '../src/renderer/modules/sequence-viewer/mcp/primer-products.js';
import { comparePrimerRoutes } from '../src/renderer/modules/sequence-viewer/mcp/primers.js';
import { buildDisplayPlan } from '../src/renderer/modules/sequence-viewer/cloning-design/plan-building.js';
import { createSequenceViewerCloningDesignNotebookPage } from '../src/renderer/modules/sequence-viewer/cloning-design-notebook.js';

function dna(n, seed) {
  let state = seed >>> 0;
  let result = '';
  for (let i = 0; i < n; i += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    result += 'ACGT'[state % 4];
  }
  return result;
}
const template = { name: 'Vector', sequence: dna(900, 24), topology: 'circular', features: [] };
// The real pET3a-PD-L1-IgV junction, with unrelated backbone replaced by filler.
// Its annotated PD-L1 fragment starts immediately after the leader's ATG.
const PET3A_LEADER = 'TCTCGATCCCGCGAAATTAATACGACTCACTATAGGGAGACCACAACGGTTTCCCTCTAGAAATAATTTTGTTTAACTTTAAGAAGGAGATATACATATG';
const PDL1_START = 'GCATTTACTGTCACGGTTCCCAAGGACCTATATGTGGTAGAGTATGGTAGCAATATGACAATTGAATGCAAATTCCCAGTAGAAAAACAATTAGACCTGG';
const HIS_TEV_INSERT = 'CACCACCACCACCACCACGAAAACCTGTACTTCCAGGGC';
function fixture(length = 12, at = 450) {
  const insert = dna(length, 124);
  const record = { ...template, name: 'Inserted', sequence: template.sequence.slice(0, at) + insert + template.sequence.slice(at) };
  const editRequest = { type: 'insertion', start: at + 1, end: at, originalSequence: '', editedSequence: insert };
  const plan = buildQ5KldPlan({ originalSequence: template.sequence, editedSequence: record.sequence, editRequest, topology: 'circular' });
  return { insert, at, record, editRequest, plan };
}

function pet3aFixture({ origin = false, maxPrimerLength = 60, repeated = false } = {}) {
  const context = PET3A_LEADER + PDL1_START;
  const sequence = context + dna(300, 77) + (repeated ? context : '');
  const parent = {
    name: 'pET3a-PD-L1-IgV junction', topology: 'circular', features: [],
    sequence: origin ? sequence.slice(PET3A_LEADER.length) + sequence.slice(0, PET3A_LEADER.length) : sequence
  };
  const at = origin ? 0 : PET3A_LEADER.length;
  const record = { ...parent, sequence: parent.sequence.slice(0, at) + HIS_TEV_INSERT + parent.sequence.slice(at) };
  const editRequest = { type: 'insertion', start: at + 1, end: at, editedSequence: HIS_TEV_INSERT };
  const plan = buildQ5KldPlan({ originalSequence: parent.sequence, editedSequence: record.sequence, editRequest,
    topology: parent.topology, preferences: { maxPrimerLength } });
  return { parent, record, at, editRequest, plan };
}

for (const origin of [false, true]) {
  test(`Q5/KLD inserts 6xHis–TEV at the AT-rich pET3a-PD-L1 junction${origin ? ' across the circular origin' : ''}`, () => {
    assert.ok(cloningPrimerTm(rc(PET3A_LEADER.slice(-40))) < levels.relaxed.primerTm.min,
      'the former 40 nt binding-window cap cannot reach the annealing Tm');
    const { parent, record, plan } = pet3aFixture({ origin });
    assert.equal(plan.feasible, true, plan.warnings.join('\n'));
    const [forward, reverse] = plan.primers;
    assert.ok(reverse.bindingSequence.length > 40);
    assert.ok(plan.primers.every((primer) => primer.length <= 60));
    assert.ok(plan.primers.every((primer) => countPrimerBindingSites(parent.sequence, primer.bindingSequence, true) === 1));
    assert.equal(rc(reverse.tailSequence) + forward.tailSequence, HIS_TEV_INSERT);
    const product = reconstructPcrProduct(forward, reverse, parent);
    assert.equal(product.length, record.sequence.length);
    assert.ok((product + product).includes(record.sequence));
    assert.equal(translateDnaSequence('ATG' + HIS_TEV_INSERT + PDL1_START.slice(0, 18)).protein, 'MHHHHHHENLYFQGAFTVTV');
    const threshold = levels[plan.plans[0].plan.primerOligoPlan.selectedThresholdLevel];
    for (const primer of plan.primers) {
      assert.ok(primer.tm >= threshold.primerTm.min && primer.tm <= threshold.primerTm.max);
    }
    assert.ok(Math.abs(forward.tm - reverse.tm) <= threshold.maxPrimerTmDifference);
  });
}

test('longer Q5/KLD annealing windows respect the configured full-oligo cap and unique binding requirement', () => {
  assert.equal(pet3aFixture({ maxPrimerLength: 45 }).plan.feasible, false);
  const repeated = pet3aFixture({ repeated: true }).plan;
  assert.equal(repeated.feasible, false);
  assert.match(repeated.warnings.join('\n'), /more than one site/);
});

test('MCP verifies the AT-rich pET3a-PD-L1 His–TEV PCR product and physical template', () => {
  const { parent, record, at } = pet3aFixture();
  const routes = comparePrimerRoutes(parent, record, [{ start: at, end: at, sequence: HIS_TEV_INSERT }], ['q5-kld'], null, 'parent');
  assert.equal(routes.status, 'design_ready');
  const stage = routes.routes[0].stages[0];
  assert.equal(stage.product_matches, true);
  assert.ok(stage.primers.every((primer) => primer.binding_verified && primer.template_id === 'parent'));
});

for (const length of [12, 24, 50]) {
  test(`Q5/KLD distributes a ${length} nt insert over bounded non-overlapping tails`, () => {
    const { insert, record, plan } = fixture(length);
    assert.equal(plan.feasible, true, plan.warnings.join('\n'));
    const [forward, reverse] = plan.primers;
    assert.ok(forward.tailSequence && reverse.tailSequence);
    assert.equal(rc(reverse.tailSequence) + forward.tailSequence, insert);
    assert.ok(forward.length <= 60 && reverse.length <= 60);
    assert.ok(Math.abs(forward.length - reverse.length) <= 1);
    const product = reconstructPcrProduct(forward, reverse, template);
    assert.equal(product.length, record.sequence.length, 'the two tails supply one insert without a duplicated overlap');
    assert.ok((product + product).includes(record.sequence));
    assert.ok(!forward.closingOverlapSequence && !reverse.closingOverlapSequence);
    assert.match(plan.plans[0].plan.stepByStepProcedure[2].details, /KLD/);
  });
}

test('a short insert selects a smaller pair even when the whole insert fits one primer', () => {
  const { insert, at, plan } = fixture();
  const thresholds = levels[plan.plans[0].plan.primerOligoPlan.selectedThresholdLevel];
  const config = { specificitySequence: template.sequence, specificityCircular: true };
  const originalForward = selectBindingWindow(template.sequence.slice(at), 'forward', thresholds, insert.length, config);
  const originalReverse = selectBindingWindow(template.sequence.slice(0, at), 'reverse', thresholds, 0, config);
  assert.ok(originalForward && originalReverse, 'the older single-tail arrangement was feasible');
  const previousMaximum = Math.max(insert.length + originalForward.length, originalReverse.length);
  assert.ok(Math.max(...plan.primers.map((primer) => primer.length)) < previousMaximum);
});

for (const at of [0, 896, 900]) {
  test(`Q5/KLD insert at ${at} reconstructs correctly across the circular origin`, () => {
    const { plan, record } = fixture(24, at);
    assert.equal(plan.feasible, true, plan.warnings.join('\n'));
    const product = reconstructPcrProduct(...plan.primers, template);
    assert.equal(product.length, record.sequence.length);
    assert.ok((product + product).includes(record.sequence));
  });
}

test('MCP and Notebook retain the Q5/KLD route and its KLD finish', () => {
  const { insert, at, record, editRequest } = fixture();
  const routes = comparePrimerRoutes(template, record, [{ start: at, end: at, sequence: insert }], ['q5-kld'], null, 'parent');
  const stage = routes.routes[0].stages[0];
  assert.equal(routes.status, 'design_ready');
  assert.equal(stage.product_matches, true);
  assert.ok(stage.primers.every((primer) => primer.binding_verified && primer.template_id === 'parent'));
  const source = { recordName: record.name, parentEntryId: 'parent', originalSequence: template.sequence, editedSequence: record.sequence, editRequest };
  const displayPlan = buildDisplayPlan({ strategy: 'q5-kld', source, record });
  assert.ok(displayPlan.primers.every((primer) => primer.templateEntryId === 'parent'));
  const state = { notebookEntries: [] };
  let id = 0;
  const page = createSequenceViewerCloningDesignNotebookPage({ state, source, record, displayPlan, createId: () => `item-${++id}` });
  assert.ok(page);
  assert.equal(page.stepEntries.length, 1);
  assert.match(page.stepEntries[0].experimentName, /KLD/);
  assert.ok(page.pcrPrograms[0].steps.some((step) => step.cycles === '25'));
});
