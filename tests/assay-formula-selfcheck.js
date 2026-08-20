#!/usr/bin/env node
// Self-check for the plate formula language: parsing, evaluation, and the errors it
// reports instead of producing wrong numbers.
// Run: node tests/assay-formula-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const { compileFormula, parseFormula } = loadEsmStyleModule(
  path.join(root, 'src/renderer/lib/formula.js')
);
const { applyPlateTransform } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/assay/derived-plate.js')
);

const DEF = { value: '24', label: '24 well', rows: 4, columns: 6 };

// Evaluate a formula with no plate references, so arithmetic can be checked directly.
function calc(text, value = 0) {
  const compiled = compileFormula(text);
  assert.equal(compiled.error, null, `expected "${text}" to parse: ${compiled.error?.message}`);
  return compiled.evaluate({ value, resolveRef: () => [] });
}

// --- arithmetic, precedence and associativity ---
assert.equal(calc('=1+2*3'), 7, 'multiplication binds tighter than addition');
assert.equal(calc('=(1+2)*3'), 9, 'parentheses win');
assert.equal(calc('=2^3^2'), 512, '^ is right-associative, as in Excel');
assert.equal(calc('=-2^2'), 4, 'unary minus applies to the base');
assert.equal(calc('=10/4'), 2.5, 'division');
assert.equal(calc('=1 - -3'), 4, 'unary minus after an operator');
assert.equal(calc('=1e3 / 2'), 500, 'exponent notation');
assert.equal(calc('=.5 * 4'), 2, 'leading-dot decimals');
assert.equal(calc('x * 2', 21), 42, 'the leading = is optional');
assert.equal(calc('=X + 1', 41), 42, 'x is case-insensitive');
assert.ok(!Number.isFinite(calc('=1/0')), 'divide by zero is not finite');

// --- scalar functions ---
assert.equal(calc('=LOG10(100)'), 2, 'LOG10');
assert.equal(calc('=LN(1)'), 0, 'LN');
assert.equal(calc('=SQRT(16)'), 4, 'SQRT');
assert.equal(calc('=ABS(0-7)'), 7, 'ABS');
assert.equal(calc('=POWER(2,10)'), 1024, 'POWER');
assert.equal(calc('=ROUND(3.14159, 2)'), 3.14, 'ROUND with digits');
assert.equal(calc('=ROUND(3.7)'), 4, 'ROUND defaults to whole numbers');
assert.equal(calc('=LOG(8, 2)'), 3, 'LOG with an explicit base');
assert.equal(calc('=mean(1,2,3)'), 2, 'function names are case-insensitive');
assert.ok(!Number.isFinite(calc('=LOG10(0)')), 'LOG10(0) is undefined, not an exception');
assert.ok(!Number.isFinite(calc('=SQRT(0-1)')), 'SQRT of a negative is undefined');

// --- aggregates over literal lists ---
assert.equal(calc('=MEAN(2,4,6)'), 4, 'MEAN');
assert.equal(calc('=MEDIAN(1,3,2)'), 2, 'MEDIAN of an odd count');
assert.equal(calc('=MEDIAN(1,2,3,4)'), 2.5, 'MEDIAN of an even count');
assert.equal(calc('=MIN(5,2,9)'), 2, 'MIN');
assert.equal(calc('=MAX(5,2,9)'), 9, 'MAX');
assert.equal(calc('=SUM(1,2,3,4)'), 10, 'SUM');
assert.equal(calc('=COUNT(1,2,3)'), 3, 'COUNT');
assert.equal(calc('=SD(2,4,4,4,5,5,7,9)'), 2.138089935299395, 'SD is the sample SD');
assert.equal(calc('=AVERAGE(1,2)'), 1.5, 'AVERAGE aliases MEAN');

// --- parse errors are located, not generic ---
const badCases = [
  ['', 'Formula is empty.'],
  ['=x +', 'Expected a number'],
  ['=(1+2', 'Expected a closing'],
  ['=ZORP(1)', 'Unknown function "ZORP"'],
  ['=1 $ 2', 'Unexpected character'],
  ['=1 2', 'Unexpected trailing input'],
  ['=ROUND(1,2,3)', 'ROUND() takes 1-2 argument(s)'],
  ['=SQRT()', 'SQRT() takes 1 argument(s)']
];
badCases.forEach(([text, fragment]) => {
  const compiled = compileFormula(text);
  assert.ok(compiled.error, `expected "${text}" to fail`);
  assert.ok(
    compiled.error.message.includes(fragment),
    `expected "${text}" to mention "${fragment}", got "${compiled.error.message}"`
  );
});
assert.equal(compileFormula('=x +').error.position, 4, 'the error carries a position');

