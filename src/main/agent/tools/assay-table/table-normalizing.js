'use strict';

const { asArray, cloneJson, ensureObject } = require('../../../lib/normalize.js');
const { MAX_CELL_LENGTH, MAX_COLUMNS, MAX_NAME_LENGTH, MAX_PREVIEW_ROWS, MAX_ROWS, MAX_SOURCE_LENGTH } = require('./constants.js');

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function normalizeCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '';
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.slice(0, MAX_CELL_LENGTH);
  }
  return JSON.stringify(value).slice(0, MAX_CELL_LENGTH);
}

function normalizeColumnName(value, fallback = '') {
  const source = ensureObject(value);
  return cleanText(
    typeof value === 'string'
      ? value
      : (source.name || source.key || source.id || source.field || source.title),
    120
  ) || fallback;
}

function uniqueColumnNames(values = []) {
  const seen = new Map();
  return asArray(values)
    .map((value, index) => normalizeColumnName(value, `c${index + 1}`))
    .filter(Boolean)
    .map((name) => {
      const key = name.toLowerCase();
      const count = Number(seen.get(key) || 0) + 1;
      seen.set(key, count);
      return count === 1 ? name : `${name}_${count}`;
    })
    .slice(0, MAX_COLUMNS);
}

function inferColumnsFromRows(rows = []) {
  const columns = [];
  const seen = new Set();
  asArray(rows).forEach((row) => {
    if (Array.isArray(row)) {
      row.forEach((_value, index) => {
        const name = `c${index + 1}`;
        if (!seen.has(name)) {
          seen.add(name);
          columns.push(name);
        }
      });
      return;
    }
    Object.keys(ensureObject(row)).forEach((key) => {
      const name = normalizeColumnName(key);
      const dedupeKey = name.toLowerCase();
      if (!name || seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      columns.push(name);
    });
  });
  return columns.slice(0, MAX_COLUMNS);
}

function normalizeRows(rows = [], columns = []) {
  const resolvedColumns = uniqueColumnNames(columns.length ? columns : inferColumnsFromRows(rows));
  const normalizedRows = asArray(rows).slice(0, MAX_ROWS).map((row) => {
    const out = {};
    if (Array.isArray(row)) {
      resolvedColumns.forEach((column, index) => {
        out[column] = normalizeCell(row[index]);
      });
      return out;
    }
    const source = ensureObject(row);
    resolvedColumns.forEach((column) => {
      out[column] = normalizeCell(source[column]);
    });
    return out;
  });
  return {
    columns: resolvedColumns,
    rows: normalizedRows
  };
}

function serializeTable(table = {}, options = {}) {
  const maxRows = Math.max(1, Math.min(MAX_PREVIEW_ROWS, Number(options.maxRows) || MAX_PREVIEW_ROWS));
  const includeRows = options.includeRows !== false;
  const rows = asArray(table.rows);
  return {
    id: cleanText(table.id, 40),
    name: cleanText(table.name, MAX_NAME_LENGTH),
    source: cleanText(table.source, MAX_SOURCE_LENGTH),
    columns: asArray(table.columns).map((column) => cleanText(column, 120)).filter(Boolean),
    row_count: rows.length,
    column_count: asArray(table.columns).length,
    created_at: cleanText(table.created_at, 80),
    updated_at: cleanText(table.updated_at, 80),
    ...(includeRows ? { rows: cloneJson(rows.slice(0, maxRows), []) } : {}),
    preview_truncated: includeRows ? rows.length > maxRows : undefined
  };
}

module.exports = {
  cleanText,
  normalizeCell,
  normalizeColumnName,
  normalizeRows,
  serializeTable,
  uniqueColumnNames
};
