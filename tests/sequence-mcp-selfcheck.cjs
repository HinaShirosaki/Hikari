'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { algorithms } = require('../src/renderer/modules/sequence-viewer/main-process/mcp/service');
const { SEQUENCE_MCP_TOOLS } = require('../src/main/agent/mcp-contract/direct-tools/sequence-tools');
const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library');
const store = require('../src/renderer/modules/sequence-viewer/main-process/mcp/store');
async function fixture(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sequence-mcp-'));
  const model = await algorithms();
  const call = async (name, args = {}) => {
    const result = await SEQUENCE_MCP_TOOLS.find(t => t.definition.name === name).handler(args, {}, { storagePath: root });
    return result;
  };
  const add = async (record, id = 'parent', status = 'saved') => {
    await library.upsertSequenceEntry({ storagePath: root, id, name: record.name, status, sequence: record.sequence, sequenceLength: record.sequence.length, topology: record.topology, features: record.features, featureCount: record.features.length, gbkText: model.buildRecordGenbankText(record) });
    return call('sequence_get', { entry_id: id });
  };
  try { await callback({ root, model, call, add }); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
const coding = { id: 'cds', name: 'Test protein', type: 'cds', strand: 1, segments: [{ start: 4, end: 22 }], qualifiers: { codon_start: '1', transl_table: '1', gene: 'test', experiment: 'retained' } };
const record = { name: 'Test plasmid', topology: 'circular', sequence: 'ACGTATGGAACGTTTTAAATAACGTA', features: [coding, { id: 'tail', name: 'tail', type: 'misc_feature', strand: 1, segments: [{ start: 22, end: 26 }] }] };

test('MCP discovery, exact searches, qualifiers, pagination and stale identities', () => fixture(async ({ add, call }) => {
  const value = await add(record);
  assert.equal(value.ok, true, JSON.stringify(value));
  assert.equal(value.features.items[0].qualifiers.experiment, 'retained');
  assert.equal((await call('sequence_list')).total, 1);
  assert.equal((await call('sequence_list', { status: 'temporary' })).total, 0);
  for (const [mode, query] of [['name', 'plasmid'], ['feature', 'Test protein'], ['dna', 'ATGGAA'], ['protein', 'MER']]) {
    assert.equal((await call('sequence_search', { mode, query })).total, 1, mode);
  }
  assert.equal((await call('sequence_search', { mode: 'protein', query: 'VVVV' })).total, 0);
  assert.equal((await call('sequence_search', { mode: 'protein', query: 'm e r' })).total, 1);
  const ref = value.features.items[0].feature_ref;
  const protein = await call('sequence_protein_get', { entry_id: value.entry_id, feature_ref: ref, offset: 1, limit: 2 });
  assert.deepEqual(protein.residues.items.map(r => [r.position, r.amino_acid, r.codon]), [[2, 'E', 'GAA'], [3, 'R', 'CGT']]);
  assert.equal(protein.terminal_stop.codon, 'TAA');
  const bad = await call('sequence_feature_edit', { entry_id: 'parent', expected_revision: 'old', request_id: 'stale', operation: 'delete', mode: 'annotation_only', feature_ref: ref });
  assert.equal(bad.status, 'stale_revision');
  assert.equal((await call('sequence_search', { query: 'x' })).ok, false);
}));

test('protein batches preserve codons and parent, retry, restart and indel coordinates', () => fixture(async ({ add, call, root }) => {
  const value = await add(record);
  const args = { entry_id: 'parent', expected_revision: value.revision, feature_ref: value.features.items[0].feature_ref, request_id: 'batch', operations: [{ operation: 'substitute', position: 2, expected_amino_acid: 'E', amino_acid: 'G' }, { operation: 'delete', start: 4, end: 4, expected_amino_acids: 'F' }, { operation: 'insert', after_residue: 5, amino_acids: 'HH' }] };
  const result = await call('sequence_protein_edit', args);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.protein, 'MGRKHH');
  assert.equal((await store.load(root, 'parent')).record.sequence, record.sequence);
  const derived = await store.load(root, result.entry_id);
  assert.equal(derived.entry.status, 'temporary');
  assert.equal(derived.record.features[0].qualifiers.experiment, 'retained');
  assert.equal(derived.metadata.patches.length, 3);
  assert.equal((await call('sequence_protein_edit', args)).entry_id, result.entry_id);
  assert.equal((await call('sequence_protein_edit', { ...args, name: 'different' })).status, 'request_conflict');
  const fresh = await call('sequence_get', { entry_id: result.entry_id });
  assert.equal((await call('sequence_protein_get', { entry_id: fresh.entry_id, feature_ref: fresh.features.items[0].feature_ref })).residues.items.map(r => r.amino_acid).join(''), 'MGRKHH');
  assert.equal((await call('sequence_protein_edit', { ...args, request_id: 'bad-residue', operations: [{ operation: 'delete', position: 2, expected_amino_acid: 'A' }] })).status, 'residue_mismatch');
}));

test('reverse and origin-spanning CDS edits round trip', () => fixture(async ({ add, call, model }) => {
  const { reverseComplementDna } = await import('../src/renderer/modules/sequence-viewer/calculations/sequence.js');
  for (const reverse of [false, true]) for (const wrap of [false, true]) {
    const gene = 'ATGGAACGTTTTAAATAA';
    const genomic = reverse ? reverseComplementDna(gene) : gene;
    let seq = genomic + 'ACGTCGATCG';
    let segments = [{ start: 0, end: genomic.length }];
    if (wrap) { const origin = 7; seq = seq.slice(origin) + seq.slice(0, origin); segments = [{ start: seq.length - origin, end: seq.length }, { start: 0, end: genomic.length - origin }]; }
    const input = { name: 'oriented', topology: 'circular', sequence: seq, features: [{ ...coding, strand: reverse ? -1 : 1, segments }] };
    const id = `case_${reverse}_${wrap}`;
    const value = await add(input, id);
    const ref = value.features.items[0].feature_ref;
    const protein = await call('sequence_protein_get', { entry_id: id, feature_ref: ref });
    assert.equal(protein.residues.items.map(r => r.amino_acid).join(''), 'MERFK', JSON.stringify({ reverse, wrap, protein }));
    for (const [label, operations, expected] of [
      ['sub', [{ operation: 'substitute', position: 2, expected_amino_acid: 'E', amino_acid: 'G' }], 'MGRFK'],
      ['n', [{ operation: 'insert', after_residue: 0, amino_acids: 'HH' }], 'HHMERFK'],
      ['c', [{ operation: 'insert', after_residue: 5, amino_acids: 'HH' }], 'MERFKHH'],
      ['del', [{ operation: 'delete', start: 2, end: 3, expected_amino_acids: 'ER' }], 'MFK']
    ]) {
      const out = await call('sequence_protein_edit', { entry_id: id, expected_revision: value.revision, feature_ref: ref, request_id: `${id}_${label}`, operations });
      assert.equal(out.ok, true, JSON.stringify({ reverse, wrap, label, out }));
      assert.equal(out.protein, expected);
      const reopened = await call('sequence_get', { entry_id: out.entry_id });
      const read = await call('sequence_protein_get', { entry_id: out.entry_id, feature_ref: reopened.features.items[0].feature_ref });
      assert.equal(read.residues.items.map(r => r.amino_acid).join(''), expected);
    }
  }
  assert.ok(model);
}));

test('feature modes and Protein Builder construct insertion', () => fixture(async ({ add, call, root }) => {
  const value = await add(record);
  const ref = value.features.items[0].feature_ref;
  const annotation = await call('sequence_feature_edit', { entry_id: 'parent', expected_revision: value.revision, feature_ref: ref, request_id: 'annotation', mode: 'annotation_only', operation: 'replace', feature: { name: 'Renamed CDS' } });
  assert.equal(annotation.ok, true, JSON.stringify(annotation));
  assert.equal((await store.load(root, annotation.entry_id)).record.sequence, record.sequence);
  assert.equal((await store.load(root, annotation.entry_id)).record.features[0].name, 'Renamed CDS');
  const relocated = await call('sequence_feature_edit', { entry_id: 'parent', expected_revision: value.revision, feature_ref: ref, request_id: 'relocate', mode: 'annotation_only', operation: 'replace', feature: { segments: [{ start: 8, end: 22 }] } });
  assert.equal(relocated.ok, true, JSON.stringify(relocated));
  assert.equal((await store.load(root, relocated.entry_id)).record.features[0].translation, 'ERFK');
  const removed = await call('sequence_feature_edit', { entry_id: 'parent', expected_revision: value.revision, feature_ref: ref, request_id: 'delete', mode: 'sequence_and_annotation', operation: 'delete' });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.equal((await store.load(root, removed.entry_id)).record.sequence, record.sequence.slice(0, 4) + record.sequence.slice(22));
  const parts = await call('sequence_protein_parts');
  assert.ok(parts.items.some(p => p.part_id === 'tag:his6'));
  const built = await call('sequence_protein_build', { request_id: 'build', parts: [{ kind: 'catalog', part_id: 'tag:his6' }, { kind: 'feature', source: { entry_id: 'parent', expected_revision: value.revision, feature_ref: ref } }] });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.protein, 'HHHHHHMERFK');
  const inserted = await call('sequence_protein_edit', { entry_id: 'parent', expected_revision: value.revision, feature_ref: ref, request_id: 'built-replace', operations: [{ operation: 'replace_cds', construct_id: built.construct_id }] });
  assert.equal(inserted.ok, true, JSON.stringify(inserted));
  assert.equal(inserted.protein, built.protein);
  assert.ok((await store.load(root, inserted.entry_id)).metadata.construct.payload);
}));
function randomDna(length) {
  let state = 137;
  return Array.from({ length }, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return 'ACGT'[state >>> 30]; }).join('');
}
test('primer routes reconstruct desired products and retain multi-site templates', () => fixture(async ({ add, call, root }) => {
  const seq = randomDna(1200);
  const template = { name: 'Primer fixture', topology: 'circular', sequence: seq, features: [{ id: 'edit', name: 'target', type: 'misc_feature', strand: 1, segments: [{ start: 350, end: 351 }] }] };
  const original = await add(template);
  const changed = await call('sequence_feature_edit', { entry_id: 'parent', expected_revision: original.revision, request_id: 'primer-edit', operation: 'replace', mode: 'sequence_and_annotation', feature_ref: original.features.items[0].feature_ref, dna: seq[350] === 'A' ? 'G' : 'A' });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  const design = await call('sequence_mutagenesis_primers', { entry_id: changed.entry_id, expected_revision: changed.revision, methods: ['q5-kld', 'whole-plasmid'] });
  assert.equal(design.ok, true, JSON.stringify(design));
  assert.equal(design.status, 'design_ready', JSON.stringify(design));
  assert.equal(design.routes.find(r => r.method === 'q5-kld').feasible, true, JSON.stringify(design));
  assert.ok(design.routes.find(r => r.method === 'q5-kld').stages[0].product_matches);
  assert.equal((await store.load(root, changed.entry_id)).metadata.primer_design.status, 'design_ready');
  const repeat = { ...template, sequence: 'ACGT'.repeat(300) };
  const parent = await add(repeat, 'repeat');
  const edited = await call('sequence_feature_edit', { entry_id: 'repeat', expected_revision: parent.revision, request_id: 'repeat-edit', operation: 'replace', mode: 'sequence_and_annotation', feature_ref: parent.features.items[0].feature_ref, dna: 'A' });
  const impossible = await call('sequence_mutagenesis_primers', { entry_id: edited.entry_id, expected_revision: edited.revision, methods: ['q5-kld'] });
  assert.equal(impossible.status, 'no_feasible_design');
}));

