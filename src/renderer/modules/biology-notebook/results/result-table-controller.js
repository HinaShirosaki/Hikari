import {
  addNotebookResultTableColumn,
  addNotebookResultTableRow,
  cloneNotebookResultTable,
  cloneNotebookResultTables,
  createDefaultNotebookResultTable,
  createNotebookResultTableFromPlaceholder,
  normalizeNotebookResultTable,
  normalizeNotebookResultTables
} from '../../../lib/notebook-result-tables.js';
import {
  applyReferencePick,
  computeNotebookResultTable,
  fillCellContent,
  isNotebookTableFormula,
  notebookTableColumnLetter
} from '../../../lib/notebook-table-formulas.js';
import { showTransientNotice } from '../../../lib/notify.js';

function getResultTableHeight(table) {
  const rowCount = Array.isArray(table?.rows) ? table.rows.length : 0;
  if (rowCount <= 8) {
    return '';
  }
  return `${Math.min(420, 82 + (rowCount * 42))}px`;
}

export function createResultTableController({
  host,
  statusEl,
  wrapEl,
  addBtn,
  addRowBtn,
  addColBtn,
  removeBtn,
  createId,
  TabulatorLib
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
      element.className = 'biology-notebook-result-cell biology-notebook-result-cell--error';
    } else if (computed.pending) {
      // Not a result yet: the arithmetic left once the empty cells are filled in.
      element.className = 'biology-notebook-result-cell biology-notebook-result-cell--pending';
    } else {
      element.className = 'biology-notebook-result-cell biology-notebook-result-cell--formula';
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
      head.className = 'biology-notebook-result-head';
      const address = document.createElement('span');
      address.className = 'biology-notebook-result-head-address';
      address.textContent = notebookTableColumnLetter(columnIndex);
      head.appendChild(address);
      const label = String(column.title || '').trim();
      // A generated "Column 3" adds nothing next to the letter it duplicates.
      if (label && label !== `Column ${columnIndex + 1}`) {
        const name = document.createElement('span');
        name.className = 'biology-notebook-result-head-name';
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
      cssClass: 'biology-notebook-result-rownum'
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

  /* ------------------------------------------------------------ fill handle */

  // The square in the corner of the last-clicked cell. Dragging it copies that cell
  // down or across, shifting relative references the way a spreadsheet does.
  let fillAnchor = null;
  let fillHandle = null;
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

  // The handle lives inside the anchor cell, so it follows the cell as the grid
  // scrolls or re-lays out. Re-placing it is required after any reformat, which
  // replaces cell contents wholesale.
  function placeFillHandle() {
    fillHandle?.remove?.();
    fillHandle = null;
    if (!fillAnchor) {
      return;
    }
    const cellElement = cellElementAt(fillAnchor.tableIndex, fillAnchor.columnIndex, fillAnchor.rowIndex);
    // While the cell is being edited its content is the editor's input; the handle
    // would only be in the way, and the reformat on commit brings it back.
    if (!cellElement || cellElement.querySelector?.('input')) {
      return;
    }
    fillHandle = document.createElement('span');
    fillHandle.className = 'biology-notebook-result-fill-handle';
    fillHandle.title = 'Drag to fill';
    cellElement.appendChild(fillHandle);
  }

  function setFillAnchor(position) {
    fillAnchor = position;
    // Clicking a cell also opens its editor, which replaces the cell's contents right
    // after this fires -- so place the handle once that has happened, not before.
    setTimeout(placeFillHandle, 0);
  }

  function clearFillPreview() {
    (fillDrag?.targets || []).forEach(({ columnIndex, rowIndex }) => {
      cellElementAt(fillDrag.tableIndex, columnIndex, rowIndex)?.classList?.remove('is-fill-target');
    });
  }

  // A single-cell drag fills along one axis only, so a diagonal drag picks whichever
  // direction it has travelled furthest -- the same guess Excel makes.
  function fillTargetsFor(anchorPosition, target) {
    const rowSpan = target.rowIndex - anchorPosition.rowIndex;
    const columnSpan = target.columnIndex - anchorPosition.columnIndex;
    if (!rowSpan && !columnSpan) {
      return [];
    }
    const targets = [];
    if (Math.abs(rowSpan) >= Math.abs(columnSpan)) {
      const step = rowSpan > 0 ? 1 : -1;
      for (let offset = step; Math.abs(offset) <= Math.abs(rowSpan); offset += step) {
        targets.push({ columnIndex: anchorPosition.columnIndex, rowIndex: anchorPosition.rowIndex + offset });
      }
      return targets;
    }
    const step = columnSpan > 0 ? 1 : -1;
    for (let offset = step; Math.abs(offset) <= Math.abs(columnSpan); offset += step) {
      targets.push({ columnIndex: anchorPosition.columnIndex + offset, rowIndex: anchorPosition.rowIndex });
    }
    return targets;
  }

  function onFillMove(event) {
    if (!fillDrag) {
      return;
    }
    const hovered = document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('.tabulator-cell');
    const position = hovered ? cellPositionOf(fillDrag.tableIndex, hovered) : null;
    if (!position) {
      return;
    }
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
    placeFillHandle();
  }

  function startFillDrag(event) {
    const cellElement = event.target.closest?.('.tabulator-cell');
    const position = fillAnchor && cellElement ? cellPositionOf(fillAnchor.tableIndex, cellElement) : null;
    if (!position) {
      return false;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    swallowNextClick = true;
    fillDrag = { ...position, targets: [] };
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
    if (event?.target?.classList?.contains?.('biology-notebook-result-fill-handle')) {
      startFillDrag(event);
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

    // Not building a formula, so this click is just picking the cell the fill handle
    // hangs off. Tabulator's own cellClick never fires for these grids, so the anchor
    // is taken straight from the event.
    if (!input) {
      const position = cellPositionOf(tableIndex, cellElement);
      if (position) {
        setFillAnchor(position);
      }
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
      statusEl.textContent = 'Add a table to capture structured notebook results.';
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
    placeFillHandle();
    setStatus(tables);
  }

  function renderEditor(rawTables = null, options = {}) {
    draftTables = cloneNotebookResultTables(rawTables);
    activeTableIndex = clampActiveIndex(
      Object.prototype.hasOwnProperty.call(options, 'activeIndex') ? options.activeIndex : activeTableIndex,
      draftTables
    );
    destroyGrids();
    fillAnchor = null;
    fillHandle = null;
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
      <section class="biology-notebook-result-table-editor${index === activeTableIndex ? ' is-active' : ''}" data-result-table-editor="${index}">
        ${showTablePicker ? `
          <div class="biology-notebook-result-table-editor-head">
            <button class="biology-notebook-result-table-select" type="button" data-result-table-select="${index}">Table ${index + 1}</button>
          </div>
        ` : ''}
        <div class="biology-notebook-result-table" data-result-table-host="${index}" aria-label="Notebook result table ${index + 1}"></div>
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
        placeholder: 'Use Add row / Add column to shape this notebook table.'
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
      // Any redraw rebuilds cell contents, taking the handle with it.
      grid.on?.('renderComplete', () => placeFillHandle());
      grid.on?.('cellEditCancelled', () => setTimeout(placeFillHandle, 0));
      return grid;
    });
  }

  function getCurrent() {
    return syncDraftFromGrid()[0] || null;
  }

  function getCurrentTables() {
    return syncDraftFromGrid();
  }

  function onAdd() {
    const tables = syncDraftFromGrid();
    tables.push(createDefaultNotebookResultTable(createId));
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
