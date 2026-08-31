import { FormulaError, compileFormula } from './formula.js';
import { normalizeNotebookResultTables } from './notebook-result-tables.js';
import { fail, formatCellAddress, formatNotebookTableNumber, isNotebookTableFormula, notebookTableCellText, parseCellAddress } from './notebook-table-formulas/cell-address.js';
import { simplifyFormula } from './notebook-table-formulas/formula-simplify.js';

// shared recursive evaluator is simpler than maintaining an incremental dependency
// graph. Bare A1 addresses stay local; Table1:A1 selects an explicit sibling table.
export function computeNotebookResultTables(rawTables, { plateAddressing = false, legacyTable = null } = {}) {
  const tables = normalizeNotebookResultTables(rawTables, legacyTable);
  const outputs = tables.map((table) => ({ table, byRowId: {} }));
  const computed = new Map();
  const visiting = new Set();

  function tableLabel(tableIndex) {
    return `Table${tableIndex + 1}`;
  }

  function rawAt(tableIndex, column, row) {
    const table = tables[tableIndex];
    if (!table || column < 0 || column >= table.columns.length || row < 0 || row >= table.rows.length) {
      return null;
    }
    return String(table.rows[row][table.columns[column].field] ?? '').trim();
  }

  function targetTableIndex(node, currentTableIndex) {
    if (!node.table) {
      return currentTableIndex;
    }
    const match = /^Table(\d+)$/i.exec(String(node.table));
    const tableIndex = match ? Number(match[1]) - 1 : -1;
    if (tableIndex < 0 || tableIndex >= tables.length) {
      throw fail(`Unknown table "${node.table}". This notebook has ${tables.length} table(s).`);
    }
    return tableIndex;
  }

  function referenceLabel(node) {
    const prefix = node.table ? `${node.table}:` : '';
    return node.kind === 'range'
      ? `${prefix}${String(node.from).toUpperCase()}:${String(node.to).toUpperCase()}`
      : `${prefix}${String(node.name).toUpperCase()}`;
  }

  // The number a cell contributes: empty is 0, plain text is NaN, and formula errors
  // propagate through local and cross-table dependencies.
  function valueAt(tableIndex, column, row) {
    const key = `${tableIndex}:${column}:${row}`;
    const address = `${tableLabel(tableIndex)}:${formatCellAddress(column, row, plateAddressing)}`;
    const cached = computed.get(key);
    if (cached) {
      if (cached.error) {
        throw fail(cached.error, cached.cycle, cached.numeric, cached.pending);
      }
      return cached.value;
    }
    if (visiting.has(key)) {
      // In a solve table every column is the same equation rearranged, so two unknowns
      // necessarily reference each other. That loop is "not determined yet" -- both
      // cells show the arithmetic that is left -- not the mistake it is anywhere else.
      const solving = Boolean(tables[tableIndex]?.solve);
      throw fail(`"${address}" refers to itself or creates a circular reference.`, !solving, false, solving);
    }

    const raw = rawAt(tableIndex, column, row);
    if (raw === null) {
      throw fail(`"${address}" is outside this table.`);
    }
    if (!raw) {
      return 0;
    }
    if (!isNotebookTableFormula(raw)) {
      return Number(raw.replace(/,/g, ''));
    }

    visiting.add(key);
    try {
      const compiled = compileFormula(raw);
      if (compiled.error) {
        throw fail(compiled.error.message);
      }
      const value = compiled.evaluate({
        value: NaN,
        resolveRef: (node) => resolveRef(node, tableIndex)
      });
      if (!Number.isFinite(value)) {
        throw fail('Formula result is not a finite number.', false, true);
      }
      computed.set(key, { value, error: null, cycle: false, numeric: false, pending: false });
      return value;
    } catch (error) {
      const message = error instanceof FormulaError ? error.message : String(error?.message || error);
      const cycle = Boolean(error?.cycle);
      const numeric = Boolean(error?.numeric);
      const pending = Boolean(error?.pending);
      computed.set(key, { value: NaN, error: message, cycle, numeric, pending });
      throw fail(message, cycle, numeric, pending);
    } finally {
      visiting.delete(key);
    }
  }

  function resolveRef(node, currentTableIndex) {
    const tableIndex = targetTableIndex(node, currentTableIndex);
    const label = referenceLabel(node);
    if (node.kind === 'range') {
      const from = parseCellAddress(node.from, plateAddressing);
      const to = parseCellAddress(node.to, plateAddressing);
      if (!from || !to) {
        throw fail(`"${label}" is not a range of cells.`);
      }
      const values = [];
      for (let column = Math.min(from.column, to.column); column <= Math.max(from.column, to.column); column += 1) {
        for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row += 1) {
          // Out-of-bounds and empty range cells drop out. Filled formula failures still
          // propagate so an aggregate cannot silently change its scientific result.
          const raw = rawAt(tableIndex, column, row);
          if (raw === null || !raw) {
            continue;
          }
          values.push(valueAt(tableIndex, column, row));
        }
      }
      if (!values.length) {
        throw fail(`"${label}" covers no filled cells in its table.`);
      }
      return values;
    }

    const address = parseCellAddress(node.name, plateAddressing);
    if (!address) {
      throw fail(`"${label}" is not a cell reference.`);
    }
    if (rawAt(tableIndex, address.column, address.row) === '') {
      throw fail(`"${label}" is empty.`, false, false, true);
    }
    const value = valueAt(tableIndex, address.column, address.row);
    if (!Number.isFinite(value)) {
      throw fail(`"${label}" is not a number.`);
    }
    return [value];
  }

  function pendingExpressionFor(raw, tableIndex) {
    const resolveSymbol = (node) => {
      const label = referenceLabel(node);
      try {
        resolveRef(node, tableIndex);
        return { known: true };
      } catch (error) {
        if (error?.pending) {
          return { known: false, text: label };
        }
        throw error;
      }
    };
    try {
      return simplifyFormula(raw, {
        resolve: resolveSymbol,
        numeric: { value: NaN, resolveRef: (node) => resolveRef(node, tableIndex) }
      }) || '';
    } catch (_error) {
      return '';
    }
  }

  tables.forEach((table, tableIndex) => {
    table.rows.forEach((row, rowIndex) => {
      const cells = {};
      table.columns.forEach((column, columnIndex) => {
        const raw = String(row[column.field] ?? '');
        if (!isNotebookTableFormula(raw)) {
          cells[column.field] = { text: notebookTableCellText(raw), error: null, formula: false };
          return;
        }
        try {
          cells[column.field] = {
            text: formatNotebookTableNumber(valueAt(tableIndex, columnIndex, rowIndex)),
            error: null,
            formula: true
          };
        } catch (error) {
          const pendingText = error?.pending ? pendingExpressionFor(raw, tableIndex) : '';
          cells[column.field] = pendingText
            ? { text: pendingText, error: null, formula: true, pending: true }
            : {
              text: error?.numeric ? '#NUM!' : '#ERROR',
              error: error instanceof FormulaError ? error.message : String(error?.message || error),
              formula: true
            };
        }
      });
      outputs[tableIndex].byRowId[row.id] = cells;
    });
  });

  return outputs;
}