test('folder preservation, rollback, concurrent retries, and index recovery', () => fixture(async ({ add, call, root }) => {
  await add(record);
  const folder = await library.upsertSequenceFolder({ storagePath: root, name: 'Designs' });
  await library.moveSequenceEntryToFolder({ storagePath: root, id: 'parent', folderId: folder.folder.id });
  const parent = await call('sequence_get', { entry_id: 'parent' });
  const args = { entry_id: 'parent', expected_revision: parent.revision, request_id: 'atomic', operation: 'delete', mode: 'annotation_only', feature_ref: parent.features.items[1].feature_ref };
  const writeFile = fs.writeFile;
  fs.writeFile = async (file, ...rest) => { if (String(file).endsWith('agent-design.json')) throw new Error('injected storage failure'); return writeFile(file, ...rest); };
  let failed;
  try { failed = await call('sequence_feature_edit', args); } finally { fs.writeFile = writeFile; }
  assert.equal(failed.ok, false);
  assert.equal((await call('sequence_list')).total, 1);
  const results = await Promise.all([call('sequence_feature_edit', args), call('sequence_feature_edit', args)]);
  assert.equal(results[0].ok, true, JSON.stringify(results));
  assert.equal(results[0].entry_id, results[1].entry_id);
  assert.equal(results[0].folder_id, folder.folder.id);
  const dbPath = path.join(root, 'DNA', 'sequence-library.sqlite');
  await fs.rm(dbPath);
  const recovered = await call('sequence_get', { entry_id: results[0].entry_id });
  assert.equal(recovered.status, 'temporary');
  assert.equal(recovered.folder_id, folder.folder.id);
}));

