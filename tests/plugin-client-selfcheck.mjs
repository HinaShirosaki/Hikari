import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const referencePath = path.join(projectRoot, 'examples/plugins/notebook-results/hikari.js');
const gelPath = path.join(projectRoot, 'examples/plugins/gel/hikari.js');
const referenceDir = path.dirname(referencePath);
const [source, gelSource, referenceHtml, referenceMain, referenceParser] = await Promise.all([
  fs.readFile(referencePath, 'utf8'),
  fs.readFile(gelPath, 'utf8'),
  fs.readFile(path.join(referenceDir, 'index.html'), 'utf8'),
  fs.readFile(path.join(referenceDir, 'main.js'), 'utf8'),
  fs.readFile(path.join(referenceDir, 'parse-results.js'), 'utf8')
]);

assert.equal(gelSource, source, 'served and local examples must use the same copyable client');
assert.doesNotMatch(source, /\bexport\b|\bimport\b/, 'the reference client must remain a classic script');
assert.ok(
  referenceHtml.indexOf('./hikari.js') < referenceHtml.indexOf('./parse-results.js')
  && referenceHtml.indexOf('./parse-results.js') < referenceHtml.indexOf('./main.js'),
  'the local reference loads classic dependencies before its UI'
);
assert.doesNotMatch(referenceMain, /^\s*(?:import|export)\s/m, 'the local reference UI must remain a classic script');
assert.doesNotMatch(referenceParser, /^\s*(?:import|export)\s/m, 'the local reference parser must remain a classic script');
assert.doesNotMatch(referenceMain, /\.innerHTML\s*=/, 'host and user text must be rendered through safe DOM APIs');
assert.match(referenceMain, /let attachInFlight = false/, 'the reference prevents duplicate writes');
assert.match(referenceMain, /let entriesLoadPromise = null/, 'the reference prevents duplicate refreshes');
assert.match(referenceMain, /resultsInput\.disabled = true/, 'the draft stays locked during its write');

function createRuntime({ standalone = false, throwOnPost = false } = {}) {
  const listeners = new Map();
  const requests = [];
  const parent = {
    postMessage(payload, origin) {
      if (throwOnPost) {
        throw new Error('clone failed');
      }
      requests.push({ payload, origin });
    }
  };
  const root = {
    parent,
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  };
  if (standalone) {
    root.parent = root;
  }
  vm.runInNewContext(source, { window: root, console, Error, Map, Object, Promise, String, Array });
  return { root, parent: root.parent, listeners, requests };
}

const runtime = createRuntime();
const { hikari } = runtime.root.HikariPlugin;
const call = hikari.call('app.info');
assert.equal(runtime.requests.length, 1);
assert.equal(runtime.requests[0].origin, '*');
assert.equal(runtime.requests[0].payload.verb, 'app.info');
runtime.listeners.get('message')({
  source: runtime.parent,
  data: {
    hikari: 1,
    id: runtime.requests[0].payload.id,
    ok: true,
    result: { host: 'hikari' }
  }
});
assert.equal((await call).host, 'hikari');

let contextPayload = null;
const unsubscribe = hikari.on('app.context', (payload) => {
  contextPayload = payload;
});
runtime.listeners.get('message')({
  source: runtime.parent,
  data: { hikari: 1, event: 'app.context', payload: { changed: 'storage' } }
});
assert.equal(contextPayload.changed, 'storage');
unsubscribe();
contextPayload = null;
runtime.listeners.get('message')({
  source: runtime.parent,
  data: { hikari: 1, event: 'app.context', payload: { changed: 'appearance' } }
});
assert.equal(contextPayload, null);

await assert.rejects(hikari.call('', {}), /non-empty verb/);
await assert.rejects(hikari.call('app.info', []), /object for params/);
await assert.rejects(createRuntime({ standalone: true }).root.HikariPlugin.hikari.call('app.info'), /only inside an installed Hikari plugin/);
await assert.rejects(createRuntime({ throwOnPost: true }).root.HikariPlugin.hikari.call('app.info'), /clone failed/);

console.log('plugin-client-selfcheck: ok');
