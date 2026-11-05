import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDnaAssemblyRecord, orientDnaAssemblyFragment, getDnaFragmentEnds, getUnpairedStrandEnds, findDnaTerminalOverlap } from '../src/renderer/modules/sequence-viewer/dna-assembly.js';
import { buildRestrictionDigestProducts } from '../src/renderer/modules/sequence-viewer/restriction-digestion.js';
import { reverseComplementIupac as rc } from '../src/renderer/modules/sequence-viewer/shared.js';
import { buildRecordGenbankText } from '../src/renderer/modules/sequence-viewer/storage.js';
import { parseInputRecords } from '../src/renderer/modules/sequence-viewer/parsing.js';
import { createLibraryPersistenceActions } from '../src/renderer/modules/sequence-viewer/runtime/library-persistence.js';

const record = (name, sequence, features = []) => ({ name, sequence, features, topology: 'linear' });
const input = (record, orientation = 'forward') => ({ record, orientation, entryId: record.name });
const roundtrip = record => parseInputRecords(buildRecordGenbankText(record)).records[0];
const fails = (code, fn) => assert.throws(fn, error => error.assemblyCode === code);
const overlap = 'ACGTCAGTACGATGC';
const a = record('A', 'TTGCCATGCGATACG' + overlap);
const b = record('B', overlap + 'GACTACGTTAGCCAT', [{ id: 'gene', name: 'gene B', type: 'CDS', strand: -1,
  segments: [{ start: 17, end: 26 }], qualifiers: { translation: 'fixture' } }]);
const originals = JSON.stringify([a, b]);
const assembled = buildDnaAssemblyRecord([input(a), input(b)], { name: 'Auto assembly' });
assert.equal(assembled.assemblyMethod, 'overlap-pcr');
assert.equal(assembled.sequence, a.sequence + b.sequence.slice(15));
assert.equal(assembled.features.find(feature => feature.name === 'gene B').segments[0].start, a.sequence.length + 2);
assert.deepEqual(assembled.features.filter(feature => !feature.qualifiers?.hikari_digest_end).map(feature => feature.name), ['gene B'],
  'no full-span feature is added over each input fragment');
const reverseB = orientDnaAssemblyFragment(input(b, 'reverse'));
const flipped = buildDnaAssemblyRecord([input(a), input(reverseB)]);
assert.equal(flipped.sequence, assembled.sequence, 'a reverse-complemented input is oriented automatically');
const gene = flipped.features.find(feature => feature.name === 'gene B');
assert.equal(gene.strand, -1);
assert.deepEqual(gene.segments, [{ start: a.sequence.length + 2, end: a.sequence.length + 11 }]);
assert.match(flipped.description, /B \(reverse\)/, 'fragment provenance stays in the description');
assert.equal(JSON.stringify([a, b]), originals, 'inputs are never mutated');
assert.equal(buildDnaAssemblyRecord([input(a), input(b)]).topology, 'linear', 'open outer ends infer linear DNA');
assert.equal(roundtrip(flipped).sequence, flipped.sequence);
assert.equal(getDnaFragmentEnds(roundtrip(assembled)).left.kind, 'blunt');

const overlap2 = 'TATGCGATCGTACGA';
const oa = record('Overlap A', 'TTCGAACGTA' + overlap);
const ob = record('Overlap B', overlap + 'GGACTCCAGTA' + overlap2);
const oc = record('Overlap C', overlap2 + 'CGATTTGCATA');
const pcr = buildDnaAssemblyRecord([input(oa), input(ob), input(oc)]);
assert.equal(pcr.sequence, oa.sequence + ob.sequence.slice(15) + oc.sequence.slice(15));
assert.deepEqual(pcr.junctions.map(junction => junction.overlap), [15, 15]);
assert.deepEqual(pcr.features.filter(feature => !feature.qualifiers?.hikari_digest_end), [], 'joined fragments contribute no features of their own');
for (let mask = 0; mask < 8; mask++) {
  const sources = [oa, ob, oc].map((fragment, index) => mask & (1 << index)
    ? orientDnaAssemblyFragment(input(fragment, 'reverse')) : fragment);
  assert.equal(buildDnaAssemblyRecord(sources.map(input)).sequence, pcr.sequence, `all mixed input orientations resolve (${mask})`);
}

