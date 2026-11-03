import test from 'node:test';
import assert from 'node:assert/strict';
import { getPluginLeftRailLayout, setPluginLeftRailFolded } from '../src/renderer/app/plugin-left-rail.js';
import { createPluginLeftRailHeader, getActivePluginLeftRailHeader } from '../src/renderer/app/plugin-left-rail-header.js';

test('host restores each plugin fold preference without changing the expanded width', () => {
  const storage = new Map([['hikari_plugin_left_rail_folded_v1:illustration', 'true'], ['hikari_shared_left_rail_width_v2', '336']]);
  const windowObject = { innerWidth: 1300, localStorage: { getItem: key => storage.get(key) } };
  assert.equal(getPluginLeftRailLayout('illustration', { windowObject }).folded, true);
  assert.equal(getPluginLeftRailLayout('gel', { windowObject }).folded, false);
  assert.equal(getPluginLeftRailLayout('illustration', { windowObject }).width, 336);
});

test('folding still works when host local storage cannot be written', () => {
  const windowObject = { localStorage: { getItem: () => 'true', setItem: () => { throw new Error('blocked'); } } };
  assert.equal(getPluginLeftRailLayout('illustration', { windowObject }).folded, true);
  assert.equal(setPluginLeftRailFolded('illustration', false, { windowObject }).folded, false);
  assert.equal(getPluginLeftRailLayout('illustration', { windowObject }).folded, false);
});

test('missing host browser APIs keep layout reads available', () => {
  assert.equal(getPluginLeftRailLayout('illustration', { windowObject: null }).folded, false);
  assert.equal(getPluginLeftRailLayout('illustration', { windowObject: null }).width, 280);
});

test('header registrations follow the active frame and cannot survive a replaced permission grant', () => {
  const registrations = new Map(), folds = new Map();
  const windowObject = { document: { getElementById: () => ({}) } };
  const controller = createPluginLeftRailHeader({ windowObject,
    getRegistration: frame => registrations.get(frame),
    readLayout: id => ({ folded: folds.get(id) === true }),
    setFolded: (id, folded) => folds.set(id, folded) });
  const frame = {}, other = {};
  const plugin = { id: 'figura', permissions: ['layout'], enabled: true };
  registrations.set(frame, { plugin });
  registrations.set(other, { plugin: { id: 'other', permissions: ['layout'] } });
  const view = (id, contentWindow) => ({ getAttribute: () => id, closest: () => null,
    querySelector: () => ({ contentWindow }) });
  assert.throws(() => controller.set({ available: 'true' }, frame), /boolean/);
  assert.throws(() => controller.set({ available: true, pluginId: 'other' }, frame), /boolean/);
  assert.equal(controller.set({ available: true }, frame).mounted, true);
  assert.equal(getActivePluginLeftRailHeader(windowObject, view('other', other)), null);
  assert.equal(getActivePluginLeftRailHeader(windowObject, view('figura', other)), null);
  getActivePluginLeftRailHeader(windowObject, view('figura', frame)).setFolded(true);
  assert.equal(folds.get('figura'), true);
  assert.equal(folds.has('other'), false);
  controller.set({ available: false }, frame);
  assert.equal(getActivePluginLeftRailHeader(windowObject, view('figura', frame)), null);
  controller.set({ available: true }, frame);
  plugin.enabled = false;
  assert.equal(getActivePluginLeftRailHeader(windowObject, view('figura', frame)), null);
  plugin.enabled = true;
  registrations.set(frame, { plugin });
  assert.equal(getActivePluginLeftRailHeader(windowObject, view('figura', frame)), null);
  controller.set({ available: true }, frame);
  controller.clear(frame);
  assert.equal(getActivePluginLeftRailHeader(windowObject, view('figura', frame)), null);
});
