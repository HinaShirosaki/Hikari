import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginBridge } from '../src/renderer/app/plugin-bridge.js';
import { capturePluginActionContext } from '../src/renderer/app/plugin-action-context.js';
import { normalizeContextActions } from '../src/renderer/app/plugin-context-actions.js';

const action = { id: 'generate-illustration', label: 'Generate illustration', contexts: ['protocol', 'paper-selection'], requiresAgent: true };
const origin = 'http://127.0.0.1:41234';
function fixture(api = {}) {
  const sent = [], other = { postMessage() {} }, frame = { postMessage: payload => sent.push(payload) };
  const state = { settings: { storagePath: '/storage' }, protocols: [{ id: 'p1', name: 'Wash', steps: ['Wash at 4 °C'] }, { id: 'p2', name: 'Other' }],
    papers: [{ id: 'paper-1', title: 'Selected', knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/folder/Selected paper.md' }, { id: 'paper-2', title: 'Other paper' }] };
  const windowObject = { addEventListener() {}, setTimeout, clearTimeout, document: { body: { dataset: { agentAvailability: 'connected' } } } };
  const bridge = createPluginBridge({ state, windowObject, api });
  bridge.register(frame, { id: 'demo', permissions: ['layout'] }, origin);
  bridge.register(other, { id: 'other', permissions: ['layout'] }, 'http://127.0.0.1:41235');
  bridge.contextActions.set({ actions: [action] }, frame);
  return { bridge, state, windowObject, frame, other, sent, actions: bridge.contextActions };
}
test('context actions accept declarative fields and reject malformed declarations', () => {
  assert.equal(normalizeContextActions({ actions: [action] })[0].label, action.label);
  for (const value of [{ actions: [{ ...action, html: '<svg>' }] }, { actions: [action, action] }, { actions: [{ ...action, id: '../escape' }] },
    { actions: [{ ...action, contexts: ['files'] }] }, { actions: [{ ...action, requiresAgent: 'yes' }] }, { actions: [{ ...action, label: '' }] }]) assert.throws(() => normalizeContextActions(value));
});
test('a user action snapshots one protocol, pins its frame and consumes the grant on acknowledgement', async () => {
  const { actions, frame, other, sent, state } = fixture();
  const work = actions.invoke('demo:generate-illustration', { kind: 'protocol', protocolId: 'p1' });
  const { id } = sent.at(-1).payload;
  state.protocols[0].steps[0] = 'Edited later';
  await assert.rejects(actions.read({ id }, other), /another plugin/);
  assert.throws(() => actions.respond({ id, result: { ok: true } }, other), /another plugin/);
  const source = await actions.read({ id }, frame);
  assert.deepEqual(source.protocol.steps, ['Wash at 4 °C']);
  assert.equal(source.protocol.id, 'p1');
  actions.respond({ id, result: { ok: true } }, frame);
  assert.deepEqual(await work, { ok: true });
  await assert.rejects(actions.read({ id }, frame), /expired/);
});
test('paper handoff reads only the saved Markdown locator, retains the exact passage and omits unrelated record bytes', async () => {
  const paths = [];
  const { actions, frame, sent, state } = fixture({ readFileBytes: async path => { paths.push(path); return { ok: true, bytes: new TextEncoder().encode('# Selected\nSpecific mechanism.') }; } });
  state.papers[0].pdfDataUrl = 'private-pdf-bytes';
  const work = actions.invoke('demo:generate-illustration', { kind: 'paper-selection', paperId: 'paper-1', text: 'Exact\npassage', pageNumber: 3 });
  const { id } = sent.at(-1).payload;
  const source = await actions.read({ id }, frame);
  assert.equal(source.markdownStatus, 'ready'); assert.match(source.markdown, /Specific mechanism/);
  assert.equal(source.text, 'Exact\npassage'); assert.equal(source.pageNumber, 3);
  assert.equal(source.paper.pdfDataUrl, undefined);
  assert.deepEqual(paths, ['/storage/KnowledgeBase/papers.md/folder/Selected paper.md']);
  actions.respond({ id, result: { ok: true } }, frame); await work;
});
test('disabled/offline/missing sources do not dispatch, and overlapping handoffs are rejected', async () => {
  const { actions, frame, sent, state, windowObject } = fixture();
  assert.equal((await actions.invoke('missing:action', { kind: 'protocol', protocolId: 'p1' })).ok, false);
  assert.equal((await actions.invoke('demo:generate-illustration', { kind: 'protocol', protocolId: 'missing' })).ok, false);
  windowObject.document.body.dataset.agentAvailability = 'offline';
  assert.equal((await actions.invoke('demo:generate-illustration', { kind: 'protocol', protocolId: 'p1' })).ok, false);
  assert.equal(sent.length, 0); windowObject.document.body.dataset.agentAvailability = 'connected';
  const work = actions.invoke('demo:generate-illustration', { kind: 'protocol', protocolId: 'p1' });
  assert.equal((await actions.invoke('demo:generate-illustration', { kind: 'protocol', protocolId: 'p2' })).ok, false);
  state.protocols[0].name = 'Changed'; actions.clear(frame); assert.equal((await work).ok, false);
  assert.deepEqual(actions.list('protocol'), []);
});
test('a navigated frame loses both its actions and an outstanding source read', async () => {
  let resolve;
  const { actions, frame, sent, bridge } = fixture({ readFileBytes: () => new Promise(done => { resolve = done; }) });
  const work = actions.invoke('demo:generate-illustration', { kind: 'paper-selection', paperId: 'paper-1', text: 'passage' });
  const { id } = sent.at(-1).payload;
  const read = actions.read({ id }, frame);
  bridge.handleMessage({ source: frame, origin: 'https://other.example', data: { hikari: 1, verb: 'app.readContextAction', params: { id } } });
  resolve({ ok: true, bytes: new TextEncoder().encode('private') });
  await assert.rejects(read, /expired/); assert.equal((await work).ok, false);
  assert.deepEqual(actions.list('paper-selection'), []);
});
test('registering actions again on the same frame revokes the previous document handoff', async () => {
  const { actions, frame, sent } = fixture();
  const work = actions.invoke('demo:generate-illustration', { kind: 'protocol', protocolId: 'p1' });
  const { id } = sent.at(-1).payload;
  actions.set({ actions: [action] }, frame);
  assert.equal((await work).ok, false);
  await assert.rejects(actions.read({ id }, frame), /expired/);
  assert.equal(actions.list('protocol').length, 1);
});
test('source paths cannot traverse or leave the paper folder and storage switches invalidate pending reads', async () => {
  for (const path of ['../../secrets.md', 'KnowledgeBase/papers.md/../secret.md', 'KnowledgeBase/papers.md/folder/meta.json', '/outside/paper.md']) {
    const state = { settings: { storagePath: '/root' }, papers: [{ id: 'p', knowledgeMarkdownRelativePath: path }] };
    const read = capturePluginActionContext(state, { kind: 'paper-selection', paperId: 'p', text: 'passage' }, { readFileBytes: () => assert.fail('Unsafe path was read') });
    assert.equal((await read()).markdownStatus, 'missing');
  }
  let resolve;
  const state = { settings: { storagePath: '/a' }, papers: [{ id: 'p', knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/folder/paper.md' }] };
  const read = capturePluginActionContext(state, { kind: 'paper-selection', paperId: 'p', text: 'passage' }, { readFileBytes: () => new Promise(done => { resolve = done; }) })();
  state.settings.storagePath = '/b'; resolve({ ok: true, bytes: new TextEncoder().encode('private') });
  await assert.rejects(read, /storage folder changed/);
});
test('missing and long Markdown contexts report limitations explicitly', async () => {
  const state = { settings: { storagePath: '/root' }, papers: [{ id: 'p', knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/folder/paper.md' }] };
  const context = { kind: 'paper-selection', paperId: 'p', text: 'passage' };
  const missing = await capturePluginActionContext(state, context, { readFileBytes: async () => ({ ok: false, error: 'ENOENT' }) })();
  assert.equal(missing.markdownStatus, 'missing'); assert.equal(missing.text, context.text);
  const long = await capturePluginActionContext(state, context, { readFileBytes: async () => ({ ok: true, bytes: new TextEncoder().encode('x'.repeat(200001)) }) })();
  assert.equal(long.markdown.length, 200000); assert.equal(long.markdownStatus, 'truncated'); assert.equal(long.markdownTruncated, true);
});
