import { FormulaError } from '../formula.js';

const CELL_PATTERN = /^([A-Za-z]+)(\d+)$/;

function notebookTableColumnLetter(index) {
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

function formatCellAddress(column, row, plate = false) {
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

function isNotebookTableFormula(text) {
  return String(text ?? '').trimStart().startsWith('=');
}

// Excel's escape hatch, and the only way to show a cell that starts with "=" as the
// text it is — "=> see figure 2" would otherwise be parsed as a formula.
function notebookTableCellText(raw) {
  const text = String(raw ?? '');
  return text.startsWith("'") ? text.slice(1) : text;
}

// Float arithmetic leaves noise (0.1 + 0.2); 12 significant digits is past any
// precision a notebook value carries and is short enough to read in a cell.
function formatNotebookTableNumber(value) {
  if (!Number.isFinite(value)) {
    return '#NUM!';
  }
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 1e-6 || absolute >= 1e12)) {
    return value.toExponential(4);
  }
  return String(Number(value.toPrecision(12)));
}

export {
  fail,
  formatCellAddress,
  formatNotebookTableNumber,
  isNotebookTableFormula,
  notebookTableCellText,
  notebookTableColumnLetter,
  parseCellAddress
};
