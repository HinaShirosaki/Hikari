// Spreadsheet-style formulas for notebook result tables.
//
//   =SUM(B1:B4) / COUNT(B1:B4)
//
// Cells whose text starts with "=" are evaluated by the shared formula language in
// ./formula.js; everything else is plain text (numeric when it parses as a number).
// References are A1-style: the column letter is the column's position in the table,
// the number is the row's position, so inserting a column shifts references the way a
// spreadsheet does. Nothing is stored but the text the user typed.

import {
  compileFormula,
  evaluateFormula,
  FormulaError,
  parseFormula
} from './formula.js';
import {
  normalizeNotebookResultTable,
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

function parseCellAddress(name) {
  const match = CELL_PATTERN.exec(String(name || '').trim());
  if (!match) {
    return null;
  }
  const letters = match[1].toUpperCase();
  let column = 0;
  for (let index = 0; index < letters.length; index += 1) {
    column = (column * 26) + (letters.charCodeAt(index) - 64);
  }
  return { column: column - 1, row: Number(match[2]) - 1 };
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

// ponytail: every cell is recomputed on each call — a notebook table is tens of cells,
// so there is no dependency graph. Add incremental recalc if tables ever get large.
export function computeNotebookResultTable(rawTable) {
  const table = normalizeNotebookResultTable(rawTable);
  const byRowId = {};
  if (!table) {
    return { table: null, byRowId };
  }

  const columnCount = table.columns.length;
  const rowCount = table.rows.length;
  const rawAt = (column, row) => (
    column >= 0 && column < columnCount && row >= 0 && row < rowCount
      ? String(table.rows[row][table.columns[column].field] ?? '').trim()
      : null
  );

  const computed = new Map();
  const visiting = new Set();

  // The number a cell contributes: empty is 0, plain text is NaN, a formula is
  // evaluated and its own errors propagate to whoever referenced it.
  function valueAt(column, row) {
    const key = `${column}:${row}`;
    const cached = computed.get(key);
    if (cached) {
      if (cached.error) {
        throw fail(cached.error, cached.cycle, cached.numeric, cached.pending);
      }
      return cached.value;
    }
    if (visiting.has(key)) {
      throw fail(`"${notebookTableColumnLetter(column)}${row + 1}" refers to itself.`, true);
    }

    const raw = rawAt(column, row);
    if (raw === null) {
      throw fail(`"${notebookTableColumnLetter(column)}${row + 1}" is outside this table.`);
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
      const value = compiled.evaluate({ value: NaN, resolveRef });
      if (!Number.isFinite(value)) {
        throw fail('Formula result is not a finite number.', false, true);
      }
      computed.set(key, { value, error: null, cycle: false, numeric: false, pending: false });
      return value;
    } catch (error) {
      const message = error instanceof FormulaError
        ? error.message
        : String(error?.message || error);
      const cycle = Boolean(error?.cycle);
      const numeric = Boolean(error?.numeric);
      const pending = Boolean(error?.pending);
      computed.set(key, { value: NaN, error: message, cycle, numeric, pending });
      throw fail(message, cycle, numeric, pending);
    } finally {
      visiting.delete(key);
    }
  }

  function resolveRef(node) {
    if (node.kind === 'range') {
      const from = parseCellAddress(node.from);
      const to = parseCellAddress(node.to);
      if (!from || !to) {
        throw fail(`"${node.from}:${node.to}" is not a range of cells.`);
      }
      const values = [];
      for (let column = Math.min(from.column, to.column); column <= Math.max(from.column, to.column); column += 1) {
        for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row += 1) {
          // Cells outside the table and empty cells drop out of the range instead of
          // counting as zero, so SUM(A1:A20) and MEAN(A1:A20) both work on a
          // four-row table. Plain text contributes NaN and is filtered by aggregates;
          // errors from formula cells propagate instead of silently changing a result.
          const raw = rawAt(column, row);
          if (raw === null || !raw) {
            continue;
          }
          values.push(valueAt(column, row));
        }
      }
      if (!values.length) {
        throw fail(`"${node.from}:${node.to}" covers no filled cells in this table.`);
      }
      return values;
    }

    const address = parseCellAddress(node.name);
    if (!address) {
      throw fail(`"${node.name}" is not a cell reference.`);
    }
    // An empty cell is not a zero -- it is a value nobody has recorded yet.
    if (rawAt(address.column, address.row) === '') {
      throw fail(`"${String(node.name).toUpperCase()}" is empty.`, false, false, true);
    }
    const value = valueAt(address.column, address.row);
    if (!Number.isFinite(value)) {
      throw fail(`"${String(node.name).toUpperCase()}" is not a number.`);
    }
    return [value];
  }

  // Whether a reference has a value yet. Anything that is merely waiting on an empty
  // cell comes back unknown; a genuine error still throws and is reported as one.
  function resolveSymbol(node) {
    const label = node.kind === 'range'
      ? `${String(node.from).toUpperCase()}:${String(node.to).toUpperCase()}`
      : String(node.name).toUpperCase();
    try {
      resolveRef(node);
      return { known: true };
    } catch (error) {
      if (error?.pending) {
        return { known: false, text: label };
      }
      throw error;
    }
  }

  function pendingExpressionFor(raw) {
    try {
      return simplifyFormula(raw, {
        resolve: resolveSymbol,
        numeric: { value: NaN, resolveRef }
      }) || '';
    } catch (_error) {
      // Anything the simplifier cannot express falls back to the normal error text.
      return '';
    }
  }

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
          text: formatNotebookTableNumber(valueAt(columnIndex, rowIndex)),
          error: null,
          formula: true
        };
      } catch (error) {
        const pendingText = error?.pending ? pendingExpressionFor(raw) : '';
        cells[column.field] = pendingText
          ? { text: pendingText, error: null, formula: true, pending: true }
          : {
            text: error?.numeric ? '#NUM!' : '#ERROR',
            error: error instanceof FormulaError ? error.message : String(error?.message || error),
            formula: true
          };
      }
    });
    byRowId[row.id] = cells;
  });

  return { table, byRowId };
}

