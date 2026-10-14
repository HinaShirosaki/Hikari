import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { addPrimersToLibrary, normalizePrimerLibrary } from '../src/shared/primer-library.mjs';
import { normalizeState } from '../src/renderer/modules/app-state/index.js';
import { buildIdtBulkInput } from '../src/renderer/modules/sequence-viewer/primer-order.js';
const require = createRequire(import.meta.url);
const { syncBundleFromSnapshot, hydrateSnapshotFromBundle, importStorageRoot } = require('../src/main/storage');
const { writePrimerLibrary, readPrimerLibrary, primerLibraryPath } = require('../src/main/storage/primer-library-storage');

const full = 'GGTCTCGATGGCACGTTTAGGCCATAC';
const result = addPrimersToLibrary([], [
  { name: 'Construct F', sequence: 'ATGGCACGTTTAGGCCATAC', primerSequence: full },
  { name: 'Construct R', sequence: 'ttacggttaagccttggaacc' },
  { name: 'Construct F', sequence: full },
  { name: 'bad', sequence: 'ACGT/5Phos/' },
  { name: 'empty' }
], { createId: () => 'same-id', sourceName: 'Test construct', nowIso: '2026-10-14T12:00:00Z' });
assert.equal(result.added, 2);
assert.equal(result.invalid, 2);
assert.equal(result.savedIds.length, 2);
assert.equal(result.entries[0].sequence, full);
assert.equal(new Set(result.entries.map(row => row.id)).size, 2);
assert.equal(result.entries[0].sourceName, 'Test construct');
assert.deepEqual(addPrimersToLibrary(result.entries, [{ name: 'Construct F', sequence: full }]).entries, result.entries);
assert.deepEqual(normalizeState({ primerLibrary: result.entries }).primerLibrary, result.entries);
assert.deepEqual(normalizeState({ primerLibrary: {} }).primerLibrary, []);
assert.deepEqual(normalizePrimerLibrary([{ ...result.entries[0], sequence: 'ACGT!' }]), []);
assert.equal(buildIdtBulkInput([result.entries[1]], { scale: '100nm', purification: 'PAGE' }), 'Construct R\tTTACGGTTAAGCCTTGGAACC\t100nm\tPAGE');

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-primer-library-'));
try {
  const state = { settings: { storagePath: temp }, primerLibrary: result.entries };
  await syncBundleFromSnapshot({ snapshot: state });
  assert.deepEqual((await readPrimerLibrary(temp)).primers, result.entries);
  const hydrated = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: temp } } });
  assert.deepEqual(hydrated.snapshot.primerLibrary, result.entries);
  assert.deepEqual((await importStorageRoot({ storagePath: temp })).statePatch.primerLibrary, result.entries);
  // An older recovery snapshot must not resurrect deliberately removed primers.
  await fs.writeFile(path.join(temp, 'old-state.json'), JSON.stringify(state));
  await writePrimerLibrary(temp, { primerLibrary: [] }, '2026-10-14T13:00:00Z');
  assert.deepEqual((await importStorageRoot({ storagePath: temp })).statePatch.primerLibrary, []);
  // Saves from legacy callers without the new collection preserve the library.
  await writePrimerLibrary(temp, state, '2026-10-14T14:00:00Z');
  await syncBundleFromSnapshot({ snapshot: { settings: { storagePath: temp } } });
  assert.deepEqual((await readPrimerLibrary(temp)).primers, result.entries);
  await fs.writeFile(primerLibraryPath(temp), '{invalid');
  assert.match((await readPrimerLibrary(temp)).error, /Failed to read primer library/);
  assert.ok((await importStorageRoot({ storagePath: temp })).warnings.some(warning => /primer library/.test(warning)));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
console.log('Primer Library self-check passed: full oligos, duplicates, invalid DNA, cache normalization, selected IDT rows, durable save/hydration/import and removal recovery.');
