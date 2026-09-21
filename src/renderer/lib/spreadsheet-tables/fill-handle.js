import { fillCellContent, isNotebookTableFormula } from '../notebook-table-formulas.js';

// A compact grip marks the bottom or right cell edge. Drag that edge to copy
// the cell, shifting relative references as a spreadsheet does.
function createSpreadsheetFillHandle({
  host,
  getGrids,
  getDraftTables,
  handleEdited,
  canFillCell = () => true,
  canStartFillCell,
  applyFill
} = {}) {
  /* -------------------------------------------------------------- fill edges */

  const FILL_EDGE_PX = 10;

  let fillEdge = null;      // { tableIndex, columnIndex, rowIndex, axis }
  let fillHandle = null;
  let fillEdgeCell = null;
  let fillDrag = null;

  function cellElementAt(tableIndex, columnIndex, rowIndex) {
    const field = getDraftTables()[tableIndex]?.columns?.[columnIndex]?.field;
    const row = getGrids()[tableIndex]?.getRows?.()?.[rowIndex];
    return field && row ? row.getCell?.(field)?.getElement?.() : null;
  }

  function cellPositionOf(tableIndex, cellElement) {
    const field = cellElement?.getAttribute?.('tabulator-field');
    const columnIndex = (getDraftTables()[tableIndex]?.columns || []).findIndex((column) => column.field === field);
    const rowElement = cellElement?.closest?.('.tabulator-row');
    const rowIndex = (getGrids()[tableIndex]?.getRows?.() || [])
      .findIndex((row) => row?.getElement?.() === rowElement);
    return columnIndex >= 0 && rowIndex >= 0 ? { tableIndex, columnIndex, rowIndex } : null;
  }

  function hideFillHandle() {
    fillHandle?.remove?.();
    fillHandle = null;
    fillEdgeCell?.classList?.remove('is-fill-edge', 'is-fill-ready');
    fillEdgeCell = null;
    fillEdge = null;
  }

  // The overlay is decoration only -- pointer-events stay off it so it can never
  // swallow a click meant for the cell it is drawn over.
  function showFillHandle(cellElement, position, axis) {
    hideFillHandle();
    const element = document.createElement('span');
    element.className = `spreadsheet-fill-handle spreadsheet-fill-handle--${axis}`;
    element.setAttribute('aria-hidden', 'true');
    cellElement.appendChild(element);
    fillHandle = element;
    fillEdgeCell = cellElement;
    cellElement.classList.add('is-fill-edge');
    fillEdge = { ...position, axis };
  }

  // Which way a fill would go from the cell under the pointer. Hovering anywhere in a
  // cell offers the downward fill, so the grip is found by moving over the table
  // rather than by aiming at a border; the right-hand strip switches to across.
  function fillAxisAt(event, cellElement, position) {
    const table = getDraftTables()[position.tableIndex];
    const rect = cellElement.getBoundingClientRect();
    const canFillDown = position.rowIndex + 1 < (table?.rows?.length || 0);
    const canFillAcross = position.columnIndex + 1 < (table?.columns?.length || 0);
    const toRight = rect.right - event.clientX;
    if (canFillAcross && toRight >= 0 && toRight <= FILL_EDGE_PX) {
      return 'column';
    }
    if (canFillDown) {
      return 'row';
    }
    return canFillAcross ? 'column' : '';
  }

  // The grip is a hint; the drag itself starts from the border strip it marks, so
  // clicking in the body of a cell still edits it.
  function pointerInFillZone(event) {
    const cellRect = fillEdgeCell?.getBoundingClientRect?.();
    if (!fillEdge || !cellRect) {
      return false;
    }
    const distance = fillEdge.axis === 'row'
      ? cellRect.bottom - event.clientY
      : cellRect.right - event.clientX;
    return event.clientX >= cellRect.left && event.clientX <= cellRect.right
      && event.clientY >= cellRect.top && event.clientY <= cellRect.bottom
      && distance >= 0 && distance <= FILL_EDGE_PX;
  }

  function onHostMouseMove(event) {
    if (fillDrag) {
      return;
    }
    const cellElement = event?.target?.closest?.('.tabulator-cell');
    const tableHost = cellElement?.closest?.('[data-result-table-host]');
    const tableIndex = Number(tableHost?.dataset?.resultTableHost);
    const position = cellElement && getGrids()[tableIndex] ? cellPositionOf(tableIndex, cellElement) : null;
    const canStartFill = typeof canStartFillCell === 'function' ? canStartFillCell : canFillCell;
    if (!position || !canStartFill(position)) {
      hideFillHandle();
      return;
    }
    const axis = fillAxisAt(event, cellElement, position);
    if (!axis) {
      hideFillHandle();
      return;
    }
    if (!fillEdge
      || fillEdge.tableIndex !== tableIndex
      || fillEdge.axis !== axis
      || fillEdge.columnIndex !== position.columnIndex
      || fillEdge.rowIndex !== position.rowIndex) {
      showFillHandle(cellElement, position, axis);
    }
    cellElement.classList.toggle('is-fill-ready', pointerInFillZone(event));
  }

  function clearFillPreview() {
    (fillDrag?.targets || []).forEach(({ columnIndex, rowIndex }) => {
      cellElementAt(fillDrag.tableIndex, columnIndex, rowIndex)?.classList?.remove('is-fill-target');
    });
  }

  // The edge commits to a direction, so the drag follows it however the pointer
  // wanders -- dragging down and slightly left still fills straight down.
  function fillTargetsFor(anchorPosition, target) {
    const targets = [];
    if (anchorPosition.axis === 'row') {
      const span = target.rowIndex - anchorPosition.rowIndex;
      const step = span > 0 ? 1 : -1;
      for (let offset = step; Math.abs(offset) <= Math.abs(span); offset += step) {
        targets.push({ columnIndex: anchorPosition.columnIndex, rowIndex: anchorPosition.rowIndex + offset });
      }
      return targets;
    }
    const span = target.columnIndex - anchorPosition.columnIndex;
    const step = span > 0 ? 1 : -1;
    for (let offset = step; Math.abs(offset) <= Math.abs(span); offset += step) {
      targets.push({ columnIndex: anchorPosition.columnIndex + offset, rowIndex: anchorPosition.rowIndex });
    }
    return targets;
  }

  // Which cell the pointer has reached, measured against the cells themselves rather
  // than by hit-testing: dragging past the last row should still fill to the end, and
  // the pointer may be over the grip or outside the table entirely.
  function fillTargetAt(event) {
    const { tableIndex, columnIndex, rowIndex, axis } = fillDrag;
    const table = getDraftTables()[tableIndex];
    const alongRows = axis === 'row';
    const count = alongRows ? (table?.rows?.length || 0) : (table?.columns?.length || 0);
    let reached = alongRows ? rowIndex : columnIndex;
    for (let index = 0; index < count; index += 1) {
      const element = alongRows
        ? cellElementAt(tableIndex, columnIndex, index)
        : cellElementAt(tableIndex, index, rowIndex);
      const rect = element?.getBoundingClientRect?.();
      if (!rect) {
        continue;
      }
      const past = alongRows ? event.clientY >= rect.top : event.clientX >= rect.left;
      if (past) {
        reached = index;
      }
    }
    return alongRows
      ? { columnIndex, rowIndex: reached }
      : { columnIndex: reached, rowIndex };
  }

  function onFillMove(event) {
    if (!fillDrag) {
      return;
    }
    const position = fillTargetAt(event);
    clearFillPreview();
    fillDrag.targets = fillTargetsFor(fillDrag, position)
      .filter((target) => canFillCell({ tableIndex: fillDrag.tableIndex, ...target }));
    fillDrag.targets.forEach(({ columnIndex, rowIndex }) => {
      cellElementAt(fillDrag.tableIndex, columnIndex, rowIndex)?.classList?.add('is-fill-target');
    });
  }

  function cancelFillDrag() {
    clearFillPreview();
    if (fillDrag) {
      document.removeEventListener('mousemove', onFillMove, true);
      document.removeEventListener('mouseup', onFillUp, true);
    }
    fillDrag = null;
    hideFillHandle();
  }

  function onFillUp() {
    if (!fillDrag) {
      return;
    }
    const { tableIndex, columnIndex, rowIndex, targets } = fillDrag;
    clearFillPreview();
    document.removeEventListener('mousemove', onFillMove, true);
    document.removeEventListener('mouseup', onFillUp, true);
    fillDrag = null;

    const table = getDraftTables()[tableIndex];
    const grid = getGrids()[tableIndex];
    const sourceField = table?.columns?.[columnIndex]?.field;
    if (!grid || !sourceField || !targets.length) {
      return;
    }
    const source = String(table.rows[rowIndex]?.[sourceField] ?? '');
    if (applyFill) {
      applyFill({ tableIndex, columnIndex, rowIndex, targets, source });
      return;
    }
    targets.forEach((target) => {
      const field = table.columns[target.columnIndex]?.field;
      const row = grid.getRows?.()?.[target.rowIndex];
      if (!field || !row) {
        return;
      }
      row.update?.({
        [field]: fillCellContent(source, target.columnIndex - columnIndex, target.rowIndex - rowIndex)
      });
    });
    handleEdited(tableIndex);
  }

  function startFillDrag(event) {
    if (!fillEdge) {
      return false;
    }
    const anchor = { ...fillEdge };
    event.preventDefault?.();
    event.stopPropagation?.();
    // Starting a fill mid-edit commits first, so it copies what is on screen rather
    // than the value from before the edit. Tabulator discards the edit on blur and
    // offers no commit call, so this sends the Enter the user would have pressed.
    host?.querySelector?.('.tabulator-cell input')?.dispatchEvent?.(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })
    );
    fillDrag = { ...anchor, targets: [] };
    hideFillHandle();
    document.addEventListener('mousemove', onFillMove, true);
    document.addEventListener('mouseup', onFillUp, true);
    return true;
  }

  function findOpenFormulaEditor() {
    const input = host?.querySelector?.('.tabulator-cell input');
    return input && isNotebookTableFormula(input.value) ? input : null;
  }

  function onHostFillPointerDown(event) {
    if (event.button !== 0) return;
    if (pointerInFillZone(event) && startFillDrag(event)) {
      return;
    }
  }

  return {
    cancelFillDrag,
    cellElementAt,
    cellPositionOf,
    hideFillHandle,
    onHostMouseMove,
    pointerInFillZone,
    startFillDrag,
    findOpenFormulaEditor,
    onHostFillPointerDown
  };
}

export { createSpreadsheetFillHandle };