export function computeNotebookResultTable(rawTable, options = {}) {
  return computeNotebookResultTables(rawTable ? [rawTable] : [], options)[0]
    || { table: null, byRowId: {} };
}

// The computed view of a table, for anything that renders cells as plain text
// (PDF export, the AI context block) rather than as an editor.
export function resolveNotebookResultTableValues(rawTable, options = {}) {
  const { table, byRowId } = computeNotebookResultTable(rawTable, options);
  if (!table) {
    return null;
  }
  return {
    columns: table.columns,
    rows: table.rows.map((row) => {
      const cells = byRowId[row.id] || {};
      const resolved = { id: row.id };
      table.columns.forEach((column) => {
        resolved[column.field] = cells[column.field]?.text ?? String(row[column.field] ?? '');
      });
      return resolved;
    })
  };
}

// Drop-in replacement for normalizeNotebookResultTables wherever cells are rendered
// as text rather than edited, so a printed page shows 12 and not "=SUM(A1:A4)".
export function resolveNotebookResultTablesValues(rawTables, legacyTable = null) {
  return computeNotebookResultTables(rawTables, { legacyTable })
    .map(({ table, byRowId }) => ({
      columns: table.columns,
      rows: table.rows.map((row) => {
        const cells = byRowId[row.id] || {};
        const resolved = { id: row.id };
        table.columns.forEach((column) => {
          resolved[column.field] = cells[column.field]?.text ?? String(row[column.field] ?? '');
        });
        return resolved;
      })
    }));
}

