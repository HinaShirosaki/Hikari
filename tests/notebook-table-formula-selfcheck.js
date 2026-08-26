#!/usr/bin/env node
// Self-check for spreadsheet formulas in notebook result tables: A1 addressing,
// ranges, and the errors they report instead of producing wrong numbers.
// Run: node tests/notebook-table-formula-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const {
  applyReferencePick,
  computeNotebookResultTables,
  fillCellContent,
  translateFormulaReferences,
  computeNotebookResultTable,
  notebookTableColumnLetter,
  resolveNotebookResultTableValues,
  resolveNotebookResultTablesValues
} = loadEsmStyleModule(path.join(root, 'src/renderer/lib/notebook-table-formulas.js'));
const { addNotebookResultTableColumn, createDefaultNotebookResultTable } = loadEsmStyleModule(
  path.join(root, 'src/renderer/lib/notebook-result-tables.js')
);
const { createSpreadsheetReferencePicker } = loadEsmStyleModule(
  path.join(root, 'src/renderer/lib/spreadsheet-reference-picker.js')
);

// Builds a table from a grid of cell texts, with the field names the notebook uses.
function tableOf(grid) {
  const columnCount = Math.max(...grid.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_unused, index) => ({
    field: `column_${index + 1}`,
    title: `Column ${index + 1}`
  }));
  return {
    columns,
    rows: grid.map((cells, rowIndex) => {
      const row = { id: `row_${rowIndex + 1}` };
      columns.forEach((column, columnIndex) => {
        row[column.field] = String(cells[columnIndex] ?? '');
      });
      return row;
    })
  };
}

// The text one cell displays, by its A1 address.
function cellAt(table, columnIndex, rowIndex) {
  const { byRowId } = computeNotebookResultTable(table);
  return byRowId[`row_${rowIndex + 1}`][`column_${columnIndex + 1}`];
}

const text = (table, column, row) => cellAt(table, column, row).text;

// --- column letters ---
assert.equal(notebookTableColumnLetter(0), 'A', 'first column is A');
assert.equal(notebookTableColumnLetter(25), 'Z', 'twenty-sixth column is Z');
assert.equal(notebookTableColumnLetter(26), 'AA', 'letters roll over like a spreadsheet');
assert.equal(notebookTableColumnLetter(701), 'ZZ', 'two-letter columns run to ZZ');

// --- plain cells are left alone ---
const plain = tableOf([['2', 'text'], ['3', '']]);
assert.equal(text(plain, 0, 0), '2', 'a number is displayed as typed');
assert.equal(text(plain, 1, 0), 'text', 'text is displayed as typed');
assert.equal(cellAt(plain, 0, 0).formula, false, 'a plain cell is not flagged as a formula');

// A leading apostrophe is the only way to show text that starts with "=".
const escaped = tableOf([["'=> see figure 2", "'=SUM(A1:A2)"]]);
assert.equal(text(escaped, 0, 0), '=> see figure 2', 'an escaped cell shows its text without the apostrophe');
assert.equal(text(escaped, 1, 0), '=SUM(A1:A2)', 'an escaped formula is shown, not evaluated');
assert.equal(cellAt(escaped, 1, 0).formula, false, 'an escaped cell is not a formula');

// --- cell references and arithmetic ---
const refs = tableOf([['2', '=A1*3'], ['4', '=A1+A2'], ['', '=B1+B2']]);
assert.equal(text(refs, 1, 0), '6', 'a formula reads another cell');
assert.equal(text(refs, 1, 1), '6', 'formulas add two cells');
assert.equal(text(refs, 1, 2), '12', 'formulas can reference other formulas');
assert.equal(cellAt(refs, 1, 0).formula, true, 'a formula cell is flagged');
assert.equal(text(tableOf([['0.1', '0.2', '=A1+B1']]), 2, 0), '0.3', 'float noise is trimmed');
assert.equal(text(tableOf([['5', '=a1*2']]), 1, 0), '10', 'references are case-insensitive');

