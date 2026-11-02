import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDnaFragmentRecord, buildPcrFragmentRecord, resolveFragmentPrimer, getFeatureDnaFragmentRange } from '../src/renderer/modules/sequence-viewer/dna-fragments.js';
import { buildRecordGenbankText } from '../src/renderer/modules/sequence-viewer/storage.js';
import { parseInputRecords } from '../src/renderer/modules/sequence-viewer/parsing.js';
import { reverseComplementIupac } from '../src/renderer/modules/sequence-viewer/shared.js';
import { buildDnaLibraryHierarchy } from '../src/renderer/modules/sequence-viewer/home/library-hierarchy.js';
import { primerFeatureSequence } from '../src/renderer/modules/sequence-viewer/primer-hover.js';
import { evaluatePcrPrimerCandidates } from '../src/renderer/modules/sequence-viewer/pcr-primer-picker.js';

const require = createRequire(import.meta.url);
const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library/index.js');
const database = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library/database.js');
let seed = 431;
const dna = count => Array.from({ length: count }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 'ACGT'[seed >>> 30]; }).join('');
const sequence = dna(240);
const template = { name: 'Template', topology: 'linear', sequence, features: [
  { name: 'clipped CDS', type: 'CDS', strand: 1, segments: [{ start: 0, end: 90 }], translation: 'STALE', qualifiers: { codon_start: '1', translation: 'STALE' } },
  { name: 'retained', type: 'misc_feature', strand: -1, segments: [{ start: 25, end: 40 }] },
  { name: 'outside', type: 'misc_feature', segments: [{ start: 190, end: 220 }] }
] };
const original = JSON.stringify(template);
const fragment = buildDnaFragmentRecord(template, { start: 20, end: 100 }, 'Saved fragment');
assert.equal(fragment.sequence, sequence.slice(20, 100));
assert.equal(fragment.topology, 'linear');
assert.equal(fragment.features.length, 2);
assert.deepEqual(fragment.features[1].segments, [{ start: 5, end: 20 }]);
assert.equal(fragment.features[0].translation, '');
assert.equal(fragment.features[0].qualifiers.codon_start, '2');
assert.equal(fragment.features[0].qualifiers.partial, 'true');
assert.equal(JSON.stringify(template), original, 'extraction leaves the template unchanged');
const reload = record => parseInputRecords(buildRecordGenbankText(record)).records[0];
assert.equal(reload(fragment).sequence, fragment.sequence);
assert.deepEqual(reload(fragment).features[1].segments, fragment.features[1].segments);
assert.throws(() => buildDnaFragmentRecord(template, { start: 230, end: 250 }), /valid DNA range/);
assert.throws(() => buildDnaFragmentRecord(template, { start: 50, end: 50 }), /valid DNA range/);

const circular = { ...template, topology: 'circular', features: [
  { name: 'origin feature', type: 'misc_feature', strand: -1, segments: [{ start: 230, end: 240 }, { start: 0, end: 12 }] }
] };
const wrapped = buildDnaFragmentRecord(circular, { start: 225, end: 20 });
assert.equal(wrapped.sequence, sequence.slice(225) + sequence.slice(0, 20));
assert.deepEqual(wrapped.features[0].segments, [{ start: 5, end: 15 }, { start: 15, end: 27 }]);
assert.deepEqual(reload(wrapped).features[0].segments, wrapped.features[0].segments);
assert.deepEqual(getFeatureDnaFragmentRange(template.features[1], template), { start: 25, end: 40 });
assert.deepEqual(getFeatureDnaFragmentRange(circular.features[0], circular), { start: 230, end: 252 });
assert.deepEqual(getFeatureDnaFragmentRange({ segments: [{ start: 20, end: 30 }, { start: 180, end: 190 }] }, circular), { start: 20, end: 190 }, 'joined annotations retain their genomic span');
assert.equal(getFeatureDnaFragmentRange({ segments: [] }, circular), null);

const primer = (name, start, end, strand, tail = '') => ({ name, type: 'primer_bind', strand,
  segments: [{ start, end }], primerSequence: tail + (strand === 1 ? sequence.slice(start, end) : reverseComplementIupac(sequence.slice(start, end))) });
