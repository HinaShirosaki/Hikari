import assert from 'node:assert/strict';
import test from 'node:test';
import { createSequenceViewerCloningDesignController } from '../src/renderer/modules/sequence-viewer/cloning-design.js';
import { confirmCloningDesign, annotateCloningTemplates } from '../src/renderer/modules/sequence-viewer/cloning-design-confirm.js';
import { assignPrimerTemplateEntries } from '../src/renderer/modules/sequence-viewer/primer-template-routing.js';
import { withPrimerBindFeatures } from '../src/renderer/modules/sequence-viewer/primer-annotation.js';
import { buildDisplayPlan } from '../src/renderer/modules/sequence-viewer/cloning-design/plan-building.js';
import { buildRecordGenbankText } from '../src/renderer/modules/sequence-viewer/storage.js';
import { parseInputRecords } from '../src/renderer/modules/sequence-viewer/parsing.js';
import { buildDnaConstruct } from '../src/renderer/modules/sequence-viewer/protein-builder/dna-construct.js';
import { buildProteinBuilderCloningPlan } from '../src/renderer/modules/sequence-viewer/protein-builder-cloning/cloning-plan.js';
import { buildAssembledPlasmidPayload } from '../src/renderer/modules/sequence-viewer/protein-builder/assembly-payload.js';
import { createProteinBuilderConfirmationActions } from '../src/renderer/modules/sequence-viewer/runtime/protein-builder-confirmation.js';
import { translateDnaSequence } from '../src/renderer/modules/sequence-viewer/calculations/sequence.js';
import { createMockDocument } from './support/runtime.js';
import { getSequenceViewerElements } from '../src/renderer/modules/sequence-viewer/dom.js';

function dna(length, seed) {
  let state = seed >>> 0, out = '';
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    out += 'ACGT'[state % 4];
  }
  return out;
}
function record(name, sequence, features = []) { return { name, sequence, topology: 'circular', features }; }
function library(records) {
  const stored = new Map(Object.entries(records).map(([id, value]) => [id, {
    entry: { id, name: value.name, status: 'saved' },
    gbkText: buildRecordGenbankText(value), alignments: [{ id: `${id}-alignment` }]
  }]));
  const writes = [], reads = [];
  const bridge = {
    async sequenceLibraryGet({ id }) {
      reads.push(id);
      return stored.has(id) ? { ok: true, ...stored.get(id) } : { ok: false, error: 'Missing template' };
    },
    async sequenceLibraryUpsert(payload) {
      writes.push(payload);
      const id = payload.id || `product-${writes.length}`;
      const entry = { id, name: payload.name, status: payload.status };
      stored.set(id, { entry, gbkText: payload.gbkText, alignments: payload.alignmentSessions || [] });
      return { ok: true, entry };
    }
  };
  return { bridge, writes, reads, stored };
}
const primerNames = (rec) => rec.features.filter((feature) => feature.type === 'primer_bind').map((feature) => feature.name).sort();
const reload = (lib, id) => parseInputRecords(lib.stored.get(id).gbkText).records[0];

function designFixture() {
  for (let seed = 1; seed <= 20; seed += 1) {
    const backbone = dna(700, seed * 3), insert = dna(240, seed * 7);
    const product = record('Assembled', insert + backbone);
    const source = { parentEntryId: 'vector', donorEntryId: 'old-choice', originalSequence: backbone, editedSequence: product.sequence,
      editedRange: { start: 0, end: insert.length }, originalRange: { start: 0, end: 0 },
      editRequest: { type: 'insertion', start: 1, end: 0, editedSequence: insert } };
    const donor = { id: 'donor', ...record('Chosen donor', dna(100, 811) + insert + dna(110, 813)) };
    const plan = buildDisplayPlan({ strategy: 'gibson', source, record: product, donor, range: { start: 0, end: insert.length } });
    if (plan.feasible) return { backbone, insert, product, source, donor, plan };
  }
  throw new Error('No fixture');
}
const fixture = designFixture();

