import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDnaAssemblyRecord, orientDnaAssemblyFragment, getDnaFragmentEnds, findDnaTerminalOverlap } from '../src/renderer/modules/sequence-viewer/dna-assembly.js';
import { buildRestrictionDigestProducts } from '../src/renderer/modules/sequence-viewer/restriction-digestion.js';
import { reverseComplementIupac as rc } from '../src/renderer/modules/sequence-viewer/shared.js';
import { buildRecordGenbankText } from '../src/renderer/modules/sequence-viewer/storage.js';
import { parseInputRecords } from '../src/renderer/modules/sequence-viewer/parsing.js';
import { createLibraryPersistenceActions } from '../src/renderer/modules/sequence-viewer/runtime/library-persistence.js';

const record = (name, sequence, features = []) => ({ name, sequence, features, topology: 'linear' });
const input = (record, orientation = 'forward') => ({ record, orientation, entryId: record.name });
const roundtrip = record => parseInputRecords(buildRecordGenbankText(record)).records[0];
const fails = (code, fn) => assert.throws(fn, error => error.assemblyCode === code);
const a = record('A', 'TTGCCATGCGATACG');
const b = record('B', 'GACTACGTTAGCCAT', [{ id: 'gene', name: 'gene B', type: 'CDS', strand: -1,
  segments: [{ start: 2, end: 11 }], qualifiers: { translation: 'fixture' } }]);
const originals = JSON.stringify([a, b]);
const blunt = buildDnaAssemblyRecord([input(a), input(b)], { method: 'blunt', name: 'Blunt assembly' });
assert.equal(blunt.sequence, a.sequence + b.sequence);
assert.equal(blunt.features.find(feature => feature.name === 'gene B').segments[0].start, a.sequence.length + 2);
assert.equal(blunt.features.filter(feature => feature.qualifiers?.hikari_assembly_source).length, 2);
const flipped = buildDnaAssemblyRecord([input(a), input(b, 'reverse')], { method: 'blunt' });
assert.equal(flipped.sequence, a.sequence + rc(b.sequence));
const gene = flipped.features.find(feature => feature.name === 'gene B');
assert.equal(gene.strand, 1);
assert.deepEqual(gene.segments, [{ start: a.sequence.length + 4, end: a.sequence.length + 13 }]);
assert.equal(JSON.stringify([a, b]), originals, 'inputs are never mutated');
assert.equal(buildDnaAssemblyRecord([input(a), input(b)], { method: 'blunt', topology: 'circular' }).topology, 'circular');
assert.equal(roundtrip(flipped).sequence, flipped.sequence);
assert.equal(getDnaFragmentEnds(roundtrip(blunt)).left.kind, 'blunt');

const overlap = 'ACGTCAGTACGATGC';
const overlap2 = 'TATGCGATCGTACGA';
const oa = record('Overlap A', 'TTCGAACGTA' + overlap);
const ob = record('Overlap B', overlap + 'GGACTCCAGTA' + overlap2);
const oc = record('Overlap C', overlap2 + 'CGATTTGCATA');
const pcr = buildDnaAssemblyRecord([input(oa), input(ob), input(oc)], { method: 'overlap-pcr' });
assert.equal(pcr.sequence, oa.sequence + ob.sequence.slice(15) + oc.sequence.slice(15));
assert.deepEqual(pcr.junctions.map(junction => junction.overlap), [15, 15]);
assert.deepEqual(pcr.features.filter(feature => feature.qualifiers?.hikari_assembly_source).map(feature => feature.segments[0].start), [0, 10, 36]);
fails('overlap', () => buildDnaAssemblyRecord([input(oa), input(ob, 'reverse')], { method: 'overlap-pcr' }));
fails('minimum', () => buildDnaAssemblyRecord([input(oa), input(ob)], { method: 'overlap-pcr', minimumOverlap: 1 }));
fails('pcrTopology', () => buildDnaAssemblyRecord([input(oa), input(ob)], { method: 'overlap-pcr', topology: 'circular' }));
fails('contained', () => buildDnaAssemblyRecord([input(oa), input(oa)], { method: 'overlap-pcr' }));
assert.equal(findDnaTerminalOverlap('AAAANNNNNNNNNNNNNNN', 'NNNNNNNNNNNNNNNCCCC'), 0, 'ambiguous bases never prove an overlap');
assert.equal(findDnaTerminalOverlap('A'.repeat(100000), 'A'.repeat(99999) + 'C'), 99999, 'long repeats use linear-time matching');
fails('fragments', () => buildDnaAssemblyRecord([input(a)]));
fails('linear', () => buildDnaAssemblyRecord([input({ ...a, topology: 'circular' }), input(b)], { method: 'blunt' }));
fails('sequence', () => buildDnaAssemblyRecord([input(record('Invalid', 'ACGTZ')), input(b)], { method: 'blunt' }));
fails('sticky', () => buildDnaAssemblyRecord([input(a), input(b)]));
fails('name', () => buildDnaAssemblyRecord([input(a), input(b)], { method: 'blunt', name: ' ' }));

