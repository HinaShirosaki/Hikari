import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginBridge, PLUGIN_BRIDGE_VERBS } from '../src/renderer/app/plugin-bridge.js';
import { readPluginChemicalClipboard } from '../src/renderer/app/plugin-bridge/chemical-clipboard.js';

test('chemical paste shares Sample format priority and returns previews without native binary payloads', async () => {
  const result = await readPluginChemicalClipboard({}, { api: { readChemicalClipboard: () => ({ ok: true,
    formats: ['com.cambridgesoft.chemdraw', 'public.tiff'], candidates: [
      { format: 'text/plain', text: 'Unrelated private text' },
      { format: 'com.cambridgesoft.chemdraw', text: 'VjCD0100 BINARY' },
      { format: 'image/native', imageDataUrl: 'data:image/png;base64,TkFUSVZF' },
      { format: 'public.tiff', imageDataUrl: 'data:image/png;base64,U0hBUlA=' }
    ] }) } });
  assert.equal(result.images[0], 'data:image/png;base64,U0hBUlA=');
  assert.equal(result.text, '');
  assert.ok(!JSON.stringify(result).includes('BINARY'));
  const text = '{"format":"hikari.figura.components"}';
  const components = await readPluginChemicalClipboard({}, { api: { readChemicalClipboard: () => ({ ok: true, candidates: [{ format: 'text/plain', text }] }) } });
  assert.equal(components.text, text);
  assert.equal(await readPluginChemicalClipboard({}, { api: { readChemicalClipboard: () => ({ ok: false }) } }), null);
});

test('native clipboard reads require the installed permission and the registered plugin origin', async () => {
  assert.equal(PLUGIN_BRIDGE_VERBS['clipboard.readChemical'], 'clipboard:read');
  let reads = 0;
  const frame = { replies: [], postMessage(payload) { this.replies.push(payload); } };
  const origin = 'http://127.0.0.1:43210';
  const plugin = { id: 'clipboard-test', permissions: [] };
  const bridge = createPluginBridge({ state: { settings: {} }, windowObject: { addEventListener() {} },
    api: { readChemicalClipboard() { reads++; return { ok: true, candidates: [] }; } } });
  bridge.register(frame, plugin, origin);
  const send = (sourceOrigin = origin) => bridge.handleMessage({ source: frame, origin: sourceOrigin,
    data: { hikari: 1, id: 'paste', verb: 'clipboard.readChemical', params: {} } });
  send(); assert.equal(reads, 0); assert.equal(frame.replies.at(-1).ok, false);
  plugin.permissions = ['clipboard:read']; send();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1); assert.equal(frame.replies.at(-1).ok, true);
  send('https://unrelated.example');
  assert.equal(reads, 1);
});
