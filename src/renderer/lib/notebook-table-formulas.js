// Spreadsheet-style formulas for notebook result tables.
//
//   =SUM(B1:B4) / COUNT(B1:B4)
//
// Cells whose text starts with "=" are evaluated by the shared formula language in
// ./formula.js; everything else is plain text (numeric when it parses as a number).
// References are A1-style: bare A1 is local to the formula's table, and Table1:A1
// selects an explicit sibling table. The column letter is the column's position and
// the number is the row's position. Nothing is stored but the text the user typed.

import {
  compileFormula,
  evaluateFormula,
  FormulaError,
  parseFormula
} from './formula.js';
import {
  normalizeNotebookResultTables
} from './notebook-result-tables.js';

const CELL_PATTERN = /^([A-Za-z]+)(\d+)$/;

export function notebookTableColumnLetter(index) {
  let remaining = Math.max(0, Math.trunc(Number(index) || 0));
  let letters = '';
  for (;;) {
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26) - 1;
    if (remaining < 0) {
      return letters;
    }
  }
}

// Two addressing schemes share one parser. In a plain grid the letters pick the column
// and the digits the row (A1 = first column, first row). On a microplate the letters
// are the ROW and the digits the column, so "B3" is row B, column 3 -- the well id the
// user already knows. Getting this backwards silently reads the transposed cell.
function lettersToIndex(letters) {
  let index = 0;
  for (let at = 0; at < letters.length; at += 1) {
    index = (index * 26) + (letters.charCodeAt(at) - 64);
  }
  return index - 1;
}

function parseCellAddress(name, plate = false) {
  const match = CELL_PATTERN.exec(String(name || '').trim());
  if (!match) {
    return null;
  }
  const letterIndex = lettersToIndex(match[1].toUpperCase());
  const digitIndex = Number(match[2]) - 1;
  return plate
    ? { column: digitIndex, row: letterIndex }
    : { column: letterIndex, row: digitIndex };
}

export function formatCellAddress(column, row, plate = false) {
  return plate
    ? `${notebookTableColumnLetter(row)}${column + 1}`
    : `${notebookTableColumnLetter(column)}${row + 1}`;
}

// Error kinds have to survive dependency traversal so a source #NUM! remains #NUM!
// wherever it is referenced, while cycles retain their more specific explanation.
function fail(message, cycle = false, numeric = false, pending = false) {
  const error = new FormulaError(message);
  if (cycle) {
    error.cycle = true;
  }
  if (numeric) {
    error.numeric = true;
  }
  // Pending is not a failure so much as "not yet": some cell this formula reads is
  // still empty, so the cell shows the arithmetic that is left instead of a number.
  if (pending) {
    error.pending = true;
  }
  return error;
}

export function isNotebookTableFormula(text) {
  return String(text ?? '').trimStart().startsWith('=');
}

// Excel's escape hatch, and the only way to show a cell that starts with "=" as the
// text it is — "=> see figure 2" would otherwise be parsed as a formula.
export function notebookTableCellText(raw) {
  const text = String(raw ?? '');
  return text.startsWith("'") ? text.slice(1) : text;
}

// Float arithmetic leaves noise (0.1 + 0.2); 12 significant digits is past any
// precision a notebook value carries and is short enough to read in a cell.
export function formatNotebookTableNumber(value) {
  if (!Number.isFinite(value)) {
    return '#NUM!';
  }
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 1e-6 || absolute >= 1e12)) {
    return value.toExponential(4);
  }
  return String(Number(value.toPrecision(12)));
}

// ponytail: every cell is recomputed on each call — notebook tables are small, so a
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

const OPERATOR_PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
const UNARY_PRECEDENCE = 4;
const ATOM_PRECEDENCE = 5;

// Parenthesise a part only where dropping them would change the arithmetic:
// (10+D3)*2 needs them, 10+18*D3 does not.
function operandText(part, parentPrecedence, { rightSide = false, operator = '' } = {}) {
  const tighter = part.precedence < parentPrecedence;
  const sameButOrderMatters = part.precedence === parentPrecedence
    && ((rightSide && (operator === '-' || operator === '/' || operator === '^'))
      || (!rightSide && operator === '^'));
  return tighter || sameButOrderMatters ? `(${part.text})` : part.text;
}

function simplifyNode(node, context) {
  const known = { known: true };

  switch (node.kind) {
    case 'number':
      return known;

    case 'value':
      // "x" means the current well on a plate; a table cell has no such value.
      return { known: false, text: 'x', precedence: ATOM_PRECEDENCE };

    case 'ref':
    case 'range': {
      const resolved = context.resolve(node);
      return resolved.known
        ? known
        : { known: false, text: resolved.text, precedence: ATOM_PRECEDENCE };
    }

    case 'unary': {
      const arg = simplifyNode(node.arg, context);
      if (arg.known) {
        return known;
      }
      return {
        known: false,
        text: `${node.op}${operandText(textPartOf(node.arg, arg, context), UNARY_PRECEDENCE)}`,
        precedence: UNARY_PRECEDENCE
      };
    }

    case 'binary': {
      const left = simplifyNode(node.left, context);
      const right = simplifyNode(node.right, context);
      if (left.known && right.known) {
        return known;
      }
      const precedence = OPERATOR_PRECEDENCE[node.op] || 1;
      const leftText = operandText(textPartOf(node.left, left, context), precedence, { operator: node.op });
      const rightText = operandText(
        textPartOf(node.right, right, context),
        precedence,
        { rightSide: true, operator: node.op }
      );
      return { known: false, text: `${leftText}${node.op}${rightText}`, precedence };
    }

    case 'call': {
      const args = node.args.map((arg) => simplifyNode(arg, context));
      if (args.every((arg) => arg.known)) {
        return known;
      }
      const argsText = node.args
        .map((arg, index) => textPartOf(arg, args[index], context).text)
        .join(', ');
      return { known: false, text: `${node.rawName}(${argsText})`, precedence: ATOM_PRECEDENCE };
    }

    default:
      return { known: false, text: '?', precedence: ATOM_PRECEDENCE };
  }
}

// What a sub-expression looks like once written out: a folded number for the parts
// that are known, the source text for the parts that are still waiting on a cell.
function textPartOf(node, part, context) {
  if (!part.known) {
    return part;
  }
  if (node.kind === 'range') {
    // A qualified range keeps its table, or the text would point at the local one.
    const prefix = node.table ? `${node.table}:` : '';
    return {
      text: `${prefix}${String(node.from).toUpperCase()}:${String(node.to).toUpperCase()}`,
      precedence: ATOM_PRECEDENCE
    };
  }
  const value = evaluateFormula(node, context.numeric);
  return {
    text: formatNotebookTableNumber(value),
    // A folded negative has to survive sitting next to an operator: 2-(-3).
    precedence: value < 0 ? UNARY_PRECEDENCE : ATOM_PRECEDENCE
  };
}

// `resolve(node)` reports whether a reference has a value yet: { known: true } or
// { known: false, text } naming the cell that is still empty. `numeric` is the
// evaluation context used to fold the parts that are known.
export function simplifyFormula(text, { resolve, numeric }) {
  const ast = parseFormula(text);
  const context = { resolve, numeric };
  const result = simplifyNode(ast, context);
  return result.known ? null : result.text;
}
