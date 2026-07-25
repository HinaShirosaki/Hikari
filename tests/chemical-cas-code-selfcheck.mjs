import assert from 'node:assert/strict';
import {
  CAS_CODE_MIN,
  casCodeNumber,
  installLocationCodeHelpers
} from '../src/renderer/modules/lab-common-inventory/location-codes.js';

// Deterministic: the whole point is that two people adding the same chemical
// on different machines land on the same code.
assert.equal(casCodeNumber('7732-18-5'), casCodeNumber('7732-18-5'));
assert.equal(casCodeNumber('7732-18-5'), casCodeNumber(' 7732 18 5 '));
assert.notEqual(casCodeNumber('7732-18-5'), casCodeNumber('64-17-5'));
assert.equal(casCodeNumber(''), 0);
for (const cas of ['50-00-0', '7732-18-5', '64-17-5', '1310-73-2']) {
  const code = casCodeNumber(cas);
  assert.ok(code >= CAS_CODE_MIN && code <= 999999, `${cas} -> ${code} out of range`);
}

const state = {
  labInventory: {
    chemicals: [],
    locationCodeMap: {},
    locationCodeNextByLocation: {},
    lastLocationNumber: 0
  }
};
const ctx = { state, ensureLabInventoryShape() {} };
installLocationCodeHelpers(ctx);

// Same CAS + same location -> same code, regardless of what the other person typed.
const water = ctx.assignLocationCode('Shelf A', '', '7732-18-5');
assert.equal(water, ctx.assignLocationCode('Shelf A', 'A7', '7732-18-5'));
assert.equal(water, `A${casCodeNumber('7732-18-5')}`);

// Letter still follows the location.
const waterElsewhere = ctx.assignLocationCode('Fridge', '', '7732-18-5');
assert.equal(waterElsewhere, `B${casCodeNumber('7732-18-5')}`);

// No CAS -> legacy sequential numbering, untouched by the 6-digit CAS codes.
state.labInventory.chemicals = [{ location: 'Shelf A', locationCode: water }];
assert.equal(ctx.assignLocationCode('Shelf A', '', ''), 'A1');

// Existing records migrate to CAS codes on the next render pass.
state.labInventory.chemicals = [
  { location: 'Shelf A', locationCode: 'A3', casNumber: '7732-18-5' },
  { location: 'Shelf A', locationCode: 'A4', casNumber: '7732-18-5' }
];
assert.equal(ctx.ensureChemicalCodes(), true);
const [first, second] = state.labInventory.chemicals;
assert.equal(first.locationCode, water);
assert.equal(second.locationCode, water);

console.log('chemical-cas-code selfcheck ok');
