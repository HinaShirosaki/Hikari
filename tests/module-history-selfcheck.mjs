import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createUndoService } from '../src/renderer/services/undoService.js';
import { initializeModuleManifest } from '../src/renderer/core/manifest-runtime.js';
import { createModuleHistoryRuntime } from '../src/renderer/core/module-history-runtime.js';
import { biologyNotebookManifest } from '../src/renderer/module-manifests/biology-notebook.js';
import { personalInventoryManifest } from '../src/renderer/module-manifests/personal-inventory.js';
import { settingsManifest } from '../src/renderer/module-manifests/settings.js';
import { VIEWS } from '../src/renderer/modules/views.js';

const doc = () => ({ getElementById: () => null, addEventListener() {} });
function fixture(initial, options = {}) {
  const state = structuredClone(initial);
  let owner = 'a';
  const service = createUndoService({ state, documentObject: doc(), getActiveOwner: () => owner, ...options });
  return { state, service, a: service.forModule('a'), b: service.forModule('b'), select: key => { owner = key; } };
}

test('modules retain independent undo and redo while editing the same collection', () => {
  const f = fixture({ records: [] });
  f.state.records.push({ id: 'a', name: 'A' }); f.a.persist();
  f.select('b');
  f.state.records.push({ id: 'b', name: 'B' }); f.b.persist();
  f.select('a'); assert.equal(f.service.undo(), true);
  assert.deepEqual(f.state.records, [{ id: 'b', name: 'B' }]);
  f.state.records[0].name = 'Edited B'; f.b.persist();
  assert.equal(f.service.redo(), true);
  assert.deepEqual(f.state.records, [{ id: 'a', name: 'A' }, { id: 'b', name: 'Edited B' }]);
  f.select('empty'); assert.equal(f.service.undo(), false);
  assert.deepEqual(f.service.getHistoryState(), { canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 });
});

test('background completion uses the persist callback of its initiating module', () => {
  const f = fixture({ value: 0 }); f.select('b');
  f.state.value = 1; f.a.persist();
  assert.equal(f.service.undo(), false);
  f.select('a'); assert.equal(f.service.undo(), true); assert.equal(f.state.value, 0);
});

test('disjoint fields survive history restoration and external record additions', () => {
  const f = fixture({ records: [{ id: 'r', name: 'Original', note: '' }] });
  f.state.records[0].name = 'Renamed'; f.a.persist();
  f.state.records[0].note = 'Other module'; f.b.persist();
  f.state.records.push({ id: 'external', name: 'Agent record' }); f.service.persist({ external: true });
  f.a.undo();
  assert.deepEqual(f.state.records, [{ id: 'r', name: 'Original', note: 'Other module' }, { id: 'external', name: 'Agent record' }]);
  f.a.redo(); assert.equal(f.state.records[0].name, 'Renamed');
});

test('conflicting external edits invalidate only histories that touch them', () => {
  const f = fixture({ a: 0, b: 0 });
  f.state.a = 1; f.a.persist(); f.a.undo();
  f.state.b = 1; f.b.persist();
  f.state.a = 99; f.service.persist({ external: true });
  assert.equal(f.a.redo(), false); assert.equal(f.state.a, 99);
  assert.equal(f.b.undo(), true); assert.equal(f.state.b, 0);
});

test('linked changes restore together and never partially overwrite a later edit', () => {
  const f = fixture({ samples: [], notebookEntries: [{ id: 'n', samples: [] }], other: 0 });
  f.state.samples.push({ id: 's', name: 'Sample' }); f.state.notebookEntries[0].samples.push('s'); f.a.persist();
  assert.equal(f.a.undo(), true);
  assert.deepEqual(f.state.samples, []); assert.deepEqual(f.state.notebookEntries[0].samples, []);
  f.a.redo();
  f.state.samples[0].name = 'New external name'; // No persist notification yet.
  assert.equal(f.a.undo(), false);
  assert.equal(f.state.samples[0].name, 'New external name');
  assert.deepEqual(f.state.notebookEntries[0].samples, ['s']);
});

test('workspace replacement clears every module and cannot restore an old root', () => {
  const f = fixture({ settings: { storagePath: '/a' }, a: 0, b: 0 });
  f.state.a = 1; f.a.persist(); f.state.b = 1; f.b.persist(); f.b.undo();
  f.state.settings.storagePath = '/b'; f.service.persist();
  assert.equal(f.a.undo(), false); assert.equal(f.b.redo(), false);
  assert.equal(f.state.settings.storagePath, '/b');
  f.state.a = 2; f.a.persist(); f.service.persist({ resetHistory: true });
  assert.equal(f.a.undo(), false);
});

