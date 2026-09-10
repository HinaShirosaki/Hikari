import {
  columnUnit,
  columnUnitFactor,
  rescaleCellValue,
  retitleColumnUnit
} from './table-units.js';

const DEFAULT_NOTEBOOK_TABLE_COLUMNS = 3;
const DEFAULT_NOTEBOOK_TABLE_ROWS = 3;
export const MAX_NOTEBOOK_TABLE_COLUMNS = 50;
export const MAX_NOTEBOOK_TABLE_ROWS = 500;
const MOLARITY_COLUMN_TITLES = ['Entry', 'MW (g/mol)', 'Weight (mg)', 'Volume (mL)', 'Molarity (mM)'];
const MOLARITY_ROW_COUNT = 4;

function sanitizeFieldName(value, fallback) {
  const clean = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || fallback;
}

function buildColumnTitle(index) {
  return `Column ${index + 1}`;
}

function buildFieldId(createId, prefix, index) {
  const created = typeof createId === 'function' ? createId() : `${prefix}_${index + 1}`;
  return sanitizeFieldName(`${prefix}_${created}`, `${prefix}_${index + 1}`);
}

function buildRow(columns, rowId) {
  const row = {
    id: String(rowId || '').trim() || `row_${Date.now()}`
  };
  columns.forEach((column) => {
    row[column.field] = '';
  });
  return row;
}

export function normalizeNotebookResultTable(rawTable) {
  const source = rawTable && typeof rawTable === 'object' ? rawTable : null;
  if (!source) {
    return null;
  }

  const columns = Array.isArray(source.columns)
    ? source.columns
      .map((column, index) => {
        const field = sanitizeFieldName(column?.field, '');
        if (!field) {
          return null;
        }
        return {
          field,
          title: String(column?.title || '').trim() || buildColumnTitle(index)
        };
      })
      .filter(Boolean)
    : [];

  if (!columns.length) {
    return null;
  }

  const rows = Array.isArray(source.rows)
    ? source.rows.map((rawRow, index) => {
      const sourceRow = rawRow && typeof rawRow === 'object' ? rawRow : {};
      const row = {
        id: String(sourceRow.id || '').trim() || `row_${index + 1}`
      };
      columns.forEach((column) => {
        row[column.field] = String(sourceRow[column.field] ?? '');
      });
      return row;
    })
    : [];

  // `solve` marks a table whose columns define one another (the molarity table), so a
  // loop between two empty ones means "not determined yet" rather than a mistake.
  if (!source.solve) {
    return { columns, rows };
  }
  // Solve tables used to keep their formula in every cell, which had to be typed over
  // to enter a value. The formula lives in solveTableCellFormula now, so a stored copy
  // of the generated one is dropped on the way in: the cell is a value or it is empty.
  rows.forEach((row, rowIndex) => {
    const generated = molarityRowFormulas(columns, rowIndex);
    columns.forEach((column, index) => {
      if (generated[index] && row[column.field] === generated[index]) {
        row[column.field] = '';
      }
    });
  });
  return { columns, rows, solve: true };
}

export function cloneNotebookResultTable(rawTable) {
  return normalizeNotebookResultTable(rawTable);
}

export function normalizeNotebookResultTables(rawTables, legacyTable = null) {
  const normalizedTables = Array.isArray(rawTables)
    ? rawTables.map((table) => normalizeNotebookResultTable(table)).filter(Boolean)
    : [];
  if (normalizedTables.length) {
    return normalizedTables;
  }

  const singleTable = normalizeNotebookResultTable(Array.isArray(rawTables) ? legacyTable : rawTables)
    || normalizeNotebookResultTable(legacyTable);
  return singleTable ? [singleTable] : [];
}

export function cloneNotebookResultTables(rawTables, legacyTable = null) {
  return normalizeNotebookResultTables(rawTables, legacyTable);
}

export function createDefaultNotebookResultTable(createId, {
  columnCount = DEFAULT_NOTEBOOK_TABLE_COLUMNS,
  rowCount = DEFAULT_NOTEBOOK_TABLE_ROWS
} = {}) {
  // Upper bounds because the size can be typed: every cell is a real DOM node, and a
  // stray extra digit would otherwise build a grid big enough to hang the renderer.
  const safeColumnCount = Math.min(MAX_NOTEBOOK_TABLE_COLUMNS,
    Math.max(1, Math.trunc(Number(columnCount)) || DEFAULT_NOTEBOOK_TABLE_COLUMNS));
  const safeRowCount = Math.min(MAX_NOTEBOOK_TABLE_ROWS,
    Math.max(1, Math.trunc(Number(rowCount)) || DEFAULT_NOTEBOOK_TABLE_ROWS));
  const columns = Array.from({ length: safeColumnCount }, (_unused, index) => ({
    field: buildFieldId(createId, 'column', index),
    title: buildColumnTitle(index)
  }));
  const rows = Array.from({ length: safeRowCount }, (_unused, index) => (
    buildRow(columns, buildFieldId(createId, 'row', index))
  ));
  return {
    columns,
    rows
  };
}

export function createNotebookResultTableFromPlaceholder(createId, {
  name = '',
  value = ''
} = {}) {
  const variableColumn = {
    field: buildFieldId(createId, 'variable', 0),
    title: 'Variable'
  };
  const valueColumn = {
    field: buildFieldId(createId, 'value', 1),
    title: 'Value'
  };
  const row = {
    id: buildFieldId(createId, 'row', 0),
    [variableColumn.field]: String(name ?? '').trim(),
    [valueColumn.field]: String(value ?? '').trim()
  };
  return {
    columns: [variableColumn, valueColumn],
    rows: [row]
  };
}