test('partial/nonstandard CDS is readable, operation conflicts rejected, original frame offset retained', () => fixture(async ({ add, call }) => {
  for (const [id, qualifiers] of [['offset', { codon_start: '2' }], ['nonstandard', { transl_table: '2' }]]) {
    const input = { ...record, features: [{ ...coding, segments: [{ start: id === 'offset' ? 3 : 4, end: 22 }], qualifiers }] };
    const parent = await add(input, id);
    const protein = await call('sequence_protein_get', { entry_id: id, feature_ref: parent.features.items[0].feature_ref });
    assert.equal(protein.editable, id === 'offset');
    const result = await call('sequence_protein_edit', { entry_id: id, expected_revision: parent.revision, feature_ref: parent.features.items[0].feature_ref, request_id: id, operations: [{ operation: 'substitute', position: 2, expected_amino_acid: 'E', amino_acid: 'G' }] });
    assert.equal(result.ok, id === 'offset', JSON.stringify(result));
  }
}));

test('circular feature index, duplicate qualifiers, artifact manifest and copied-bundle recovery', () => fixture(async ({ add, call, root, model }) => {
  const input = { name: 'Wrapped CDS', topology: 'circular', sequence: 'GAACGTTTTAAATAAACGTATG', features: [{ ...coding, segments: [{ start: 19, end: 22 }, { start: 0, end: 15 }], qualifiers: { db_xref: ['GeneID:1', 'GeneID:2'], pseudo: 'true' } }] };
  const parent = await add(input);
  const value = await store.load(root, parent.entry_id);
  assert.deepEqual(value.record.features[0].qualifiers.db_xref, ['GeneID:1', 'GeneID:2']);
  assert.equal(value.record.features[0].qualifiers.pseudo, 'true');
  const { openDatabase, readRows } = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library/database');
  const db = await openDatabase(path.join(root, 'DNA/sequence-library.sqlite'));
  try { assert.equal(readRows(db, 'SELECT sequence FROM sequence_features')[0].sequence, 'ATGGAACGTTTTAAATAA'); } finally { db.close(); }
  const built = await call('sequence_protein_build', { request_id: 'export-build', parts: [{ kind: 'custom', amino_acids: 'MHHHHHH' }] });
  assert.equal(built.ok, true, JSON.stringify(built));
  const changed = await call('sequence_feature_edit', { entry_id: parent.entry_id, expected_revision: parent.revision, feature_ref: parent.features.items[0].feature_ref, operation: 'replace', mode: 'annotation_only', feature: { name: 'kept' }, request_id: 'export-edit' });
  const entries = (await fs.readdir(path.join(root, 'DNA', 'entries'), { recursive: true })).map((p) => String(p).split(path.sep).join('/'));
  assert.ok(entries.some(e => e.endsWith(`.constructs/${built.construct_id}.json`)));
  assert.ok(entries.some(e => e.endsWith(`${changed.entry_id}/agent-design.json`)));
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), 'sequence-bundle-copy-'));
  try {
    await fs.cp(path.join(root, 'DNA'), path.join(copy, 'DNA'), { recursive: true });
    const loaded = await store.load(copy, changed.entry_id);
    assert.equal(loaded.entry.name, changed.name);
    assert.deepEqual(loaded.record.features[0].qualifiers.db_xref, ['GeneID:1', 'GeneID:2']);
    assert.equal((await store.artifact(copy, built.construct_id)).protein, built.protein);
  } finally { await fs.rm(copy, { recursive: true, force: true }); }
  assert.ok(model);
}));

