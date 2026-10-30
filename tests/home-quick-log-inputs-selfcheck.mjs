import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import runtime from './support/runtime.js';

const { MockElement, flushAsync, loadEsmStyleModule, trigger } = runtime;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { initQuickLogWidget } = loadEsmStyleModule(path.join(root, 'src/renderer/modules/home-dashboard/quick-log.js'), {
  console: { ...console, warn() {} }
});
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

function fixture({ connected = true, send = async () => ({ ok: true }) } = {}) {
  const elements = Object.fromEntries([
    'quickLogInput', 'quickLogStatus', 'quickLogSaveBtn', 'quickLogAgentBtn', 'quickLogRecent'
  ].map(name => [name, new MockElement(name)]));
  elements.quickLogInput.ownerDocument = { body: { dataset: { agentAvailability: connected ? 'connected' : 'offline' } } };
  const state = { settings: { dashboard: { quickLogDraft: '', quickLogEntries: [] } } };
  const timers = new Map();
  let serial = 0, saves = 0, fail = false;
  let saved = structuredClone(state);
  let widget;
  widget = initQuickLogWidget({ state, safeText: escape,
    createId: () => `log-${++serial}`,
    persist: () => { if (fail) throw Error('Simulated storage failure'); saves++; saved = structuredClone(state); },
    render: () => widget.render(), onSendQuickLogToAgent: send,
    scheduleDraftPersist: callback => { const id = ++serial; timers.set(id, callback); return id; },
    cancelDraftPersist: id => timers.delete(id), elements
  });
  widget.render();
  return {
    ...elements, state, widget,
    get saved() { return saved; }, get saves() { return saves; },
    set fail(value) { fail = value; },
    input(value) { elements.quickLogInput.value = value; trigger(elements.quickLogInput, 'input'); },
    tick() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    key(extra = {}) { trigger(elements.quickLogInput, 'keydown', { key: 'Enter', ctrlKey: true, ...extra }); }
  };
}

test('blank and whitespace-only notes stay unsaved', () => {
  for (const value of ['', ' \t\n', '\u00a0\u3000']) {
    const f = fixture(); f.input(value); f.tick();
    assert.equal(f.quickLogSaveBtn.disabled, true);
    assert.equal(f.quickLogAgentBtn.disabled, true);
    f.key();
    assert.equal(f.state.settings.dashboard.quickLogEntries.length, 0);
  }
});

test('rapid local saves create one dated entry and preserve special characters', () => {
  const f = fixture();
  const note = '  PCR α/β: 0.5 µL, 37°C\nClone\tA1\t0.00\n<script>alert("test")</script> 🧪  ';
  f.input(note);
  f.quickLogSaveBtn.click(); f.quickLogSaveBtn.click(); f.tick();
  assert.equal(f.state.settings.dashboard.quickLogEntries.length, 1);
  assert.equal(f.saved.settings.dashboard.quickLogEntries[0].text, note.trim());
  assert.equal(f.saved.settings.dashboard.quickLogDraft, '');
  assert.ok(Number.isFinite(Date.parse(f.saved.settings.dashboard.quickLogEntries[0].createdAt)));
  assert.ok(f.quickLogRecent.innerHTML.includes('&lt;script&gt;'));
  assert.ok(!f.quickLogRecent.innerHTML.includes('<script>'));
});

test('offline keyboard shortcut saves locally', () => {
  const f = fixture({ connected: false, send: () => { throw Error('Unexpected assistant call'); } });
  f.input('No colonies on the negative control.'); f.key();
  assert.equal(f.saved.settings.dashboard.quickLogEntries[0].text, 'No colonies on the negative control.');
});

test('Ctrl/Command+Enter does not submit an unfinished IME composition', async () => {
  for (const connected of [true, false]) {
    let sends = 0;
    const f = fixture({ connected, send: async () => { sends++; return { ok: true }; } });
    f.input('今天转染，尚未观察');
    f.key({ isComposing: true });
    await flushAsync();
    assert.equal(sends, 0, 'Composing text must not be sent');
    assert.equal(f.state.settings.dashboard.quickLogEntries.length, 0, 'Composing text must not be saved');
    assert.equal(f.quickLogInput.value, '今天转染，尚未观察');
  }
});

test('draft autosave cannot replace the in-progress notebook status', async () => {
  let finish, sends = 0;
  const f = fixture({ send: () => { sends++; return new Promise(resolve => { finish = resolve; }); } });
  f.input('Protein concentration 0.82 mg/mL; blank not subtracted.');
  f.quickLogAgentBtn.click(); f.key();
  assert.equal(sends, 1);
  assert.equal(f.quickLogInput.disabled, true);
  f.tick();
  assert.equal(f.quickLogStatus.textContent, 'Preparing notebook page…');
  finish({ ok: true }); await flushAsync();
  assert.equal(f.state.settings.dashboard.quickLogEntries.length, 1);
  assert.equal(f.quickLogInput.disabled, false);
});

test('failed draft persistence stays an error across a dashboard render and recovers on retry', () => {
  const f = fixture(); f.fail = true;
  f.input('Keep this observation if storage is full.'); f.tick(); f.widget.render();
  assert.equal(f.quickLogStatus.textContent, 'Experiment draft could not be saved.');
  assert.equal(f.quickLogStatus.classList.contains('is-error'), true);
  assert.equal(f.quickLogInput.value, 'Keep this observation if storage is full.');
  f.fail = false; f.input(f.quickLogInput.value + ' Retried.'); f.tick(); f.widget.render();
  assert.equal(f.quickLogStatus.textContent, 'Draft saved locally.');
  assert.equal(f.saved.settings.dashboard.quickLogDraft, f.quickLogInput.value);
});

test('local save failure rolls back the entry and permits a single successful retry', () => {
  const f = fixture(); f.input('A1 = 0; A2 = missing; do not infer a measurement.'); f.tick();
  f.fail = true; f.quickLogSaveBtn.click();
  assert.equal(f.state.settings.dashboard.quickLogEntries.length, 0);
  assert.equal(f.quickLogInput.value, f.saved.settings.dashboard.quickLogDraft);
  f.widget.render();
  assert.equal(f.quickLogStatus.textContent, 'Experiment could not be saved.');
  f.fail = false; f.quickLogSaveBtn.click();
  assert.equal(f.saved.settings.dashboard.quickLogEntries.length, 1);
});

for (const reason of ['busy', 'composer_not_empty', 'too_long', 'session_error', 'request_error', 'unavailable']) {
  test(`failed assistant handoff (${reason}) preserves the draft without adding an entry`, async () => {
    const f = fixture({ send: async () => ({ ok: false, reason }) });
    const note = 'Append to yesterday’s page: correction, 5 µM rather than 5 mM.';
    f.input(note); f.quickLogAgentBtn.click(); await flushAsync();
    assert.equal(f.quickLogInput.value, note);
    assert.equal(f.saved.settings.dashboard.quickLogDraft, note);
    assert.equal(f.saved.settings.dashboard.quickLogEntries.length, 0);
    assert.equal(f.quickLogStatus.classList.contains('is-error'), true);
    assert.equal(f.quickLogInput.disabled, false);
  });
}

test('a thrown assistant request preserves the note for retry', async () => {
  const f = fixture({ send: async () => { throw Error('Simulated network loss'); } });
  f.input('Measurements still pending.'); f.quickLogAgentBtn.click(); await flushAsync();
  assert.equal(f.saved.settings.dashboard.quickLogDraft, 'Measurements still pending.');
  assert.equal(f.state.settings.dashboard.quickLogEntries.length, 0);
  assert.match(f.quickLogStatus.textContent, /unavailable/);
});
