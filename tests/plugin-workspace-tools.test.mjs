import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkspaceTools } from '../src/renderer/app/plugin-workspace-tools.js';
import { createPluginBridge } from '../src/renderer/app/plugin-bridge.js';
import { PROTOCOL_MARKER, buildPluginAppContext } from '../src/renderer/app/plugin-bridge/helpers.js';
import { workspaceToolIcons } from '../src/renderer/app/plugin-workspace-tool-icons.js';
import { createWorkspaceTools } from '../plugins/scientific-illustration/workspace-tools.mjs';

const button = { id: 'layers', label: 'Layers', icon: 'layers', expanded: false };
test('workspace tools accept bounded, declarative controls and focus an enabled button', () => {
  const args = { tools: [button, { id: 'zoom', kind: 'output', label: '125%' }], focusId: 'layers' };
  const normalized = normalizeWorkspaceTools(args);
  assert.equal(normalized.tools.length, 2); assert.equal(normalized.focusId, 'layers');
  assert.equal(normalized.tools[0].kind, 'button'); assert.notEqual(normalized.tools[0], button);
});
test('workspace tools reject injected markup fields, duplicate IDs, arbitrary icons and invalid flags', () => {
  for (const tools of [[button, button], [{ ...button, html: '<script>' }], [{ ...button, icon: '<svg>' }],
    [{ ...button, disabled: 'true' }], [{ ...button, label: '' }], [{ ...button, id: '../other' }],
    Array.from({ length: 25 }, (_, i) => ({ ...button, id: `part-${i}` }))]) assert.throws(() => normalizeWorkspaceTools({ tools }));
  for (const tools of [[{ ...button, disabled: true }], [{ id: 'layers', kind: 'output', label: 'Layers' }]]) {
    assert.throws(() => normalizeWorkspaceTools({ tools, focusId: 'layers' }), /enabled workspace tool/);
  }
});
test('layout controls and chat expansion keep their separate declared permissions and origin grants', () => {
  const received = [], frame = { postMessage: (reply, origin) => received.push({ reply, origin }) };
  const bridge = createPluginBridge({ state: { settings: {} }, windowObject: { addEventListener() {} } });
  bridge.register(frame, { id: 'demo', permissions: [] }, 'http://127.0.0.1:41234/');
  const request = verb => ({ source: frame, origin: 'http://127.0.0.1:41234', data: { hikari: PROTOCOL_MARKER, id: 'request', verb, params: {} } });
  bridge.handleMessage(request('app.setWorkspaceTools'));
  assert.match(received.at(-1).reply.error, /layout/);
  bridge.handleMessage(request('app.setAgentChatExpanded'));
  assert.match(received.at(-1).reply.error, /agent:chat/);
  const count = received.length;
  bridge.handleMessage({ ...request('app.setWorkspaceTools'), origin: 'https://other.example' });
  assert.equal(received.length, count, 'A navigated frame has no toolbar or reply grant');
});

test('host advertises exactly the icons its workspace toolbar accepts', () => {
  const windowObject = { document: { getElementById: id => id === 'plugin-workspace-tools' ? {} : null } };
  const context = buildPluginAppContext({ settings: {} }, '', windowObject);
  assert.equal(context.layout.workspaceTools.available, true);
  assert.deepEqual(context.layout.workspaceTools.icons, workspaceToolIcons);
  assert.ok(context.layout.workspaceTools.icons.includes('crop'));
  assert.ok(context.layout.workspaceTools.icons.includes('align'));
  for (const icon of context.layout.workspaceTools.icons) {
    assert.doesNotThrow(() => normalizeWorkspaceTools({ tools: [{ id: 'tool', label: 'Tool', icon }] }));
  }
});

function illustrationToolbarFixture(icons) {
  const calls = [], events = {}, classes = new Set();
  const classList = { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) };
  const ids = ['pointer-tool', 'freehand-tool', 'add-menu', 'crop-raster', 'group-selection',
    'ungroup-selection', 'align-menu', 'layers-tab', 'assets-tab', 'zoom-out', 'zoom-level', 'zoom-in', 'zoom-fit', 'workspace-tools'];
  const nodes = Object.fromEntries(ids.map(id => [id, {
    title: id === 'crop-raster' ? 'Crop selected image' : id, textContent: '100%', disabled: id === 'crop-raster',
    classList, hasAttribute: () => false, getAttribute: () => null, querySelector() { return this; },
    addEventListener() {}, click() { this.clicks = (this.clicks || 0) + 1; }
  }]));
  const accepted = new Set(icons || workspaceToolIcons.filter(icon => !['crop', 'align'].includes(icon)));
  const hikari = { on: (name, callback) => { events[name] = callback; }, call: async (verb, params) => {
    calls.push({ verb, params });
    if (params.tools.some(tool => tool.kind !== 'output' && !accepted.has(tool.icon))) throw new Error('Unsupported icon');
    return { mounted: true };
  } };
  const toolbar = createWorkspaceTools({ hikari, document: { body: { classList }, defaultView: {}, getElementById: id => nodes[id] } });
  const info = { permissions: ['layout'], layout: { workspaceTools: { available: true, ...(icons ? { icons } : {}) } } };
  return { calls, events, nodes, classes, toolbar, info };
}
const flushToolbar = () => new Promise(resolve => setImmediate(resolve));

test('current hosts use the dedicated Crop icon and context refresh keeps the hosted toolbar', async () => {
  const fixture = illustrationToolbarFixture(workspaceToolIcons);
  fixture.toolbar.connect(fixture.info); await flushToolbar();
  assert.equal(fixture.toolbar.isHosted(), true);
  assert.equal(fixture.calls.at(-1).params.tools.find(tool => tool.id === 'crop-raster').icon, 'crop');
  assert.equal(fixture.calls.at(-1).params.tools.find(tool => tool.id === 'align-menu').icon, 'align');
  assert.deepEqual(fixture.calls.at(-1).params.tools.filter(tool => tool.icon === 'layers').map(tool => tool.id), ['layers-tab']);
  const count = fixture.calls.length;
  fixture.toolbar.connect(fixture.info); await flushToolbar();
  assert.equal(fixture.calls.length, count, 'Unchanged context does not re-register controls');
  assert.equal(fixture.toolbar.isHosted(), true);
});