const closing = 'GCTAACGTCAGTCCA';
const circularA = record('Circular A', closing + 'GGAACCTTAA' + overlap);
const circularC = record('Circular C', overlap2 + 'CGATTTGCATA' + closing, [
  { id: 'closing', name: 'Closing CDS', type: 'CDS', strand: 1, segments: [{ start: 21, end: 40 }], qualifiers: { codon_start: '2' } },
  { id: 'closing-reverse', name: 'Reverse closing CDS', type: 'CDS', strand: -1, segments: [{ start: 21, end: 40 }], qualifiers: { codon_start: '2' } }
]);
const circularInputs = [circularA, ob, circularC];
const circular = buildDnaAssemblyRecord(circularInputs.map(input));
const circularSequence = (circularA.sequence + ob.sequence.slice(15) + circularC.sequence.slice(15)).slice(0, -15);
assert.equal(circular.topology, 'circular', 'a compatible closing homology junction infers a circle');
assert.equal(circular.assemblyMethod, 'overlap-assembly');
assert.equal(circular.sequence, circularSequence, 'the closing overlap is retained once');
assert.equal(circular.junctions.length, 3);
assert.equal(circular.digestEnds, undefined, 'circular products have no free ends');
assert.ok(circular.features.every(feature => !feature.qualifiers?.hikari_digest_end));
const featureSequence = (record, feature) => {
  const bases = feature.segments.map(segment => record.sequence.slice(segment.start, segment.end)).join('');
  return feature.strand === -1 ? rc(bases) : bases;
};
for (const feature of circularC.features) {
  const mapped = circular.features.find(mapped => mapped.name === feature.name);
  assert.equal(mapped.segments.length, 2, 'a feature crossing the closed origin is split into ordered segments');
  assert.equal(featureSequence(circular, mapped), featureSequence(circularC, feature));
  const reloaded = roundtrip(circular);
  assert.equal(reloaded.topology, 'circular');
  assert.equal(featureSequence(reloaded, reloaded.features.find(mapped => mapped.name === feature.name)), featureSequence(circularC, feature));
}
for (let mask = 0; mask < 8; mask++) {
  const sources = circularInputs.map((fragment, index) => mask & (1 << index)
    ? orientDnaAssemblyFragment(input(fragment, 'reverse')) : fragment);
  const result = buildDnaAssemblyRecord(sources.map(input));
  assert.equal(result.topology, 'circular');
  assert.equal(result.sequence, circularSequence, `circular topology and orientation resolve together (${mask})`);
}
const shortClosing = { ...circularC, sequence: circularC.sequence.slice(0, -1), features: [] };
assert.equal(buildDnaAssemblyRecord([circularA, ob, shortClosing].map(input)).topology, 'linear', 'subthreshold closing homology does not imply a circle');
const repeat = 'ACGT'.repeat(20);
assert.equal(buildDnaAssemblyRecord([record('Repeat A', repeat.slice(0, 35)), record('Repeat B', repeat.slice(2, 37))].map(input)).topology,
  'linear', 'terminal repeats cannot shrink a circular product below the length of an input fragment');
fails('minimum', () => buildDnaAssemblyRecord([input(oa), input(ob)], { minimumOverlap: 1 }));
fails('compatible', () => buildDnaAssemblyRecord([input(oa), input(oa)]));
assert.equal(findDnaTerminalOverlap('AAAANNNNNNNNNNNNNNN', 'NNNNNNNNNNNNNNNCCCC'), 0, 'ambiguous bases never prove an overlap');
assert.equal(findDnaTerminalOverlap('A'.repeat(100000), 'A'.repeat(99999) + 'C'), 99999, 'long repeats use linear-time matching');
fails('fragments', () => buildDnaAssemblyRecord([input(a)]));
fails('linear', () => buildDnaAssemblyRecord([input({ ...a, topology: 'circular' }), input(b)]));
fails('sequence', () => buildDnaAssemblyRecord([input(record('Invalid', 'ACGTZ')), input(b)]));
fails('compatible', () => buildDnaAssemblyRecord([input(record('No overlap A', 'AAAACCCC')), input(record('No overlap B', 'GGGGTTTT'))]));
fails('name', () => buildDnaAssemblyRecord([input(a), input(b)], { name: ' ' }));

const stickyA = { ...a, digestEnds: { left: { kind: 'blunt', sequence: '' }, right: { kind: '5-prime', sequence: rc(overlap.slice(0, 4)) } } };
const stickyB = { ...b, digestEnds: { left: { kind: '5-prime', sequence: overlap.slice(0, 4) }, right: { kind: 'blunt', sequence: '' } } };
const stickyPreferred = buildDnaAssemblyRecord([input(stickyA), input(stickyB)]);
assert.equal(stickyPreferred.assemblyMethod, 'sticky', 'explicit compatible end chemistry takes precedence over coincidental homology');
assert.equal(stickyPreferred.sequence, a.sequence + b.sequence);

let assemblySeed = 761;
const bases = length => Array.from({ length }, () => {
  assemblySeed = (Math.imul(assemblySeed, 1664525) + 1013904223) >>> 0;
  return 'ACGT'[assemblySeed >>> 30];
}).join('');
const shared = Array.from({ length: 31 }, () => bases(15));
const many = Array.from({ length: 32 }, (_, index) => record(`Fragment ${index + 1}`,
  (shared[index - 1] || '') + bases(18) + (shared[index] || '')));
const manyInputs = many.map((fragment, index) => input(index % 2 ? orientDnaAssemblyFragment(input(fragment, 'reverse')) : fragment));
assert.equal(buildDnaAssemblyRecord(manyInputs).sequence, many[0].sequence + many.slice(1).map(fragment => fragment.sequence.slice(15)).join(''),
  'long mixed-orientation assemblies resolve without enumerating every orientation combination');

