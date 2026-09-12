import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import runtime from './support/runtime.js';

const { MockElement, flushAsync, loadEsmStyleModule, trigger, wireFormReset } = runtime;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safeText = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const elementsFor = (names) => Object.fromEntries(names.map((name) => [name, new MockElement(name)]));
const targetFor = (attribute, dataset) => ({ closest: (selector) => selector === `[${attribute}]` ? { dataset } : null });

let now = Date.now();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const intervals = new Map();
let nextInterval = 0;
const windowObject = {
  requestAnimationFrame: (callback) => callback(),
  setInterval: (callback) => { intervals.set(++nextInterval, callback); return nextInterval; },
  clearInterval: (id) => intervals.delete(id)
};
const load = (name) => loadEsmStyleModule(path.join(root, 'src/renderer/modules/home-dashboard', name), {
  window: windowObject, Date: Clock
});

const { parseTimerDuration } = load('utils.js');
assert.equal(parseTimerDuration('5'), 5, 'bare durations remain minutes');
assert.equal(parseTimerDuration('15 min'), 15);
assert.equal(parseTimerDuration('15 mins'), 15);
assert.equal(parseTimerDuration('1 h'), 60);
assert.equal(parseTimerDuration('1 hour'), 60);
assert.equal(parseTimerDuration('1.5 hours'), 90);
assert.equal(parseTimerDuration('1 h 30 min'), 90);
assert.equal(parseTimerDuration('1 hour nonsense'), null, 'unrecognized duration text is rejected');

// A countdown tick must not replace the control tree; pause/resume keeps the
// selected timer's remaining duration even when display order changes.
const timerElements = elementsFor([
  'localTimeDisplay', 'localDateDisplay', 'timerStatus', 'timerActiveList',
  'timerOpenBtn', 'timerDialogOverlay', 'timerDialogCloseBtn', 'timerDialogForm',
  'timerNameInput', 'timerMinutesInput', 'timerTemplateList', 'topbarTimer',
  'topbarTimerTime', 'topbarTimerProgress'
]);
timerElements.timerDialogOverlay.hidden = true;
timerElements.timerDialogForm.reportValidity = () => true;
wireFormReset(timerElements.timerDialogForm, [timerElements.timerNameInput, timerElements.timerMinutesInput]);
// This harness checks timer state and tree replacement; live DOM patching is
// checked separately below and in the rendered dashboard.
timerElements.timerActiveList.querySelector = () => null;
let replacements = 0;
Object.defineProperty(timerElements.timerActiveList, 'innerHTML', {
  get() { return this._innerHTML; },
  set(value) { this._innerHTML = value; replacements += 1; }
});
const timerState = { settings: { dashboard: {
  timerTemplates: [{ name: 'Wash', durationMinutes: 5 }],
  activeTimers: [
    { name: 'First <timer>', durationMinutes: 10, startedAtMs: now, endAtMs: now + 600_000 },
    { name: 'Second timer', durationMinutes: 20, startedAtMs: now, endAtMs: now + 1_200_000 }
  ]
} } };
let timerPersists = 0;
let timer;
timer = load('timer.js').initTimerWidget({ state: timerState, safeText, persist: () => { timerPersists += 1; }, render: () => timer.render(), elements: timerElements });
timer.render();
assert.equal(timerElements.topbarTimer.hidden, false);
assert.equal(timerElements.topbarTimerTime.textContent, '10:00');
assert.equal(timerElements.topbarTimerProgress.style.strokeDasharray, '100.0 100');
assert.equal(timerElements.topbarTimer.getAttribute('aria-valuenow'), '100');
const initialReplacements = replacements;
now += 1000;
[...intervals.values()].forEach((callback) => callback());
assert.equal(replacements, initialReplacements, 'a tick preserves the existing timer DOM');
assert.match(timerElements.timerActiveList.innerHTML, /First &lt;timer&gt;/);
trigger(timerElements.timerActiveList, 'click', { target: targetFor('data-dashboard-toggle-active-timer', { dashboardToggleActiveTimer: '0' }) });
assert.equal(timerState.settings.dashboard.activeTimers[0].remainingMs, 599_000);
assert.equal(timerState.settings.dashboard.activeTimers[0].isPaused, true);
assert.ok(timerElements.timerActiveList.innerHTML.indexOf('Second timer') < timerElements.timerActiveList.innerHTML.indexOf('First &lt;timer&gt;'));
now += 30_000;
trigger(timerElements.timerActiveList, 'click', { target: targetFor('data-dashboard-toggle-active-timer', { dashboardToggleActiveTimer: '0' }) });
assert.equal(timerState.settings.dashboard.activeTimers[0].endAtMs, now + 599_000);
assert.equal(timerPersists, 2);
timerElements.timerOpenBtn.click();
assert.equal(timerElements.timerDialogOverlay.hidden, false);
assert.equal(timer.handleEscape(), true);
assert.equal(timerElements.timerDialogOverlay.hidden, true);
timerElements.timerNameInput.value = 'Overnight incubation';
timerElements.timerMinutesInput.value = '1.5 h';
trigger(timerElements.timerDialogForm, 'submit');
assert.equal(timerState.settings.dashboard.timerTemplates.at(-1).name, 'Overnight incubation');
assert.equal(timerState.settings.dashboard.timerTemplates.at(-1).durationMinutes, 90);
assert.equal(timerElements.timerMinutesInput.validationMessage, '');
const presetCount = timerState.settings.dashboard.timerTemplates.length;
timerElements.timerMinutesInput.value = 'about an hour';
trigger(timerElements.timerDialogForm, 'submit');
assert.equal(timerState.settings.dashboard.timerTemplates.length, presetCount);
assert.match(timerElements.timerMinutesInput.validationMessage, /Enter a duration/);
now += 1_300_000;
[...intervals.values()].forEach((callback) => callback());
assert.match(timerElements.timerActiveList.innerHTML, /Dismiss finished timer First &lt;timer&gt;/);
assert.doesNotMatch(timerElements.timerActiveList.innerHTML, /data-dashboard-toggle-active-timer/);
assert.equal(timerElements.topbarTimer.hidden, true, 'the header timer hides when no countdown remains active');