// --- plate references, through the real transform ---
function plate(values) {
  const results = {};
  Object.entries(values).forEach(([well, value]) => { results[well] = String(value); });
  return results;
}
const RESULTS = plate({
  A1: 10, A2: 20, A3: 30,
  B1: 12, B2: 22, B3: 32,
  D1: 2, D2: 4
});

function transform(formula, results = RESULTS, options = {}) {
  return applyPlateTransform({
    results,
    spec: { mode: 'formula', formula },
    definition: DEF,
    ...options
  });
}

// blank subtraction and normalisation expressed as one formula
const normalized = transform('=(x - MEAN(D1:D2)) / MEAN(A1:A3) * 100');
assert.equal(normalized.numericResults.A1, 35, 'A1 = (10-3)/20*100');
assert.equal(normalized.numericResults.A3, 135, 'A3 = (30-3)/20*100');
assert.equal(normalized.warnings.length, 0, 'no warnings on a clean run');
assert.ok(normalized.steps[0].includes('Applied formula'), 'the step names the formula');

// a single well reference is a scalar
assert.equal(transform('=x - A1').numericResults.A2, 10, 'A2 - A1');
// a whole row by name
assert.equal(transform('=MEAN(A)').numericResults.A1, 20, 'MEAN of row A');
// a rectangular block spans rows and columns
assert.equal(transform('=MAX(A1:B3)').numericResults.A1, 32, 'MAX over a block');
assert.equal(transform('=COUNT(A1:B3)').numericResults.A1, 6, 'COUNT over a block');
// blocks are order-insensitive
assert.equal(transform('=MIN(B3:A1)').numericResults.A1, 10, 'a reversed block is the same block');

// custom groups resolve inside a formula
const grouped = transform('=x / MEAN(Blank)', RESULTS, {
  rowGroupSpec: 'Blank: D',
  columnGroupSpec: ''
});
assert.equal(grouped.numericResults.A1, 10 / 3, 'a group name works as a reference');

// aggregates read the RAW plate, so no well can see another well's transformed value
const stable = transform('=x - MIN(A1:A3)');
assert.equal(stable.numericResults.A1, 0, 'A1 - min(10,20,30)');
assert.equal(stable.numericResults.A3, 20, 'A3 - min(10,20,30), not min of already-shifted values');

// --- reference errors report once, not once per well ---
const badRef = transform('=x - MEAN(ZZ9)');
assert.equal(badRef.wellCount, 0, 'nothing is derived from an unresolvable reference');
assert.equal(badRef.warnings.length, 1, 'and it is reported exactly once');
assert.ok(badRef.warnings[0].includes('ZZ9'), 'naming the reference that failed');

const emptyRef = transform('=x / MEAN(C1:C3)');
assert.ok(emptyRef.warnings[0].includes('no numeric results'), 'a reference with no data says so');

// a multi-well reference used as a scalar explains the fix
const unreduced = transform('=x - A1:A3');
assert.ok(
  unreduced.warnings[0].includes('MEAN()'),
  'using a block as a scalar suggests an aggregate'
);

// wells the formula cannot define are dropped and counted
const dropped = transform('=LOG10(x - 10)');
assert.equal('A1' in dropped.numericResults, false, 'log10(0) is dropped');
assert.equal(dropped.numericResults.A2, 1, 'log10(10) survives');
assert.ok(dropped.steps[0].includes('dropped'), 'the step reports the drops');

// a syntax error yields no plate at all, with the message
const syntax = transform('=x +');
assert.equal(syntax.wellCount, 0, 'a broken formula derives nothing');
assert.ok(syntax.warnings[0].startsWith('Formula error:'), 'and is labelled as a formula error');

// --- the spec keeps both modes independently ---
const stepsStillWork = applyPlateTransform({
  results: RESULTS,
  spec: { mode: 'steps', blank: 'D1,D2', formula: '=x * 999' },
  definition: DEF
});
assert.equal(stepsStillWork.numericResults.A1, 7, 'steps mode ignores the stored formula');
assert.equal(
  applyPlateTransform({
    results: RESULTS,
    spec: { mode: 'formula', formula: '=x * 2', blank: 'D1,D2' },
    definition: DEF
  }).numericResults.A1,
  20,
  'formula mode ignores the stored steps'
);

// parseFormula throws where compileFormula reports
assert.throws(() => parseFormula('=('), /Expected/, 'parseFormula throws on bad input');

console.log('assay formula self-check passed');