test('undo cannot remove an item another module has since linked', () => {
  const f = fixture({ samples: [], notebookEntries: [] });
  f.state.samples.push({ id: 's', name: 'Sample' }); f.a.persist();
  f.state.notebookEntries.push({ id: 'n', sampleIds: ['s'] }); f.b.persist();
  assert.equal(f.a.undo(), false); assert.equal(f.state.samples.length, 1);
  assert.equal(f.b.undo(), true); assert.equal(f.a.undo(), true);
  assert.deepEqual(f.state.samples, []);
});

test('barriers retain unrelated module histories', () => {
  const f = fixture({ a: 0, b: 0 });
  f.state.a = 1; f.a.persist(); f.state.b = 1; f.b.persist();
  f.state.a = 2; f.a.persist({ barrier: true });
  assert.equal(f.a.undo(), false); assert.equal(f.b.undo(), true);
  assert.equal(f.state.a, 2);
});

test('failed persistence leaves both data and history available for retry', () => {
  let fail = false;
  const f = fixture({ a: 0 }, { persistState: () => { if (fail) throw new Error('disk fixture'); } });
  f.state.a = 1; f.a.persist(); fail = true;
  assert.equal(f.a.undo(), false); assert.equal(f.state.a, 1);
  assert.equal(f.a.getHistoryState().canUndo, true);
  fail = false; assert.equal(f.a.undo(), true); assert.equal(f.state.a, 0);
});

test('depth and byte budgets keep valid steps and bound large edits', () => {
  const f = fixture({ value: '' }, { maxDepth: 2, maxBytes: 1000 });
  for (const value of ['a', 'b', 'c']) { f.state.value = value; f.a.persist(); }
  assert.equal(f.a.getHistoryState().undoDepth, 2);
  assert.equal(f.a.undo(), true); assert.equal(f.state.value, 'b');
  assert.equal(f.a.undo(), true); assert.equal(f.state.value, 'a');
  assert.equal(f.a.undo(), false);
  f.state.value = 'x'.repeat(2000); f.a.persist();
  assert.equal(f.a.getHistoryState().undoDepth, 0, 'an oversized change must not exceed the shared byte budget');
});

test('a claiming plugin cannot fall through to module history on failed delivery', () => {
  const f = fixture({ value: 0 }, { delegate: { claim: () => ({ canUndo: true }), run: () => false } });
  f.state.value = 1; f.a.persist();
  assert.equal(f.service.undo(), false); assert.equal(f.state.value, 1);
});

test('save revision acknowledgments are preserved and do not become history', () => {
  const f = fixture({ protocols: [{ id: 'p', name: 'Before', markdownRevision: { version: 1 } }] });
  f.state.protocols[0].name = 'After'; f.a.persist();
  f.state.protocols[0].markdownRevision = { version: 2 }; f.service.acceptExternalChanges();
  f.a.undo();
  assert.equal(f.state.protocols[0].name, 'Before');
  assert.deepEqual(f.state.protocols[0].markdownRevision, { version: 2 });
});

test('batch record replacements retain their order through undo and redo', () => {
  const before = ['a', 'b', 'c'].map(id => ({ id }));
  const after = ['d', 'b', 'e'].map(id => ({ id }));
  const f = fixture({ records: before });
  f.state.records = structuredClone(after); f.a.persist();
  assert.equal(f.a.undo(), true); assert.deepEqual(f.state.records, before);
  assert.equal(f.a.redo(), true); assert.deepEqual(f.state.records, after);
});

test('collection reordering retains current save revisions by record ID', () => {
  const f = fixture({ protocols: ['a', 'b'].map(id => ({ id, markdownRevision: { version: 1 } })) });
  f.state.protocols.reverse(); f.a.persist();
  f.state.protocols.forEach(record => { record.markdownRevision = { version: record.id === 'a' ? 2 : 3 }; });
  f.service.acceptExternalChanges();
  assert.equal(f.a.undo(), true);
  assert.deepEqual(f.state.protocols, [{ id: 'a', markdownRevision: { version: 2 } }, { id: 'b', markdownRevision: { version: 3 } }]);
  assert.equal(f.a.redo(), true);
  assert.deepEqual(f.state.protocols, [{ id: 'b', markdownRevision: { version: 3 } }, { id: 'a', markdownRevision: { version: 2 } }]);
});

test('module constructors receive their history and bound persistence', () => {
  const f = fixture({ a: 0 }); let received;
  const module = initializeModuleManifest({ register() {} }, { key: 'a', init: options => { received = options; return {}; },
    createOptions: context => ({ persist: context.persist }) }, { getModuleHistory: f.service.forModule });
  f.select('b'); f.state.a = 1; received.persist();
  assert.equal(module.history.undo(), true); assert.equal(f.state.a, 0);
});

