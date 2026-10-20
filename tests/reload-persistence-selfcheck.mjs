import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createUnsavedChangesService } from '../src/renderer/services/unsavedChangesService.js';
import { flushMarkdownRecordState, hasPendingMarkdownSaves, syncMarkdownRecordState } from '../src/renderer/services/markdown-record-storage.js';

const require = createRequire(import.meta.url);
const { createMockDocument } = require('./support/runtime.js');
const { createMainDataHelpers } = require('../src/main/data/data-helpers.js');
const { syncBundleFromSnapshot } = require('../src/main/storage/storage-sidecars.js');
const { importStorageRoot } = require('../src/main/storage/storage-import.js');
const deferred = () => Promise.withResolvers();
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture(api, state, save = () => {}) {
  const document = createMockDocument(['overlay', 'title', 'list', 'description', 'status', 'close-btn', 'cancel-btn', 'discard-btn', 'save-btn']
    .map(id => `unsaved-changes-${id}`));
  const element = name => document.getElementById(`unsaved-changes-${name}`);
  element('list').replaceChildren = (...children) => { element('list').children = children; };
  element('overlay').hidden = true;
  let dirty = false, reloads = 0, editorSaves = 0;
  const events = {};
  const service = createUnsavedChangesService({
    moduleRegistry: { get: key => key === 'protocol' ? {
      hasUnsavedChanges: () => dirty,
      saveUnsavedChanges: async () => { editorSaves++; save(); dirty = false; return true; }
    } : null },
    flushPendingSaves: () => flushMarkdownRecordState(api, state),
    hasPendingSaves: hasPendingMarkdownSaves,
    documentObject: document,
    windowObject: { addEventListener: (name, listener) => { events[name] = listener; }, location: { reload: () => { reloads++; } } }
  });
  return { service, element, events, dirty: () => { dirty = true; }, get reloads() { return reloads; }, get editorSaves() { return editorSaves; } };
}

