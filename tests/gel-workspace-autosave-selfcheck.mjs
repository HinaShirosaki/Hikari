import assert from 'node:assert/strict';
import { createGelWorkspaceStore } from '../src/plugins/gel/workspace-store.js';
import { createWorkspaceAutosave } from '../src/plugins/gel/workspace/figure/autosave.js';

const files = new Map();
let failPath = '', writes = 0;
const hikari = { async call(verb, params) {
  if (verb === 'files.read') {
    if (!files.has(params.path)) throw new Error('Plugin file not found.');
    return { dataBase64: files.get(params.path) };
  }
  assert.equal(verb, 'files.write');
  assert.ok(params.dataBase64.length < 24_000_000, 'Chunks stay within the host file limit');
  if (params.path === failPath) throw new Error('Disk full');
  files.set(params.path, params.dataBase64); writes++;
  return { path: params.path };
} };
const store = () => createGelWorkspaceStore({ hikari, isConfigured: () => true });
let current = store();
assert.deepEqual(await current.load(), []);
// Unicode straddles chunk boundaries; reconstruction must preserve bytes.
const large = JSON.stringify({ text: 'x'.repeat(5_999_990) + '🧪'.repeat(10) + 'y'.repeat(200) });
await current.save(large);
assert.equal(JSON.parse(Buffer.from(files.get('Workspace/current.json'), 'base64')).chunks.length, 2);
current = store();
let candidates = await current.load();
assert.equal(candidates[0].content, large); candidates[0].accept();
const priorWrites = writes;
await current.save(large);
assert.equal(writes, priorWrites, 'Identical content does not write again');
failPath = 'Workspace/current.json';
await assert.rejects(current.save('second'), /Disk full/);
assert.equal((await store().load())[0].content, large, 'An uncommitted write retains the previous complete workspace');
failPath = '';
await current.save('second');
candidates = await store().load();
assert.equal(candidates[0].content, 'second'); assert.equal(candidates[1].content, large);
files.set('Workspace/current.json', Buffer.from('broken').toString('base64'));
candidates = await store().load();
assert.equal(candidates[0].previous, true); assert.equal(candidates[0].content, large, 'Corruption falls back to the previous snapshot');
const oldFiles = new Map(files);
files.delete('Workspace/previous.json');
await assert.rejects(store().load(), /JSON|Unexpected token/);
files.clear(); oldFiles.forEach((value, key) => files.set(key, value));
const manifest = JSON.parse(Buffer.from(files.get('Workspace/previous.json'), 'base64'));
files.set('Workspace/current.json', files.get('Workspace/previous.json')); files.delete('Workspace/previous.json');
files.delete(`Workspace/slots/${manifest.slot}/0.bin`);
await assert.rejects(store().load(), /not found/, 'Missing chunks are a failed recovery, never an empty workspace');
current.dispose();
await assert.rejects(current.save('after root switch'), /storage folder changed/);

let key = 'initial', disk = 'initial', reject = false, release = null;
const errors = [];
const autosave = createWorkspaceAutosave({ getKey: () => key, getContent: () => key,
  async save(content) {
    if (reject) throw new Error('Disk full');
    if (release === 'pause') await new Promise(resolve => { release = resolve; });
    disk = content;
  }, onError: error => errors.push(error.message), delay: 5 });
autosave.enable(); assert.equal(autosave.dirty(), false);
key = 'first'; release = 'pause';
const flushing = autosave.flush();
assert.equal(autosave.dirty(), true);
key = 'second'; release();
assert.equal(await flushing, true); assert.equal(disk, 'second', 'Edits during a write are flushed next');
assert.equal(autosave.dirty(), false);
reject = true; key = 'failed';
assert.equal(await autosave.flush(), false); assert.equal(autosave.dirty(), true);
assert.equal(disk, 'second'); assert.deepEqual(errors, ['Disk full']);
reject = false; assert.equal(await autosave.flush(), true);
key = 'undo'; autosave.schedule();
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(disk, 'undo', 'Debounced changes are saved automatically');
key = 'cancelled'; autosave.schedule(); autosave.dispose();
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(disk, 'undo', 'Disposal cancels delayed writes');
console.log('gel-workspace-autosave-selfcheck: passed (chunk limits, Unicode, atomic commit, recovery, corruption, root changes, queued edits, failures, retry, debounce)');
