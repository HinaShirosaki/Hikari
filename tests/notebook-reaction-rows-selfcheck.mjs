// Self-check: the notebook fixed-reaction table is not capped at 6 reagents —
// the "+" row keeps appending rows above itself.
import assert from 'node:assert/strict';
import { createNotebookToolSidebarController } from '../src/renderer/modules/biology-notebook/tools/tool-sidebar.js';

class El {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this.listeners = [];
  }
  addEventListener(type, handler) { this.listeners.push([type, handler]); }
  fire(type, event = {}) { this.listeners.filter(([t]) => t === type).forEach(([, h]) => h(event)); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  appendChild(child) { child.parentElement = this; this.children.push(child); doc.register(child); }
  insertBefore(child, reference) {
    child.parentElement = this;
    const index = this.children.indexOf(reference);
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    doc.register(child);
  }
  querySelector() { return null; }
  querySelectorAll() { return this.children.filter((child) => child.id); }
  cloneNode() {
    const copy = new El(this.id);
    copy.attrs = { ...this.attrs };
    copy.dataset = { ...this.dataset };
    copy.hidden = this.hidden;
    copy.children = this.children.map((child) => child.cloneNode());
    return copy;
  }
}

const doc = {
  elements: new Map(),
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new El(id));
    return this.elements.get(id);
  },
  querySelector(selector) {
    return selector === '[data-notebook-tool-sidebar]' ? this.getElementById('sidebar') : null;
  },
  register(el) { this.elements.set(el.id, el); el.children.forEach((child) => this.register(child)); },
  addEventListener() {}
};

const row1 = doc.getElementById('biology-notebook-tool-reaction-row-1');
['name', 'stock', 'final', 'volume', 'output'].forEach((field) => {
  const cell = doc.getElementById(`biology-notebook-tool-reaction-${field}-1`);
  cell.setAttribute('aria-label', `Reaction item 1 ${field}`);
  row1.children.push(cell);
});
const reactionRows = doc.getElementById('biology-notebook-tool-reaction-rows-host');
reactionRows.appendChild(row1);
reactionRows.appendChild(doc.getElementById('biology-notebook-tool-reaction-add-row-anchor'));
for (let index = 2; index <= 6; index += 1) {
  doc.getElementById(`biology-notebook-tool-reaction-row-${index}`).hidden = true;
}
doc.getElementById('biology-notebook-tool-reaction-total-volume').value = '100 uL';

createNotebookToolSidebarController({
  doc,
  win: { addEventListener() {} },
  safeText: (value) => String(value ?? ''),
  createId: () => 'tool-record',
  getStoredCompounds: () => []
});

const addBtn = doc.getElementById('biology-notebook-tool-reaction-add-row');
for (let click = 0; click < 6; click += 1) addBtn.fire('click'); // reveals 2..6, then appends 7

const row7 = doc.getElementById('biology-notebook-tool-reaction-row-7');
assert.equal(row7.hidden, false, 'the seventh reagent row is created on demand');
assert.deepEqual(
  reactionRows.children.map((child) => child.id),
  [
    'biology-notebook-tool-reaction-row-1',
    'biology-notebook-tool-reaction-row-7',
    'biology-notebook-tool-reaction-add-row-anchor'
  ],
  'appended reagents stay above the add-reagent row'
);
assert.equal(
  doc.getElementById('biology-notebook-tool-reaction-name-7').getAttribute('aria-label'),
  'Reaction item 7 name'
);
assert.equal(doc.getElementById('biology-notebook-tool-reaction-name-7').value, '');

console.log('notebook-reaction-rows selfcheck OK');
