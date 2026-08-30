import { fillCellContent, isNotebookTableFormula } from '../notebook-table-formulas.js';

// Hovering a cell's bottom or right border raises a run of chevrons pointing the
// way a fill would go. Press and drag along them to copy the cell that way,
// shifting relative references as a spreadsheet does.
function createSpreadsheetFillHandle({
  host,
  getGrids,
  getDraftTables,
  handleEdited
} = {}) {
  /* -------------------------------------------------------------- fill edges */

  // Hovering a cell's bottom or right border raises a run of chevrons pointing the way
  // the fill would go, fading with distance. Press and drag along them to copy the cell
  // that way, shifting relative references as a spreadsheet does.
  const FILL_EDGE_PX = 10;

  let fillEdge = null;      // { tableIndex, columnIndex, rowIndex, axis }
  let fillArrows = null;
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

  // Three chevrons, darkest nearest the cell, pointing the way the fill would go.
  // Drawn at a fixed size and centred on the border rather than stretched along it:
  // stretching to a wide cell flattens the V until it reads as a bent bar.
  const ARROW_ACROSS = 22;    // span perpendicular to the fill direction
  const ARROW_DIP = 11;       // how far each V points -- half the span, so ~50 degree
                              // arms. Shallower than this and three stacked chevrons
                              // read as one solid triangle.
  const ARROW_STROKE = 2;
  const ARROW_GAP = 7;      // start-to-start; must clear the stroke or they merge
  const ARROW_PAD = 2;
  const ARROW_SPAN = (ARROW_GAP * 2) + ARROW_DIP + (ARROW_PAD * 2);
  const ARROW_FADE = [1, 0.45, 0.18];

  function fillArrowMarkup(axis) {
    const near = ARROW_PAD;
    const far = ARROW_ACROSS - ARROW_PAD;
    const middle = ARROW_ACROSS / 2;
    const paths = ARROW_FADE.map((opacity, index) => {
      const at = ARROW_PAD + (index * ARROW_GAP);
      const tip = at + ARROW_DIP;
      const d = axis === 'row'
        ? `M${near} ${at} L${middle} ${tip} L${far} ${at}`
        : `M${at} ${near} L${tip} ${middle} L${at} ${far}`;
      return `<path opacity="${opacity}" d="${d}"/>`;
    }).join('');
    const viewBox = axis === 'row'
      ? `0 0 ${ARROW_ACROSS} ${ARROW_SPAN}`
      : `0 0 ${ARROW_SPAN} ${ARROW_ACROSS}`;
    // Stroked rather than filled: round caps and joins keep the points clean at this
    // size, where filled polygons show ragged corners.
    return `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="${ARROW_STROKE}" `
      + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  function hideFillArrows() {
    fillArrows?.remove?.();
    fillArrows = null;
    fillEdgeCell?.classList?.remove('is-fill-edge');
    fillEdgeCell = null;
    fillEdge = null;
  }

  // The overlay is decoration only -- pointer-events stay off it so it can never
  // swallow a click meant for the cell it is drawn over.
  function showFillArrows(cellElement, position, axis) {
    hideFillArrows();
    const parent = cellElement.closest?.('.tabulator');
    if (!parent) {
      return;
    }
    const cellRect = cellElement.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const element = document.createElement('span');
    element.className = 'spreadsheet-fill-arrows';
    element.innerHTML = fillArrowMarkup(axis);
    if (axis === 'row') {
      const across = Math.min(ARROW_ACROSS, cellRect.width);
      element.style.left = `${cellRect.left - parentRect.left + ((cellRect.width - across) / 2)}px`;
      element.style.top = `${cellRect.bottom - parentRect.top - 5}px`;
      element.style.width = `${across}px`;
      element.style.height = `${ARROW_SPAN}px`;
    } else {
      const across = Math.min(ARROW_ACROSS, cellRect.height);
      element.style.left = `${cellRect.right - parentRect.left - 5}px`;
      element.style.top = `${cellRect.top - parentRect.top + ((cellRect.height - across) / 2)}px`;
      element.style.width = `${ARROW_SPAN}px`;
      element.style.height = `${across}px`;
    }
    parent.appendChild(element);
    fillArrows = element;
    fillEdgeCell = cellElement;
    cellElement.classList.add('is-fill-edge');
    fillEdge = { ...position, axis };
  }

  // Which way a fill would go from the cell under the pointer. Hovering anywhere in a
  // cell offers the downward fill, so the chevrons are found by moving over the table
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

  // The chevrons are a hint; the drag itself starts from the border strip they hug, so
  // clicking in the body of a cell still edits it.
  function pointerInFillZone(event) {
    const cellRect = fillEdgeCell?.getBoundingClientRect?.();
    if (!fillEdge || !cellRect) {
      return false;
    }
    const distance = fillEdge.axis === 'row'
      ? cellRect.bottom - event.clientY
      : cellRect.right - event.clientX;
    return distance >= 0 && distance <= FILL_EDGE_PX;
  }

  function onHostMouseMove(event) {
    if (fillDrag) {
      return;
    }
    const cellElement = event?.target?.closest?.('.tabulator-cell');
    const tableHost = cellElement?.closest?.('[data-result-table-host]');
    const tableIndex = Number(tableHost?.dataset?.resultTableHost);
    const position = cellElement && getGrids()[tableIndex] ? cellPositionOf(tableIndex, cellElement) : null;
    if (!position) {
      hideFillArrows();
      return;
    }
    const axis = fillAxisAt(event, cellElement, position);
    if (!axis) {
      hideFillArrows();
      return;
    }
    if (fillEdge
      && fillEdge.axis === axis
      && fillEdge.columnIndex === position.columnIndex
      && fillEdge.rowIndex === position.rowIndex) {
      return;
    }
    showFillArrows(cellElement, position, axis);
  }

  function clearFillPreview() {
    (fillDrag?.targets || []).forEach(({ columnIndex, rowIndex }) => {
      cellElementAt(fillDrag.tableIndex, columnIndex, rowIndex)?.classList?.remove('is-fill-target');
    });
  }

  // The chevrons committed to a direction, so the drag follows it however the pointer
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
  // the pointer may be over the chevrons or outside the table entirely.
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
    fillDrag.targets = fillTargetsFor(fillDrag, position);
    fillDrag.targets.forEach(({ columnIndex, rowIndex }) => {
      cellElementAt(fillDrag.tableIndex, columnIndex, rowIndex)?.classList?.add('is-fill-target');
    });
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
    event.preventDefault?.();
    event.stopPropagation?.();
    // Starting a fill mid-edit commits first, so it copies what is on screen rather
    // than the value from before the edit. Tabulator discards the edit on blur and
    // offers no commit call, so this sends the Enter the user would have pressed.
    host?.querySelector?.('.tabulator-cell input')?.dispatchEvent?.(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })
    );
    fillDrag = { ...fillEdge, targets: [] };
    hideFillArrows();
    document.addEventListener('mousemove', onFillMove, true);
    document.addEventListener('mouseup', onFillUp, true);
    return true;
  }

  function findOpenFormulaEditor() {
    const input = host?.querySelector?.('.tabulator-cell input');
    return input && isNotebookTableFormula(input.value) ? input : null;
  }

  function onHostFillPointerDown(event) {
    if (pointerInFillZone(event) && startFillDrag(event)) {
      return;
    }
  }

  return {
    cellElementAt,
    cellPositionOf,
    hideFillArrows,
    onHostMouseMove,
    pointerInFillZone,
    startFillDrag,
    findOpenFormulaEditor,
    onHostFillPointerDown
  };
}

export { createSpreadsheetFillHandle };
