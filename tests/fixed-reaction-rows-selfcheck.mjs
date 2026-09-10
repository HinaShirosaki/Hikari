// Self-check: the fixed-volume reaction table is not capped at 6 reagents.
import assert from 'node:assert/strict';
import { initFixedReactionTool } from '../src/renderer/modules/tool-box/fixed-reaction-ui.js';

class El {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.children = [];
    this.attrs = {};
    this.listeners = [];
  }
  addEventListener(type, handler) { this.listeners.push([type, handler]); }
  fire(type, event = {}) { this.listeners.filter(([registeredType]) => registeredType === type).forEach(([, handler]) => handler(event)); }
  getAttribute(name) { return this.attrs[name] || null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    doc.register(child);
  }
  insertBefore(child, reference) {
    child.parentElement = this;
    const index = this.children.indexOf(reference);
    if (index < 0) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    doc.register(child);
  }
  querySelectorAll() { return this.children.filter((c) => c.id.startsWith('fixed-reaction-')); }
  cloneNode() {
    const copy = new El(this.id);
    copy.attrs = { ...this.attrs };
    copy.children = this.children.map((c) => c.cloneNode());
    return copy;
  }
}

const doc = {
  elements: new Map(),
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new El(id));
    return this.elements.get(id);
  },
  register(el) {
    this.elements.set(el.id, el);
    el.children.forEach((c) => this.register(c));
  }
};

// Row 1 acts as the clone template with its five inputs.
const row1 = doc.getElementById('fixed-reaction-row-1');
['name', 'stock', 'final', 'volume', 'note'].forEach((field) => {
  row1.children.push(doc.getElementById(`fixed-reaction-${field}-1`));
});
const fixedRows = doc.getElementById('fixed-reaction-rows');
fixedRows.appendChild(doc.getElementById('fixed-reaction-solvent-row'));
doc.getElementById('fixed-reaction-add-row-btn');
doc.getElementById('fixed-reaction-fill-name');
doc.getElementById('fixed-reaction-total-volume');
for (let i = 2; i <= 6; i += 1) doc.getElementById(`fixed-reaction-row-${i}`).hidden = true;

initFixedReactionTool({ document: doc });

const addBtn = doc.getElementById('fixed-reaction-add-row-btn');
const click = () => addBtn.fire('click');

for (let i = 0; i < 5; i += 1) click(); // reveals rows 2..6
assert.equal(doc.getElementById('fixed-reaction-row-6').hidden, false);

click(); // must create row 7 rather than silently doing nothing
const row7 = doc.getElementById('fixed-reaction-row-7');
assert.equal(row7.hidden, false);
assert.deepEqual(
  fixedRows.children.map((child) => child.id),
  ['fixed-reaction-row-7', 'fixed-reaction-solvent-row'],
  'new reagents stay above the solvent row'
);
assert.ok(doc.elements.has('fixed-reaction-name-7'), 'row 7 inputs are registered');

click();
assert.equal(doc.getElementById('fixed-reaction-row-8').hidden, false);

// Values in a cloned row reach the calculation.
doc.getElementById('fixed-reaction-total-volume').value = '100 uL';
doc.getElementById('fixed-reaction-name-7').value = 'Carrier';
doc.getElementById('fixed-reaction-stock-7').value = '1 mg/mL';
doc.getElementById('fixed-reaction-final-7').value = '100 ng/uL';
const input7 = doc.getElementById('fixed-reaction-final-7');
input7.listeners.filter(([t]) => t === 'input').forEach(([, h]) => h());
assert.match(doc.getElementById('fixed-reaction-volume-7').placeholder, /10/);

const removeTarget = {
  closest(selector) {
    if (selector === '[data-fixed-reaction-row-remove]') return this;
    if (selector === '.tool-box-reaction-row') return row7;
    return null;
  }
};
fixedRows.fire('click', { target: removeTarget });
assert.equal(row7.hidden, true, 'removing a reagent hides its row');
assert.equal(doc.getElementById('fixed-reaction-name-7').value, '');

console.log('fixed-reaction-rows selfcheck OK');