let seed = 970;
const sequence = Array.from({ length: 200 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 'ACGT'[seed >>> 30]; }).join('');
const template = { name: 'Template', sequence, topology: 'circular', features: [
  { id: 'cds', name: 'Long CDS', type: 'CDS', strand: 1, segments: [{ start: 30, end: 70 }] }
] };
const site = (name, cut, start) => ({ name, site: cut.replace(/[^ACGT]/g, ''), type: 'restriction_site', strand: 1, cut, segments: [{ start, end: start + 6 }] });
for (const cutter of [{ name: 'BsaI', cut: 'GGTCTC(1/5)', shift: 7 }, { name: 'PstI', cut: 'CTGCA^G', shift: 5 }]) {
  const products = buildRestrictionDigestProducts(template, [10, 110].map(start => ({ site: site(cutter.name, cutter.cut, start) })));
  const reloaded = products.map(roundtrip);
  const joined = buildDnaAssemblyRecord(reloaded.map(input), { method: 'sticky', topology: 'circular' });
  const start = 10 + cutter.shift;
  assert.equal(joined.sequence, sequence.slice(start) + sequence.slice(0, start), `${cutter.name} digestion reassembles without duplicated or lost overhangs`);
  const reversed = buildDnaAssemblyRecord([...reloaded].reverse().map(fragment => input(fragment, 'reverse')), { method: 'sticky', topology: 'circular' });
  assert.equal(reversed.sequence.length, sequence.length);
  assert.ok((rc(sequence) + rc(sequence)).includes(reversed.sequence), 'reversed ligation preserves the complete circular molecule');
  const oriented = orientDnaAssemblyFragment(input(reloaded[0], 'reverse'));
  const twice = orientDnaAssemblyFragment(input({ ...oriented, digestEnds: oriented.ends }, 'reverse'));
  assert.equal(twice.sequence, reloaded[0].sequence, 'reverse orientation preserves asymmetric physical strands');
  fails('blunt', () => buildDnaAssemblyRecord(reloaded.map(input), { method: 'blunt' }));
  const corrupt = { ...reloaded[1], digestEnds: { ...getDnaFragmentEnds(reloaded[1]), left: { kind: '3-prime', sequence: 'ACGT' } } };
  fails('sticky', () => buildDnaAssemblyRecord([input(reloaded[0]), input(corrupt)], { method: 'sticky' }));
}

const require = createRequire(import.meta.url);
const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library/index.js');
const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-assembly-'));
try {
  const persist = async (id, source, parentEntryId = '') => library.upsertSequenceEntry({ storagePath, id, parentEntryId,
    name: source.name, status: 'saved', topology: source.topology, sequence: source.sequence, sequenceLength: source.sequence.length,
    features: source.features, featureCount: source.features.length, gbkText: buildRecordGenbankText(source) });
  await persist('template', template);
  await persist('child', a, 'template');
  const state = { activeEntryId: 'child', activeEntryStatus: 'saved' };
  let opened = '';
  const persistence = createLibraryPersistenceActions({ state, actions: {
    getStoragePath: () => storagePath, getBridge: () => ({ sequenceLibraryUpsert: async payload => ({ ok: true, ...await library.upsertSequenceEntry(payload) }) }),
    setStatus: () => {}
  }, controllers: { home: { refreshLibraryEntries: async () => {}, openLibraryEntryInDetail: async id => { opened = id; } } } });
  const output = await persistence.saveAssembledDna(blunt, { id: 'assembled', storagePath });
  assert.equal(output.parentEntryId, '', 'assembly is always an independent root');
  assert.equal(opened, 'assembled');
  assert.equal(state.activeEntryId, 'child', 'persisting a new output does not overwrite the active source identity');
  await persistence.saveAssembledDna(blunt, { id: 'assembled', storagePath });
  const entries = (await library.listSequenceEntries({ storagePath })).entries;
  assert.equal(entries.length, 3, 'retrying a save reuses the output ID');
  assert.equal(entries.find(entry => entry.id === 'child').parentEntryId, 'template');
  assert.equal(parseInputRecords((await library.getSequenceEntry({ storagePath, id: 'assembled', includeGbk: true })).gbkText).records[0].sequence, blunt.sequence);
  await assert.rejects(persistence.saveAssembledDna(blunt, { id: 'other', storagePath: storagePath + '-changed' }), /storage folder changed/);
} finally {
  await fs.rm(storagePath, { recursive: true, force: true });
}
console.log('sequence-assembly-selfcheck: ok');