test('index publication failure rolls back new files, and promotion retains provenance', () => fixture(async ({ add, call, root }) => {
  const parent = await add(record);
  const args = { entry_id: parent.entry_id, expected_revision: parent.revision, feature_ref: parent.features.items[0].feature_ref, operation: 'delete', mode: 'annotation_only', request_id: 'publish-failure' };
  const rename = fs.rename;
  fs.rename = async (from, to) => { if (String(to).endsWith('sequence-library.sqlite')) throw new Error('injected index publication failure'); return rename(from, to); };
  let result;
  try { result = await call('sequence_feature_edit', args); } finally { fs.rename = rename; }
  assert.equal(result.ok, false);
  assert.equal((await call('sequence_list')).total, 1);
  const dirs = await fs.readdir(path.join(root, 'DNA/entries'));
  assert.deepEqual(dirs, ['parent']);
  const success = await call('sequence_feature_edit', args);
  assert.equal(success.ok, true, JSON.stringify(success));
  await library.promoteSequenceEntry({ storagePath: root, id: success.entry_id });
  const saved = await store.load(root, success.entry_id);
  assert.equal(saved.entry.status, 'saved');
  assert.equal(saved.metadata.entry.status, 'saved');
  assert.equal(saved.metadata.parent_entry_id, parent.entry_id);
}));