const { updateActiveTimer, updateTopbarTimer, formatCountdown } = load('timer-rendering.js');
const children = new Map(['.home-timer-count', '.home-timer-fill', '.home-timer-track'].map((selector) => [selector, new MockElement(selector)]));
updateActiveTimer({ querySelector: (selector) => children.get(selector) }, { remainingMs: 61_000, pct: 80.5, isWarn: true, isPaused: false });
assert.equal(children.get('.home-timer-count').textContent, '01:01');
assert.equal(children.get('.home-timer-fill').style.width, '80.5%');
assert.equal(children.get('.home-timer-track').getAttribute('aria-valuenow'), '81');
assert.equal(formatCountdown(3_661_000), '01:01:01');
const topbarElements = elementsFor(['topbarTimer', 'topbarTimerTime', 'topbarTimerProgress']);
updateTopbarTimer(topbarElements, {
  name: 'PCR extension',
  remainingMs: 61_000,
  remainingPct: 37.5,
  isWarn: true,
  isPaused: false
});
assert.equal(topbarElements.topbarTimerTime.textContent, '01:01');
assert.equal(topbarElements.topbarTimerProgress.style.strokeDasharray, '37.5 100');
assert.equal(topbarElements.topbarTimerProgress.style.transform, 'rotate(-157.5deg)');
assert.equal(topbarElements.topbarTimer.getAttribute('aria-valuenow'), '38');
assert.equal(topbarElements.topbarTimer.getAttribute('aria-valuetext'), '38% remaining, 01:01 left');
assert.equal(topbarElements.topbarTimer.classList.contains('is-warn'), true);