// The three unit factors of a molarity worksheet folded into the single constant its
// row formulas carry: weight/(MW x volume) is in mol/L, and K puts it back into the
// units the columns are actually kept in. For the default mg, mL and mM that is 1000.
function molarityUnitConstant(columns) {
  const weight = columnUnitFactor(columns?.[2]?.title, 1e-3);
  const volume = columnUnitFactor(columns?.[3]?.title, 1e-3);
  const molarity = columnUnitFactor(columns?.[4]?.title, 1e-3);
  return weight / (volume * molarity);
}

// One row of the worksheet: the same equation rearranged once per column, so any
// column can be the unknown. Exponents always carry their sign in JS ("1e+21"), which
// is what keeps translateFormulaReferences from reading the mantissa as a cell.
export function molarityRowFormulas(columns, rowIndex) {
  const line = rowIndex + 1;
  const k = String(Number(molarityUnitConstant(columns).toPrecision(12)));
  return [
    '',
    `=${k}*C${line}/(D${line}*E${line})`,
    `=B${line}*D${line}*E${line}/${k}`,
    `=${k}*C${line}/(B${line}*E${line})`,
    `=${k}*C${line}/(B${line}*D${line})`
  ];
}

// The formula a solve table's cell falls back to when nothing is typed in it. It is
// never stored in the cell, so a value goes straight into an empty editor and clearing
// it brings the computed value back -- the formula belongs to the table, not the cell.
export function solveTableCellFormula(table, columnIndex, rowIndex) {
  if (!table?.solve) {
    return '';
  }
  return molarityRowFormulas(table.columns, rowIndex)[columnIndex] || '';
}

// Molarity worksheet: one row is molarity = weight / (MW x volume), rearranged once per
// column so any column can be the unknown. Cells start empty and stay values-only; fill
// three and the fourth computes, fill two and the other two show the arithmetic left.
export function createMolarityNotebookResultTable(createId, rowCount = MOLARITY_ROW_COUNT) {
  const columns = MOLARITY_COLUMN_TITLES.map((title, index) => ({
    field: buildFieldId(createId, 'molarity', index),
    title
  }));
  const rows = Array.from({ length: rowCount }, (_unused, index) => (
    buildRow(columns, buildFieldId(createId, 'row', index))
  ));
  return { columns, rows, solve: true };
}

// Switching a column's unit re-expresses what is already in it rather than changing
// what the numbers mean: typed values are converted, and a solve table's formulas are
// derived from the column titles, so they follow the new constant on their own.
export function setNotebookResultTableColumnUnit(rawTable, columnIndex, unit) {
  const table = normalizeNotebookResultTable(rawTable);
  const column = table?.columns?.[columnIndex];
  const previous = columnUnit(column?.title);
  const next = previous ? columnUnit(`(${unit})`) : null;
  if (!next || next.dimension !== previous.dimension) {
    return table;
  }

  column.title = retitleColumnUnit(column.title, next.unit);
  const ratio = previous.factor / next.factor;
  table.rows.forEach((row) => {
    row[column.field] = rescaleCellValue(row[column.field], ratio);
  });
  return table;
}

export function addNotebookResultTableRow(rawTable, createId) {
  const table = normalizeNotebookResultTable(rawTable);
  if (!table) {
    return createDefaultNotebookResultTable(createId);
  }
  table.rows.push(buildRow(table.columns, buildFieldId(createId, 'row', table.rows.length)));
  return table;
}

export function addNotebookResultTableColumn(rawTable, createId) {
  const table = normalizeNotebookResultTable(rawTable);
  if (!table) {
    return createDefaultNotebookResultTable(createId);
  }
  const nextColumn = {
    field: buildFieldId(createId, 'column', table.columns.length),
    title: buildColumnTitle(table.columns.length)
  };
  table.columns.push(nextColumn);
  table.rows = table.rows.map((row) => ({
    ...row,
    [nextColumn.field]: ''
  }));
  return table;
}

export function summarizeNotebookResultTable(rawTable) {
  const table = normalizeNotebookResultTable(rawTable);
  if (!table) {
    return '';
  }
  const columnCount = table.columns.length;
  const rowCount = table.rows.length;
  return `${columnCount} column${columnCount === 1 ? '' : 's'} x ${rowCount} row${rowCount === 1 ? '' : 's'}`;
}

export function summarizeNotebookResultTables(rawTables, legacyTable = null) {
  const tables = normalizeNotebookResultTables(rawTables, legacyTable);
  if (!tables.length) {
    return '';
  }
  if (tables.length === 1) {
    return summarizeNotebookResultTable(tables[0]);
  }
  const parts = tables.map((table, index) => `Table ${index + 1}: ${summarizeNotebookResultTable(table)}`);
  return `${tables.length} tables (${parts.join('; ')})`;
}

export function flattenNotebookResultTableText(rawTable) {
  const table = normalizeNotebookResultTable(rawTable);
  if (!table) {
    return '';
  }
  const lines = notebookResultTableToLines(table);
  return lines.join(' ').trim();
}

export function flattenNotebookResultTablesText(rawTables, legacyTable = null) {
  return normalizeNotebookResultTables(rawTables, legacyTable)
    .map((table, index) => [
      `Table ${index + 1}`,
      flattenNotebookResultTableText(table)
    ].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function notebookResultTableToLines(rawTable) {
  const table = normalizeNotebookResultTable(rawTable);
  if (!table) {
    return [];
  }

  const headerLine = table.columns.map((column) => column.title).join(' | ').trim();
  const rowLines = table.rows.map((row) => (
    table.columns.map((column) => String(row[column.field] ?? '').trim()).join(' | ').trim()
  ));

  return [headerLine, ...rowLines].filter(Boolean);
}