// The computed view of a table, for anything that renders cells as plain text
// (PDF export, the AI context block) rather than as an editor.
export function resolveNotebookResultTableValues(rawTable) {
  const { table, byRowId } = computeNotebookResultTable(rawTable);
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
  return normalizeNotebookResultTables(rawTables, legacyTable)
    .map((table) => resolveNotebookResultTableValues(table))
    .filter(Boolean);
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
    const typed = /[A-Za-z]+\d+$/.exec(value.slice(0, caretStart));
    if (typed) {
      anchor = typed[0];
      start = caretStart - typed[0].length;
    }
  }

  const text = extendRange && anchor ? `${anchor}:${address}` : address;
  const nextValue = value.slice(0, start) + text + value.slice(end);
  const caret = start + text.length;
  return {
    value: nextValue,
    caret,
    pick: {
      start,
      end: caret,
      text,
      anchor: extendRange && anchor ? anchor : address
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
export function translateFormulaReferences(text, columnDelta = 0, rowDelta = 0) {
  const source = String(text ?? '');
  if (!isNotebookTableFormula(source) || (!columnDelta && !rowDelta)) {
    return source;
  }
  return source.replace(/([A-Za-z]+)(\d+)/g, (match, letters, digits, offset) => {
    // A name followed by "(" is a function call -- LOG10( must not be read as a cell.
    const rest = source.slice(offset + match.length);
    if (/^\s*\(/.test(rest)) {
      return match;
    }
    const address = parseCellAddress(match);
    if (!address) {
      return match;
    }
    const column = address.column + columnDelta;
    const row = address.row + rowDelta;
    if (column < 0 || row < 0) {
      return '#REF!';
    }
    return `${notebookTableColumnLetter(column)}${row + 1}`;
  });
}

// One cell's content copied to an offset cell: formulas shift their references, plain
// text is copied as-is. Excel grows number series when several cells are dragged; a
// single-cell drag copies, which is all this does.
export function fillCellContent(sourceText, columnDelta, rowDelta) {
  return isNotebookTableFormula(sourceText)
    ? translateFormulaReferences(sourceText, columnDelta, rowDelta)
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
    return {
      text: `${String(node.from).toUpperCase()}:${String(node.to).toUpperCase()}`,
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
