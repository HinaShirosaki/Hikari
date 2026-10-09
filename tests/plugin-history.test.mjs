import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginHistoryDelegate } from '../src/renderer/app/plugin-history.js';
import { createUndoService } from '../src/renderer/services/undoService.js';

function fixture() {
  const events = {}, commands = [], histories = new Map();
  const view = { id: 'plugin-figura-view' };
  const frame = { tagName: 'IFRAME', isConnected: true, contentWindow: {}, closest: selector => selector === '.plugin-view' ? view : null };
  view.querySelector = () => frame;
  const tools = { dataset: { viewId: view.id } };
  const button = selector => ({ closest: value => value === selector ? value === '#plugin-workspace-tools' ? tools : {} : null });
  const documentObject = { activeElement: frame, body: { dataset: { activeView: view.id } },
    addEventListener: (type, listener) => { events[type] = listener; },
    getElementById: id => id === view.id ? view : null };
  const windowObject = { addEventListener: (type, listener) => { events[type] = listener; } };
  const bridge = { getFrameHistory: owner => histories.get(owner) || null,
    sendFrameHistoryCommand: (owner, command) => { if (!histories.has(owner)) return false; commands.push({ owner, command }); return true; } };
  histories.set(frame.contentWindow, { canUndo: true, canRedo: false });
  const delegate = createPluginHistoryDelegate({ documentObject, windowObject, bridge });
  const focus = target => { documentObject.activeElement = target; events.focusin(); };
  return { delegate, frame, view, tools, button, histories, commands, documentObject, focus };
}

test('system buttons retain the active editor after shared-toolbar actions and never roll back host state behind it', () => {
  const f = fixture(), state = { value: 0 };
  const service = createUndoService({ state, delegate: f.delegate, documentObject: { getElementById: () => null, addEventListener() {} } });
  state.value = 1; service.persist();
  f.focus(f.button('#plugin-workspace-tools'));
  f.focus(f.button('.topbar-history-controls'));
  assert.equal(service.undo(), true); assert.equal(state.value, 1);
  assert.equal(service.redo(), true); assert.equal(state.value, 1);
  assert.deepEqual(f.commands.map(entry => entry.command), ['undo', 'redo']);
  assert.ok(f.commands.every(entry => entry.owner === f.frame.contentWindow));
  f.focus(f.button('.unrelated-host-control'));
  assert.equal(f.delegate.claim(), null);
  service.undo(); assert.equal(state.value, 0); assert.equal(f.commands.length, 2);
});

test('hidden, detached and unregistered frames cannot claim another view history', () => {
  const f = fixture(); assert.equal(f.delegate.claim().canUndo, true);
  f.documentObject.body.dataset.activeView = 'papers-view';
  assert.equal(f.delegate.claim(), null); assert.equal(f.delegate.run('undo'), false);
  f.documentObject.body.dataset.activeView = f.view.id; f.focus(f.frame);
  f.frame.isConnected = false; assert.equal(f.delegate.claim(), null);
  f.frame.isConnected = true; f.histories.clear(); assert.equal(f.delegate.claim(), null); assert.equal(f.delegate.run('redo'), false);
});

test('shared tools select their active owner even before iframe focus and stale tools cannot claim it', () => {
  const f = fixture(); f.focus(f.button('.unrelated-host-control'));
  assert.equal(f.delegate.claim(), null);
  f.focus(f.button('#plugin-workspace-tools')); assert.equal(f.delegate.claim().canUndo, true);
  f.tools.dataset.viewId = 'plugin-other-view'; f.focus(f.button('#plugin-workspace-tools'));
  assert.equal(f.delegate.claim(), null);
});
