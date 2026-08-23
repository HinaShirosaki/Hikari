import {
  addNotebookResultTableColumn,
  addNotebookResultTableRow,
  cloneNotebookResultTable,
  cloneNotebookResultTables,
  createDefaultNotebookResultTable,
  createNotebookResultTableFromPlaceholder,
  normalizeNotebookResultTable,
  normalizeNotebookResultTables
} from './notebook-result-tables.js';
import {
  applyReferencePick,
  computeNotebookResultTable,
  fillCellContent,
  isNotebookTableFormula,
  notebookTableColumnLetter
} from './notebook-table-formulas.js';
import { showTransientNotice } from './notify.js';

function getResultTableHeight(table) {
  const rowCount = Array.isArray(table?.rows) ? table.rows.length : 0;
  if (rowCount <= 8) {
    return '';
  }
  return `${Math.min(420, 82 + (rowCount * 42))}px`;
}

// A list of spreadsheet tables on one host element: A1 addressing, formulas, click-to-
// reference while editing a formula, and drag-to-fill from a cell's border. The wording
// differs per feature, so the few user-facing strings are passed in.
export function createSpreadsheetTables({
  host,
  statusEl,
  wrapEl,
  addBtn,
  addRowBtn,
  addColBtn,
  removeBtn,
  createId,
  TabulatorLib,
  label = 'table',
  emptyMessage = 'Add a table to capture structured results.',
  placeholder = 'Use Add row / Add column to shape this table.'
} = {}) {
  let grids = [];
  let draftTables = [];
  let activeTableIndex = -1;
  // Computed values for every cell, index-aligned with draftTables. Cells store the
  // formula text the user typed; this is what the grid actually shows.
  let computedTables = [];

  function recomputeTables() {
    computedTables = draftTables.map((table) => computeNotebookResultTable(table).byRowId);
  }

  function firstFormulaError() {
    for (const byRowId of computedTables) {
      for (const cells of Object.values(byRowId || {})) {
        for (const cell of Object.values(cells || {})) {
          if (cell?.error) {
            return cell.error;
          }
        }
      }
    }
    return '';
  }

  // Returns an element rather than a string so cell text is never parsed as HTML.
  function formatCell(tableIndex, cell) {
    const raw = String(cell?.getValue?.() ?? '');
    const rowId = cell?.getRow?.()?.getData?.()?.id;
    const computed = computedTables[tableIndex]?.[rowId]?.[cell?.getField?.()];
    const element = document.createElement('span');
    if (!computed?.formula) {
      element.textContent = computed?.text ?? raw;
      return element;
    }
    if (computed.error) {
      element.className = 'spreadsheet-cell spreadsheet-cell--error';
    } else if (computed.pending) {
      // Not a result yet: the arithmetic left once the empty cells are filled in.
      element.className = 'spreadsheet-cell spreadsheet-cell--pending';
    } else {
      element.className = 'spreadsheet-cell spreadsheet-cell--formula';
    }
    element.textContent = computed.text;
    // Editing shows the formula again; until then the tooltip is where it lives.
    element.title = computed.error ? `${raw} — ${computed.error}` : raw;
    return element;
  }

  // The spreadsheet address goes in a titleFormatter rather than in `title`, because
  // syncDraftFromGrid reads `title` straight back into the stored table -- writing "A"
  // there would persist the letter as the column's name.
  function buildTitleFormatter(column, columnIndex) {
    return () => {
      const head = document.createElement('span');
      head.className = 'spreadsheet-head';
      const address = document.createElement('span');
      address.className = 'spreadsheet-head-address';
      address.textContent = notebookTableColumnLetter(columnIndex);
      head.appendChild(address);
      const label = String(column.title || '').trim();
      // A generated "Column 3" adds nothing next to the letter it duplicates.
      if (label && label !== `Column ${columnIndex + 1}`) {
        const name = document.createElement('span');
        name.className = 'spreadsheet-head-name';
        name.textContent = label;
        head.appendChild(name);
      }
      return head;
    };
  }

  // A gutter of row numbers. It carries no field, so syncDraftFromGrid drops it and it
  // never reaches the stored table.
  function buildRowNumberColumn() {
    return {
      title: '',
      formatter: 'rownum',
      hozAlign: 'center',
      width: 42,
      headerSort: false,
      resizable: false,
      frozen: true,
      cssClass: 'spreadsheet-rownum'
    };
  }

  function buildColumnDefinition(column, columnIndex, tableIndex) {
    return {
      title: column.title,
      titleFormatter: buildTitleFormatter(column, columnIndex),
      field: column.field,
      // 'input' edits the underlying value, so clicking a computed cell brings the
      // formula back the way a spreadsheet does.
      editor: 'input',
      formatter: (cell) => formatCell(tableIndex, cell),
      headerSort: false,
      resizable: true
    };
  }

  // Adds a row or column to a live grid instead of re-rendering the editor, which
  // would tear down every Tabulator instance and make the whole table blink. Without a
  // live grid to mutate, fall back to the full re-render: it flashes, but the change
  // is never silently dropped.
  function applyTableChange(tables, targetIndex, method, apply) {
    const grid = grids[targetIndex];
    if (typeof grid?.[method] !== 'function') {
      renderEditor(tables, { activeIndex: targetIndex });
      return;
    }
    draftTables = tables;
    activeTableIndex = targetIndex;
    apply(grid, tables[targetIndex]);
    recomputeTables();
    setStatus(tables);
  }

  // Excel's "point mode": while a cell is being edited as a formula, clicking another
  // cell types its address into the formula instead of moving the edit there.
  let swallowNextClick = false;
  let lastPick = null;

  function addressOfCellElement(grid, tableIndex, cellElement) {
    const field = cellElement.getAttribute?.('tabulator-field');
    const columns = draftTables[tableIndex]?.columns || [];
    const columnIndex = columns.findIndex((column) => column.field === field);
    if (columnIndex < 0) {
      // The row-number gutter carries no field, so it has no address to offer.
      return '';
    }
    const rowElement = cellElement.closest?.('.tabulator-row');
    const rowIndex = (grid.getRows?.() || []).findIndex((row) => row?.getElement?.() === rowElement);
    if (rowIndex < 0) {
      return '';
    }
    return `${notebookTableColumnLetter(columnIndex)}${rowIndex + 1}`;
  }

  function insertReference(input, address, extendRange) {
    const result = applyReferencePick({
      value: input.value,
      caretStart: Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length,
      caretEnd: Number.isFinite(input.selectionEnd) ? input.selectionEnd : input.value.length,
      address,
      extendRange,
      // A pick only stays live on the input that made it.
      pick: lastPick && lastPick.input === input ? lastPick.pick : null
    });
    input.value = result.value;
    input.setSelectionRange?.(result.caret, result.caret);
    input.focus?.();
    lastPick = { input, pick: result.pick };
  }

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
    const field = draftTables[tableIndex]?.columns?.[columnIndex]?.field;
    const row = grids[tableIndex]?.getRows?.()?.[rowIndex];
    return field && row ? row.getCell?.(field)?.getElement?.() : null;
  }

  function cellPositionOf(tableIndex, cellElement) {
    const field = cellElement?.getAttribute?.('tabulator-field');
    const columnIndex = (draftTables[tableIndex]?.columns || []).findIndex((column) => column.field === field);
    const rowElement = cellElement?.closest?.('.tabulator-row');
    const rowIndex = (grids[tableIndex]?.getRows?.() || [])
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
    const table = draftTables[position.tableIndex];
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
    const position = cellElement && grids[tableIndex] ? cellPositionOf(tableIndex, cellElement) : null;
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
    const table = draftTables[tableIndex];
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
    // A drag ends without a click, so the swallow armed on mousedown has to be
    // disarmed here or it eats the user's next click on the table.
    swallowNextClick = false;

    const table = draftTables[tableIndex];
    const grid = grids[tableIndex];
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
    swallowNextClick = true;
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

  function onHostPointerDown(event) {
    swallowNextClick = false;
    if (pointerInFillZone(event) && startFillDrag(event)) {
      return;
    }
    const input = findOpenFormulaEditor();
    const cellElement = event?.target?.closest?.('.tabulator-cell');
    const tableHost = cellElement?.closest?.('[data-result-table-host]');
    const tableIndex = Number(tableHost?.dataset?.resultTableHost);
    const grid = grids[tableIndex];
    if (!cellElement || !grid) {
      return;
    }

    if (!input) {
      return;
    }
    // Clicking inside the cell being edited just moves the caret, as it should.
    if (cellElement.contains(input)) {
      return;
    }
    const address = addressOfCellElement(grid, tableIndex, cellElement);
    if (!address) {
      return;
    }
    // Swallowed in the capture phase: left alone, the click would blur this editor and
    // start editing the cell that was only meant to be referenced.
    event.preventDefault?.();
    event.stopPropagation?.();
    swallowNextClick = true;
    insertReference(input, address, Boolean(event.shiftKey));
  }

  // The click that follows a consumed mousedown has to be swallowed too, or Tabulator
  // opens an editor on the cell that was only being pointed at. It must not insert a
  // second reference -- one gesture, one address.
  function onHostPointerClick(event) {
    if (!swallowNextClick) {
      return;
    }
    swallowNextClick = false;
    event.preventDefault?.();
    event.stopPropagation?.();
  }

  function destroyGrids() {
    grids.forEach((grid) => {
      if (grid && typeof grid.destroy === 'function') {
        grid.destroy();
      }
    });
    grids = [];
    if (host) {
      host.innerHTML = '';
    }
  }

  function clampActiveIndex(index, tables = draftTables) {
    const count = Array.isArray(tables) ? tables.length : 0;
    if (!count) {
      return -1;
    }
    const numericIndex = Number(index);
    if (!Number.isFinite(numericIndex)) {
      return Math.max(0, Math.min(activeTableIndex, count - 1));
    }
    return Math.max(0, Math.min(numericIndex, count - 1));
  }

  function setStatus(tables, message = '') {
    if (!statusEl) {
      return;
    }
    if (message) {
      statusEl.hidden = false;
      statusEl.textContent = message;
      return;
    }
    const normalizedTables = normalizeNotebookResultTables(tables);
    const hasTables = normalizedTables.length > 0;
    if (!hasTables) {
      statusEl.hidden = false;
      statusEl.classList.remove('is-error');
      statusEl.textContent = emptyMessage;
      return;
    }
    // A broken formula shows as #ERROR in its cell; the reason belongs somewhere the
    // user does not have to hover to find. With nothing broken the line stays hidden.
    const formulaError = firstFormulaError();
    statusEl.classList.toggle('is-error', Boolean(formulaError));
    statusEl.hidden = !formulaError;
    statusEl.textContent = formulaError;
  }

  function syncControls(tables = []) {
    const hasTable = Boolean(Array.isArray(tables) && tables.length);
    if (wrapEl) {
      wrapEl.hidden = !hasTable;
    }
    if (addBtn) {
      addBtn.hidden = false;
    }
    if (addRowBtn) {
      addRowBtn.hidden = !hasTable;
    }
    if (addColBtn) {
      addColBtn.hidden = !hasTable;
    }
    if (removeBtn) {
      removeBtn.hidden = !hasTable;
    }
  }

  function syncDraftFromGrid() {
    if (!grids.length) {
      draftTables = cloneNotebookResultTables(draftTables);
      activeTableIndex = clampActiveIndex(activeTableIndex, draftTables);
      return cloneNotebookResultTables(draftTables);
    }

    draftTables = draftTables.map((draftTable, tableIndex) => {
      const grid = grids[tableIndex];
      if (!grid) {
        return cloneNotebookResultTable(draftTable);
      }

      const columns = typeof grid.getColumns === 'function'
        ? grid.getColumns()
          .map((component, index) => {
            const field = String(component?.getField?.() || '').trim();
            if (!field) {
              return null;
            }
            const definition = component?.getDefinition?.() || {};
            return {
              field,
              title: String(definition?.title || '').trim() || `Column ${index + 1}`
            };
          })
          .filter(Boolean)
        : [];
      const rows = typeof grid.getData === 'function'
        ? grid.getData().map((rawRow, index) => {
          const row = {
            id: String(rawRow?.id || '').trim() || `row_${index + 1}`
          };
          columns.forEach((column) => {
            row[column.field] = String(rawRow?.[column.field] ?? '');
          });
          return row;
        })
        : [];

      return normalizeNotebookResultTable({
        columns,
        rows
      });
    }).filter(Boolean);

    activeTableIndex = clampActiveIndex(activeTableIndex, draftTables);
    return cloneNotebookResultTables(draftTables);
  }

  function handleEdited(tableIndex) {
    activeTableIndex = clampActiveIndex(tableIndex, draftTables);
    const tables = syncDraftFromGrid();
    recomputeTables();
    // One edit can change every formula that reads it, so the whole grid re-renders.
    grids[tableIndex]?.getRows?.().forEach((row) => row?.reformat?.());
    setStatus(tables);
  }

  function renderEditor(rawTables = null, options = {}) {
    draftTables = cloneNotebookResultTables(rawTables);
    activeTableIndex = clampActiveIndex(
      Object.prototype.hasOwnProperty.call(options, 'activeIndex') ? options.activeIndex : activeTableIndex,
      draftTables
    );
    destroyGrids();
    hideFillArrows();
    recomputeTables();
    syncControls(draftTables);
    setStatus(draftTables);

    if (!draftTables.length || !host) {
      return;
    }

    if (!TabulatorLib) {
      host.innerHTML = '<p class="small-note">Table editing is unavailable because Tabulator did not load.</p>';
      showTransientNotice('Table editing is unavailable because Tabulator did not load.', { type: 'error' });
      setStatus(draftTables, 'Table data is saved, but the Tabulator editor is unavailable right now.');
      return;
    }

    const showTablePicker = draftTables.length > 1;
    host.innerHTML = draftTables.map((table, index) => `
      <section class="spreadsheet-table-editor${index === activeTableIndex ? ' is-active' : ''}" data-result-table-editor="${index}">
        ${showTablePicker ? `
          <div class="spreadsheet-table-editor-head">
            <button class="spreadsheet-table-select" type="button" data-result-table-select="${index}">Table ${index + 1}</button>
          </div>
        ` : ''}
        <div class="spreadsheet-table" data-result-table-host="${index}" aria-label="${label} ${index + 1}"></div>
      </section>
    `).join('');

    const tableHosts = Array.from(host.querySelectorAll?.('[data-result-table-host]') || []);
    grids = draftTables.map((table, index) => {
      const tableHost = tableHosts.find((item) => String(item?.dataset?.resultTableHost || '') === String(index))
        || tableHosts[index];
      if (!tableHost) {
        return null;
      }
      const gridOptions = {
        data: table.rows.map((row) => ({ ...row })),
        columns: [
          buildRowNumberColumn(),
          ...table.columns.map((column, columnIndex) => (
            buildColumnDefinition(column, columnIndex, index)
          ))
        ],
        index: 'id',
        layout: 'fitColumns',
        // The header always shows, because it carries the column letters formulas
        // reference, not just whatever the columns happen to be named.
        headerVisible: true,
        reactiveData: false,
        placeholder
      };
      const gridHeight = getResultTableHeight(table);
      if (gridHeight) {
        gridOptions.height = gridHeight;
      }
      const grid = new TabulatorLib(tableHost, gridOptions);
      // Tabulator 6 dropped callbacks passed in the options object; they are accepted
      // and never fired. Without this the computed values never refresh, so the
      // formatter repaints a stale cell over whatever was just typed.
      grid.on?.('cellEdited', () => handleEdited(index));
      return grid;
    });
  }

  function getCurrent() {
    return syncDraftFromGrid()[0] || null;
  }

  function getCurrentTables() {
    return syncDraftFromGrid();
  }

  function onAdd(size = {}) {
    const tables = syncDraftFromGrid();
    tables.push(createDefaultNotebookResultTable(createId, size));
    renderEditor(tables, { activeIndex: tables.length - 1 });
  }

  function onAddFromPlaceholder({ name = '', value = '' } = {}) {
    const tables = syncDraftFromGrid();
    tables.push(createNotebookResultTableFromPlaceholder(createId, { name, value }));
    renderEditor(tables, { activeIndex: tables.length - 1 });
  }

  function onAddRow() {
    const tables = syncDraftFromGrid();
    const targetIndex = clampActiveIndex(activeTableIndex, tables);
    if (targetIndex < 0) {
      renderEditor([createDefaultNotebookResultTable(createId)], { activeIndex: 0 });
      return;
    }
    tables[targetIndex] = addNotebookResultTableRow(tables[targetIndex], createId);
    applyTableChange(tables, targetIndex, 'addRow', (grid, table) => {
      grid.addRow({ ...table.rows[table.rows.length - 1] });
      const height = getResultTableHeight(table);
      if (height) {
        grid.setHeight?.(height);
      }
    });
  }

  function onAddColumn() {
    const tables = syncDraftFromGrid();
    const targetIndex = clampActiveIndex(activeTableIndex, tables);
    if (targetIndex < 0) {
      renderEditor([createDefaultNotebookResultTable(createId)], { activeIndex: 0 });
      return;
    }
    tables[targetIndex] = addNotebookResultTableColumn(tables[targetIndex], createId);
    applyTableChange(tables, targetIndex, 'addColumn', (grid, table) => {
      const columnIndex = table.columns.length - 1;
      grid.addColumn(buildColumnDefinition(table.columns[columnIndex], columnIndex, targetIndex));
    });
  }

  function onRemove() {
    const tables = syncDraftFromGrid();
    const targetIndex = clampActiveIndex(activeTableIndex, tables);
    if (targetIndex < 0) {
      renderEditor([]);
      return;
    }
    tables.splice(targetIndex, 1);
    renderEditor(tables, { activeIndex: Math.min(targetIndex, tables.length - 1) });
  }

  function onHostClick(event) {
    const select = event?.target?.closest?.('[data-result-table-select]')
      || (event?.target?.dataset?.resultTableSelect !== undefined ? event.target : null);
    if (!select) {
      return;
    }
    event?.preventDefault?.();
    const selectedIndex = Number(select.dataset.resultTableSelect);
    if (!Number.isFinite(selectedIndex)) {
      return;
    }
    renderEditor(syncDraftFromGrid(), { activeIndex: selectedIndex });
  }

  host?.addEventListener?.('click', onHostClick);
  host?.addEventListener?.('mousemove', onHostMouseMove);
  host?.addEventListener?.('mouseleave', hideFillArrows);
  host?.addEventListener?.('mousedown', onHostPointerDown, true);
  host?.addEventListener?.('click', onHostPointerClick, true);

  return {
    renderEditor,
    getCurrent,
    getCurrentTables,
    onAdd,
    onAddFromPlaceholder,
    onAddRow,
    onAddColumn,
    onRemove
  };
}