let seed = 970;
const sequence = Array.from({ length: 200 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 'ACGT'[seed >>> 30]; }).join('');
const template = { name: 'Template', sequence, topology: 'circular', features: [
  { id: 'cds', name: 'Long CDS', type: 'CDS', strand: 1, segments: [{ start: 30, end: 70 }] }
] };
const site = (name, cut, start) => ({ name, site: cut.replace(/[^ACGT]/g, ''), type: 'restriction_site', strand: 1, cut, segments: [{ start, end: start + 6 }] });
for (const cutter of [
  // A 5′ overhang protrudes on the stored plus strand at a product's left end;
  // a 3′ overhang protrudes at its right end. The partner strand is recessed
  // there, so those bases have no complement to draw.
  { name: 'BsaI', cut: 'GGTCTC(1/5)', shift: 7, unpaired: { left: 4, right: 0 } },
  { name: 'PstI', cut: 'CTGCA^G', shift: 5, unpaired: { left: 0, right: 4 } }
]) {
  const products = buildRestrictionDigestProducts(template, [10, 110].map(start => ({ site: site(cutter.name, cutter.cut, start) })));
  const reloaded = products.map(roundtrip);
  for (const product of reloaded) {
    assert.deepEqual(getUnpairedStrandEnds(product), cutter.unpaired, `${cutter.name} products report their single-stranded terminus`);
  }
  assert.equal(reloaded.reduce((sum, product) => {
    const ends = getUnpairedStrandEnds(product);
    return sum + ends.left + ends.right;
  }, 0), 8, 'each junction leaves its overhang unpaired in exactly one of the two stored fragments');
  const joined = buildDnaAssemblyRecord(reloaded.map(input));
  assert.equal(joined.assemblyMethod, 'sticky');
  assert.equal(joined.topology, 'circular', 'compatible closing sticky ends infer a circle automatically');
  const start = 10 + cutter.shift;
  assert.equal(joined.sequence, sequence.slice(start) + sequence.slice(0, start), `${cutter.name} digestion reassembles without duplicated or lost overhangs`);
  const reversed = buildDnaAssemblyRecord([...reloaded].reverse().map(fragment => {
    const reverse = orientDnaAssemblyFragment(input(fragment, 'reverse'));
    return input({ ...reverse, digestEnds: reverse.ends });
  }));
  assert.equal(reversed.sequence.length, sequence.length);
  assert.ok((rc(sequence) + rc(sequence)).includes(reversed.sequence), 'reversed ligation preserves the complete circular molecule');
  const oriented = orientDnaAssemblyFragment(input(reloaded[0], 'reverse'));
  const twice = orientDnaAssemblyFragment(input({ ...oriented, digestEnds: oriented.ends }, 'reverse'));
  assert.equal(twice.sequence, reloaded[0].sequence, 'reverse orientation preserves asymmetric physical strands');
  const open = { ...reloaded[0], digestEnds: { ...getDnaFragmentEnds(reloaded[0]), left: { kind: 'blunt', sequence: '' } } };
  const linear = buildDnaAssemblyRecord([input(open), input(reloaded[1])]);
  assert.equal(linear.topology, 'linear', 'a failed closing sticky junction leaves the valid chain linear');
  assert.ok(linear.digestEnds);
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
  const output = await persistence.saveAssembledDna(assembled, { id: 'assembled', storagePath });
  assert.equal(output.parentEntryId, '', 'assembly is always an independent root');
  assert.equal(opened, 'assembled');
  assert.equal(state.activeEntryId, 'child', 'persisting a new output does not overwrite the active source identity');
  await persistence.saveAssembledDna(assembled, { id: 'assembled', storagePath });
  const entries = (await library.listSequenceEntries({ storagePath })).entries;
  assert.equal(entries.length, 3, 'retrying a save reuses the output ID');
  assert.equal(entries.find(entry => entry.id === 'child').parentEntryId, 'template');
  assert.equal(parseInputRecords((await library.getSequenceEntry({ storagePath, id: 'assembled', includeGbk: true })).gbkText).records[0].sequence, assembled.sequence);
  const savedCircle = await persistence.saveAssembledDna(circular, { id: 'assembled-circle', storagePath });
  assert.equal(savedCircle.parentEntryId, '');
  assert.equal(savedCircle.topology, 'circular');
  const storedCircle = roundtrip(parseInputRecords((await library.getSequenceEntry({ storagePath, id: 'assembled-circle', includeGbk: true })).gbkText).records[0]);
  assert.equal(storedCircle.topology, 'circular');
  assert.equal(storedCircle.sequence, circularSequence);
  await assert.rejects(persistence.saveAssembledDna(assembled, { id: 'other', storagePath: storagePath + '-changed' }), /storage folder changed/);
} finally {
  await fs.rm(storagePath, { recursive: true, force: true });
}
console.log('sequence-assembly-selfcheck: ok');
