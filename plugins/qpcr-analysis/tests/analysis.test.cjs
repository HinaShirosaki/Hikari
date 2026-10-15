const { test } = require('node:test');
const assert = require('node:assert/strict');
const math = require('../analysis.js');

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const expressionData = 'Sample\tGroup\tTarget Ct\tReference Ct\nc1\tControl\t24,25,26\t20\nc2\tControl\t27\t20\nt1\tTreated\t20\t16';
const standardData = 'Quantity\tCt\n1\t30\n10\t26\n100\t23';

test('normalizes biological samples to the mean calibrator delta Ct with the correct sign', () => {
  const result = math.expression(expressionData, 'Control');
  assert.equal(result.calibratorDeltaCt, 6);
  assert.equal(result.controlN, 2);
  assert.equal(result.samples[2].deltaCt, 4);
  assert.equal(result.samples[2].deltaDeltaCt, -2);
  assert.equal(result.samples[2].log2Fold, 2);
  assert.equal(result.samples[2].fold, 4);
  assert.equal(result.samples[0].target.n, 3);
  assert.equal(result.samples[0].target.sd, 1);
  assert.equal(result.samples[0].reference.sd, null);
});

test('technical wells never inflate biological n and group folds use geometric means', () => {
  const result = math.expression(expressionData, 'Control');
  const control = result.groups[0];
  assert.equal(control.n, 2);
  close(control.deltaCtSd, Math.sqrt(2));
  assert.equal(control.geometricFold, 1);
  assert.equal((result.samples[0].fold + result.samples[1].fold) / 2, 1.25);
});

test('averages target and reference wells independently without inventing paired wells', () => {
  const result = math.expression('c\tC\t25,27\t20,21,22\nt\tT\t25\t21', 'C');
  assert.equal(result.samples[0].deltaCt, 5);
  assert.equal(result.samples[1].fold, 2);
});

test('parses optional headers, CRLF, BOM, semicolons and scientific notation', () => {
  const result = math.expression('\uFEFFsample\tgroup\ttarget_ct\treference_ct\r\nc\tC\t2.5e1; 25\t20\r\n', 'C');
  assert.equal(result.samples[0].fold, 1);
});

test('rejects repeated sample identities and missing calibrators', () => {
  assert.throws(() => math.expression('s\tC\t20\t18\nS\tT\t22\t18', 'C'), /repeated/);
  assert.throws(() => math.expression(expressionData, 'control'), /does not match/);
  assert.throws(() => math.expression(expressionData, ''), /Choose a calibrator/);
});

test('never coerces blank, undetermined, zero, malformed or non-finite Ct wells to a number', () => {
  for (const value of ['', 'Undetermined', '20, Undetermined', 'NA', 'NaN', 'Infinity', '0', '-2', '20junk', '0x14', '20,,21', '20, ,21', '20,']) {
    assert.throws(() => math.ctReplicates(value, 'test'), Error, value);
  }
});

test('rejects missing columns, unsupported CSV, excessive data and numeric overflow', () => {
  for (const value of ['s\tC\t20', 's,C,20,18', 's\tC\t20\t', '']) assert.throws(() => math.expression(value, 'C'), Error);
  assert.throws(() => math.expression('x'.repeat(60001), 'C'), /60,000/);
  assert.throws(() => math.expression('c\tC\t1\t1\nt\tT\t2000\t1', 'C'), /numeric range/);
});

test('OLS fits Ct on log10 quantity and calculates slope, intercept and R squared', () => {
  const curve = math.standardCurve(standardData);
  close(curve.slope, -3.5);
  close(curve.intercept, 29.833333333333332);
  close(curve.rSquared, 0.9932432432432432);
  close(curve.efficiency, (10 ** (1 / 3.5) - 1) * 100);
  close(curve.points.reduce((sum, point) => sum + point.residual, 0), 0);
});

test('an ideal doubling series returns 100 percent efficiency', () => {
  const slope = -1 / Math.log10(2);
  const curve = math.standardCurve([1, 10, 100, 1000].map(quantity => `${quantity}\t${35 + slope * Math.log10(quantity)}`).join('\n'));
  close(curve.efficiency, 100);
  close(curve.rSquared, 1);
});

test('weights each standard mean equally regardless of technical well count', () => {
  const curve = math.standardCurve('100\t23,23,23,23\n1\t30,30\n10\t26');
  close(curve.slope, -3.5);
  assert.equal(curve.points[0].quantity, 1);
});

test('rejects degenerate, increasing and invalid standard curves', () => {
  for (const value of ['1\t30\n10\t27', '1\t30\n1\t27\n10\t24', '1\t20\n10\t21\n100\t22', '1\t20\n10\t20\n100\t20', '0\t30\n10\t27\n100\t24']) assert.throws(() => math.standardCurve(value), Error);
});

test('notebook tables retain technical values and use documented string cells and identifier fields', () => {
  for (const result of [math.expression(expressionData, 'Control'), math.standardCurve(standardData)]) {
    const table = math.resultTable(result);
    assert.ok(table.columns.every(column => /^[A-Za-z_][A-Za-z0-9_]*$/.test(column.field)));
    assert.ok(table.rows.every(row => row.id && table.columns.every(column => typeof row[column.field] === 'string')));
  }
  assert.equal(math.resultTable(math.expression(expressionData, 'Control')).rows[0].target_ct_values, '24, 25, 26');
});

test('TSV export protects text from spreadsheet formula execution while preserving numbers', () => {
  const table = { columns: [{ field: 'sample', title: 'Sample' }, { field: 'number', title: 'Number' }], rows: [{ sample: '=HYPERLINK("x")', number: '-2.5' }] };
  assert.equal(math.toTsv(table), 'Sample\tNumber\n\'=HYPERLINK("x")\t-2.5\n');
});