test('Save & Reload waits for the real Markdown queue and the reloaded record retains the edit', async () => {
  const root = await fs.mkdtemp('/private/tmp/hikari-reload-save-');
  try {
    const state = { settings: { storagePath: root }, protocols: [{ id: 'p', name: 'Protocol', purpose: 'Old', steps: ['Mix.'] }], notebookEntries: [] };
    const helpers = createMainDataHelpers({ fs, path, syncBundleFromSnapshot, hasSupportedDataExtension: () => true, getDefaultDataFilePath: () => path.join(root, 'hikari-data.json') });
    const write = data => helpers.autoSaveDataFile({ data });
    await syncMarkdownRecordState({ autoSaveDataFile: write }, state);
    const gate = deferred(), started = deferred();
    const api = { autoSaveDataFile: async data => { started.resolve(); await gate.promise; return write(data); } };
    let autosave;
    const f = fixture(api, state, () => {
      state.protocols[0].purpose = 'New scientific observations';
      autosave = syncMarkdownRecordState(api, state);
    });
    f.dirty();
    await f.service.requestReload();
    const saving = f.service.saveAndQuit();
    await started.promise;
    assert.equal(f.reloads, 0);
    assert.equal(f.element('overlay').hidden, false);
    assert.equal(f.element('save-btn').disabled, true);
    let prevented = false;
    f.events.beforeunload({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, 'the now-clean editor cannot unload during the storage write');
    await f.service.requestReload();
    gate.resolve();
    await saving; await autosave;
    assert.equal(f.reloads, 1);
    const reloaded = await importStorageRoot({ storagePath: root });
    assert.equal(reloaded.statePatch.protocols[0].purpose, 'New scientific observations');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('clean reload waits for earlier autosaves and flushes the latest state', async () => {
  const state = { settings: { storagePath: '/synthetic' }, protocols: [{ id: 'p', name: 'Earlier' }] };
  const gate = deferred(), started = deferred(), writes = [];
  const api = { autoSaveDataFile: async data => { started.resolve(); await gate.promise; writes.push(data); return { ok: true }; } };
  const earlier = syncMarkdownRecordState(api, state);
  await started.promise;
  state.protocols[0].name = 'Latest';
  const f = fixture(api, state);
  const reloading = f.service.requestReload();
  assert.equal(f.reloads, 0);
  assert.equal(f.element('overlay').hidden, false);
  gate.resolve();
  await earlier; await reloading;
  assert.equal(f.reloads, 1);
  assert.deepEqual(writes.map(data => data.protocols[0].name), ['Earlier', 'Latest']);
});

test('storage failure blocks reload and retry flushes an editor that is already clean', async () => {
  const state = { settings: { storagePath: '/synthetic' } };
  let failed = true;
  const f = fixture({ autoSaveDataFile: async () => failed ? { ok: false, error: 'Disk full' } : { ok: true } }, state);
  f.dirty(); await f.service.requestReload(); await f.service.saveAndQuit();
  assert.equal(f.editorSaves, 1);
  assert.equal(f.reloads, 0);
  assert.equal(f.element('overlay').hidden, false);
  assert.match(f.element('status').textContent, /Disk full/);
  assert.equal(f.element('save-btn').disabled, false);
  failed = false; await f.service.saveAndQuit();
  assert.equal(f.editorSaves, 1);
  assert.equal(f.reloads, 1);
});

test('skipped records and rejected saves block clean reload with an enabled retry action', async () => {
  const state = { settings: { storagePath: '/synthetic' } };
  const results = [
    { ok: true, sidecarPaths: { skippedRecords: [{ id: 'p', message: 'Protocol has a Markdown conflict' }] } },
    new Error('Storage unavailable'),
    { ok: true }
  ];
  const f = fixture({ autoSaveDataFile: async () => { const result = results.shift(); if (result instanceof Error) throw result; return result; } }, state);
  await f.service.requestReload();
  assert.equal(f.reloads, 0);
  assert.equal(f.element('overlay').hidden, false);
  assert.equal(f.element('save-btn').disabled, false);
  assert.match(f.element('status').textContent, /Markdown conflict/);
  await f.service.saveAndQuit();
  assert.equal(f.reloads, 0);
  assert.match(f.element('status').textContent, /Storage unavailable/);
  await f.service.saveAndQuit();
  assert.equal(f.reloads, 1);
});

test('Discard & Reload flushes saved state without saving the discarded editor', async () => {
  const state = { settings: { storagePath: '/synthetic' } };
  const gate = deferred(), started = deferred();
  const f = fixture({ autoSaveDataFile: async () => { started.resolve(); await gate.promise; return { ok: true }; } }, state);
  f.dirty(); await f.service.requestReload();
  f.element('discard-btn').click();
  await started.promise;
  assert.equal(f.editorSaves, 0);
  assert.equal(f.reloads, 0);
  gate.resolve();
  for (let i = 0; i < 20 && !f.reloads; i++) await turn();
  assert.equal(f.reloads, 1);
});

test('reload works with local-only state when no storage root is configured', async () => {
  const f = fixture({ autoSaveDataFile: () => { throw new Error('Unexpected storage write'); } }, { settings: {} });
  await f.service.requestReload();
  assert.equal(f.reloads, 1);
});

test('a menu reload right after an editor save waits until storage has the edit', async () => {
  const state = { settings: { storagePath: '/synthetic' }, protocols: [{ id: 'p', name: 'Edited' }] };
  const gate = deferred();
  const api = { autoSaveDataFile: async () => { await gate.promise; return { ok: true }; } };
  const f = fixture(api, state);
  // The editor is already clean; its persist() queued this save, still hashing.
  const autosave = syncMarkdownRecordState(api, state);
  let prevented = false;
  f.events.beforeunload({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'View > Reload cannot unload before the save reaches storage');
  gate.resolve(); await autosave;
  prevented = false;
  f.events.beforeunload({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false, 'once storage answers, the reload goes through');
});