const forward = primer('Forward', 20, 38, 1, 'GGGG');
const reverse = primer('Reverse', 150, 168, -1, 'CCCC');
const pcr = buildPcrFragmentRecord(template, forward, reverse);
assert.equal(pcr.sequence, 'GGGG' + sequence.slice(20, 168) + 'GGGG');
assert.equal(pcr.features.at(-1).primerSequence, reverse.primerSequence);
assert.deepEqual(pcr.features.at(-1).segments, [{ start: pcr.sequence.length - reverse.primerSequence.length, end: pcr.sequence.length }]);
assert.equal(reload(pcr).sequence, pcr.sequence);
assert.equal(reload(pcr).features.at(-1).primerSequence, reverse.primerSequence);
assert.equal(pcr.features[0].translation, '', 'PCR discards the old translation');
const mutant = { ...forward, primerSequence: forward.primerSequence.slice(0, 7) + (forward.primerSequence[7] === 'A' ? 'T' : 'A') + forward.primerSequence.slice(8) };
assert.ok(buildPcrFragmentRecord(template, mutant, reverse).sequence.startsWith(mutant.primerSequence));
const custom = buildPcrFragmentRecord(template, { sequence: forward.primerSequence }, { sequence: reverse.primerSequence });
assert.equal(custom.sequence, pcr.sequence, 'pasted primers retain 5′ additions');
const aroundOrigin = buildPcrFragmentRecord(circular, primer('F wrap', 210, 228, 1), primer('R wrap', 20, 38, -1));
assert.equal(aroundOrigin.sequence, sequence.slice(210) + sequence.slice(0, 38));
const crossingPrimer = { name: 'F origin', type: 'primer_bind', strand: 1, segments: [{ start: 230, end: 240 }, { start: 0, end: 8 }] };
assert.equal(primerFeatureSequence(crossingPrimer, sequence), sequence.slice(230) + sequence.slice(0, 8));
assert.equal(primerFeatureSequence({ ...crossingPrimer, strand: -1 }, sequence), reverseComplementIupac(sequence.slice(230) + sequence.slice(0, 8)));
assert.equal(buildPcrFragmentRecord(circular, crossingPrimer, primer('R', 40, 58, -1)).sequence, sequence.slice(230) + sequence.slice(0, 58));
assert.throws(() => buildPcrFragmentRecord(template, primer('F', 180, 198, 1), reverse), /face inward/);
assert.throws(() => resolveFragmentPrimer({ sequence: 'ACGT'.repeat(30), topology: 'linear' }, { sequence: 'ACGTACGTACGT' }, 1), /multiple sites/);
assert.throws(() => resolveFragmentPrimer(template, { sequence: 'AAAA' }, -1), /at least 12/);
assert.throws(() => resolveFragmentPrimer(template, { ...forward, primerSequence: 'A'.repeat(22) }, 1), /3′ end/);

const otherForward = primer('Other forward', 60, 78, 1);
const invalidReverse = { ...reverse, name: 'Invalid reverse', primerSequence: 'A'.repeat(22) };
const outwardReverse = primer('Outward reverse', 1, 19, -1);
const candidateTemplate = { ...template, features: [forward, reverse, otherForward, invalidReverse, outwardReverse] };
const candidates = evaluatePcrPrimerCandidates(candidateTemplate, forward);
const status = (list, name) => list.find(candidate => candidate.primer.name === name)?.state;
assert.equal(status(candidates, 'Forward'), 'selected');
assert.equal(status(candidates, 'Reverse'), 'feasible');
assert.equal(candidates.find(candidate => candidate.state === 'feasible').productLength, pcr.sequence.length);
assert.equal(status(candidates, 'Other forward'), 'unavailable');
assert.equal(status(candidates, 'Invalid reverse'), 'unavailable');
assert.equal(status(candidates, 'Outward reverse'), 'unavailable');
assert.equal(status(evaluatePcrPrimerCandidates({ ...candidateTemplate, topology: 'circular' }, forward), 'Outward reverse'), 'feasible');
const reverseCandidates = evaluatePcrPrimerCandidates(candidateTemplate, reverse);
assert.equal(status(reverseCandidates, 'Forward'), 'feasible');
assert.equal(status(reverseCandidates, 'Other forward'), 'feasible');
assert.equal(status(reverseCandidates, 'Reverse'), 'selected');

