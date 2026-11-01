import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildRestrictionDigestProducts, resolveDigestSiteCuts } from '../src/renderer/modules/sequence-viewer/restriction-digestion.js';
import { getCommercialRestrictionFeaturesForRecord } from '../src/renderer/modules/sequence-viewer/restriction-analysis.js';
import { buildRecordGenbankText } from '../src/renderer/modules/sequence-viewer/storage.js';
import { parseInputRecords } from '../src/renderer/modules/sequence-viewer/parsing.js';
import { reverseComplementIupac } from '../src/renderer/modules/sequence-viewer/shared.js';
import { createLibraryPersistenceActions } from '../src/renderer/modules/sequence-viewer/runtime/library-persistence.js';

const sequence = 'ACGTTACGTA' + 'GAATTC' + 'TATCCGATGCTAGTACGTAC' + 'GGATCC' + 'CTAGTCGTAA';
const template = { name: 'Digest template', sequence, topology: 'circular', features: [
  { id: 'gene', name: 'Interrupted gene', type: 'CDS', strand: 1, translation: 'STALE', qualifiers: { translation: 'STALE' }, segments: [{ start: 5, end: 25 }] },
  { id: 'retained', name: 'Retained feature', type: 'misc_feature', strand: -1, segments: [{ start: 18, end: 27 }] }
] };
const unchanged = JSON.stringify(template);
const sites = getCommercialRestrictionFeaturesForRecord(template);
const eco = sites.find(site => site.name === 'EcoRI');
const bam = sites.find(site => site.name === 'BamHI');
assert.ok(eco && bam);
const ecoCut = resolveDigestSiteCuts(template, eco)[0];
const bamCut = resolveDigestSiteCuts(template, bam)[0];
assert.deepEqual([ecoCut.top, ecoCut.bottom], [11, 15]);
assert.deepEqual([bamCut.top, bamCut.bottom], [37, 41]);
const one = buildRestrictionDigestProducts(template, [{ site: eco }]);
assert.equal(one.length, 1);
assert.equal(one[0].topology, 'linear');
assert.equal(one[0].sequence, sequence.slice(11) + sequence.slice(0, 11));
assert.equal(one[0].digestEnds.left.kind, '5-prime');
assert.equal(one[0].digestEnds.left.sequence, 'AATT');
const geneParts = one[0].features.filter(feature => feature.name === 'Interrupted gene');
assert.equal(geneParts.length, 2, 'a linearization break splits its interrupted CDS annotation');
assert.ok(geneParts.every(feature => feature.qualifiers.partial === 'true' && !feature.translation));
assert.equal(geneParts.reduce((sum, feature) => sum + feature.segments.reduce((n, part) => n + part.end - part.start, 0), 0), 20);
const two = buildRestrictionDigestProducts(template, [{ site: bam }, { site: eco }]);
assert.equal(two.length, 2);
assert.equal(two[0].sequence, sequence.slice(11, 37));
assert.equal(two[1].sequence, sequence.slice(37) + sequence.slice(0, 11));
assert.equal(two.reduce((sum, product) => sum + product.sequence.length, 0), sequence.length);
assert.equal(JSON.stringify(template), unchanged);
const linear = { ...template, topology: 'linear' };
assert.equal(buildRestrictionDigestProducts(linear, [{ site: eco }]).length, 2);
const linearDouble = buildRestrictionDigestProducts(linear, [{ site: eco }, { site: bam }]);
assert.deepEqual(linearDouble.map(product => product.sequence), [sequence.slice(0, 11), sequence.slice(11, 37), sequence.slice(37)]);
assert.equal(linearDouble[0].digestEnds.left.kind, 'original');
assert.equal(linearDouble[2].digestEnds.right.kind, 'original');
assert.throws(() => buildRestrictionDigestProducts(template, [{ site: eco }, { site: eco }]), /different second/);
assert.throws(() => buildRestrictionDigestProducts(template, [{ site: { ...eco, enzymes: [], cut: '?' } }]), /supported/);

const site = (name, motif, cut, start, strand = 1) => ({ name, site: motif, type: 'restriction_site', cut, strand,
  segments: [{ start, end: start + motif.length }] });
