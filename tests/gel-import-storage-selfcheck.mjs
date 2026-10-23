import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRecordsManager } from '../src/plugins/gel/workspace/records-manager.js';
import { createGelRecordImages } from '../src/plugins/gel/workspace/records/record-images.js';
import { createGelStorageRecords } from '../src/plugins/gel/storage-records.js';

const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gel-import-storage-'));
const previousWindow = globalThis.window;
globalThis.window = {};
let failArtifact = '';
let failIndex = false;
let activePersists = 0;
let maximumPersists = 0;
const { toStoredRecord } = createGelStorageRecords({
  hikari: {
    async call(verb, args) {
      const file = path.join(folder, args.path);
      if (verb === 'files.read') return { dataBase64: (await fs.readFile(file)).toString('base64') };
      assert.equal(verb, 'files.write');
      if (path.basename(file) === failArtifact) throw new Error('Disk write failed');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, Buffer.from(args.dataBase64, 'base64'));
      return { path: args.path };
    }
  },
  errorMessage: error => error.message
});
let nextId = 0;
const activeImage = { name: 'active.png', imageData: { tag: 'active pixels' } };
const state = { settings: { storagePath: '.' }, gelAnalyses: [] };
const elements = {
  gelIdInput: { value: '' }, gelNameInput: { value: 'Active gel' }, gelTypeInput: { value: 'agarose' }
};
const runtime = {
  state, currentImage: activeImage, originalFile: null, currentReport: null, manualOverrides: {},
  createId: () => `gel-${++nextId}`, safeText: String,
  async persist() {
    activePersists++;
    maximumPersists = Math.max(maximumPersists, activePersists);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (failIndex) throw new Error('Index write failed');
      await fs.writeFile(path.join(folder, 'index.json'), JSON.stringify(state.gelAnalyses.map(toStoredRecord)));
    } finally { activePersists--; }
  }
};
const statuses = [];
const manager = createRecordsManager({ runtime, elements, deps: {
  imageDataToDataUrl: image => `data:image/png;base64,${btoa(image.tag)}`,
  readEnhancementSettingsFromUi: () => ({}), setStatus: message => statuses.push(message)
} });
function importedDraft(name, pixels) {
  const bytes = new Uint8Array([0, 255, name.length, 42, 128]);
  const image = { name, imageData: { tag: pixels } };
  return { currentImage: image, originalImage: image, originalFile: { name, arrayBuffer: async () => bytes.buffer },
    controls: { 'gel-id': '', 'gel-type': 'western', 'gel-denoise-strength': '20', 'gel-contrast-strength': '125' },
    manualOverrides: {}, currentReport: null, cropApplied: false, pendingNotebookLink: null };
}

try {
  const first = importedDraft('first.tif', 'first pixels');
  const second = importedDraft('second.png', 'second pixels');
  const [a, b] = await Promise.all([manager.saveImportedGel(first, 'Gel 1'), manager.saveImportedGel(second, 'Gel 2')]);
  assert.notEqual(a.id, b.id);
  assert.equal(first.controls['gel-id'], a.id);
  assert.equal(second.controls['gel-id'], b.id);
  assert.equal(runtime.currentImage, activeImage, 'Saving imports must not replace the active gel');
  assert.equal(elements.gelNameInput.value, 'Active gel');
  assert.equal(elements.gelIdInput.value, '');
  assert.equal(a.analysisType, 'western', 'Import metadata comes from the imported draft');
  assert.equal(a.parameters.enhancement.denoiseStrength, 20);
  assert.equal(maximumPersists, 1, 'Manual and automatic saves share a serialized index writer');
  const stored = JSON.parse(await fs.readFile(path.join(folder, 'index.json'), 'utf8'));
  assert.equal(stored.length, 2, 'Each imported gel is indexed durably without a Save click');
  for (const [record, draft] of [[a, first], [b, second]]) {
    assert.deepEqual(await fs.readFile(path.join(folder, record.originalImagePath)), Buffer.from(await draft.originalFile.arrayBuffer()));
    assert.equal((await fs.readFile(path.join(folder, record.sourceImagePath))).toString(), draft.currentImage.imageData.tag);
    assert.equal((await fs.readFile(path.join(folder, record.previewImagePath))).toString(), draft.currentImage.imageData.tag);
    const metadata = JSON.parse(await fs.readFile(path.join(folder, record.recordJsonPath), 'utf8'));
    assert.equal(metadata.id, record.id);
    assert.equal(metadata.imageName, draft.currentImage.name);
  }
  const restoredImages = createGelRecordImages({ getStorageRoot: () => '.', deps: {
    decodeImageSource: async (dataUrl, name) => ({ name, pixels: atob(dataUrl.split(',')[1]) })
  } });
  assert.equal((await restoredImages.restoreRecordImage(stored[1])).image.pixels, 'second pixels', 'A fresh reader restores the stored source');

  runtime.currentImage = first.currentImage;
  runtime.originalFile = null;
  elements.gelIdInput.value = a.id;
  elements.gelNameInput.value = 'Renamed imported gel';
  const saved = await manager.onSaveAnalysis();
  assert.equal(saved.id, a.id);
  assert.equal(elements.gelIdInput.value, a.id);
  assert.equal(state.gelAnalyses.length, 2, 'Processing and saving an import updates its existing record');
  assert.equal(saved.storageFolder, a.storageFolder, 'Renaming preserves the original artifact folder');
  assert.equal(saved.originalImagePath, a.originalImagePath, 'Reopening without a File keeps the archived original');

  failArtifact = 'original.png';
  const failed = importedDraft('failed.png', 'failed pixels');
  await assert.rejects(manager.saveImportedGel(failed, 'Failed gel'), /Disk write failed/);
  assert.equal(state.gelAnalyses.length, 2, 'Failed artifact writes do not publish a saved record');
  assert.equal(failed.controls['gel-id'], '');
  failArtifact = '';
  failIndex = true;
  await assert.rejects(manager.saveImportedGel(failed, 'Failed gel'), /Index write failed/);
  assert.equal(state.gelAnalyses.length, 2, 'An index failure rolls back the in-memory record');
  assert.equal(failed.controls['gel-id'], '');
  failIndex = false;
  await manager.saveImportedGel(failed, 'Recovered gel');
  assert.equal(state.gelAnalyses.length, 3, 'The save queue recovers after a failed import');
  assert.equal(JSON.parse(await fs.readFile(path.join(folder, 'index.json'), 'utf8')).length, 3);
  console.log('gel-import-storage-selfcheck: passed (original bytes, per-gel artifacts, durable index, restore, update identity, serialized writes, and failure recovery)');
} finally {
  globalThis.window = previousWindow;
  await fs.rm(folder, { recursive: true, force: true });
}