test('result gets every primer; parent and selected donor get only their assigned PCR primers after reload', async () => {
  const unrelated = { id: 'old', name: 'Earlier primer', type: 'primer_bind', source: 'primer_design', primerSequence: fixture.backbone.slice(50, 72), segments: [{ start: 50, end: 72 }] };
  // The donor insert also occurs in the parent; sequence matching alone must not route its primers there.
  const lib = library({ vector: record('Parent vector', fixture.backbone + fixture.insert, [unrelated]), donor: fixture.donor });
  const result = await confirmCloningDesign({ record: fixture.product, source: fixture.source, primers: fixture.plan.primers, bridge: lib.bridge, storagePath: '/tmp/library' });
  const all = fixture.plan.primers.map((primer) => primer.name).sort();
  const expectedFor = (id) => fixture.plan.primers.filter((primer) => primer.templateEntryId === id).map((primer) => primer.name).sort();
  assert.equal(result.productPlaced, 4);
  assert.deepEqual(primerNames(reload(lib, result.productEntry.id)), all);
  assert.deepEqual(primerNames(reload(lib, 'vector')), [...expectedFor('vector'), 'Earlier primer'].sort());
  assert.deepEqual(primerNames(reload(lib, 'donor')), expectedFor('donor'));
  assert.equal(reload(lib, 'vector').sequence, fixture.backbone + fixture.insert);
  assert.equal(reload(lib, 'donor').sequence, fixture.donor.sequence);
  assert.deepEqual(lib.reads.sort(), ['donor', 'vector']);
  assert.ok(!lib.reads.includes('old-choice'));
  for (const id of ['vector', 'donor']) {
    const write = lib.writes.find((item) => item.id === id);
    assert.equal(write.status, 'saved');
    assert.deepEqual(write.alignmentSessions, [{ id: `${id}-alignment` }]);
  }
  await confirmCloningDesign({ record: fixture.product, source: fixture.source, primers: fixture.plan.primers, bridge: lib.bridge, storagePath: '/tmp/library' });
  assert.deepEqual(primerNames(reload(lib, 'donor')), expectedFor('donor'), 'reconfirmation must not duplicate primers');
});

test('unmatched assembly primers are never projected onto the parent edit coordinates', async () => {
  const lib = library({ vector: record('Wrong template', dna(700, 977)) });
  const primer = { ...fixture.plan.primers.find((item) => item.templateEntryId === 'donor'), templateEntryId: 'vector' };
  const result = await confirmCloningDesign({ record: fixture.product, source: fixture.source, primers: [primer], bridge: lib.bridge, storagePath: '/tmp/library' });
  assert.equal(result.productPlaced, 1);
  assert.equal(result.parentPlaced, 0);
  assert.deepEqual(result.parentUnplaced, [primer.name]);
  assert.equal(lib.writes.length, 1, 'no fabricated parent annotation is saved');
});

test('full product oligo resolves repeated binding regions and includes the assembled overlap', () => {
  const binding = dna(22, 22), overlap = dna(20, 88);
  const product = record('Repeated insert', binding + dna(80, 93) + overlap + binding + dna(80, 95));
  const primer = { name: 'junction F', sequence: overlap + binding, bindingSequence: binding };
  const annotated = withPrimerBindFeatures(product, [primer], { target: 'product' });
  assert.equal(annotated.added.length, 1);
  assert.deepEqual(annotated.ambiguous, []);
  assert.deepEqual(annotated.added[0].segments, [{ start: 102, end: 144 }]);
  assert.equal(annotated.added[0].primerSequence, primer.sequence);
  const template = withPrimerBindFeatures(record('Donor', dna(80, 91) + binding + dna(80, 92)), [primer]);
  assert.deepEqual(template.added[0].segments, [{ start: 80, end: 102 }]);
});

test('multiple fragments from one donor are grouped; synthesis and intermediates never update it', async () => {
  const primers = assignPrimerTemplateEntries([
    { name: 'A F', templateId: 'a', sequence: fixture.insert.slice(0, 25), bindingSequence: fixture.insert.slice(0, 25) },
    { name: 'B F', templateId: 'b', sequence: fixture.insert.slice(80, 105), bindingSequence: fixture.insert.slice(80, 105) },
    { name: 'Synthetic F', templateId: 's', sequence: fixture.insert.slice(120, 145) },
    { name: 'Stage 2 F', template_id: 'intermediate_1', template_kind: 'hypothetical_intermediate', sequence: fixture.insert.slice(150, 175) }
  ], { parentEntryId: 'vector', fragments: [
    { id: 'a', metadata: { templateEntryId: 'donor' } }, { id: 'b', metadata: { templateEntryId: 'donor' } }, { id: 's', metadata: { source: 'synthesis' } }
  ] });
  const lib = library({ donor: fixture.donor });
  await annotateCloningTemplates({ bridge: lib.bridge, storagePath: '/tmp/library', primers });
  assert.deepEqual(lib.reads, ['donor']);
  assert.equal(lib.writes.length, 1);
  assert.deepEqual(primerNames(reload(lib, 'donor')), ['A F', 'B F']);
});

