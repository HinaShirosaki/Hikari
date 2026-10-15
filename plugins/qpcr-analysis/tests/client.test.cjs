const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../hikari.js'), 'utf8');

function fixture() {
  const messages = [], handlers = new Map(), timers = new Map();
  let counter = 0;
  const parent = { postMessage: message => messages.push(message) };
  const root = { parent, console, setTimeout: (callback, delay) => { timers.set(++counter, { callback, delay }); return counter; }, clearTimeout: id => timers.delete(id),
    addEventListener: (event, handler) => handlers.set(event, handler), removeEventListener: event => handlers.delete(event) };
  vm.runInNewContext(source, { window: root });
  return { root, messages, timers, receive: (data, sender = parent) => handlers.get('message')({ data, source: sender }), close: () => handlers.get('pagehide')() };
}

test('correlates replies, rejects host errors and ignores forged senders/markers', async () => {
  const f = fixture();
  const first = f.root.HikariPlugin.hikari.call('app.info');
  const second = f.root.HikariPlugin.hikari.call('storage.get');
  assert.notEqual(f.messages[0].id, f.messages[1].id);
  f.receive({ hikari: 1, id: f.messages[0].id, ok: true, result: 'forged' }, {});
  f.receive({ id: f.messages[0].id, ok: true, result: 'unmarked' });
  assert.equal(f.timers.size, 2);
  f.receive({ hikari: 1, id: f.messages[1].id, ok: false, error: 'Denied' });
  await assert.rejects(second, /Denied/);
  f.receive({ hikari: 1, id: f.messages[0].id, ok: true, result: { host: 'hikari' } });
  assert.equal((await first).host, 'hikari');
  assert.equal(f.timers.size, 0);
});

test('subscribes only to parent events and unsubscribes cleanly', () => {
  const f = fixture(), contexts = [];
  const off = f.root.HikariPlugin.hikari.on('app.context', payload => contexts.push(payload));
  f.receive({ hikari: 1, event: 'app.context', payload: 'forged' }, {});
  f.receive({ hikari: 1, event: 'app.context', payload: 'night' });
  off();
  f.receive({ hikari: 1, event: 'app.context', payload: 'day' });
  assert.deepEqual(contexts, ['night']);
});

test('uses the documented timeout budgets and rejects outstanding calls on teardown', async () => {
  const f = fixture();
  const normal = f.root.HikariPlugin.hikari.call('app.info');
  assert.equal([...f.timers.values()][0].delay, 10000);
  [...f.timers.values()][0].callback();
  await assert.rejects(normal, /did not answer/);
  // Fake timers do not remove themselves; clear that expired fixture entry.
  f.timers.clear();
  const download = f.root.HikariPlugin.hikari.call('downloads.save', {});
  assert.equal([...f.timers.values()][0].delay, 600000);
  f.close();
  await assert.rejects(download, /closed/);
  assert.equal(f.timers.size, 0);
});

test('rejects invalid parameters, uncloneable requests and standalone use immediately', async () => {
  const f = fixture();
  for (const params of [null, [], 'bad']) await assert.rejects(f.root.HikariPlugin.hikari.call('app.info', params), /object/);
  f.root.parent.postMessage = () => { throw new Error('could not clone'); };
  await assert.rejects(f.root.HikariPlugin.hikari.call('app.info'), /clone/);
  assert.equal(f.timers.size, 0);
  f.root.parent = f.root;
  await assert.rejects(f.root.HikariPlugin.hikari.call('app.info'), /Hikari/);
});
