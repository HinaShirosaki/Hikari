import assert from 'node:assert/strict';
import { listCanvasFonts } from '../src/renderer/app/plugin-bridge/fonts.js';
import { createPluginBridge } from '../src/renderer/app/plugin-bridge.js';
import { initFontPicker } from '../plugins/scientific-illustration/fonts.mjs';

let reads = 0;
const windowObject = { queryLocalFonts: async () => {
  reads += 1;
  return [{ family: ' Menlo ', fullName: 'Menlo Regular', blob() { throw new Error('Do not read font bytes'); } },
    { family: 'menlo' }, { family: 'Academy Engraved LET' }, { family: '' }, { family: null }, { family: 'x'.repeat(101) }];
} };
const [first, second] = await Promise.all([listCanvasFonts(windowObject), listCanvasFonts(windowObject)]);
assert.deepEqual(first, { families: ['Academy Engraved LET', 'Menlo'] });
assert.deepEqual(second, first);
await listCanvasFonts(windowObject);
assert.equal(reads, 1, 'concurrent calls and later pickers share discovery');
assert.throws(() => listCanvasFonts({}), /unavailable/);

let attempts = 0;
const transient = { queryLocalFonts: async () => {
  attempts += 1;
  if (attempts === 1) throw new Error('temporary failure');
  return attempts === 2 ? [] : [{ family: 'Optima' }];
} };
await assert.rejects(listCanvasFonts(transient), /temporary failure/);
assert.deepEqual(await listCanvasFonts(transient), { families: [] });
assert.deepEqual(await listCanvasFonts(transient), { families: ['Optima'] });

// Permission and origin checks run before invoking the host's font API.
const bridge = createPluginBridge({ state: {}, windowObject });
const frame = () => ({ replies: [], postMessage(payload) { this.replies.push(payload); } });
const canvas = frame(), denied = frame();
const origin = 'http://127.0.0.1:43210';
bridge.register(canvas, { id: 'canvas', permissions: ['agent:canvas'] }, origin);
bridge.register(denied, { id: 'denied', permissions: ['layout'] }, origin);
const send = (source, from = origin) => bridge.handleMessage({ source, origin: from,
  data: { hikari: 1, id: 'fonts', verb: 'app.listFonts' } });
send(denied);
assert.equal(denied.replies.at(-1).ok, false);
send(canvas);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(canvas.replies.at(-1).result, first);
send(canvas, 'http://127.0.0.1:9999');
send(canvas);
assert.equal(canvas.replies.length, 1, 'replacement origins lose the grant');
bridge.disconnectLocale();

// Older hosts keep free-form fonts and bundled suggestions; focus can retry.
const listeners = {};
const input = { value: 'My custom font', addEventListener(name, listener) { listeners[name] = listener; } };
const list = { options: [{ value: 'Inter' }, { value: 'Arial' }], replaceChildren(...options) { this.options = options; } };
const documentObject = { getElementById: id => id === 'fonts' ? list : input, createElement: () => ({}) };
let calls = 0;
const picker = initFontPicker({ documentObject, hikari: { call: async verb => {
  assert.equal(verb, 'app.listFonts');
  calls += 1;
  if (calls === 1) throw new Error('Unknown verb');
  return { families: ['Menlo', 'Arial', '<Font & Family>'] };
} } });
assert.equal(await picker.load(), false);
assert.deepEqual(list.options.map(option => option.value), ['Inter', 'Arial']);
listeners.focus();
assert.equal(await picker.load(), true);
assert.deepEqual(list.options.map(option => option.value), ['<Font & Family>', 'Arial', 'Inter', 'Menlo']);
assert.equal(input.value, 'My custom font', 'asynchronous discovery preserves the edited value');
await picker.load();
assert.equal(calls, 2, 'successful picker discovery is cached');
console.log('PASS plugin fonts: metadata, permission gates, retries, and picker fallback');
