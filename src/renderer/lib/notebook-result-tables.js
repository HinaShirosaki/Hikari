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
  return source.solve ? { columns, rows, solve: true } : { columns, rows };
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

// Molarity worksheet: one row is molarity = weight / (MW x volume), written out once
// per column so any column can be the unknown. Fill three and the fourth computes;
// fill two and the other two show the arithmetic that is left. Clearing a cell you
// typed over drops that column's formula for good -- drag the fill handle from a
// spare row to get it back.
export function createMolarityNotebookResultTable(createId, rowCount = MOLARITY_ROW_COUNT) {
  const columns = MOLARITY_COLUMN_TITLES.map((title, index) => ({
    field: buildFieldId(createId, 'molarity', index),
    title
  }));
  const rows = Array.from({ length: rowCount }, (_unused, index) => {
    // mg and mL against g/mol give mol/L, so the 1000 is what turns the answer into mM.
    const line = index + 1;
    const cells = [
      '',
      `=1000*C${line}/(D${line}*E${line})`,
      `=B${line}*D${line}*E${line}/1000`,
      `=1000*C${line}/(B${line}*E${line})`,
      `=1000*C${line}/(B${line}*D${line})`
    ];
    const row = { id: buildFieldId(createId, 'row', index) };
    columns.forEach((column, columnIndex) => {
      row[column.field] = cells[columnIndex];
    });
    return row;
  });
  return { columns, rows, solve: true };
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
