'use strict';

const { asArray, cloneJson, ensureObject } = require('../../lib/normalize.js');

const ASSAY_TABLE_ACTIONS = Object.freeze([
  'create',
  'read',
  'list',
  'derive',
  'add_column',
  'python',
  'delete',
  'clear'
]);

const MAX_NAME_LENGTH = 160;
const MAX_SOURCE_LENGTH = 1200;
const MAX_COLUMNS = 200;
const MAX_ROWS = 5000;
const MAX_CELL_LENGTH = 4000;
const MAX_PREVIEW_ROWS = 50;

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

function createAgentAssayTableRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const runPythonSandbox = typeof deps.runPythonSandbox === 'function' ? deps.runPythonSandbox : null;
  const getSandboxRoot = typeof deps.getSandboxRoot === 'function' ? deps.getSandboxRoot : (() => cleanText(deps.sandboxRoot, 1200));
  const tables = new Map();
  let nextId = 1;

  function allocateId() {
    const id = String(nextId);
    nextId += 1;
    return id;
  }

  function findByName(name = '') {
    const normalized = cleanText(name, MAX_NAME_LENGTH).toLowerCase();
    if (!normalized) {
      return null;
    }
    for (const table of tables.values()) {
      if (cleanText(table.name, MAX_NAME_LENGTH).toLowerCase() === normalized) {
        return table;
      }
    }
    return null;
  }

  function resolveTable(input = {}) {
    const source = ensureObject(input);
    const id = cleanText(source.id || source.table_id || source.tableId || source.source_table_id || source.sourceTableId, 40);
    if (id && tables.has(id)) {
      return tables.get(id);
    }
    const name = cleanText(source.name || source.table_name || source.tableName, MAX_NAME_LENGTH);
    return name ? findByName(name) : null;
  }

  function missingTable(input = {}) {
    const source = ensureObject(input);
    const id = cleanText(source.id || source.table_id || source.tableId || source.source_table_id || source.sourceTableId, 40);
    const name = cleanText(source.name || source.table_name || source.tableName, MAX_NAME_LENGTH);
    return {
      ok: false,
      status: 'not_found',
      error: id
        ? `No assay table exists with id ${id}.`
        : (name ? `No assay table exists named "${name}".` : 'No assay table id or name was provided.')
    };
  }

  function saveTable({ name = '', source = '', columns = [], rows = [] } = {}) {
    const normalized = normalizeRows(rows, columns);
    const timestamp = now();
    const table = {
      id: allocateId(),
      name: cleanText(name, MAX_NAME_LENGTH),
      source: cleanText(source, MAX_SOURCE_LENGTH),
      columns: normalized.columns,
      rows: normalized.rows,
      created_at: timestamp,
      updated_at: timestamp
    };
    tables.set(table.id, table);
    return table;
  }

  function create(input = {}) {
    const rows = asArray(input.rows || input.data);
    const columns = asArray(input.columns);
    if (!rows.length) {
      return {
        ok: false,
        status: 'invalid_table',
        error: 'assay-table create requires rows or data.'
      };
    }
    const table = saveTable({
      name: input.name,
      source: input.source,
      columns,
      rows
    });
    return {
      ok: true,
      status: 'created',
      table: serializeTable(table),
      summary: `Created assay table ${table.id}${table.name ? ` (${table.name})` : ''} with ${table.rows.length} row(s).`
    };
  }

  function read(input = {}) {
    const table = resolveTable(input);
    if (!table) {
      return missingTable(input);
    }
    return {
      ok: true,
      status: 'read',
      table: serializeTable(table, { maxRows: input.max_rows || input.maxRows || MAX_PREVIEW_ROWS }),
      summary: `Read assay table ${table.id}.`
    };
  }

  function list(input = {}) {
    const limit = Math.max(1, Math.min(50, Number(input.limit) || 50));
    const items = [...tables.values()].slice(0, limit).map((table) => serializeTable(table, {
      includeRows: false
    }));
    return {
      ok: true,
      status: 'listed',
      items,
      count: items.length,
      total_count: tables.size,
      summary: `Listed ${items.length} assay table${items.length === 1 ? '' : 's'}.`
    };
  }

  function derive(input = {}) {
    const sourceTable = resolveTable(input);
    if (!sourceTable) {
      return missingTable(input);
    }
    const keepColumns = uniqueColumnNames(
      input.keep_columns
        || input.keepColumns
        || (input.include_source_columns === true || input.includeSourceColumns === true ? sourceTable.columns : [])
    );
    const calculationColumns = normalizeCalculationColumns(input.columns || input.calculations || input.derived_columns || input.derivedColumns);
    const groupBy = uniqueColumnNames(input.group_by || input.groupBy);
    let rows = [];

    if (groupBy.length) {
      rows = groupRows(sourceTable.rows, groupBy).map((group) => {
        const out = {};
        groupBy.forEach((column) => {
          out[column] = normalizeCell(group.values[column]);
        });
        calculationColumns.forEach((columnSpec) => {
          out[columnSpec.name] = buildColumnValue({
            columnSpec,
            row: group.rows[0] || {},
            groupRows: group.rows,
            allRows: sourceTable.rows
          });
        });
        return out;
      });
    } else {
      rows = sourceTable.rows.map((row) => {
        const out = {};
        keepColumns.forEach((column) => {
          out[column] = normalizeCell(row[column]);
        });
        calculationColumns.forEach((columnSpec) => {
          out[columnSpec.name] = buildColumnValue({
            columnSpec,
            row,
            allRows: sourceTable.rows
          });
        });
        return out;
      });
    }

    const columns = uniqueColumnNames([
      ...(groupBy.length ? groupBy : keepColumns),
      ...calculationColumns.map((column) => column.name)
    ]);
    const table = saveTable({
      name: input.output_name || input.outputName || input.name || `${sourceTable.name || sourceTable.id} derived`,
      source: input.source || `derived:${sourceTable.id}`,
      columns,
      rows
    });
    return {
      ok: true,
      status: 'derived',
      source_table_id: sourceTable.id,
      table: serializeTable(table),
      summary: `Created derived assay table ${table.id} from table ${sourceTable.id}.`
    };
  }

  function addColumn(input = {}) {
    const sourceTable = resolveTable(input);
    if (!sourceTable) {
      return missingTable(input);
    }
    const specs = asArray(input.columns).map((spec) => ensureObject(spec));
    // A single added column may take its name from a top-level `name`.
    if (specs.length === 1 && cleanText(input.name, 120)) {
      specs[0] = { ...specs[0], name: input.name };
    }
    const label = normalizeColumnName(ensureObject(specs[0]).name || input.name, 'calculation');
    return derive({
      ...input,
      source_table_id: sourceTable.id,
      include_source_columns: true,
      columns: specs,
      output_name: input.output_name || input.outputName || `${sourceTable.name || sourceTable.id} plus ${label}`
    });
  }

  async function python(input = {}) {
    const sourceTable = resolveTable(input) || null;
    if (!runPythonSandbox) {
      return {
        ok: false,
        status: 'executor_unavailable',
        error: 'Python execution is not configured for assay-table.'
      };
    }
    const code = String(input.code || '');
    if (!code.trim()) {
      return {
        ok: false,
        status: 'invalid_python',
        error: 'assay-table python requires code that writes output_table.json.'
      };
    }
    const outputPath = cleanText(input.output_path || input.outputPath || 'output_table.json', 240) || 'output_table.json';
    const allTables = [...tables.values()].map((table) => serializeTable(table, {
      maxRows: MAX_ROWS
    }));
    const stagedSource = sourceTable ? serializeTable(sourceTable, { maxRows: MAX_ROWS }) : null;
    const sandbox = await runPythonSandbox({
      code,
      timeout_ms: input.timeout_ms || input.timeoutMs || 15000,
      files: [
        {
          path: 'input_table.json',
          content: JSON.stringify(stagedSource || {}, null, 2)
        },
        {
          path: 'tables.json',
          content: JSON.stringify(allTables, null, 2)
        }
      ],
      readback_paths: [outputPath]
    }, {
      sandboxRoot: getSandboxRoot(),
      pythonExecutable: cleanText(input.python_executable || input.pythonExecutable, 240),
      preferredPythonBin: cleanText(input.preferred_python || input.preferredPython, 240)
    });
    if (sandbox?.ok !== true) {
      return {
        ok: false,
        status: 'python_failed',
        error: cleanText(sandbox?.error || sandbox?.stderr, 4000) || 'Python table transform failed.',
        sandbox,
        summary: 'Python table transform failed.'
      };
    }
    const readback = asArray(sandbox.readback_files).find((file) => cleanText(file?.path, 240) === outputPath);
    if (!readback?.content) {
      return {
        ok: false,
        status: 'missing_output_table',
        error: `Python completed but did not write ${outputPath}.`,
        sandbox,
        summary: `Python completed but ${outputPath} was not available.`
      };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(readback.content);
    } catch (error) {
      return {
        ok: false,
        status: 'invalid_output_table',
        error: `Python output table JSON could not be parsed: ${cleanText(error?.message || error, 1000)}`,
        sandbox,
        summary: 'Python output table JSON could not be parsed.'
      };
    }
    const tablePayload = Array.isArray(parsed) ? { rows: parsed } : ensureObject(parsed.table || parsed);
    const table = saveTable({
      name: input.output_name || input.outputName || tablePayload.name || 'Python assay table',
      source: input.source || `python:${sourceTable?.id || 'manual'}`,
      columns: asArray(tablePayload.columns),
      rows: asArray(tablePayload.rows || tablePayload.data)
    });
    return {
      ok: true,
      status: 'python_completed',
      source_table_id: sourceTable?.id || '',
      table: serializeTable(table),
      sandbox: {
        run_id: cleanText(sandbox.run_id, 120),
        stdout: cleanText(sandbox.stdout, 2000),
        stderr: cleanText(sandbox.stderr, 2000),
        warnings: asArray(sandbox.warnings).slice(0, 8)
      },
      summary: `Created assay table ${table.id} from Python output.`
    };
  }

  function deleteTable(input = {}) {
    const table = resolveTable(input);
    if (!table) {
      return missingTable(input);
    }
    tables.delete(table.id);
    return {
      ok: true,
      status: 'deleted',
      id: table.id,
      summary: `Deleted assay table ${table.id}.`
    };
  }

  function clear() {
    const count = tables.size;
    tables.clear();
    return {
      ok: true,
      status: 'cleared',
      count,
      summary: `Cleared ${count} assay table${count === 1 ? '' : 's'}.`
    };
  }

  async function execute(input = {}) {
    const action = cleanText(input.action, 40) || 'list';
    if (!ASSAY_TABLE_ACTIONS.includes(action)) {
      return {
        ok: false,
        status: 'invalid_action',
        error: `Unsupported assay-table action "${action}".`
      };
    }
    if (action === 'create') {
      return create(input);
    }
    if (action === 'read') {
      return read(input);
    }
    if (action === 'list') {
      return list(input);
    }
    if (action === 'derive') {
      return derive(input);
    }
    if (action === 'add_column') {
      return addColumn(input);
    }
    if (action === 'python') {
      return python(input);
    }
    if (action === 'delete') {
      return deleteTable(input);
    }
    return clear();
  }

  return {
    execute,
    listTables: () => [...tables.values()].map((table) => cloneJson(table, {})),
    getTable: (input = {}) => {
      const table = resolveTable(input);
      return table ? cloneJson(table, null) : null;
    }
  };
}

module.exports = {
  ASSAY_TABLE_ACTIONS,
  createAgentAssayTableRuntime,
  normalizeRows,
  applyOperation
};