test('multiple mutation sites remain separate primer stages; actions survive progress to rendering', () => fixture(async ({ model }) => {
  const seq = randomDna(1400);
  const original = { name: 'Multi', topology: 'circular', sequence: seq, features: [] };
  const patches = [350, 950].map(p => ({ start: p, end: p + 1, sequence: seq[p] === 'A' ? 'G' : 'A' }));
  const desired = model.applyPatches(original, patches).record;
  const routes = model.comparePrimerRoutes(original, desired, patches, ['q5-kld'], null, 'parent');
  assert.equal(routes.status, 'design_ready', JSON.stringify(routes));
  assert.equal(routes.routes[0].stages.length, 2);
  assert.equal(routes.routes[0].stages[0].primers[0].template_id, 'parent');
  assert.equal(routes.routes[0].stages[1].primers[0].template_kind, 'hypothetical_intermediate');
  const { extractSequenceActions } = require('../src/renderer/modules/sequence-viewer/main-process/mcp/artifact-events');
  const action = { action: 'open_plasmid', entry_id: 'parent', label: 'Open Plasmid' };
  const actions = extractSequenceActions({ result: { content: [{ text: JSON.stringify({ ok: true, mcp_tool: 'sequence_feature_edit', ui_actions: [action] }) }] } });
  assert.equal(actions.length, 1);
  const { applyLiveProgressEvent } = await import('../src/renderer/modules/agent-chat/live-progress-state.js');
  const message = applyLiveProgressEvent({ meta: {} }, { meta: { sequence_actions: actions } });
  const { renderSequenceActions } = await import('../src/renderer/modules/sequence-viewer/mcp/action-rendering.js');
  assert.match(renderSequenceActions(message.meta, s => String(s)), /data-sequence-entry-id="parent"/);
}));

test('all seven primer routes validate physical products; missing donors and corrupted products fail', () => fixture(async ({ model }) => {
  const original = { name: 'All routes', sequence: randomDna(1500), topology: 'circular', features: [] };
  const substitution = { start: 350, end: 351, sequence: original.sequence[350] === 'A' ? 'G' : 'A' };
  const substituted = model.applyPatches(original, [substitution]).record;
  const small = model.comparePrimerRoutes(original, substituted, [substitution], undefined, null);
  for (const method of ['whole-plasmid', 'q5-kld', 'two-step-ligation']) assert.equal(small.routes.find(r => r.method === method).feasible, true, method);
  // Continue the deterministic stream to keep the insert independent of its host.
  const insert = randomDna(1680).slice(1500);
  const patch = { start: 350, end: 350, sequence: insert };
  const desired = model.applyPatches(original, [patch]).record;
  const absent = model.comparePrimerRoutes(original, desired, [patch], ['golden-gate', 'overlap-extension'], null);
  // Naming no template only advises the interactive designer; the MCP contract
  // still refuses the route, because it holds the templates and could not
  // reconstruct the product or verify a binding site on any of them.
  assert.equal(absent.status, 'no_feasible_design');
  assert.ok(absent.routes.every(r => !r.feasible
    && r.stages[0].product_matches === false
    && r.stages[0].warnings.some(w => /names no PCR template/.test(w))));
  const donor = { id: 'donor', name: 'Donor', sequence: randomDna(1780).slice(1680) + insert + randomDna(1880).slice(1780), topology: 'linear' };
  const designs = model.comparePrimerRoutes(original, desired, [patch], undefined, donor);
  for (const method of ['gibson', 'in-fusion', 'golden-gate', 'overlap-extension']) assert.equal(designs.routes.find(r => r.method === method).feasible, true, method);
  const route = designs.routes.find(r => r.method === 'gibson').stages[0];
  assert.ok(route.primers.some(p => p.template_id === 'donor' && p.template_kind === 'supplied_template'));
  const { verifyAssemblyProducts } = await import('../src/renderer/modules/sequence-viewer/mcp/primer-products.js');
  const templates = new Map([['original', original], ['donor', donor]]);
  assert.equal(verifyAssemblyProducts('gibson', route, route.primers, templates, desired), true);
  const corrupted = structuredClone(route.primers);
  corrupted[0].tailSequence = 'AAAA' + corrupted[0].tailSequence;
  assert.equal(verifyAssemblyProducts('gibson', route, corrupted, templates, desired), false);
  const wrongProduct = { ...desired, sequence: desired.sequence.slice(0, 1000) + (desired.sequence[1000] === 'A' ? 'G' : 'A') + desired.sequence.slice(1001) };
  assert.equal(verifyAssemblyProducts('gibson', route, route.primers, templates, wrongProduct), false);
}));

