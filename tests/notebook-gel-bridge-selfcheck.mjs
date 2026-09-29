import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createPluginBridge } from '../src/renderer/app/plugin-bridge.js';

const origin = 'http://127.0.0.1:49152';
const replies = [];
const frame = { postMessage: (message) => replies.push(message) };
const intruder = { postMessage: (message) => replies.push(message) };
const state = {
  notebookEntries: [{ id: 'n1', projectId: 'p1', experimentName: 'Gel page', result: 'Private notes' }],
  settings: {}
};
let refreshes = 0;
let failSave = false;
const bridge = createPluginBridge({
  state,
  windowObject: {},
  persist: () => { if (failSave) throw new Error('Save failed'); },
  onNotebookEntriesChanged: () => { refreshes += 1; }
});
bridge.register(frame, { id: 'gel', bundled: true, path: '@bundled/gel', permissions: ['storage'] }, origin);
bridge.register(intruder, { id: 'other', permissions: ['storage'] }, origin);
const call = (source, verb, params = {}) => {
  bridge.handleMessage({ source, origin, data: { hikari: 1, id: 'test', verb, params } });
  return replies.at(-1);
};

bridge.queueNotebookGel({ notebookEntryId: 'n1' });
assert.equal(replies.at(-1).event, 'gel.notebookLink');
assert.equal(call(intruder, 'gel.takeNotebookLink').ok, false);
const selected = call(frame, 'gel.takeNotebookLink').result;
assert.equal(selected.id, 'n1');
assert.equal(selected.projectId, 'p1');
assert.equal(selected.result, undefined);
assert.equal(call(frame, 'gel.takeNotebookLink').result, null);

const value = { version: 2, gelAnalyses: [{ id: 'g1', notebookEntryId: 'n1' }] };
assert.equal(call(frame, 'storage.set', { value }).ok, true);
assert.deepEqual(state.notebookEntries[0].gelIds, ['g1']);
assert.equal(refreshes, 1);
assert.equal(JSON.parse(JSON.stringify(state)).settings.pluginStorage.gel.gelAnalyses[0].notebookEntryId, 'n1');
failSave = true;
assert.equal(call(frame, 'storage.set', { value: { gelAnalyses: [] } }).ok, false);
assert.deepEqual(state.notebookEntries[0].gelIds, ['g1']);
assert.equal(state.settings.pluginStorage.gel.gelAnalyses.length, 1);
assert.equal(refreshes, 1);

// Exercise the plugin adapter's actual handoff handler, including an event
// arriving before workspace boot and a failed save preserving the request.
const main = fs.readFileSync(new URL('../src/plugins/gel/main.js', import.meta.url), 'utf8');
const handlerSource = main.slice(main.indexOf('let notebookLinkRequest = null;'), main.indexOf("hikari?.on('gel.notebookLink'"));
let dirty = true;
let saveSucceeds = false;
let consumed = 0;
let started = null;
let banner = '';
const context = vm.createContext({
  workspaceReady: false,
  state: {},
  gelController: {
    hasUnsavedChanges: () => dirty,
    saveUnsavedChanges: async () => { if (saveSucceeds) dirty = false; return saveSucceeds; },
    startLinkedGel: (payload) => { started = payload; }
  },
  hikari: { call: async () => { consumed += 1; return selected; } },
  showBanner: (message) => { banner = message; },
  errorMessage: (error) => error.message
});
vm.runInContext(handlerSource, context);
await context.acceptNotebookLink();
assert.equal(consumed, 0);
context.workspaceReady = true;
await context.acceptNotebookLink();
assert.equal(consumed, 0, 'failed saves must leave the queued link intact');
assert.match(banner, /Save the current gel/);
saveSucceeds = true;
await context.acceptNotebookLink();
assert.equal(consumed, 1);
assert.equal(started.notebookEntryId, 'n1');
assert.equal(context.state.notebookEntries[0].id, 'n1');
console.log('Notebook Gel bridge handoff, isolation, backlinks, rollback, and plugin startup passed.');