// --- references across multiple result tables ---
const siblingTables = [
  tableOf([['2'], ['4']]),
  tableOf([['=Table1:A1*2', '=A1+Table1:A2']])
];
const siblingComputed = computeNotebookResultTables(siblingTables);
assert.equal(
  siblingComputed[1].byRowId.row_1.column_1.text,
  '4',
  'Table1:A1 reads a cell in a sibling result table'
);
assert.equal(
  siblingComputed[1].byRowId.row_1.column_2.text,
  '8',
  'a formula can mix its local table with an explicitly qualified table'
);
const crossTableCycle = computeNotebookResultTables([
  tableOf([['=Table2:A1']]),
  tableOf([['=Table1:A1']])
]);
assert.equal(crossTableCycle[0].byRowId.row_1.column_1.text, '#ERROR', 'cross-table cycles are rejected');
assert.match(crossTableCycle[0].byRowId.row_1.column_1.error, /circular reference/, 'the cross-table cycle is explained');
assert.equal(
  resolveNotebookResultTablesValues(siblingTables)[1].rows[0].column_2,
  '8',
  'PDF and agent-context table resolution keeps cross-table values'
);

// --- ranges and aggregates ---
const ranges = tableOf([
  ['2', '=SUM(A1:A4)'],
  ['4', '=MEAN(A1:A4)'],
  ['6', '=COUNT(A1:A4)'],
  ['', '=MAX(A1:A4) - MIN(A1:A4)']
]);
assert.equal(text(ranges, 1, 0), '12', 'SUM over a column range');
assert.equal(text(ranges, 1, 1), '4', 'MEAN ignores the empty cell rather than averaging in a zero');
assert.equal(text(ranges, 1, 2), '3', 'COUNT counts only filled numeric cells');
assert.equal(text(ranges, 1, 3), '4', 'MAX and MIN over the same range');

const wide = tableOf([['1', '2', '3'], ['4', '5', '6'], ['=SUM(A1:C2)', '', '']]);
assert.equal(text(wide, 0, 2), '21', 'a rectangular block sums every cell in it');

const overrun = tableOf([['2', ''], ['3', ''], ['', '=SUM(A1:A20)']]);
assert.equal(text(overrun, 1, 2), '5', 'a range past the last row stops at the table edge');

const mixed = tableOf([['2'], ['n/a'], ['4'], ['=SUM(A1:A3)']]);
assert.equal(text(mixed, 0, 3), '6', 'text cells drop out of a range instead of failing it');

// --- errors are reported, never guessed at ---
const badRef = tableOf([['abc', '=A1*2']]);
assert.equal(text(badRef, 1, 0), '#ERROR', 'text in arithmetic is an error, not a zero');
assert.match(cellAt(badRef, 1, 0).error, /not a number/, 'the error names the problem');

const offGrid = tableOf([['2', '=Z9+1']]);
assert.equal(text(offGrid, 1, 0), '#ERROR', 'a reference off the table is an error');
assert.match(cellAt(offGrid, 1, 0).error, /outside this table/, 'the error says the cell is off-table');

const typo = tableOf([['2', '=SUMM(A1)']]);
assert.equal(text(typo, 1, 0), '#ERROR', 'an unknown function is an error');
assert.match(cellAt(typo, 1, 0).error, /Unknown function/, 'the error names the typo');

const selfRef = tableOf([['=A1+1']]);
assert.equal(text(selfRef, 0, 0), '#ERROR', 'a cell referring to itself is an error');
assert.match(cellAt(selfRef, 0, 0).error, /refers to itself/, 'the error says it is circular');

const cycle = tableOf([['=B1+1', '=A1+1']]);
assert.equal(text(cycle, 0, 0), '#ERROR', 'a two-cell cycle is an error');
assert.equal(text(cycle, 1, 0), '#ERROR', 'both ends of the cycle report it');

// A running total that includes its own cell is the classic spreadsheet mistake; it
// must not quietly report the sum of everything above it.
const rangeCycle = tableOf([['2'], ['3'], ['=SUM(A1:A3)']]);
assert.equal(text(rangeCycle, 0, 2), '#ERROR', 'a range covering its own cell is circular');
assert.match(cellAt(rangeCycle, 0, 2).error, /refers to itself/, 'the range cycle says it is circular');

const brokenSource = tableOf([['=1/0', '=A1+1']]);
assert.equal(text(brokenSource, 0, 0), '#NUM!', 'a non-finite result reads as #NUM!');
assert.equal(text(brokenSource, 1, 0), '#NUM!', 'a non-finite error propagates through direct references');
assert.match(cellAt(brokenSource, 0, 0).error, /not a finite number/, 'the source cell records why it is non-finite');

const brokenRange = tableOf([
  ['=1/0', '=SUM(A1:A2)'],
  ['5', '']
]);
assert.equal(text(brokenRange, 1, 0), '#NUM!', 'a range cannot silently omit a non-finite formula cell');
assert.match(cellAt(brokenRange, 1, 0).error, /not a finite number/, 'the aggregate carries the source error');

