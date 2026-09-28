import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createPluginBridge } from '../src/renderer/app/plugin-bridge.js';
import { createPluginServiceRegistry } from '../src/renderer/app/plugin-services.js';

const require = createRequire(import.meta.url);
const { registerPluginIpc } = require('../src/main/ipc/register-plugin-ipc.js');
const { createPluginApi } = require('../src/main/preload/api/plugin-api.js');
const { createPluginServer, createPluginServerRegistry } = require('../src/main/lib/plugin-server.js');
const ORIGIN = 'http://127.0.0.1:43210';
const OTHER_ORIGIN = 'http://127.0.0.1:43211';

function createFrame() {
  return { replies: [], postMessage(payload, origin) { this.replies.push({ payload, origin }); } };
}

function send(bridge, frame, verb, params = {}, origin = ORIGIN) {
  bridge.handleMessage({ source: frame, origin, data: { hikari: 1, id: verb, verb, params } });
  return frame.replies.at(-1)?.payload;
}

async function checkBridgeOrigin() {
  let finishRead;
  const frame = createFrame();
  const plugin = { id: 'audit', permissions: ['notebook:read', 'files'] };
  const bridge = createPluginBridge({
    state: { settings: { storagePath: '/synthetic' }, notebookEntries: [{ id: 'n1', result: 'Private results' }] },
    windowObject: { addEventListener() {} },
    api: { readPluginFile: () => new Promise((resolve) => { finishRead = resolve; }) }
  });
  for (const origin of [undefined, 'null', 'file:///plugin', 'https://example.com', 'http://localhost:43210']) {
    bridge.register(frame, plugin, origin);
    send(bridge, frame, 'notebook.get', { id: 'n1' });
    assert.equal(frame.replies.length, 0, 'missing or non-plugin origins cannot gain a grant');
  }
  bridge.register(frame, plugin, ORIGIN);
  assert.equal(send(bridge, frame, 'notebook.get', { id: 'n1' }).result.resultText, 'Private results');
  assert.equal(frame.replies.at(-1).origin, ORIGIN);
  bridge.broadcastAppContext();
  assert.equal(frame.replies.at(-1).origin, ORIGIN, 'host events must not use wildcard delivery');
  send(bridge, frame, 'app.setHistory', { canUndo: true });
  assert.equal(bridge.sendFrameHistoryCommand(frame, 'undo'), true);
  assert.equal(frame.replies.at(-1).origin, ORIGIN);

  send(bridge, frame, 'files.read', { path: 'private.txt' });
  const repliesBeforeNavigation = frame.replies.length;
  send(bridge, frame, 'notebook.get', { id: 'n1' }, OTHER_ORIGIN);
  finishRead({ ok: true, dataBase64: 'eA==' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(frame.replies.length, repliesBeforeNavigation, 'neither a new call nor an in-flight reply crosses navigation');
  assert.equal(bridge.getFrameHistory(frame), null);
  assert.equal(bridge.sendFrameHistoryCommand(frame, 'redo'), false);
  send(bridge, frame, 'notebook.get', { id: 'n1' });
  assert.equal(frame.replies.length, repliesBeforeNavigation, 'a revoked frame cannot restore its own grant');

  // Even before a navigated document sends a message, delivery is origin-bound.
  bridge.register(frame, plugin, ORIGIN);
  send(bridge, frame, 'files.read', { path: 'private.txt' });
  finishRead({ ok: true, dataBase64: 'eA==' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(frame.replies.at(-1).origin, ORIGIN);
}

async function checkServiceOrigin() {
  const frameWindow = createFrame();
  const registry = createPluginServiceRegistry({ windowObject: { addEventListener() {} } });
  const registration = registry.register({ contentWindow: frameWindow }, {
    id: 'converter', service: { fileConversions: [{ from: 'dna', to: 'gbk' }] }
  });
  const deliver = (data, origin = ORIGIN, source = frameWindow) => registry.handleMessage({ data: { hikari: 1, ...data }, source, origin });
  const conversion = registry.convert({ extension: 'dna', filename: 'test.dna', bytes: new Uint8Array([1, 2]) });
  deliver({ call: 'service:ready' });
  registration.ready();
  assert.equal(frameWindow.replies.length, 0, 'readiness cannot send bytes before the origin is assigned');
  registration.setOrigin(ORIGIN);
  registration.setOrigin(OTHER_ORIGIN);
  deliver({ call: 'service:ready' });
  await new Promise((resolve) => setImmediate(resolve));
  const posted = frameWindow.replies.at(-1);
  assert.equal(posted.origin, ORIGIN);
  deliver({ call: 'convert:result', id: posted.payload.id, ok: true, text: 'wrong frame' }, ORIGIN, createFrame());
  deliver({ call: 'convert:result', id: posted.payload.id, ok: true, text: 'GenBank' });
  assert.equal((await conversion).text, 'GenBank');
  const pending = registry.convert({ extension: 'dna', bytes: new Uint8Array([3]) });
  const rejected = assert.rejects(pending, /navigated away/);
  deliver({ call: 'convert:result', id: frameWindow.replies.at(-1).payload.id, ok: true, text: 'hostile' }, OTHER_ORIGIN);
  await rejected;
  await assert.rejects(registry.convert({ extension: 'dna', bytes: new Uint8Array() }), /navigated away/);
}

function checkNotebookAndRollback() {
  const originalText = `  ${'x'.repeat(20010)}\nTAIL  `;
  const table = { columns: [{ field: 'area', title: 'Area' }], rows: [{ id: 'r1', area: '12' }] };
  const state = { settings: { pluginStorage: { audit: { saved: 'old' }, neighbour: { kept: true } } },
    notebookEntries: [{ id: 'n1', result: originalText, resultTable: table, updatedAt: '2020-01-01' }] };
  let fail = false;
  let renders = 0;
  const bridge = createPluginBridge({ state, windowObject: { addEventListener() {} },
    persist: () => { if (fail) throw new Error('QuotaExceededError'); },
    onNotebookEntriesChanged: () => { renders += 1; }
  });
  const frame = createFrame();
  bridge.register(frame, { id: 'audit', permissions: ['storage', 'notebook:read', 'notebook:write'] }, ORIGIN);
  const read = send(bridge, frame, 'notebook.get', { id: 'n1' });
  assert.equal(read.result.resultText, originalText.trim().slice(0, 20000));
  assert.equal(read.result.savedAt, '2020-01-01');
  assert.deepEqual(read.result.resultTables, [table]);
  assert.equal(send(bridge, frame, 'notebook.appendResult', { entryId: 'n1', table }).ok, true);
  assert.equal(state.notebookEntries[0].result, originalText, 'a table append cannot trim or truncate result text');
  assert.equal(state.notebookEntries[0].resultTables.length, 2, 'legacy tables survive the append');
  assert.equal(send(bridge, frame, 'notebook.appendResult', { entryId: 'n1', text: 'New result' }).ok, true);
  assert.equal(state.notebookEntries[0].result, `${originalText}\n\nNew result`);
  assert.equal(state.notebookEntries[0].resultText, undefined, 'writes use the field the notebook editor saves and displays');
  assert.notEqual(state.notebookEntries[0].updatedAt, '2020-01-01');
  assert.equal(renders, 2);

  fail = true;
  const priorStorage = state.settings.pluginStorage;
  for (const value of [{ saved: 'rejected' }, null]) {
    assert.equal(send(bridge, frame, 'storage.set', { value }).ok, false);
    assert.equal(state.settings.pluginStorage, priorStorage, 'failed replacements and deletions roll back');
  }
  const priorEntries = state.notebookEntries;
  assert.equal(send(bridge, frame, 'notebook.appendResult', { entryId: 'n1', text: 'Rejected append' }).ok, false);
  assert.equal(state.notebookEntries, priorEntries);
  assert.equal(renders, 2);
  fail = false;
  assert.equal(send(bridge, frame, 'storage.set', { value: { saved: 'new' } }).ok, true);
  assert.deepEqual(state.settings.pluginStorage, { audit: { saved: 'new' }, neighbour: { kept: true } });
}

async function checkFiles(temp) {
  const handlers = new Map();
  registerPluginIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    fs,
    dialog: {},
    session: {}
  });
  const api = createPluginApi({ invoke: (channel, payload) => handlers.get(channel)({}, payload) });
  const root = path.join(temp, 'storage');
  await fs.mkdir(root);
  const payload = { storagePath: root, pluginId: 'audit', path: 'nested/file.txt', dataBase64: 'b2xk' };
  assert.equal((await api.writePluginFile(payload)).ok, true);
  assert.equal((await api.readPluginFile(payload)).dataBase64, 'b2xk');
  assert.equal((await api.writePluginFile({ ...payload, dataBase64: 'bmV3' })).ok, true);
  assert.deepEqual(await fs.readdir(path.join(root, 'Plugins/audit/nested')), ['file.txt']);
  assert.equal((await api.readPluginFile(payload)).dataBase64, 'bmV3');

  const outside = path.join(temp, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'UNCHANGED');
  for (const [name, target, requested] of [
    ['linked', outside, 'linked/secret.txt'],
    ['leaf.txt', path.join(outside, 'secret.txt'), 'leaf.txt']
  ]) {
    await fs.symlink(target, path.join(root, 'Plugins/audit', name));
    for (const operation of [api.readPluginFile, api.writePluginFile]) {
      assert.equal((await operation({ ...payload, path: requested })).ok, false, 'links cannot bypass file confinement');
    }
  }
  await fs.symlink(outside, path.join(root, 'Plugins/other'));
  assert.equal((await api.writePluginFile({ ...payload, pluginId: 'other', path: 'secret.txt' })).ok, false);
  const linkedNamespaceRoot = path.join(temp, 'linked-namespace');
  await fs.mkdir(linkedNamespaceRoot);
  await fs.symlink(outside, path.join(linkedNamespaceRoot, 'Plugins'));
  assert.equal((await api.writePluginFile({ ...payload, storagePath: linkedNamespaceRoot })).ok, false);
  assert.deepEqual(await fs.readdir(outside), ['secret.txt']);
  assert.equal(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8'), 'UNCHANGED');

  // The configured root itself may be an OS/user alias; only paths beneath it
  // belong to the confinement boundary.
  await fs.symlink(root, path.join(temp, 'root-alias'));
  assert.equal((await api.readPluginFile({ ...payload, storagePath: path.join(temp, 'root-alias') })).dataBase64, 'bmV3');
  for (const badPath of ['../../secret.txt', '/secret.txt', '..\\secret.txt', 'C:\\secret.txt', 'x\0y']) {
    assert.equal((await api.writePluginFile({ ...payload, path: badPath })).ok, false);
    assert.equal((await api.readPluginFile({ ...payload, path: badPath })).ok, false);
  }
  assert.equal((await api.readPluginFile({ ...payload, pluginId: '../outside' })).ok, false);
  assert.equal((await api.writePluginFile({ ...payload, dataBase64: 'invalid' })).ok, false);
  assert.equal((await api.readPluginFile(payload)).dataBase64, 'bmV3', 'rejected writes leave saved bytes intact');
}

async function checkServers(temp) {
  // Every origin the registry hands out must pass through prepareOrigin first:
  // the OS reuses ports across runs, and a port is the whole origin.
  const prepared = [];
  let originFailure = '';
  const registry = createPluginServerRegistry({
    prepareOrigin: async (baseUrl) => {
      prepared.push(baseUrl);
      if (originFailure) throw new Error(originFailure);
    }
  });
  let direct;
  for (const name of ['old', 'new']) {
    await fs.mkdir(path.join(temp, name));
    await fs.writeFile(path.join(temp, name, 'index.html'), name);
  }
  await fs.symlink(path.join(temp, 'new'), path.join(temp, 'alias'));
  try {
    const [first, duplicate] = await Promise.all([
      registry.serve('audit', path.join(temp, 'old')),
      registry.serve('audit', path.join(temp, 'old'))
    ]);
    assert.equal(first.ok, true, first.error);
    assert.equal(first.baseUrl, duplicate.baseUrl, 'concurrent starts share one server');
    assert.equal(registry.size, 1);
    assert.deepEqual(prepared, [first.baseUrl], 'the served origin was prepared, exactly once');
    assert.equal(await (await fetch(first.baseUrl)).text(), 'old');
    const replaced = await registry.serve('audit', path.join(temp, 'new'));
    assert.equal(await (await fetch(replaced.baseUrl)).text(), 'new');
    assert.notEqual(replaced.baseUrl, first.baseUrl);
    await assert.rejects(fetch(first.baseUrl), /fetch failed/, 'the replaced server is closed');
    assert.equal(registry.size, 1);
    assert.deepEqual(prepared, [first.baseUrl, replaced.baseUrl], 'a replacement origin is prepared too');
    assert.equal((await registry.serve('audit', path.join(temp, 'alias'))).baseUrl, replaced.baseUrl);
    assert.equal(prepared.length, 2, 'reusing a live server must not wipe the running plugin');

    // A host that cannot empty the origin must not let a plugin onto the port.
    originFailure = 'origin not prepared';
    const refused = await registry.serve('audit-2', path.join(temp, 'new'));
    assert.equal(refused.ok, false);
    assert.match(refused.error, /origin not prepared/);
    assert.equal(registry.size, 1, 'a refused origin is never recorded');
    await assert.rejects(fetch(prepared.at(-1)), /fetch failed/, 'a refused origin stops listening');
    originFailure = '';

    direct = createPluginServer({ rootPath: path.join(temp, 'alias') });
    const url = await direct.listen();
    assert.equal(await (await fetch(url)).text(), 'new', 'symlinked roots serve their own files');
    await fs.symlink(path.join(temp, 'old/index.html'), path.join(temp, 'new/escape.html'));
    assert.equal((await fetch(`${url}escape.html`)).status, 403, 'outward file symlinks remain forbidden');
  } finally {
    await direct?.close();
    await registry.closeAll();
  }
}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-plugin-boundaries-'));
try {
  await checkBridgeOrigin();
  await checkServiceOrigin();
  checkNotebookAndRollback();
  await checkFiles(temp);
  await checkServers(temp);
  console.log('plugin-boundaries-selfcheck: ok');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
