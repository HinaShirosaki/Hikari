#!/usr/bin/env node
// Self-check for the Assay derived plate: reference resolution and the fixed-order
// transform pipeline. No DOM needed.
// Run: node tests/assay-derived-plate-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const {
  applyPlateTransform,
  buildDerivedPlateTable,
  isTransformActive,
  normalizeTransformSpec,
  resolveReferenceWells
} = loadEsmStyleModule(path.join(root, 'src/renderer/modules/assay/derived-plate.js'));

// A small 4x6 plate keeps the fixtures readable.
const DEF = { value: '24', label: '24 well', rows: 4, columns: 6 };
const NO_GROUPS = { row: { groups: [] }, column: { groups: [] } };

// --- spec normalization ---
assert.equal(normalizeTransformSpec({ transform: 'bogus' }).transform, 'none', 'unknown transform falls back');
assert.equal(normalizeTransformSpec({ arithmeticOp: 'nope' }).arithmeticOp, 'none', 'unknown op falls back');
assert.equal(normalizeTransformSpec({ arithmeticValue: 'x' }).arithmeticValue, null, 'non-numeric operand drops');
assert.equal(normalizeTransformSpec({ blank: '  H1 ,  H2 ' }).blank, 'H1 , H2', 'reference whitespace collapses');
assert.equal(isTransformActive({}), false, 'an empty spec is inactive');
assert.equal(isTransformActive({ blank: 'H1' }), true, 'a blank reference activates it');
assert.equal(isTransformActive({ arithmeticOp: 'add' }), false, 'an op with no operand stays inactive');
assert.equal(isTransformActive({ arithmeticOp: 'add', arithmeticValue: 2 }), true, 'op plus operand activates it');

// --- reference grammar ---
assert.equal(resolveReferenceWells('A1', DEF, NO_GROUPS).wells.join('|'), 'A1', 'a single well');
assert.equal(resolveReferenceWells('A1,B2', DEF, NO_GROUPS).wells.join('|'), 'A1|B2', 'a well list');
assert.equal(resolveReferenceWells('A', DEF, NO_GROUPS).wells.length, 6, 'a whole row is every column');
assert.equal(resolveReferenceWells('3', DEF, NO_GROUPS).wells.length, 4, 'a whole column is every row');
assert.equal(resolveReferenceWells('A-B', DEF, NO_GROUPS).wells.length, 12, 'a row range');
assert.equal(resolveReferenceWells('2-3', DEF, NO_GROUPS).wells.length, 8, 'a column range');
assert.equal(resolveReferenceWells('a1', DEF, NO_GROUPS).wells.join('|'), 'A1', 'references are case-insensitive');
assert.equal(resolveReferenceWells('A1,A1', DEF, NO_GROUPS).wells.length, 1, 'duplicates collapse');
assert.equal(resolveReferenceWells('Z9', DEF, NO_GROUPS).unresolved.join('|'), 'Z9', 'off-plate wells are reported');
assert.equal(resolveReferenceWells('Nope', DEF, NO_GROUPS).unresolved.join('|'), 'Nope', 'unknown names are reported');

// custom group names resolve, but plate coordinates win over a same-named group
const GROUPS = {
  row: { groups: [{ label: 'Blank', members: ['D'] }, { label: 'A', members: ['C'] }] },
  column: { groups: [{ label: 'Untreated', members: ['6'] }] }
};
assert.equal(resolveReferenceWells('Blank', DEF, GROUPS).wells.join('|'), 'D1|D2|D3|D4|D5|D6', 'a row group resolves');
assert.equal(resolveReferenceWells('Untreated', DEF, GROUPS).wells.join('|'), 'A6|B6|C6|D6', 'a column group resolves');
assert.equal(resolveReferenceWells('A', DEF, GROUPS).wells[0], 'A1', 'row A beats a group named "A"');