const invalidRange = tableOf([
  ['=SUMM(1)', '=SUM(A1:A2)'],
  ['5', '']
]);
assert.equal(text(invalidRange, 1, 0), '#ERROR', 'a range cannot silently omit a formula parse error');
assert.match(cellAt(invalidRange, 1, 0).error, /Unknown function/, 'the aggregate carries the parse error');

// --- references follow the table's shape ---
const shifted = addNotebookResultTableColumn(tableOf([['2', '=A1*3']]), null);
assert.equal(
  computeNotebookResultTable(shifted).byRowId.row_1[shifted.columns[1].field].text,
  '6',
  'adding a column on the right leaves existing references alone'
);

// --- the resolved view used by PDF export and the AI context block ---
const resolved = resolveNotebookResultTableValues(tableOf([['2', '=A1*3']]));
assert.equal(resolved.rows[0][resolved.columns[1].field], '6', 'the resolved table carries values, not formulas');
assert.equal(resolved.rows[0][resolved.columns[0].field], '2', 'plain cells survive the resolved view');
assert.equal(resolveNotebookResultTableValues(null), null, 'no table resolves to nothing');

// --- point mode: building a formula by clicking cells ---
// Picks are chained the way the editor chains them: each result's `pick` feeds the
// next call, and the caret lands where the click left it.
function pickSeq(start, clicks) {
  let state = { value: start, caret: start.length, pick: null };
  for (const { address, extendRange = false, type = '' } of clicks) {
    if (type) {
      // Typing between picks moves the caret and retires the pick.
      state = {
        value: state.value.slice(0, state.caret) + type + state.value.slice(state.caret),
        caret: state.caret + type.length,
        pick: state.pick
      };
    }
    const result = applyReferencePick({
      value: state.value,
      caretStart: state.caret,
      caretEnd: state.caret,
      address,
      extendRange,
      pick: state.pick
    });
    state = { value: result.value, caret: result.caret, pick: result.pick };
  }
  return state.value;
}

assert.equal(pickSeq('=', [{ address: 'A1' }]), '=A1', 'a click types the cell address');

// The bug this guards: a mis-click corrected by clicking elsewhere used to append,
// leaving "=A1B2" instead of replacing the wrong reference.
assert.equal(pickSeq('=', [{ address: 'A1' }, { address: 'B2' }]), '=B2', 'the next click corrects the last one');
assert.equal(
  pickSeq('=', [{ address: 'A1' }, { address: 'B2' }, { address: 'C3' }]),
  '=C3',
  'corrections can be repeated'
);

assert.equal(
  pickSeq('=SUM(', [{ address: 'A1' }, { address: 'A3', extendRange: true }]),
  '=SUM(A1:A3',
  'shift-click widens the pick into a range'
);
assert.equal(
  pickSeq('=MAX(', [{ address: 'Table1:A1' }, { address: 'Table1:A8', extendRange: true }]),
  '=MAX(Table1:A1:A8',
  'a qualified range keeps one source-table prefix'
);
assert.equal(
  pickSeq('=', [{ address: 'Table1:A1' }, { address: 'Table2:A1', extendRange: true }]),
  '=Table2:A1',
  'shift-clicking another table selects that cell instead of creating a cross-table range'
);
assert.equal(
  pickSeq('=SUM(', [{ address: 'A1' }, { address: 'A3', extendRange: true }, { address: 'A5', extendRange: true }]),
  '=SUM(A1:A5',
  're-extending grows from the same anchor instead of chaining colons'
);
assert.equal(
  pickSeq('=SUM(', [{ address: 'A1' }, { address: 'A3', extendRange: true }, { address: 'B2' }]),
  '=SUM(B2',
  'a plain click replaces the whole range'
);

// Typing retires the pick, so the click after it starts a new reference.
assert.equal(
  pickSeq('=', [{ address: 'A1' }, { address: 'A2', type: '+' }]),
  '=A1+A2',
  'a reference typed after is appended, not replaced'
);
assert.equal(
  pickSeq('=', [{ address: 'A1' }, { address: 'A3', type: '+', extendRange: true }]),
  '=A1+A3',
  'shift-clicking with no live pick and no typed reference just inserts the address'
);

// A reference the user typed by hand can still be extended by shift-clicking.
assert.equal(
  applyReferencePick({ value: '=SUM(B2', caretStart: 7, address: 'B5', extendRange: true }).value,
  '=SUM(B2:B5',
  'shift-click grows from a hand-typed reference'
);

