import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkspaceTools } from '../src/renderer/app/plugin-workspace-tools.js';
import { createPluginBridge } from '../src/renderer/app/plugin-bridge.js';
import { PROTOCOL_MARKER } from '../src/renderer/app/plugin-bridge/helpers.js';

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