test('Protein Builder keeps the chosen template ID through protein and DNA construction', () => {
  const coding = 'ATGGCTGACTTCGGTAAACTGGACGTTGCTGAGAACGCTTTCTACGGTGACTGG';
  const protein = translateDnaSequence(coding);
  const construct = buildDnaConstruct({ rows: [{ type: 'feature', kind: 'feature', label: 'Domain', sequence: protein, sourceDnaSequence: coding, sourceVectorId: 'donor', sourceVectorName: 'Chosen donor', sourceVectorSequence: coding }] });
  assert.equal(construct.ok, true);
  assert.equal(construct.parts[0].templateEntryId, 'donor');
});

test('Protein Builder confirmation refreshes the final record and persists primers on both templates', async () => {
  const backbone = { entryId: 'vector', backboneSequence: fixture.backbone, topology: 'circular', variantMode: 'gibson', insertionOffset: fixture.backbone.length, hostVectorName: 'Parent vector' };
  const dnaConstruct = { sequence: fixture.insert, parts: [{ label: 'Insert', dnaSequence: fixture.insert, templateSequence: fixture.insert, templateEntryId: 'donor', templateName: 'Chosen donor', templateHostSequence: fixture.donor.sequence }] };
  const product = buildAssembledPlasmidPayload(backbone, dnaConstruct);
  const planned = buildProteinBuilderCloningPlan({ backbone, dnaConstruct, assembledRecord: product });
  assert.equal(planned.feasible, true);
  assert.deepEqual([...new Set(planned.primerOligoPlan.primers.map((primer) => primer.templateEntryId))].sort(), ['donor', 'vector']);
  const lib = library({ vector: record('Parent vector', fixture.backbone), donor: fixture.donor });
  const state = { records: [product], selectedRecordIndex: 0, proteinBuilderConfirmation: { constructName: 'Construct', cloningDesignSource: { backbone, dnaConstruct, assembledRecord: product } } };
  const navigation = [];
  const appState = {};
  const controllers = {};
  const actions = createProteinBuilderConfirmationActions({ state, controllers, actions: {
    getSelectedRecord: () => state.records[0]
  } });
  controllers.cloningDesign = createSequenceViewerCloningDesignController({
    state, appState, persist() {}, getSelectedRecord: () => state.records[0],
    getCloningDesignSource: () => state.sequenceEditDesignSource,
    getBridge: () => lib.bridge, getStoragePath: () => '/tmp/library',
    onNavigateCloningDesign: () => navigation.push('cloning'),
    onReturnToDetail: () => navigation.push('detail'),
    onDesignConfirmed: async (result) => { state.activeEntryId = result.productEntry.id; }
  });
  actions.confirmProteinBuilderConstruct();
  await new Promise(setImmediate);
  assert.deepEqual(navigation, ['cloning']);
  assert.equal(state.cloningDesign.strategy, 'gibson');
  assert.equal(state.cloningDesign.displayPlan.feasible, true);
  assert.deepEqual(state.sequenceEditDesignSource.supportedStrategies, ['gibson', 'in-fusion']);
  assert.equal(lib.writes.length, 0, 'templates are untouched until the cloning design is confirmed');
  state.cloningDesign.strategy = 'in-fusion';
  controllers.cloningDesign.designPrimers();
  assert.equal(state.cloningDesign.displayPlan.feasible, true);
  const notebookDesigns = appState.notebookEntries.filter((entry) => entry.proteinBuilderCloningDesign);
  assert.equal(notebookDesigns.length, 1, 'changing methods refreshes the existing design page');
  assert.equal(notebookDesigns[0].proteinBuilderCloningDesign.recommendedAssemblyStrategy, 'in-fusion');
  assert.ok(appState.notebookEntries.some((entry) => JSON.stringify(entry).includes('5x In-Fusion Snap Assembly master mix')));
  const confirmed = await controllers.cloningDesign.confirmDesign();
  assert.ok(confirmed.productEntry);
  assert.deepEqual(navigation, ['cloning', 'detail']);
  assert.equal(state.activeEntryId, confirmed.productEntry.id);
  assert.equal(primerNames(reload(lib, confirmed.productEntry.id)).length, 4);
  assert.equal(primerNames(state.records[0]).length, 4);
  assert.equal(primerNames(reload(lib, 'vector')).length, 2);
  assert.equal(primerNames(reload(lib, 'donor')).length, 2);
  assert.equal(state.proteinBuilderConfirmation, null);
});