// The reusable DOM controller keeps an editor open while its host maps clicks to
// feature-specific addresses. Notebook and Assay both use this exact event lifecycle.
const pickerListeners = {};
const pickerRoot = {
  addEventListener(type, handler) { pickerListeners[type] = handler; },
  removeEventListener(type, handler) {
    if (pickerListeners[type] === handler) delete pickerListeners[type];
  }
};
const pickerInput = {
  value: '=',
  selectionStart: 1,
  selectionEnd: 1,
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  focus() { this.focused = true; }
};
const pickerCell = { contains: () => false };
let pickerAddress = 'Table1:A1';
const pickerController = createSpreadsheetReferencePicker({
  roots: [pickerRoot],
  findEditor: () => pickerInput,
  addressOfCell: () => pickerAddress
});
function pickerEvent() {
  return {
    button: 0,
    target: { closest: (selector) => (selector === '.tabulator-cell' ? pickerCell : null) },
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}
pickerListeners.mousedown(pickerEvent());
assert.equal(pickerInput.value, '=Table1:A1', 'the shared picker inserts the mapped first-table address');
pickerInput.value += '+';
pickerInput.selectionStart = pickerInput.value.length;
pickerInput.selectionEnd = pickerInput.value.length;
pickerAddress = 'Table2:A1';
pickerListeners.mousedown(pickerEvent());
assert.equal(pickerInput.value, '=Table1:A1+Table2:A1', 'the shared picker can mix mapped table sources');
pickerController.destroy();
assert.equal(pickerListeners.mousedown, undefined, 'destroy removes the shared capture listeners');

// --- drag to fill: relative references shift with the cell ---
assert.equal(translateFormulaReferences('=A1*2', 0, 1), '=A2*2', 'filling down advances the row');
assert.equal(translateFormulaReferences('=A1*2', 1, 0), '=B1*2', 'filling across advances the column');
assert.equal(translateFormulaReferences('=SUM(A1:A3)', 1, 0), '=SUM(B1:B3)', 'both ends of a range shift');
assert.equal(translateFormulaReferences('=A1+B2-C3', 0, 2), '=A3+B4-C5', 'every reference shifts');
assert.equal(translateFormulaReferences('=Z1+1', 1, 0), '=AA1+1', 'shifting past Z rolls into AA');

// Function names ending in digits look exactly like cell references; translating
// LOG10 into LOG12 would silently compute the wrong thing.
assert.equal(translateFormulaReferences('=LOG10(B2)', 0, 2), '=LOG10(B4)', 'LOG10 is a function, not a cell');
assert.equal(translateFormulaReferences('=LOG10 (B2)', 0, 2), '=LOG10 (B4)', 'a space before "(" still marks a call');
assert.equal(
  translateFormulaReferences('=Table1:A1+MAX(Table2:B1:B3)', 1, 2),
  '=Table1:B3+MAX(Table2:C3:C5)',
  'table names stay fixed while their cell references shift'
);

// Off the top or left edge there is no cell to point at, so the fill reports it.
assert.equal(translateFormulaReferences('=A1+B1', 0, -1), '=#REF!+#REF!', 'filling above row 1 is #REF!');
assert.equal(translateFormulaReferences('=A1', -1, 0), '=#REF!', 'filling left of column A is #REF!');
assert.equal(text(tableOf([['=#REF!']]), 0, 0), '#ERROR', 'a #REF! formula reports instead of computing');

assert.equal(translateFormulaReferences('=A1*2', 0, 0), '=A1*2', 'filling nowhere changes nothing');
assert.equal(translateFormulaReferences('plain text', 0, 3), 'plain text', 'plain text is never rewritten');
assert.equal(fillCellContent('37 C', 0, 3), '37 C', 'filling a plain cell copies it');
assert.equal(fillCellContent('=A1*2', 0, 3), '=A4*2', 'filling a formula shifts its references');

// --- formulas waiting on empty cells show the arithmetic that is left ---
// A half-recorded experiment is the normal state of a notebook page: the formula is
// written before the readings exist, so the cell shows what still has to be worked out
// rather than a number computed by pretending the blanks are zero.
const pendingTable = (formula) => tableOf([
  ['10', '', '', ''],
  ['18', '', '', ''],
  [formula, '', '', '']
]);
const pending = (formula) => cellAt(pendingTable(formula), 0, 2);

assert.equal(pending('=A1+A2+D3').text, '28+D3', 'the known terms fold, the empty cell stays');
assert.equal(pending('=A1+A2+D3').pending, true, 'the cell is flagged as waiting, not failed');
assert.equal(pending('=A1+A2+D3').error, null, 'waiting on a cell is not an error');
assert.equal(pending('=D3*0.18').text, 'D3*0.18', 'a constant factor is kept as written');
assert.equal(pending('=A1+A2*D3').text, '10+18*D3', 'no parentheses where precedence already agrees');
assert.equal(pending('=(A1+D3)*2').text, '(10+D3)*2', 'parentheses are kept where dropping them would change the result');
assert.equal(pending('=A1-(D3-A2)').text, '10-(D3-18)', 'a subtraction on the right keeps its grouping');
assert.equal(pending('=SUM(A1:A2)+D3').text, '28+D3', 'a range that is fully filled folds to its total');
assert.equal(pending('=LOG10(D3)+A1').text, 'LOG10(D3)+10', 'a call waiting on a cell is left standing');
assert.equal(pending('=MEAN(A1:A2, D3)').text, 'MEAN(A1:A2, D3)', 'a partly filled argument list stays symbolic');

// Once everything is filled in, the cell goes back to being a number.
assert.equal(pending('=A1+A2').text, '28', 'a fully filled formula still computes');
assert.equal(pending('=A1+A2').pending, undefined, 'a computed cell is not flagged as waiting');

// Waiting spreads: a formula reading a waiting cell is itself waiting.
const chained = tableOf([['10', '=A1+D1', '', ''], ['', '=B1*2', '', '']]);
assert.equal(cellAt(chained, 1, 0).text, '10+D1', 'the first formula waits on the empty cell');
assert.equal(cellAt(chained, 1, 1).text, 'B1*2', 'a formula reading a waiting cell waits too');

// A cell that does not exist cannot be filled in, so it stays an error.
assert.equal(text(tableOf([['10', '=A1+Z9']]), 1, 0), '#ERROR', 'a reference off the table is still an error');

// --- plate addressing: letters are rows, digits are columns ---
// A microplate names B3 as row B, column 3. The same parser reads it the other way
// round for a plain grid, and reading it backwards silently returns the transposed
// cell -- a wrong number rather than an error.
const plateGrid = (formula) => tableOf([
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [formula, '', '']
]);
const onPlate = (formula) => computeNotebookResultTable(plateGrid(formula), { plateAddressing: true })
  .byRowId.row_4.column_1.text;
const onGrid = (formula) => computeNotebookResultTable(plateGrid(formula))
  .byRowId.row_4.column_1.text;

assert.equal(onPlate('=B3'), '6', 'on a plate B3 is row B, column 3');
assert.equal(onGrid('=B3'), '8', 'on a plain grid B3 is column B, row 3');
assert.equal(onPlate('=C1'), '7', 'on a plate C1 is row C, column 1');
assert.equal(onPlate('=SUM(A1:C1)'), '12', 'a plate range down column 1');
assert.equal(onPlate('=MEAN(A1:A3)'), '2', 'a plate range across row A');

// Filling down a plate steps the row letter; filling across steps the column number.
assert.equal(
  translateFormulaReferences('=A1*2', 0, 1, { plateAddressing: true }),
  '=B1*2',
  'filling down a plate column advances the row letter'
);
assert.equal(
  translateFormulaReferences('=A1*2', 1, 0, { plateAddressing: true }),
  '=A2*2',
  'filling across a plate row advances the column number'
);
assert.equal(translateFormulaReferences('=A1*2', 0, 1), '=A2*2', 'a plain grid still steps the digit');

// --- a typed table size is honoured, and bounded ---
const sized = (options) => {
  const table = createDefaultNotebookResultTable(null, options);
  return `${table.columns.length}x${table.rows.length}`;
};
assert.equal(sized(undefined), '3x3', 'the default table is 3x3');
assert.equal(sized({ columnCount: 5, rowCount: 8 }), '5x8', 'a typed size is used as given');
assert.equal(sized({ columnCount: 0, rowCount: 0 }), '3x3', 'zero falls back to the default');
assert.equal(sized({ columnCount: 2.7, rowCount: 4.9 }), '2x4', 'fractions are truncated, not rounded up');
// Every cell is a DOM node, so a stray digit must not build a grid that hangs the app.
assert.equal(sized({ columnCount: 9999, rowCount: 99999 }), '50x500', 'an absurd size is clamped');

console.log('notebook table formula self-check passed');
