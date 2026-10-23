import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createGelStorageRecords } from '../src/plugins/gel/storage-records.js';

const source = await fs.readFile(new URL('../src/plugins/gel/main.js', import.meta.url), 'utf8');
const restoreSource = source.slice(source.indexOf('async function readStoredJson('), source.indexOf('function validateStoredValue('));
const files = new Map();
const reads = [];
const hikari = {
  async call(verb, { path }) {
    assert.equal(verb, 'files.read');
    reads.push(path);
    if (path.startsWith('/') || !files.has(path)) throw new Error('Plugin file not found.');
    return { dataBase64: Buffer.from(JSON.stringify(files.get(path))).toString('base64') };
  }
};
const context = vm.createContext({ hikari, fromBase64Json: value => JSON.parse(Buffer.from(value, 'base64').toString('utf8')) });
vm.runInContext(restoreSource, context);
const folder = 'Gels/Saved_Gel__gel-1';
const metadataPath = `${folder}/gel-record.json`;
const reportPath = `${folder}/analysis-result.json`;
const index = {
  id: 'gel-1', name: 'Saved Gel', storageFolder: folder,
  recordJsonPath: '/old/root/Gels/old/gel-record.json', recordJsonRelativePath: metadataPath,
  analysisResultPath: '/old/root/Gels/old/analysis-result.json', analysisResultRelativePath: reportPath,
  sourceImagePath: `${folder}/source.png`, sourceImageRelativePath: `${folder}/source.png`,
  previewImagePath: '', previewImageRelativePath: '', previewImageIsSource: false
};
files.set(metadataPath, { id: 'gel-1', name: 'Saved Gel', parameters: { analysisType: 'western' },
  storageFolder: '/old/root/Gels/old', recordJsonPath: '/old/root/Gels/old/gel-record.json',
  sourceImagePath: '/old/root/source.png', sourceImageRelativePath: 'Gels/old/source.png',
  previewImagePath: '/old/root/preview.png', previewImageIsSource: true });
files.set(reportPath, { lanes: [{ laneIndex: 1 }] });

const restored = await context.hydrateStoredRecord(index);
assert.equal(restored.warnings, 0, 'Stale absolute paths fall back to saved relative paths');
assert.equal(restored.record.parameters.analysisType, 'western');
assert.equal(restored.record.report.lanes[0].laneIndex, 1);
assert.equal(restored.record.recordJsonPath, metadataPath);
assert.equal(restored.record.analysisResultPath, reportPath);
assert.equal(restored.record.storageFolder, folder);
assert.equal(restored.record.sourceImagePath, index.sourceImagePath, 'Old metadata cannot replace current image locations');
assert.equal(restored.record.previewImagePath, '', 'An old preview is not revived over the current index');
assert.equal(restored.record.previewImageIsSource, false);
assert.equal(reads.some(path => path.startsWith('/')), false, 'Valid relative paths are tried before obsolete absolute paths');

globalThis.window = {};
const { toStoredRecord } = createGelStorageRecords({ hikari, errorMessage: error => error.message });
const savedAgain = toStoredRecord(restored.record);
delete globalThis.window;
const reopened = await context.hydrateStoredRecord(savedAgain);
assert.equal(reopened.warnings, 0, 'Saving and reopening a restored record does not reintroduce stale metadata paths');
assert.equal(reopened.record.sourceImagePath, index.sourceImagePath);

const folderFallback = await context.hydrateStoredRecord({ ...index,
  recordJsonRelativePath: 'Gels/moved/gel-record.json', analysisResultRelativePath: 'Gels/moved/analysis-result.json' });
assert.equal(folderFallback.warnings, 0, 'The saved artifact folder recovers outdated file references');
assert.equal(folderFallback.record.recordJsonRelativePath, metadataPath);

files.delete(metadataPath);
const missingMetadata = await context.hydrateStoredRecord(index);
assert.equal(missingMetadata.warnings, 1, 'A genuinely unavailable metadata file still produces a warning');
assert.equal(missingMetadata.record.id, index.id);
assert.equal(missingMetadata.record.report.lanes.length, 1, 'A metadata failure does not discard the available report');
files.delete(reportPath);
assert.equal((await context.hydrateStoredRecord(index)).warnings, 2, 'Both unavailable files are reported accurately');
files.set(metadataPath, 'invalid metadata');
assert.equal((await context.hydrateStoredRecord(index)).warnings, 2, 'Invalid JSON shapes remain visible as failures');
assert.equal((await context.readStoredJson('', undefined)).warning, false, 'An older record without an artifact path is not a read failure');
reads.length = 0;
const inline = { ...index, report: { lanes: [] } };
assert.equal((await context.hydrateStoredRecord(inline)).record, inline);
assert.equal(reads.length, 0, 'An already hydrated record is left intact');

const recoverySource = source.slice(source.indexOf('function recoverSavedGels()'), source.indexOf('async function fetchWorkspaceMarkup()'));
let failRecoverySave = false;
let recoverySaves = 0;
const banners = [];
let recoverable = [{ id: 'indexed', name: 'Stale duplicate', report: {} }, { id: 'orphan', name: 'Recovered gel', report: {} }, { id: 'orphan', report: {} }];
Object.assign(context, {
  state: { gelAnalyses: [{ id: 'indexed', name: 'Current name', report: {} }] },
  host: {}, gelController: { renderList() {} }, setHostBusy() {},
  errorMessage: error => error.message, showBanner: message => banners.push(message),
  persist: async () => { recoverySaves++; if (failRecoverySave) throw new Error('Index save failed'); },
  hikari: { call: async verb => { assert.equal(verb, 'migration.recoverStoredGel'); return { records: recoverable, warnings: [] }; } }
});
vm.runInContext(`let recoveryPromise=null; ${recoverySource}`, context);
const recovery = context.recoverSavedGels();
assert.equal(context.recoverSavedGels(), recovery, 'Concurrent recovery requests share one operation');
await recovery;
assert.equal(context.state.gelAnalyses.length, 2, 'Merge records missing from the index once');
assert.equal(context.state.gelAnalyses[0].name, 'Current name', 'Existing indexed data remains authoritative');
assert.equal(context.host.inert, false);
assert.equal(recoverySaves, 1);
await context.recoverSavedGels();
assert.equal(context.state.gelAnalyses.length, 2, 'Repeated recovery is idempotent');
assert.equal(recoverySaves, 1, 'Do not save an unchanged index');
recoverable = [{ id: 'failed', report: {} }]; failRecoverySave = true;
await context.recoverSavedGels();
assert.equal(context.state.gelAnalyses.length, 2, 'A failed index save does not publish recovered records');
assert.match(banners.at(-1), /Could not recover saved gels: Index save failed/);
assert.equal(context.host.inert, false, 'Recovery failure unlocks the workspace');
console.log('gel-storage-restore-selfcheck: passed (relative paths, migration metadata, save/reopen, folder fallback, and genuine failures)');
