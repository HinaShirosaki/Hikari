import {
  applyReferencePick,
  isNotebookTableFormula
} from './notebook-table-formulas.js';

// Shared spreadsheet "point mode": while a formula editor is open, clicking a cell
// inserts the address supplied by the host instead of moving the edit to that cell.
// The host owns address semantics (plain grid, plate grid, TableN qualification); this
// controller owns the capture-phase event handling and formula-selection bookkeeping.
export function createSpreadsheetReferencePicker({
  roots = [],
  findEditor,
  addressOfCell,
  shouldIgnore,
  isFormula = isNotebookTableFormula
} = {}) {
  const eventRoots = Array.from(new Set((Array.isArray(roots) ? roots : [roots]).filter(Boolean)));
  let swallowNextClick = false;
  let lastPick = null;

  function insertReference(input, address, extendRange) {
    const result = applyReferencePick({
      value: input.value,
      caretStart: Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length,
      caretEnd: Number.isFinite(input.selectionEnd) ? input.selectionEnd : input.value.length,
      address,
      extendRange,
      pick: lastPick?.input === input ? lastPick.pick : null
    });
    input.value = result.value;
    input.setSelectionRange?.(result.caret, result.caret);
    input.focus?.();
    lastPick = { input, pick: result.pick };
  }

  function onPointerDown(event) {
    swallowNextClick = false;
    if (event?.button !== undefined && event.button !== 0) {
      return;
    }
    if (typeof shouldIgnore === 'function' && shouldIgnore(event)) {
      return;
    }
    const input = typeof findEditor === 'function' ? findEditor() : null;
    const cellElement = event?.target?.closest?.('.tabulator-cell');
    if (!input || !isFormula(input.value) || !cellElement || cellElement.contains?.(input)) {
      return;
    }
    const address = typeof addressOfCell === 'function'
      ? addressOfCell({ cellElement, event, input })
      : '';
    if (!address) {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    swallowNextClick = true;
    insertReference(input, address, Boolean(event.shiftKey));
  }

  function onClick(event) {
    if (!swallowNextClick) {
      return;
    }
    swallowNextClick = false;
    event.preventDefault?.();
    event.stopPropagation?.();
  }

  eventRoots.forEach((root) => {
    root.addEventListener?.('mousedown', onPointerDown, true);
    root.addEventListener?.('click', onClick, true);
  });

  return {
    destroy() {
      eventRoots.forEach((root) => {
        root.removeEventListener?.('mousedown', onPointerDown, true);
        root.removeEventListener?.('click', onClick, true);
      });
      swallowNextClick = false;
      lastPick = null;
    }
  };
}