test('feature insertions, overlaps, and exact discontinuous deletion preserve DNA and locations', () => fixture(async ({ add, call, root }) => {
  const parent = await add(record);
  const common = { entry_id: parent.entry_id, expected_revision: parent.revision };
  const annotated = await call('sequence_feature_edit', { ...common, request_id: 'annotate-new', operation: 'insert', mode: 'annotation_only', feature: { name: 'duplicate', type: 'misc_feature', strand: -1, segments: [{ start: 1, end: 3 }] } });
  assert.equal(annotated.ok, true, JSON.stringify(annotated));
  assert.equal((await store.load(root, annotated.entry_id)).record.sequence, record.sequence);
  const insertion = await call('sequence_feature_edit', { ...common, request_id: 'insert-dna', operation: 'insert', mode: 'sequence_and_annotation', after_base: 10, dna: 'ATG', feature: { name: 'insert', type: 'misc_feature', strand: -1 } });
  assert.equal(insertion.ok, true, JSON.stringify(insertion));
  const loaded = await store.load(root, insertion.entry_id);
  assert.equal(loaded.record.sequence, record.sequence.slice(0, 10) + 'CAT' + record.sequence.slice(10));
  assert.deepEqual(loaded.record.features[0].segments, [{ start: 4, end: 25 }]);
  assert.deepEqual(loaded.record.features[1].segments, [{ start: 25, end: 29 }]);
  assert.ok(insertion.affected_features.some(f => f.name === 'Test protein'));
  const discontinuous = await add({ ...record, features: [{ ...coding, type: 'misc_feature', segments: [{ start: 1, end: 3 }, { start: 10, end: 12 }] }] }, 'gapped');
  const target = { entry_id: discontinuous.entry_id, expected_revision: discontinuous.revision, feature_ref: discontinuous.features.items[0].feature_ref };
  const rejected = await call('sequence_feature_edit', { ...target, request_id: 'gapped-replace', operation: 'replace', mode: 'sequence_and_annotation', dna: 'AAA' });
  assert.equal(rejected.status, 'unsupported_location');
  const deleted = await call('sequence_feature_edit', { ...target, request_id: 'gapped-delete', operation: 'delete', mode: 'sequence_and_annotation' });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal((await store.load(root, deleted.entry_id)).record.sequence, record.sequence.slice(0, 1) + record.sequence.slice(3, 10) + record.sequence.slice(12));
}));

test('concurrent dead-owner recovery keeps library writers serialized', () => fixture(async ({ root }) => {
  const { withLibraryLock } = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library/operation-lock');
  const lockPath = path.join(root, 'DNA', '.operation-lock');
  await fs.mkdir(lockPath, { recursive: true });
  await fs.writeFile(path.join(lockPath, 'owner'), '2147483647');
  let active = 0;
  let maxActive = 0;
  await Promise.all(Array.from({ length: 6 }, () => withLibraryLock(root, async () => {
    maxActive = Math.max(maxActive, ++active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
  })));
  assert.equal(maxActive, 1);
  assert.equal(await fs.readFile(path.join(lockPath, 'owner'), 'utf8'), '2147483647');
}));
