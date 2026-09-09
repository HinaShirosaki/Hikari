'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const library = require('../sequence-library');
const { withLibraryLock } = require('../sequence-library/operation-lock');
const store = require('./store');
let modules;
async function algorithms() {
  if (!modules) modules = Promise.all(['model.js', 'edits.js', 'builders.js', 'primers.js', '../storage.js', '../sequence-naming.js'].map(file => import(pathToFileURL(path.resolve(__dirname, '../../mcp', file)).href)))
    .then(([model, edits, builders, primers, storage, naming]) => ({ ...model, ...edits, ...builders, ...primers, ...storage, ...naming }));
  return modules;
}
function paginate(items, args, defaultLimit = 50) {
  const offset = args.offset ?? 0;
  const limit = args.limit ?? defaultLimit;
  return { items: items.slice(offset, offset + limit), total: items.length, offset, next_offset: offset + limit < items.length ? offset + limit : null };
}
function summary(value) {
  const { entry, revision } = value;
  return { entry_id: entry.id, name: entry.name, status: entry.status, folder_id: entry.folderId, topology: entry.topology, length: entry.sequenceLength, feature_count: entry.featureCount, revision };
}
function checkRevision(value, expected) {
  if (expected !== value.revision) throw Object.assign(new Error('Plasmid changed. Read its current revision and features before editing.'), { code: 'stale_revision' });
}
function actions(entryId, hasBuilder = false, hasPrimers = false, constructId = '') {
  return [
    ...(entryId ? [{ action: 'open_plasmid', entry_id: entryId, label: 'Open Plasmid' }] : []),
    ...(hasBuilder ? [{ action: 'open_protein_builder', entry_id: entryId, construct_id: constructId, label: 'Open Protein Builder' }] : []),
    ...(hasPrimers ? [{ action: 'open_primer_design', entry_id: entryId, label: 'Open Primer Design' }] : [])
  ];
}
function derivativeResponse(value) {
  const metadata = value.metadata;
  return { ...summary(value), status: 'derivative_created', entry_status: value.entry.status, source_id: metadata.parent_entry_id, root_id: metadata.root_entry_id, changes: metadata.changes, affected_features: metadata.affected_features, protein: metadata.protein,
    ui_actions: actions(value.entry.id, Boolean(metadata.construct_id), Boolean(metadata.primer_design), metadata.construct_id), summary: `Derivative ${value.entry.name} is available (${value.entry.status}).` };
}
async function resolveSource(storagePath, reference, model) {
  if (!reference) model.fail('A source feature reference is required.');
  const value = await store.load(storagePath, reference.entry_id);
  checkRevision(value, reference.expected_revision);
  const { feature } = model.resolveFeature(value.record, value.revision, reference.feature_ref);
  return { ...value, feature, context: model.codingContext(value.record, feature) };
}
async function queryLibrary(storagePath, args, context, model) {
  const result = await library.listSequenceEntries({ storagePath, status: args.status === 'all' ? '' : args.status, projects: context.snapshot?.projects || [] });
  const folder = args.folder_id ?? (args.project_id ? `project:${args.project_id}` : undefined);
  const entries = result.entries.filter(e => (folder === undefined || e.folderId === folder) && (!args.topology || e.topology === args.topology));
  if (!args.mode || args.mode === 'name') {
    const selected = args.mode ? entries.filter(e => e.name.toLowerCase().includes(args.query.toLowerCase())) : entries;
    const page = paginate(selected, args);
    const items = [];
    for (const entry of page.items) {
      const value = await library.getSequenceEntry({ storagePath, id: entry.id, includeGbk: true });
      items.push({ ...summary({ ...value, revision: store.revision(value.entry, value.gbkText) }), ...(args.mode ? { matches: [] } : {}) });
    }
    return { ...page, items, folders: result.folders };
  }
  const results = [];
  for (const entry of entries) {
    const value = await store.load(storagePath, entry.id);
    let matches = [];
    if (args.mode) {
      const q = args.mode === 'protein' ? model.peptide(args.query) : args.query.toUpperCase();
      if (args.mode === 'name') {
        if (!entry.name.toUpperCase().includes(q)) continue;
      } else if (args.mode === 'feature') {
        matches = model.allFeatures(value.record).flatMap((f, i) => `${f.name} ${f.type}`.toUpperCase().includes(q) ? [model.summarizeFeature(value.record, f, value.revision, i)] : []);
      } else if (args.mode === 'protein') {
        matches = model.allFeatures(value.record, true).flatMap((f, i) => {
          if (!/^(cds|open_reading_frame|orf)$/i.test(f.type)) return [];
          const protein = model.codingContext(value.record, f).protein;
          const hits = []; let pos = protein.indexOf(q);
          while (pos >= 0 && hits.length < 200) { hits.push({ start: pos + 1, end: pos + q.length }); pos = protein.indexOf(q, pos + 1); }
          return hits.length ? [{ ...model.summarizeFeature(value.record, f, value.revision, i), residue_matches: hits }] : [];
        });
      } else {
        const query = model.dna(args.query);
        const reverse = query.split('').reverse().map(c => ({ A: 'T', T: 'A', C: 'G', G: 'C', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N' })[c]).join('');
        const seq = value.record.sequence;
        const text = value.record.topology === 'circular' ? seq + seq.slice(0, query.length - 1) : seq;
        if (query.length <= seq.length) for (const [needle, strand] of [[query, 1], ...(reverse !== query ? [[reverse, -1]] : [])]) {
          let pos = text.indexOf(needle);
          while (pos >= 0 && pos < seq.length && matches.length < 200) {
            const end = pos + needle.length;
            const segments = end <= seq.length ? [{ start: pos + 1, end }] : [{ start: pos + 1, end: seq.length }, { start: 1, end: end - seq.length }];
            const features = value.record.features.flatMap((f, i) => f.segments.some(s => segments.some(t => s.start < t.end && s.end >= t.start)) ? [model.summarizeFeature(value.record, f, value.revision, i)] : []);
            matches.push({ strand, segments, features }); pos = text.indexOf(needle, pos + 1);
          }
        }
      }
      if (args.mode !== 'name' && !matches.length) continue;
    }
    results.push({ ...summary(value), ...(args.mode ? { matches, matches_truncated: matches.length >= 200 } : {}) });
  }
  return { ...paginate(results, args), folders: result.folders };
}
async function execute(name, args, storagePath, context = {}) {
  const model = await algorithms();
  if (name === 'sequence_protein_parts') {
    const parts = model.catalog.filter(p => (!args.type || p.type === args.type) && (!args.query || `${p.label} ${p.part_id}`.toLowerCase().includes(args.query.toLowerCase())));
    return { ...paginate(parts, args), codon_profiles: model.profiles, default_codon_profile: 'ecoli' };
  }
  return withLibraryLock(storagePath, async () => {
    if (name === 'sequence_list' || name === 'sequence_search') return queryLibrary(storagePath, args, context, model);
    if (name === 'sequence_protein_build') {
      const id = `construct_${store.hash(args.request_id).slice(0, 32)}`;
      const requestHash = store.hash(args);
      let built;
      try { built = await store.artifact(storagePath, id); } catch (e) { if (e.code !== 'not_found') throw e; }
      if (built && built.request_hash !== requestHash) model.fail('Request ID already used with different build arguments.', 'request_conflict');
      if (!built) {
        const sources = {};
        for (const [index, part] of args.parts.entries()) {
          if (part.kind === 'feature') {
            sources[index] = await resolveSource(storagePath, part.source, model);
            if (!sources[index].context.editable) model.fail(sources[index].context.warnings.join(' '));
          }
        }
        built = { ...model.buildProtein(args, sources), version: 1, construct_id: id, request_hash: requestHash, sources: Object.values(sources).map(s => ({ entry_id: s.entry.id, revision: s.revision })) };
        await store.artifact(storagePath, id, built);
      }
      const { payload: _payload, ...result } = built;
      return { status: 'construct_ready', ...result, ui_actions: actions('', true, false, id) };
    }
    const requestHash = store.hash({ name, args });
    if (name.endsWith('_edit')) {
      const prior = await store.retry(storagePath, args.request_id, requestHash);
      if (prior) return derivativeResponse(prior);
    }
    const value = await store.load(storagePath, args.entry_id);
    if (args.expected_revision) checkRevision(value, args.expected_revision);
    if (name === 'sequence_get') {
      const features = model.allFeatures(value.record, args.include_orfs);
      const response = { ...summary(value), features: paginate(features.map((f, i) => model.summarizeFeature(value.record, f, value.revision, i)), args), ui_actions: actions(value.entry.id, Boolean(value.metadata?.construct_id), Boolean(value.metadata?.primer_design), value.metadata?.construct_id) };
      if (args.include_sequence) response.sequence = value.record.sequence;
      if (args.feature_ref) { const { feature, index } = model.resolveFeature(value.record, value.revision, args.feature_ref); response.feature = model.summarizeFeature(value.record, feature, value.revision, index, args.include_feature_dna); }
      if (args.nucleotide_range) {
        const { start, end } = args.nucleotide_range;
        model.integer(start, 1, value.record.sequence.length, 'range start'); model.integer(end, start, value.record.sequence.length, 'range end');
        response.nucleotide_range = { start, end, sequence: value.record.sequence.slice(start - 1, end) };
      }
      return response;
    }
    if (name === 'sequence_protein_get') {
      const { feature } = model.resolveFeature(value.record, value.revision, args.feature_ref);
      const coding = model.codingContext(value.record, feature);
      return { ...summary(value), feature_ref: args.feature_ref, residue_count: coding.residues.length, residues: paginate(coding.residues, args, 100), terminal_stop: coding.terminal_stop, editable: coding.editable, warnings: coding.warnings };
    }
    if (name === 'sequence_mutagenesis_primers') {
      if (!value.metadata?.patches?.length) return { status: 'no_feasible_design', routes: [], warnings: ['This entry has no recorded DNA edits.'] };
      if (value.metadata.result_sequence_hash !== store.hash(value.record.sequence)) model.fail('The derivative has changed since its recorded edit. Create a new derivative before designing primers.', 'stale_design');
      const donorValue = args.donor ? await resolveSource(storagePath, args.donor, model) : null;
      const donor = donorValue ? { ...donorValue.record, id: donorValue.entry.id } : null;
      const design = model.comparePrimerRoutes(value.metadata.source_record, value.record, value.metadata.patches, args.methods, donor, value.metadata.parent_entry_id, value.metadata.source_is_derived ? 'hypothetical_intermediate' : 'supplied_template');
      const metadata = { ...value.metadata, primer_design: design, primer_revision: value.revision };
      await store.saveDesign(storagePath, value.entry.id, metadata);
      const compactDesign = { ...design, routes: design.routes.map(route => ({ ...route, stages: route.stages.map(stage => ({ stage: stage.stage, feasible: stage.feasible, product_matches: stage.product_matches, product_validation: stage.product_validation, template_kind: stage.template_kind, warnings: stage.warnings, primers: stage.primers })) })) };
      return { ...summary(value), ...compactDesign, ui_actions: actions(value.entry.id, false, true) };
    }
    checkRevision(value, args.expected_revision);
    let edit;
    let constructId = '';
    if (name === 'sequence_feature_edit') {
      if (args.operation === 'delete' && (args.dna || args.source || args.feature || args.after_base !== undefined)) model.fail('Deletion accepts only the target feature reference.');
      if (args.mode === 'annotation_only' && args.after_base !== undefined) model.fail('Use feature segments for annotation-only edits.');
      if (args.operation !== 'insert' && args.after_base !== undefined) model.fail('after_base is only valid for insertion.');
      const target = args.operation === 'insert' ? null : model.resolveFeature(value.record, value.revision, args.feature_ref);
      if (target && target.index >= value.record.features.length) model.fail('Predicted ORFs must be edited through sequence_protein_edit.');
      if (args.mode === 'annotation_only' && (args.dna || args.source)) model.fail('Annotation-only edits cannot include a DNA payload.');
      if (args.dna && args.source) model.fail('Choose either literal DNA or a source feature.');
      let replacement = args.dna || '';
      if (args.source) { const s = await resolveSource(storagePath, args.source, model); replacement = model.featureDna(s.record, s.feature); }
      edit = model.editFeature(value.record, args, target, replacement);
    } else if (name === 'sequence_protein_edit') {
      model.validateProfile(args.codon_profile);
      const { feature, index } = model.resolveFeature(value.record, value.revision, args.feature_ref);
      const operations = [];
      for (const operation of args.operations) {
        const op = { ...operation };
        if (op.construct_id) {
          if (!['insert', 'replace_cds'].includes(op.operation) || op.amino_acids || op.amino_acid) model.fail('Construct payload is only valid for insertion or whole-CDS replacement, without a second peptide payload.');
          const construct = await store.artifact(storagePath, op.construct_id);
          op.amino_acids = construct.protein; op.dna = construct.dna; constructId = op.construct_id;
        }
        operations.push(op);
      }
      edit = model.editProtein(value.record, feature, index, operations, args.codon_profile);
    } else model.fail('Unknown sequence tool.');
    const record = edit.record;
    record.name = args.name || model.buildEditedSequenceName({ record: value.record, originalSequence: value.record.sequence, editedSequence: record.sequence, baseName: value.entry.name }) || `${value.entry.name} edited`;
    if (record.name === value.entry.name) record.name = `${value.entry.name} edited`;
    const metadata = {
      request_id: args.request_id, request_hash: requestHash, parent_entry_id: value.entry.id,
      root_entry_id: value.metadata?.root_entry_id || value.entry.id, parent_revision: value.revision,
      source_record: value.record, source_is_derived: Boolean(value.metadata?.patches?.length || value.metadata?.source_is_derived), result_sequence_hash: store.hash(record.sequence), patches: edit.patches,
      changes: args.operations || [{ operation: args.operation, mode: args.mode, feature_ref: args.feature_ref }],
      affected_features: edit.affected_features, protein: edit.protein, construct_id: constructId,
      history: [...(value.metadata?.history || []), { source_id: value.entry.id, source_revision: value.revision, tool: name, request_id: args.request_id }]
    };
    if (constructId) metadata.construct = await store.artifact(storagePath, constructId);
    const gbkText = model.buildRecordGenbankText(record);
    const saved = await store.createDerivative(storagePath, value, record, metadata, gbkText);
    return derivativeResponse(saved);
  });
}
module.exports = { execute, algorithms, checkRevision };