const long = { name: 'Type IIS', topology: 'circular', sequence: 'ATCG'.repeat(30), features: [] };
const bsa = site('BsaI', 'GGTCTC', 'GGTCTC(1/5)', 10);
const bsaCuts = resolveDigestSiteCuts(long, bsa)[0];
assert.deepEqual([bsaCuts.top, bsaCuts.bottom], [17, 21]);
const tailed = buildRestrictionDigestProducts(long, [{ site: bsa }])[0];
assert.equal(tailed.digestEnds.left.sequence, long.sequence.slice(17, 21));
assert.equal(tailed.digestEnds.right.sequence, reverseComplementIupac(long.sequence.slice(17, 21)));
const reverseCuts = resolveDigestSiteCuts(long, { ...bsa, strand: -1 })[0];
assert.deepEqual([reverseCuts.top, reverseCuts.bottom], [5, 9]);
const pst = site('PstI', 'CTGCAG', 'CTGCA^G', 20);
const pstProduct = buildRestrictionDigestProducts(long, [{ site: pst }])[0];
assert.equal(pstProduct.digestEnds.left.kind, '3-prime');
assert.equal(pstProduct.digestEnds.left.sequence, reverseComplementIupac(long.sequence.slice(21, 25)));
assert.equal(pstProduct.digestEnds.right.sequence, long.sequence.slice(21, 25));
const sma = site('SmaI', 'CCCGGG', 'CCC^GGG', 25);
assert.equal(buildRestrictionDigestProducts(long, [{ site: sma }])[0].digestEnds.left.kind, 'blunt');
const variants = { ...sma, cut: '', enzymes: [{ name: 'SmaI', cut: 'CCC^GGG' }, { name: 'XmaI', cut: 'C^CCGGG' }] };
assert.equal(buildRestrictionDigestProducts(long, [{ site: variants, enzymeName: 'XmaI' }])[0].digestEnds.left.kind, '5-prime');
const bcg = site('BcgI', 'CGANNNNNNTGC', '(10/12)CGANNNNNNTGC(12/10)', 30);
assert.deepEqual(resolveDigestSiteCuts(long, bcg).map(cut => [cut.top, cut.bottom]), [[20, 18], [54, 52]]);
assert.equal(buildRestrictionDigestProducts(long, [{ site: bcg }]).length, 2, 'type IIB makes two breaks from one site');
assert.throws(() => buildRestrictionDigestProducts({ ...long, topology: 'linear' }, [{ site: { ...bsa, strand: -1, segments: [{ start: 1, end: 7 }] } }]), /inside both strands/);
assert.throws(() => buildRestrictionDigestProducts(long, [{ site: eco }, { site: { ...bam, segments: [{ start: 12, end: 18 }] } }]), /overlap/);
const origin = site('EcoRI', 'GAATTC', 'G^AATTC', long.sequence.length - 3);
origin.segments = [{ start: long.sequence.length - 3, end: long.sequence.length }, { start: 0, end: 3 }];
const originProduct = buildRestrictionDigestProducts(long, [{ site: origin }])[0];
assert.equal(originProduct.sequence.length, long.sequence.length);
assert.equal(originProduct.digestEnds.left.sequence, (long.sequence + long.sequence).slice(long.sequence.length - 2, long.sequence.length + 2));
const reloaded = parseInputRecords(buildRecordGenbankText(two[0])).records[0];
assert.equal(reloaded.sequence, two[0].sequence);
assert.equal(reloaded.features.find(feature => feature.qualifiers?.hikari_digest_end === 'left').qualifiers.hikari_digest_overhang, 'AATT');

const require = createRequire(import.meta.url);
const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library/index.js');
const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-digestion-'));
try {
  const state = { activeEntryId: '', activeEntryStatus: '' };
  let failSecond = true;
  const bridge = { sequenceLibraryUpsert: async payload => {
    if (payload.id === 'digest-child-2' && failSecond) throw new Error('Fixture disk failure');
    return { ok: true, ...await library.upsertSequenceEntry(payload) };
  } };
  const actions = { getSelectedRecord: () => template, getBridge: () => bridge, getStoragePath: () => storagePath,
    setAlignmentSessions: () => {}, setStatus: () => {} };
  const controllers = { home: { refreshLibraryEntries: async () => {}, openLibraryEntryInDetail: async () => {} } };
  const persistence = createLibraryPersistenceActions({ state, actions, controllers });
  const entryIds = ['digest-child-1', 'digest-child-2'];
  await assert.rejects(persistence.saveDerivedDnaFragments(template, two, { entryIds }), /Fixture disk failure/);
  const parentId = state.activeEntryId;
  assert.equal((await library.listSequenceEntries({ storagePath })).entries.length, 2);
  failSecond = false;
  const saved = await persistence.saveDerivedDnaFragments(template, two, { entryIds });
  assert.equal(saved.length, 2);
  const entries = (await library.listSequenceEntries({ storagePath })).entries;
  assert.equal(entries.length, 3, 'retrying a partial batch creates no duplicates');
  assert.ok(saved.every(entry => entry.parentEntryId === parentId && entry.gbkRelPath.endsWith('.gbk')));
  const stored = await library.getSequenceEntry({ storagePath, id: saved[1].id, includeGbk: true });
  assert.equal(parseInputRecords(stored.gbkText).records[0].sequence, two[1].sequence);
} finally {
  await fs.rm(storagePath, { recursive: true, force: true });
}
console.log('sequence-digestion-selfcheck: ok');
