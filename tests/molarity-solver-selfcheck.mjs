// Self-check: the molarity solver fills whichever of mass/volume/concentration/Mw is left blank,
// and answers in the unit picked for that field.
import assert from 'node:assert/strict';
import { initMolarityTool } from '../src/renderer/modules/tool-box/molarity-ui.js';

class El {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.dataset = {};
    this.listeners = [];
  }
  addEventListener(type, handler) { this.listeners.push([type, handler]); }
  fire(type) { this.listeners.filter(([t]) => t === type).forEach(([, handler]) => handler({})); }
}

const doc = {
  elements: new Map(),
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new El(id));
    return this.elements.get(id);
  }
};

const form = doc.getElementById('molarity-solver-form');
const result = doc.getElementById('molarity-solver-result');
doc.getElementById('molarity-dilution-form');
doc.getElementById('dilution-calc-result');
const set = (id, value) => { doc.getElementById(id).value = value; };

set('molarity-mass-unit', 'mg');
set('molarity-volume-unit', 'mL');
set('molarity-concentration-unit', 'mM');
initMolarityTool({ document: doc });

assert.equal(result.dataset.state, 'empty', 'starts with a hint, not a number');

// 10 mM x 500 mL x 58.44 g/mol = 292.2 mg
set('molarity-concentration', '10');
set('molarity-volume', '500');
set('molarity-mw', '58.44');
form.fire('input');
assert.equal(result.textContent, 'Mass: 292.2 mg');
assert.equal(result.dataset.state, 'calculated');

// Same solve, answer follows the unit picked for the blank field.
set('molarity-mass-unit', 'g');
form.fire('change');
assert.equal(result.textContent, 'Mass: 0.2922 g');

// Blank the volume instead: 292.2 mg / (10 mM x 58.44) = 0.5 L
set('molarity-mass', '0.2922');
set('molarity-volume', '');
set('molarity-volume-unit', 'L');
form.fire('input');
assert.equal(result.textContent, 'Volume: 0.5 L');

// Blank the concentration: 0.2922 g / (0.5 L x 58.44) = 10 mM
set('molarity-volume', '0.5');
set('molarity-concentration', '');
form.fire('input');
assert.equal(result.textContent, 'Concentration: 10 mM');

// Blank the formula weight: 0.2922 g / (10 mM x 0.5 L) = 58.44 g/mol
set('molarity-concentration', '10');
set('molarity-mw', '');
form.fire('input');
assert.equal(result.textContent, 'Formula weight: 58.44 g/mol');

// Two blanks or none: guidance instead of a wrong number.
set('molarity-volume', '');
form.fire('input');
assert.equal(result.dataset.state, 'empty');
set('molarity-volume', '0.5');
set('molarity-mw', '58.44');
form.fire('input');
assert.equal(result.dataset.state, 'empty');

// A junk known value warns rather than printing NaN.
set('molarity-mw', '');
set('molarity-concentration', '0');
form.fire('input');
assert.equal(result.dataset.state, 'warning');

console.log('molarity-solver-selfcheck ok');