test('view, toolbar and rail routing have explicit owners', () => {
  const document = { body: { dataset: { activeView: VIEWS.SETTING } }, activeElement: null };
  let renders = 0;
  const runtime = createModuleHistoryRuntime([settingsManifest, personalInventoryManifest],
    { rootDocument: document, views: VIEWS, modules: { personalInventory: { renderSections: () => renders++ } } });
  assert.equal(runtime.getHistoryOwner(), 'settings');
  document.body.dataset.activeView = VIEWS.SAMPLE_REGISTRY;
  assert.equal(runtime.getHistoryOwner(), 'personalInventory');
  runtime.restoreHistory({ owner: 'personalInventory', changes: [] }); assert.ok(renders > 0);
  document.activeElement = { closest: selector => selector === '#universal-agent-chat-rail' };
  assert.equal(runtime.getHistoryOwner(), 'agentChatRail');
  document.activeElement = { closest: selector => selector === '.topbar-history-controls' };
  assert.equal(runtime.getHistoryOwner(), 'agentChatRail');
  document.activeElement = null;
  assert.equal(runtime.getHistoryOwner(), 'personalInventory');
  const rail = { hidden: false, dataset: { state: 'expanded' } };
  document.activeElement = { closest: selector => selector === '#universal-agent-chat-rail' ? rail : null };
  assert.equal(runtime.getHistoryOwner(), 'agentChatRail');
  document.activeElement = { closest: selector => selector === '.topbar-history-controls' };
  rail.dataset.state = 'collapsed';
  assert.equal(runtime.getHistoryOwner(), 'personalInventory', 'collapsed rail cannot keep claiming history');
  document.body.dataset.activeView = VIEWS.PROTOCOL_MANAGEMENT;
  assert.equal(runtime.getHistoryOwner(), '');
});

test('undo in another module preserves an actual unsaved notebook editor', () => {
  const require = createRequire(import.meta.url);
  const { createMockDocument, loadEsmStyleModule } = require('./support/runtime.js');
  const document = createMockDocument([]);
  document.body.dataset = { activeView: VIEWS.SETTING };
  const protocol = { id: 'p', name: 'Protocol', steps: [{ text: 'Measure.', placeholders: [] }] };
  const state = { projects: [{ id: 'project', name: 'Project' }], protocols: [protocol], samples: [], assays: [],
    settings: { storagePath: '', value: 0 }, notebookEntries: [{ id: 'n', notebookType: 'biology', projectId: 'project', projectName: 'Project',
      protocolId: 'p', protocolName: 'Protocol', protocolSnapshot: protocol, experimentName: 'Page', values: {}, result: 'Saved notes',
      resultFiles: [], resultFileRecords: [], sampleLinks: [], updatedAt: '2026-10-01T00:00:00.000Z', notebookState: 'planned' }] };
  const modules = { settings: { renderForms() {}, applyAppearance() {} } };
  const runtime = createModuleHistoryRuntime([biologyNotebookManifest, settingsManifest], { rootDocument: document, views: VIEWS, modules });
  const service = createUndoService({ state, documentObject: document, getActiveOwner: runtime.getHistoryOwner,
    beforeRestore: runtime.beforeHistoryRestore, onRestore: runtime.restoreHistory });
  const { initLabNotebook } = loadEsmStyleModule(path.resolve('src/renderer/modules/biology-notebook/index.js'),
    { document, window: { hikariApi: {}, addEventListener() {} } });
  const notebook = modules.biologyNotebook = initLabNotebook({ state, persist: service.forModule('biologyNotebook').persist,
    createId: () => 'fixture', safeText: String, notebookType: 'biology', onNotebookEntriesChanged() {} });
  notebook.renderProjectOptions(); notebook.renderProtocolOptions('p'); notebook.openEntry('n'); service.reset();
  state.settings.value = 1; service.forModule('settings').persist();
  document.getElementById('biology-notebook-result').value = 'Unsaved experimental observations';
  assert.equal(notebook.hasUnsavedChanges(), true);
  assert.equal(service.undo(), true); assert.equal(state.settings.value, 0);
  assert.equal(document.getElementById('biology-notebook-result').value, 'Unsaved experimental observations');
  assert.equal(notebook.hasUnsavedChanges(), true);
  state.notebookEntries[0].result = 'Another saved change'; service.forModule('biologyNotebook').persist();
  document.body.dataset.activeView = VIEWS.BIOLOGY_NOTEBOOK;
  assert.equal(service.undo(), false, 'dirty editor must retain its draft and saved history');
  assert.equal(state.notebookEntries[0].result, 'Another saved change');
});