// Applies one "point mode" cell pick to the formula text being edited: the string
// bookkeeping behind clicking cells to build a formula, kept here so it can be tested
// without a grid. `pick` describes the reference the previous click inserted; pass the
// one this returns back in next time, or null once the user types anything else.
//
// Clicking again while a pick is still live REPLACES it -- a mis-click is corrected by
// clicking the right cell, not by deleting what the last click typed.
export function applyReferencePick({
  value = '',
  caretStart = value.length,
  caretEnd = caretStart,
  address = '',
  extendRange = false,
  pick = null
} = {}) {
  const live = Boolean(pick)
    && caretStart === pick.end
    && caretEnd === pick.end
    && value.slice(pick.start, pick.end) === pick.text;

  let start = live ? pick.start : caretStart;
  const end = live ? pick.end : caretEnd;
  let anchor = live ? pick.anchor : '';

  // Shift-click widens the reference into a range, the way dragging across cells does.
  // With no live pick, grow from a reference the user typed by hand.
  if (extendRange && !anchor) {
    const typed = /(?:Table\d+:)?[A-Za-z]+\d+$/i.exec(value.slice(0, caretStart));
    if (typed) {
      anchor = typed[0];
      start = caretStart - typed[0].length;
    }
  }

  let text = address;
  let nextAnchor = address;
  if (extendRange && anchor) {
    const qualified = /^(Table\d+):([A-Za-z]+\d+)$/i;
    const from = qualified.exec(anchor);
    const to = qualified.exec(address);
    if (from && to) {
      if (from[1].toLowerCase() === to[1].toLowerCase()) {
        text = `${from[1]}:${from[2]}:${to[2]}`;
        nextAnchor = anchor;
      }
    } else if (!from && !to) {
      text = `${anchor}:${address}`;
      nextAnchor = anchor;
    }
  }
  const nextValue = value.slice(0, start) + text + value.slice(end);
  const caret = start + text.length;
  return {
    value: nextValue,
    caret,
    pick: {
      start,
      end: caret,
      text,
      anchor: nextAnchor
    }
  };
}

// Rewrites the relative references in a formula for a cell `columnDelta`/`rowDelta`
// away, which is what dragging a fill handle does: =A1*2 filled one row down becomes
// =A2*2. A reference that would land off the top or left edge becomes #REF!, so the
// filled cell reports a broken formula instead of quietly pointing somewhere else.
//
// ponytail: relative references only -- this language has no $ absolute form, and
// adding one means changing the tokenizer that Assay's plate formulas share.
export function translateFormulaReferences(text, columnDelta = 0, rowDelta = 0, { plateAddressing = false } = {}) {
  const source = String(text ?? '');
  if (!isNotebookTableFormula(source) || (!columnDelta && !rowDelta)) {
    return source;
  }
  return source.replace(/(?:(Table\d+):)?([A-Za-z]+)(\d+)/gi, (match, table, letters, digits, offset) => {
    // A name followed by "(" is a function call -- LOG10( must not be read as a cell.
    const rest = source.slice(offset + match.length);
    if (/^\s*\(/.test(rest)) {
      return match;
    }
    const address = parseCellAddress(`${letters}${digits}`, plateAddressing);
    if (!address) {
      return match;
    }
    const column = address.column + columnDelta;
    const row = address.row + rowDelta;
    if (column < 0 || row < 0) {
      return '#REF!';
    }
    return `${table ? `${table}:` : ''}${formatCellAddress(column, row, plateAddressing)}`;
  });
}

// One cell's content copied to an offset cell: formulas shift their references, plain
// text is copied as-is. Excel grows number series when several cells are dragged; a
// single-cell drag copies, which is all this does.
export function fillCellContent(sourceText, columnDelta, rowDelta, options = {}) {
  return isNotebookTableFormula(sourceText)
    ? translateFormulaReferences(sourceText, columnDelta, rowDelta, options)
    : String(sourceText ?? '');
}

/* ------------------------------------------------- partially filled formulas */

// A formula that reads a cell nobody has filled in yet cannot produce a number, but it
// can still show the arithmetic that is left: =A1+A2+D3 over 10 and 18 reads "28+D3".
// That is the useful thing to put in the cell while an experiment is half-recorded.

export {
  notebookTableColumnLetter,
  formatCellAddress,
  isNotebookTableFormula,
  notebookTableCellText,
  formatNotebookTableNumber
} from './notebook-table-formulas/cell-address.js';
export { simplifyFormula } from './notebook-table-formulas/formula-simplify.js';
