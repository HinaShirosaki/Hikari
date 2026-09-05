import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import runtime from './support/runtime.js';

const { MockElement, loadEsmStyleModule, trigger, wireFormReset } = runtime;
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

// A countdown tick must not replace the control tree; pause/resume keeps the
// selected timer's remaining duration even when display order changes.
const timerElements = elementsFor([
  'localTimeDisplay', 'localDateDisplay', 'timerStatus', 'timerActiveList',
  'timerOpenBtn', 'timerDialogOverlay', 'timerDialogCloseBtn', 'timerDialogForm',
  'timerNameInput', 'timerMinutesInput', 'timerTemplateList'
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
now += 1_300_000;
[...intervals.values()].forEach((callback) => callback());
assert.match(timerElements.timerActiveList.innerHTML, /Dismiss finished timer First &lt;timer&gt;/);
assert.doesNotMatch(timerElements.timerActiveList.innerHTML, /data-dashboard-toggle-active-timer/);

const { updateActiveTimer, formatCountdown } = load('timer-rendering.js');
const children = new Map(['.home-timer-count', '.home-timer-fill', '.home-timer-track'].map((selector) => [selector, new MockElement(selector)]));
updateActiveTimer({ querySelector: (selector) => children.get(selector) }, { remainingMs: 61_000, pct: 80.5, isWarn: true, isPaused: false });
assert.equal(children.get('.home-timer-count').textContent, '01:01');
assert.equal(children.get('.home-timer-fill').style.width, '80.5%');
assert.equal(children.get('.home-timer-track').getAttribute('aria-valuenow'), '81');
assert.equal(formatCountdown(3_661_000), '01:01:01');

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

console.log('home dashboard interaction selfcheck OK');