// Project grouping keeps the page ID bound to the existing note overlay and
// saves only to the page the user selected.
const notes = elementsFor(['pagesStatus', 'pageList', 'noteDialogOverlay', 'noteDialogForm', 'noteDialogCloseBtn', 'noteDialogPage', 'noteInput', 'noteClarifyBtn']);
notes.noteDialogOverlay.hidden = true;
wireFormReset(notes.noteDialogForm, [notes.noteInput]);
const notebookState = { settings: {}, notebookEntries: [
  { id: 'a', projectId: 'p1', projectName: 'Project <A>', protocolName: 'Page A', result: 'Keep this', updatedAt: new Date(now).toISOString() },
  { id: 'b', projectId: 'p2', projectName: 'Project B', protocolName: 'Page B', result: '', updatedAt: new Date(now - 1000).toISOString() },
  { id: 'c', projectId: 'p1', projectName: 'Project <A>', protocolName: 'Page C', result: '', updatedAt: new Date(now - 2000).toISOString() }
] };
let notePersists = 0;
const notebook = load('notebook.js').initNotebookWidget({ state: notebookState, persist: () => { notePersists += 1; }, safeText, render() {}, elements: notes });
notebook.render();
assert.equal((notes.pageList.innerHTML.match(/class="home-notebook-project"/g) || []).length, 2);
assert.match(notes.pageList.innerHTML, /Project &lt;A&gt;/);
trigger(notes.pageList, 'click', { target: targetFor('data-dashboard-notebook-entry', { dashboardNotebookEntry: 'c' }) });
assert.equal(notes.noteDialogOverlay.hidden, false);
assert.equal(notes.noteDialogPage.textContent, 'Page C | Project <A>');
notes.noteInput.value = 'Selected-page result';
trigger(notes.noteDialogForm, 'submit');
assert.equal(notes.noteDialogOverlay.hidden, true);
assert.equal(notebookState.notebookEntries[0].result, 'Keep this');
assert.equal(notebookState.notebookEntries[1].result, '');
assert.match(notebookState.notebookEntries[2].result, /Selected-page result/);
assert.equal(notePersists, 1);
trigger(notes.pageList, 'click', { target: targetFor('data-dashboard-notebook-entry', { dashboardNotebookEntry: 'b' }) });
assert.equal(notebook.handleEscape(), true);
assert.equal(notes.noteDialogOverlay.hidden, true);
assert.equal(notePersists, 1, 'closing a window does not save a note');

// Experiment drafts debounce whole-workspace persistence. Failed Agent
// handoffs preserve the draft; accepted handoffs commit exactly one log entry.
const quickLogElements = elementsFor([
  'quickLogInput', 'quickLogStatus', 'quickLogSaveBtn', 'quickLogAgentBtn'
]);
const quickLogState = { settings: { dashboard: {
  quickLogDraft: '',
  quickLogEntries: []
} } };
const scheduledDraftSaves = new Map();
let nextDraftSaveId = 0;
let quickLogPersists = 0;
let quickLogRenders = 0;
let handoffResult = { ok: false, reason: 'composer_not_empty' };
const quickLog = load('quick-log.js').initQuickLogWidget({
  state: quickLogState,
  persist: () => { quickLogPersists += 1; },
  createId: () => 'quick-log-1',
  render: () => { quickLogRenders += 1; },
  onSendQuickLogToAgent: async () => handoffResult,
  scheduleDraftPersist: (callback) => {
    const id = nextDraftSaveId += 1;
    scheduledDraftSaves.set(id, callback);
    return id;
  },
  cancelDraftPersist: (id) => scheduledDraftSaves.delete(id),
  elements: quickLogElements
});
quickLog.render();
assert.equal(quickLogElements.quickLogSaveBtn.disabled, true);
quickLogElements.quickLogInput.value = 'PCR yielded a single clean band.';
trigger(quickLogElements.quickLogInput, 'input');
assert.equal(quickLogPersists, 0, 'typing does not persist the full workspace per keystroke');
assert.equal(scheduledDraftSaves.size, 1);
[...scheduledDraftSaves.values()][0]();
scheduledDraftSaves.clear();
assert.equal(quickLogPersists, 1);
assert.equal(quickLogState.settings.dashboard.quickLogDraft, 'PCR yielded a single clean band.');

quickLogElements.quickLogAgentBtn.click();
await flushAsync();
assert.equal(quickLogState.settings.dashboard.quickLogEntries.length, 0);
assert.equal(quickLogElements.quickLogInput.value, 'PCR yielded a single clean band.');
assert.match(quickLogElements.quickLogStatus.textContent, /unsent draft/);

handoffResult = { ok: true, clientRequestId: 'agent-request-1' };
quickLogElements.quickLogAgentBtn.click();
await flushAsync();
assert.equal(quickLogState.settings.dashboard.quickLogEntries.length, 1);
assert.equal(quickLogState.settings.dashboard.quickLogEntries[0].text, 'PCR yielded a single clean band.');
assert.equal(quickLogState.settings.dashboard.quickLogDraft, '');
assert.equal(quickLogElements.quickLogInput.value, '');
assert.equal(quickLogPersists, 2);
assert.equal(quickLogRenders, 1);
assert.equal(quickLogElements.quickLogStatus.textContent, 'Logged and sent to Assistant.');

console.log('home dashboard interaction selfcheck OK');
