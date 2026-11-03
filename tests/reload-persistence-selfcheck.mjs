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

function fixture(api, state, save = () => {}, externalSources = () => []) {
  const document = createMockDocument(['overlay', 'title', 'list', 'description', 'status', 'close-btn', 'cancel-btn', 'discard-btn', 'save-btn']
    .map(id => `unsaved-changes-${id}`));
  const element = name => document.getElementById(`unsaved-changes-${name}`);
  element('list').replaceChildren = (...children) => { element('list').children = children; };
  element('overlay').hidden = true;
  let dirty = false, reloads = 0, editorSaves = 0;
  const events = {}, responses = [];
  const service = createUnsavedChangesService({
    moduleRegistry: { get: key => key === 'protocol' ? {
      hasUnsavedChanges: () => dirty,
      saveUnsavedChanges: async () => { editorSaves++; save(); dirty = false; return true; }
    } : null },
    api: { respondToAppClose: action => responses.push(action) },
    flushPendingSaves: () => flushMarkdownRecordState(api, state),
    hasPendingSaves: hasPendingMarkdownSaves,
    externalSources,
    documentObject: document,
    windowObject: { addEventListener: (name, listener) => { events[name] = listener; }, location: { reload: () => { reloads++; } } }
  });
  return { service, element, events, responses, dirty: () => { dirty = true; }, get reloads() { return reloads; }, get editorSaves() { return editorSaves; } };
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
  assert.equal(f.element('overlay').hidden, true, 'a clean reload waits without flashing an empty save dialog');
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

test('clean quit acknowledges main, drains queued writes, and never shows a save dialog', async () => {
  const state = { settings: { storagePath: '/synthetic' }, protocols: [{ id: 'p', name: 'Earlier' }] };
  const gate = deferred(), started = deferred(), writes = [];
  const api = { autoSaveDataFile: async data => { started.resolve(); await gate.promise; writes.push(data); return { ok: true }; } };
  const earlier = syncMarkdownRecordState(api, state);
  await started.promise;
  state.protocols[0].name = 'Latest';
  const f = fixture(api, state);
  const closing = f.service.handleCloseRequested();
  assert.deepEqual(f.responses, ['pending']);
  assert.equal(f.element('overlay').hidden, true);
  let prevented = false;
  f.events.beforeunload({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  await f.service.handleCloseRequested();
  assert.deepEqual(f.responses, ['pending', 'pending']);
  gate.resolve(); await earlier; await closing;
  assert.deepEqual(writes.map(data => data.protocols[0].name), ['Earlier', 'Latest']);
  assert.deepEqual(f.responses, ['pending', 'pending', 'quit']);
  assert.equal(f.element('overlay').hidden, true);
});

test('clean local-only quit stays quiet and allows unloading', async () => {
  const f = fixture({}, { settings: {} });
  await f.service.handleCloseRequested();
  assert.deepEqual(f.responses, ['pending', 'quit']);
  assert.equal(f.element('overlay').hidden, true);
  f.events.beforeunload({ preventDefault: () => assert.fail('approved quit was blocked') });
});

test('failed clean quit shows its storage error and stays open until retry succeeds', async () => {
  let failed = true;
  const f = fixture({ autoSaveDataFile: async () => failed ? { ok: false, error: 'Disk full' } : { ok: true } }, { settings: { storagePath: '/synthetic' } });
  await f.service.handleCloseRequested();
  assert.deepEqual(f.responses, ['pending']);
  assert.equal(f.element('overlay').hidden, false);
  assert.match(f.element('status').textContent, /Disk full/);
  await f.service.handleCloseRequested();
  assert.match(f.element('status').textContent, /Disk full/, 'another quit cannot clear the error');
  failed = false;
  await f.service.saveAndQuit();
  assert.deepEqual(f.responses, ['pending', 'pending', 'quit']);
});

test('Discard & Quit after a shown storage error quits without retrying the failing write', async () => {
  let writes = 0;
  const f = fixture({ autoSaveDataFile: async () => { writes++; return { ok: false, error: 'could not be cloned' }; } }, { settings: { storagePath: '/synthetic' } });
  await f.service.handleCloseRequested();
  assert.match(f.element('status').textContent, /could not be cloned/);
  f.element('discard-btn').click();
  for (let i = 0; i < 5; i++) await turn();
  assert.equal(writes, 1);
  assert.deepEqual(f.responses, ['pending', 'quit']);
  assert.equal(f.element('overlay').hidden, true);
  f.events.beforeunload({ preventDefault: () => assert.fail('approved quit was blocked') });
  // Cancel clears the error: the next quit tries storage again before Discard skips it.
  await f.service.handleCloseRequested();
  f.element('cancel-btn').click();
  await f.service.handleCloseRequested();
  assert.equal(writes, 3);
});

test('repeated quit preserves unchecked editors and waits for the user decision', async () => {
  let pluginDirty = true, pluginSaves = 0;
  const f = fixture({}, { settings: {} }, () => {}, () => [{ key: 'plugin:test', label: 'Plugin draft', moduleApi: {
    hasUnsavedChanges: () => pluginDirty,
    saveUnsavedChanges: async () => { pluginSaves++; pluginDirty = false; return true; }
  } }]);
  f.dirty();
  await f.service.handleCloseRequested();
  const rows = f.element('list').children;
  const checkbox = rows[1]._inserted[0]._inserted[0];
  checkbox.checked = false; checkbox.change();
  await f.service.handleCloseRequested();
  assert.equal(f.element('list').children, rows);
  assert.equal(checkbox.checked, false);
  assert.deepEqual(f.responses, ['pending', 'pending']);
  await f.service.saveAndQuit();
  assert.equal(f.editorSaves, 1);
  assert.equal(pluginSaves, 0);
  assert.equal(pluginDirty, true);
  assert.equal(f.responses.at(-1), 'quit');
});

test('quit during a reload dialog preserves the reload action', async () => {
  const f = fixture({}, { settings: {} });
  f.dirty(); await f.service.requestReload();
  await f.service.handleCloseRequested();
  assert.deepEqual(f.responses, ['cancel']);
  assert.match(f.element('title').textContent, /reloading/);
  await f.service.saveAndQuit();
  assert.equal(f.reloads, 1);
  assert.deepEqual(f.responses, ['cancel']);
});

test('an edit made while clean quit waits for storage gets a save choice', async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ autoSaveDataFile: async () => { started.resolve(); await gate.promise; return { ok: true }; } }, { settings: { storagePath: '/synthetic' } });
  const closing = f.service.handleCloseRequested();
  await started.promise;
  f.dirty(); gate.resolve(); await closing;
  assert.deepEqual(f.responses, ['pending']);
  assert.equal(f.element('overlay').hidden, false);
  assert.equal(f.element('list').children[0].textContent, 'Protocol');
  assert.equal(f.element('save-btn').disabled, false);
  await f.service.saveAndQuit();
  assert.equal(f.editorSaves, 1);
  assert.equal(f.responses.at(-1), 'quit');
});