// A group name can be well-shaped. Real wells still win; anything off-plate falls
// through to the group table instead of being rejected outright.
const WELL_SHAPED_GROUPS = {
  row: { groups: [{ label: 'Ctrl1', members: ['C'] }, { label: 'A1', members: ['D'] }] },
  column: { groups: [] }
};
assert.equal(
  resolveReferenceWells('Ctrl1', DEF, WELL_SHAPED_GROUPS).wells.join('|'),
  'C1|C2|C3|C4|C5|C6',
  'a group whose name ends in a digit still resolves'
);
assert.equal(resolveReferenceWells('Ctrl1', DEF, WELL_SHAPED_GROUPS).unresolved.length, 0, 'and does not warn');
assert.equal(
  resolveReferenceWells('A1', DEF, WELL_SHAPED_GROUPS).wells.join('|'),
  'A1',
  'a real well beats a group with the same name'
);
assert.equal(
  resolveReferenceWells('Z9', DEF, WELL_SHAPED_GROUPS).unresolved.join('|'),
  'Z9',
  'and a true miss still warns'
);

function plate(values) {
  const results = {};
  Object.entries(values).forEach(([well, value]) => { results[well] = String(value); });
  return results;
}

// --- blank subtraction ---
const blanked = applyPlateTransform({
  results: plate({ A1: 10, A2: 20, D1: 2, D2: 4 }),
  spec: { blank: 'D1,D2' },
  definition: DEF
});
assert.equal(blanked.numericResults.A1, 7, 'blank mean (3) subtracted from A1');
assert.equal(blanked.numericResults.A2, 17, 'blank mean subtracted from A2');
assert.equal(blanked.numericResults.D1, -1, 'the blank wells are transformed too');
assert.equal(blanked.steps.length, 1, 'one step described');
assert.ok(blanked.steps[0].includes('mean 3'), 'the step states the blank mean it used');

// non-numeric cells are dropped before any maths
const withText = applyPlateTransform({
  results: plate({ A1: 10, A2: 'n/a', A3: 20 }),
  spec: { arithmeticOp: 'multiply', arithmeticValue: 2 },
  definition: DEF
});
assert.equal(withText.wellCount, 2, 'non-numeric wells are excluded');
assert.equal(withText.numericResults.A1, 20, 'numeric wells still multiply');

// --- normalisation ---
const normalized = applyPlateTransform({
  results: plate({ A1: 5, A2: 10, A3: 15 }),
  spec: { normalizeHundred: 'A3', normalizeZero: 'A1' },
  definition: DEF
});
assert.equal(normalized.numericResults.A1, 0, '0% reference lands on 0');
assert.equal(normalized.numericResults.A3, 100, '100% reference lands on 100');
assert.equal(normalized.numericResults.A2, 50, 'a midpoint lands on 50');

const normalizedNoZero = applyPlateTransform({
  results: plate({ A1: 25, A2: 50 }),
  spec: { normalizeHundred: 'A2' },
  definition: DEF
});
assert.equal(normalizedNoZero.numericResults.A1, 50, 'without a 0% reference, zero is 0');

const flatReference = applyPlateTransform({
  results: plate({ A1: 5, A2: 5 }),
  spec: { normalizeHundred: 'A1', normalizeZero: 'A2' },
  definition: DEF
});
assert.equal(flatReference.numericResults.A1, 5, 'identical references leave values untouched');
assert.ok(
  flatReference.warnings.some((note) => note.includes('same mean')),
  'and say why normalisation was skipped'
);

// --- arithmetic ---
assert.equal(
  applyPlateTransform({ results: plate({ A1: 8 }), spec: { arithmeticOp: 'divide', arithmeticValue: 4 }, definition: DEF })
    .numericResults.A1,
  2,
  'divide by a constant'
);
const divideByZero = applyPlateTransform({
  results: plate({ A1: 8 }),
  spec: { arithmeticOp: 'divide', arithmeticValue: 0 },
  definition: DEF
});
assert.equal(divideByZero.numericResults.A1, 8, 'divide by zero leaves the value alone');
assert.ok(divideByZero.warnings.some((note) => note.includes('zero')), 'and warns');

