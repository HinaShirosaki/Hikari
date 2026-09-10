// Self-check: the buffer preparer table is not capped at 6 ingredients.
import assert from 'node:assert/strict';
import { initBufferTool } from '../src/renderer/modules/tool-box/buffer-ui.js';

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
    this.listeners = [];
  }
  addEventListener(type, handler) { this.listeners.push([type, handler]); }
  fire(type, event = {}) { this.listeners.filter(([t]) => t === type).forEach(([, h]) => h(event)); }
  getAttribute(name) { return this.attrs[name] ?? null; }
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
  querySelectorAll() { return this.children.filter((child) => child.id); }
  cloneNode() {
    const copy = new El(this.id);
    copy.attrs = { ...this.attrs };
    copy.dataset = { ...this.dataset };
    copy.hidden = this.hidden;
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

const row1 = doc.getElementById('buffer-row-1');
['name', 'mw', 'stock', 'final', 'amount', 'note', 'suggestions'].forEach((field) => {
  row1.children.push(doc.getElementById(`buffer-${field}-1`));
});
doc.getElementById('buffer-name-1').setAttribute('aria-controls', 'buffer-suggestions-1');
doc.getElementById('buffer-name-1').setAttribute('aria-label', 'Ingredient 1 chemical');
doc.getElementById('buffer-name-1').dataset.bufferChemicalIndex = '1';
doc.getElementById('buffer-suggestions-1').hidden = true;
const bufferRows = doc.getElementById('buffer-rows');
bufferRows.appendChild(doc.getElementById('buffer-add-row'));
bufferRows.appendChild(doc.getElementById('buffer-adjustment-row'));
doc.getElementById('buffer-volume-ml');
doc.getElementById('buffer-volume-unit').value = 'mL';
doc.getElementById('buffer-total-result');
const addBtn = doc.getElementById('add-buffer-chemical-btn');
for (let i = 3; i <= 6; i += 1) doc.getElementById(`buffer-row-${i}`).hidden = true;

initBufferTool({ document: doc, getStoredCompounds: () => [] });

const click = () => addBtn.fire('click');
for (let i = 0; i < 4; i += 1) click(); // reveals rows 3..6
assert.equal(doc.getElementById('buffer-row-6').hidden, false);

click(); // must create row 7, not silently no-op
const row7 = doc.getElementById('buffer-row-7');
assert.equal(row7.hidden, false);
assert.deepEqual(
  bufferRows.children.map((child) => child.id),
  ['buffer-row-7', 'buffer-add-row', 'buffer-adjustment-row'],
  'new ingredients land above the add-ingredient row and the adjustment row'
);
assert.equal(doc.getElementById('buffer-name-7').getAttribute('aria-controls'), 'buffer-suggestions-7');
assert.equal(doc.getElementById('buffer-name-7').getAttribute('aria-label'), 'Ingredient 7 chemical');
assert.equal(doc.getElementById('buffer-name-7').dataset.bufferChemicalIndex, '7');
assert.equal(doc.getElementById('buffer-suggestions-7').hidden, true, 'cloned suggestion menu starts closed');

// Values in a cloned row reach the recipe calculation.
doc.getElementById('buffer-volume-ml').value = '1000';
doc.getElementById('buffer-name-7').value = 'NaCl';
doc.getElementById('buffer-mw-7').value = '58.44';
doc.getElementById('buffer-final-7').value = '150 mM';
doc.getElementById('buffer-final-7').fire('input');
assert.match(doc.getElementById('buffer-amount-7').placeholder, /\d/);

const bufferRemoveTarget = {
  closest(selector) {
    if (selector === '[data-buffer-row-remove]') return this;
    if (selector === '.tool-box-buffer-row') return row7;
    return null;
  }
};
bufferRows.fire('click', { target: bufferRemoveTarget });
assert.equal(row7.hidden, true, 'removing an ingredient hides its row');
assert.equal(doc.getElementById('buffer-name-7').value, '');

console.log('buffer-rows selfcheck OK');