test('late confirmation cannot replace a newly selected sequence or change its active library entry', async () => {
  const lib = library({ vector: record('Parent vector', fixture.backbone), donor: fixture.donor });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const bridge = { ...lib.bridge, async sequenceLibraryUpsert(payload) { await gate; return lib.bridge.sequenceLibraryUpsert(payload); } };
  const other = record('Another open sequence', dna(500, 491));
  const state = { records: [fixture.product, other], selectedRecordIndex: 0, activeEntryId: 'working', cloningDesign: { displayPlan: fixture.plan } };
  let activated = false;
  const controller = createSequenceViewerCloningDesignController({
    state, getSelectedRecord: () => state.records[state.selectedRecordIndex],
    getCloningDesignSource: () => fixture.source, getBridge: () => bridge, getStoragePath: () => '/tmp/library',
    onDesignConfirmed: async () => { activated = true; state.activeEntryId = 'incorrect'; }
  });
  const pending = controller.confirmDesign();
  state.selectedRecordIndex = 1;
  state.activeEntryId = 'other';
  release();
  const result = await pending;
  assert.ok(result.productEntry);
  assert.equal(state.records[1], other);
  assert.equal(state.activeEntryId, 'other');
  assert.equal(activated, false);
});

test('Needs review enables confirmation, saves generated primers, and retains the review status', async () => {
  const lib = library({ vector: record('Parent vector', fixture.backbone), donor: fixture.donor });
  const elements = getSequenceViewerElements(createMockDocument());
  const state = { records: [fixture.product], selectedRecordIndex: 0, cloningDesign: {} };
  const statuses = [];
  let release;
  let attemptedWrites = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const bridge = { ...lib.bridge, async sequenceLibraryUpsert(payload) {
    attemptedWrites += 1;
    await gate;
    return lib.bridge.sequenceLibraryUpsert(payload);
  } };
  const controller = createSequenceViewerCloningDesignController({
    elements, state, getSelectedRecord: () => state.records[0],
    getCloningDesignSource: () => fixture.source,
    getBridge: () => bridge, getStoragePath: () => '/tmp/library',
    setStatus: (message) => statuses.push(message)
  });
  controller.render();
  const reviewPlan = { ...fixture.plan, feasible: false, warnings: ['Review this primer pair before use.'] };
  state.cloningDesign.displayPlan = reviewPlan;
  controller.render();
  assert.match(elements.cloningDesignResult.innerHTML, /Needs review/);
  assert.match(elements.cloningDesignResult.innerHTML, /Review this primer pair before use/);
  assert.equal(elements.cloningDesignConfirmBtn.disabled, false);
  assert.equal(elements.cloningDesignResult.innerHTML.includes('Order Primers'), false);

  const pending = controller.confirmDesign();
  assert.equal(elements.cloningDesignConfirmBtn.disabled, true);
  assert.equal(elements.cloningDesignConfirmBtn.textContent, 'Confirming…');
  assert.equal(await controller.confirmDesign(), null);
  assert.equal(attemptedWrites, 1, 'a double click must not save twice');
  release();
  const result = await pending;
  assert.ok(result.productEntry);
  assert.equal(result.productEntry.status, 'temporary');
  assert.equal(result.productPlaced, reviewPlan.primers.length);
  assert.deepEqual(primerNames(reload(lib, result.productEntry.id)), reviewPlan.primers.map((primer) => primer.name).sort());
  assert.equal(state.cloningDesign.displayPlan, reviewPlan);
  assert.equal(state.cloningDesign.displayPlan.feasible, false);
  assert.ok(statuses.some((message) => message.includes('Design still needs review')));
  assert.equal(elements.cloningDesignConfirmBtn.disabled, false);
});

test('confirmation rejects a design without primers and a design for a different sequence', async () => {
  const lib = library({});
  const elements = getSequenceViewerElements(createMockDocument());
  const state = { records: [fixture.product], selectedRecordIndex: 0, cloningDesign: {} };
  const controller = createSequenceViewerCloningDesignController({
    elements, state, getSelectedRecord: () => state.records[0],
    getCloningDesignSource: () => fixture.source,
    getBridge: () => lib.bridge, getStoragePath: () => '/tmp/library'
  });
  controller.render();
  state.cloningDesign.displayPlan = { feasible: false, primers: [] };
  controller.render();
  assert.equal(elements.cloningDesignConfirmBtn.disabled, true);
  assert.equal(await controller.confirmDesign(), null);
  state.cloningDesign.displayPlan = fixture.plan;
  state.records[0] = record('Different sequence', dna(500, 727));
  controller.render();
  assert.equal(elements.cloningDesignConfirmBtn.disabled, true);
  assert.equal(await controller.confirmDesign(), null);
  assert.equal(lib.writes.length, 0);
});
