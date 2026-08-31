'use strict';

const { asArray, ensureObject } = require('../../../lib/normalize.js');
const { MAX_COLUMNS } = require('./constants.js');
const { cleanText, normalizeCell, normalizeColumnName, uniqueColumnNames } = require('./table-normalizing.js');

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveOperand(row = {}, operand) {
  if (typeof operand === 'number') {
    return Number.isFinite(operand) ? operand : null;
  }
  if (typeof operand === 'string') {
    if (Object.prototype.hasOwnProperty.call(row, operand)) {
      return toNumber(row[operand]);
    }
    return toNumber(operand);
  }
  const source = ensureObject(operand);
  if (Object.prototype.hasOwnProperty.call(source, 'value')) {
    return toNumber(source.value);
  }
  const column = normalizeColumnName(source.column || source.field || source.source);
  if (column) {
    return toNumber(row[column]);
  }
  return null;
}

function compactNumbers(values = []) {
  return asArray(values).map(toNumber).filter((value) => Number.isFinite(value));
}

function standardDeviation(values = []) {
  const numbers = compactNumbers(values);
  if (numbers.length < 2) {
    return 0;
  }
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (numbers.length - 1);
  return Math.sqrt(variance);
}

function median(values = []) {
  const numbers = compactNumbers(values).sort((left, right) => left - right);
  if (!numbers.length) {
    return '';
  }
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 0 ? (numbers[middle - 1] + numbers[middle]) / 2 : numbers[middle];
}

function applyOperation(operation = '', values = []) {
  const op = cleanText(operation, 40).toLowerCase();
  const numbers = compactNumbers(values);
  if (op === 'copy') {
    return values[0] ?? '';
  }
  if (op === 'add' || op === 'sum' || op === '+') {
    return numbers.reduce((sum, value) => sum + value, 0);
  }
  if (op === 'subtract' || op === 'sub' || op === '-') {
    return numbers.length ? numbers.slice(1).reduce((out, value) => out - value, numbers[0]) : '';
  }
  if (op === 'multiply' || op === 'mul' || op === '*') {
    return numbers.reduce((out, value) => out * value, numbers.length ? 1 : 0);
  }
  if (op === 'divide' || op === 'div' || op === '/') {
    if (numbers.length < 2 || numbers.slice(1).some((value) => value === 0)) {
      return '';
    }
    return numbers.slice(1).reduce((out, value) => out / value, numbers[0]);
  }
  if (op === 'max') {
    return numbers.length ? Math.max(...numbers) : '';
  }
  if (op === 'min') {
    return numbers.length ? Math.min(...numbers) : '';
  }
  if (op === 'avg' || op === 'average' || op === 'mean') {
    return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : '';
  }
  if (op === 'sd' || op === 'stdev' || op === 'stddev') {
    return standardDeviation(numbers);
  }
  if (op === 'count' || op === 'n') {
    return numbers.length;
  }
  if (op === 'median') {
    return median(numbers);
  }
  if (op === 'pow' || op === 'power') {
    return numbers.length >= 2 ? numbers[0] ** numbers[1] : '';
  }
  if (op === 'log10') {
    return numbers.length && numbers[0] > 0 ? Math.log10(numbers[0]) : '';
  }
  if (op === 'ln' || op === 'log') {
    return numbers.length && numbers[0] > 0 ? Math.log(numbers[0]) : '';
  }
  return '';
}

function valuesForColumn(rows = [], column = '') {
  const key = normalizeColumnName(column);
  return asArray(rows).map((row) => ensureObject(row)[key]);
}

function buildColumnValue({ columnSpec = {}, row = {}, groupRows = [], allRows = [] } = {}) {
  const source = ensureObject(columnSpec);
  const operation = cleanText(source.operation || source.op || source.fn || source.function, 40).toLowerCase();
  const sourceColumn = normalizeColumnName(source.source || source.column || source.field || source.from);
  if (!operation || operation === 'copy') {
    return sourceColumn ? normalizeCell(row[sourceColumn]) : '';
  }
  const aggregateRows = source.scope === 'table'
    ? allRows
    : (groupRows.length ? groupRows : []);
  if (aggregateRows.length && sourceColumn) {
    return normalizeCell(applyOperation(operation, valuesForColumn(aggregateRows, sourceColumn)));
  }
  const operands = asArray(source.operands || source.args || source.values);
  const resolved = operands.length
    ? operands.map((operand) => resolveOperand(row, operand))
    : (sourceColumn ? [resolveOperand(row, sourceColumn)] : []);
  return normalizeCell(applyOperation(operation, resolved));
}

function normalizeCalculationColumns(value = []) {
  return asArray(value).map((entry, index) => {
    const source = ensureObject(entry);
    const name = normalizeColumnName(source.name || source.key || source.id, `calculation_${index + 1}`);
    return {
      ...source,
      name
    };
  }).filter((entry) => entry.name).slice(0, MAX_COLUMNS);
}

function groupRows(rows = [], groupBy = []) {
  const groupColumns = uniqueColumnNames(groupBy);
  if (!groupColumns.length) {
    return [{ key: 'all', rows: asArray(rows), values: {} }];
  }
  const groups = new Map();
  asArray(rows).forEach((row) => {
    const values = {};
    groupColumns.forEach((column) => {
      values[column] = normalizeCell(row[column]);
    });
    const key = JSON.stringify(values);
    if (!groups.has(key)) {
      groups.set(key, { key, rows: [], values });
    }
    groups.get(key).rows.push(row);
  });
  return [...groups.values()];
}

module.exports = {
  applyOperation,
  buildColumnValue,
  groupRows,
  normalizeCalculationColumns
};
