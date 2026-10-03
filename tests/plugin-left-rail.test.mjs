import test from 'node:test';
import assert from 'node:assert/strict';
import { getPluginLeftRailLayout, setPluginLeftRailFolded } from '../src/renderer/app/plugin-left-rail.js';

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