// --- value transforms drop the wells they cannot define ---
const logged = applyPlateTransform({
  results: plate({ A1: 100, A2: 0, A3: -5 }),
  spec: { transform: 'log10' },
  definition: DEF
});
assert.equal(logged.numericResults.A1, 2, 'log10(100) is 2');
assert.equal('A2' in logged.numericResults, false, 'log10(0) is dropped');
assert.equal('A3' in logged.numericResults, false, 'log10 of a negative is dropped');
assert.ok(logged.steps[0].includes('2 well(s) dropped'), 'the step reports the drops');
assert.equal(
  applyPlateTransform({ results: plate({ A1: 4 }), spec: { transform: 'sqrt' }, definition: DEF }).numericResults.A1,
  2,
  'sqrt'
);
assert.equal(
  applyPlateTransform({ results: plate({ A1: 4 }), spec: { transform: 'reciprocal' }, definition: DEF }).numericResults.A1,
  0.25,
  'reciprocal'
);
assert.equal(
  applyPlateTransform({ results: plate({ A1: 3 }), spec: { transform: 'square' }, definition: DEF }).numericResults.A1,
  9,
  'square'
);

// --- the fixed order: blank first, then normalise, then arithmetic, then transform ---
const chained = applyPlateTransform({
  results: plate({ A1: 12, A2: 2, A3: 22 }),
  spec: {
    blank: 'A2',              // -> A1 10, A2 0, A3 20
    normalizeHundred: 'A3',   // -> A1 50, A2 0, A3 100
    arithmeticOp: 'divide',
    arithmeticValue: 50,      // -> A1 1,  A2 0, A3 2
    transform: 'square'       // -> A1 1,  A2 0, A3 4
  },
  definition: DEF
});
assert.equal(chained.numericResults.A1, 1, 'A1 through all four steps');
assert.equal(chained.numericResults.A3, 4, 'A3 through all four steps');
assert.equal(chained.steps.length, 4, 'all four steps described in order');
assert.ok(chained.steps[0].startsWith('Subtracted blank'), 'blank subtraction runs first');
assert.ok(chained.steps[3].startsWith('Applied'), 'the value transform runs last');

// --- an unresolvable reference warns instead of silently doing nothing ---
const badReference = applyPlateTransform({
  results: plate({ A1: 10 }),
  spec: { blank: 'ZZ9' },
  definition: DEF
});
assert.equal(badReference.numericResults.A1, 10, 'values are untouched when the blank cannot resolve');
assert.ok(badReference.warnings.length, 'and it warns');
assert.equal(badReference.steps.length, 0, 'no step is claimed');

// --- rendered table shape ---
const html = buildDerivedPlateTable({ A1: '1.5', B2: '2.5' }, DEF);
assert.equal((html.match(/<tr>/g) || []).length, 5, 'one header row plus four plate rows');
assert.ok(html.includes('>1.5<'), 'derived values are rendered');
assert.ok(html.includes('assay-derived-plate-table'), 'carries its styling hook');

// --- an empty operand box is not the number zero ---
// The operand arrives as a raw DOM string, and Number('') is 0, so an empty box used
// to mark the transform active and multiply the whole plate down to zero.
assert.equal(normalizeTransformSpec({ arithmeticValue: '' }).arithmeticValue, null, 'an empty operand drops');
assert.equal(normalizeTransformSpec({ arithmeticValue: '   ' }).arithmeticValue, null, 'whitespace drops too');
assert.equal(normalizeTransformSpec({ arithmeticValue: '0' }).arithmeticValue, 0, 'but a typed zero survives');
assert.equal(
  isTransformActive({ arithmeticOp: 'multiply', arithmeticValue: '' }),
  false,
  'multiply with an empty box is not an active transform'
);
const emptyOperand = applyPlateTransform({
  results: plate({ A1: 1.5, A2: 2.5 }),
  spec: { arithmeticOp: 'multiply', arithmeticValue: '' },
  definition: DEF
});
assert.equal(emptyOperand.numericResults.A1, 1.5, 'the plate is untouched');
assert.equal(emptyOperand.steps.length, 0, 'and no step is claimed');

// --- a 0% reference with no 100% reference warns instead of vanishing ---
assert.equal(isTransformActive({ normalizeZero: 'A1' }), true, 'a lone 0% reference counts as active');
const zeroOnly = applyPlateTransform({
  results: plate({ A1: 10, A2: 20 }),
  spec: { normalizeZero: 'A1' },
  definition: DEF
});
assert.equal(zeroOnly.numericResults.A2, 20, 'values are untouched');
assert.equal(zeroOnly.steps.length, 0, 'no step is claimed');
assert.ok(zeroOnly.warnings.some((text) => text.includes('100%')), 'and it says what is missing');

console.log('assay derived-plate self-check passed');