const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-fragments-'));
const save = (id, record, parentEntryId) => library.upsertSequenceEntry({ storagePath, id, name: record.name,
  status: 'saved', parentEntryId, topology: record.topology, sourceFormat: 'genbank', sequence: record.sequence,
  sequenceLength: record.sequence.length, featureCount: record.features.length, features: record.features, gbkText: buildRecordGenbankText(record) });
try {
  await save('template', template);
  const sqlitePath = path.join(storagePath, 'DNA', 'sequence-library.sqlite');
  const old = await database.openDatabase(sqlitePath);
  old.run('DROP INDEX idx_sequence_entries_parent');
  old.run('ALTER TABLE sequence_entries DROP COLUMN parent_entry_id');
  await database.persistDatabase(sqlitePath, old);
  old.close();
  assert.equal((await library.getSequenceEntry({ storagePath, id: 'template' })).entry.parentEntryId, '', 'old flat libraries migrate');
  const folder = (await library.upsertSequenceFolder({ storagePath, name: 'Cloning' })).folder;
  await library.moveSequenceEntryToFolder({ storagePath, id: 'template', folderId: folder.id });
  await save('child', fragment, 'template');
  await save('grandchild', pcr, 'child');
  await library.moveSequenceEntryToFolder({ storagePath, id: 'child', folderId: folder.id });
  assert.equal((await library.getSequenceEntry({ storagePath, id: 'child' })).entry.parentEntryId, 'template', 'moving to the same folder retains ancestry');
  const stored = await library.getSequenceEntry({ storagePath, id: 'child', includeGbk: true });
  assert.equal(stored.entry.parentEntryId, 'template');
  assert.equal(stored.entry.folderId, folder.id);
  assert.match(stored.entry.gbkRelPath, /\.gbk$/);
  assert.equal(parseInputRecords(stored.gbkText).records[0].sequence, fragment.sequence);
  await save('child', { ...fragment, name: 'Renamed' });
  assert.equal((await library.getSequenceEntry({ storagePath, id: 'child' })).entry.parentEntryId, 'template', 'ordinary resaves retain ancestry');
  await assert.rejects(save('template', template, 'grandchild'), /ancestor/);
  await assert.rejects(save('bad', fragment, 'missing'), /Parent DNA entry not found/);
  await library.moveSequenceEntryToFolder({ storagePath, id: 'template', folderId: '' });
  let entries = (await library.listSequenceEntries({ storagePath, status: 'saved' })).entries;
  assert.ok(entries.every(entry => !entry.folderId), 'moving a template carries descendants');
  const tree = buildDnaLibraryHierarchy(entries, 'renamed');
  assert.deepEqual([...tree.visibleIds].sort(), ['child', 'grandchild', 'template']);
  assert.deepEqual(tree.roots.map(entry => entry.id), ['template']);
  assert.deepEqual(buildDnaLibraryHierarchy(entries, 'template').visibleIds.size, 3);
  await library.deleteSequenceEntry({ storagePath, id: 'template' });
  entries = (await library.listSequenceEntries({ storagePath, status: 'saved' })).entries;
  assert.equal(entries.length, 2);
  assert.equal(entries.find(entry => entry.id === 'child').parentEntryId, '', 'deleting the template retains its DNA children');
  assert.deepEqual(buildDnaLibraryHierarchy(entries).roots.map(entry => entry.id), ['child']);
  assert.equal((await library.getSequenceEntry({ storagePath, id: 'grandchild', includeGbk: true })).entry.parentEntryId, 'child');
} finally {
  await fs.rm(storagePath, { recursive: true, force: true });
}
console.log('sequence-fragments-selfcheck: ok');
