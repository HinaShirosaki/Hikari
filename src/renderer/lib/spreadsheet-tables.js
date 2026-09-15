import {
  addNotebookResultTableColumn,
  addNotebookResultTableRow,
  cloneNotebookResultTable,
  cloneNotebookResultTables,
  createDefaultNotebookResultTable,
  createMolarityNotebookResultTable,
  createNotebookResultTableFromPlaceholder,
  normalizeNotebookResultTable,
  normalizeNotebookResultTables
} from './notebook-result-tables.js';
import {
  computeNotebookResultTables,
  notebookTableColumnLetter
} from './notebook-table-formulas.js';
import { createSpreadsheetReferencePicker } from './spreadsheet-reference-picker.js';
import { normalizeCellForColumn } from './table-units.js';
import { showTransientNotice } from './notify.js';
import { createSpreadsheetFillHandle } from './spreadsheet-tables/fill-handle.js';
import { createSpreadsheetColumnDefs } from './spreadsheet-tables/column-defs.js';
import { createSpreadsheetTableContextMenu } from './spreadsheet-tables/context-menu.js';

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
  contextMenuEl,
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

  function selectActiveTable(index) {
    activeTableIndex = clampActiveIndex(index, draftTables);
    Array.from(host?.querySelectorAll?.('[data-result-table-editor]') || []).forEach((editor) => {
      editor.classList?.toggle?.(
        'is-active',
        Number(editor.dataset?.resultTableEditor) === activeTableIndex
      );
    });
  }

  const tableContextMenu = createSpreadsheetTableContextMenu({
    host,
    menu: contextMenuEl,
    onSelectTable: selectActiveTable
  });

  function recomputeTables() {
    computedTables = computeNotebookResultTables(draftTables).map((result) => result.byRowId);
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
  const {
    buildRowNumberColumn,
    buildColumnDefinition
  } = createSpreadsheetColumnDefs({
    getComputedTables: () => computedTables,
    syncDraftFromGrid: () => syncDraftFromGrid(),
    renderEditor: (tables, options) => renderEditor(tables, options)
  });



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
    // Computed before the grid draws the new row, or a solve table's fresh row is
    // formatted against the old results and comes up blank instead of pending.
    recomputeTables();
    apply(grid, tables[targetIndex]);
    setStatus(tables);
  }

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

  const {
    hideFillHandle,
    onHostMouseMove,
    pointerInFillZone,
    findOpenFormulaEditor,
    onHostFillPointerDown
  } = createSpreadsheetFillHandle({
    host,
    getGrids: () => grids,
    getDraftTables: () => draftTables,
    handleEdited: (tableIndex) => handleEdited(tableIndex)
  });


  createSpreadsheetReferencePicker({
    roots: [host],
    findEditor: findOpenFormulaEditor,
    shouldIgnore: (event) => pointerInFillZone(event),
    addressOfCell: ({ cellElement }) => {
      const tableHost = cellElement?.closest?.('[data-result-table-host]');
      const tableIndex = Number(tableHost?.dataset?.resultTableHost);
      const grid = grids[tableIndex];
      const address = cellElement && grid
        ? addressOfCellElement(grid, tableIndex, cellElement)
        : '';
      return address ? `Table${tableIndex + 1}:${address}` : '';
    }
  });

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
    if (!hasTable) {
      tableContextMenu.hide();
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
      const columns = typeof grid?.getColumns === 'function'
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
      // Tabulator builds a grid on a setTimeout after `new Tabulator`, so a read in the
      // same tick as renderEditor finds no columns yet. The model never holds a table
      // without columns, so an empty read means "not built": the draft is the truth.
      if (!columns.length) {
        return cloneNotebookResultTable(draftTable);
      }
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
        rows,
        solve: draftTable?.solve
      });
    }).filter(Boolean);

    activeTableIndex = clampActiveIndex(activeTableIndex, draftTables);
    return cloneNotebookResultTables(draftTables);
  }

  function handleEdited(tableIndex) {
    activeTableIndex = clampActiveIndex(tableIndex, draftTables);
    const tables = syncDraftFromGrid();
    recomputeTables();
    // One edit can change formulas in any sibling table, so every grid re-renders.
    grids.forEach((grid) => grid?.getRows?.().forEach((row) => row?.reformat?.()));
    setStatus(tables);
  }

  function renderEditor(rawTables = null, options = {}) {
    tableContextMenu.hide();
    draftTables = cloneNotebookResultTables(rawTables);
    activeTableIndex = clampActiveIndex(
      Object.prototype.hasOwnProperty.call(options, 'activeIndex') ? options.activeIndex : activeTableIndex,
      draftTables
    );
    destroyGrids();
    hideFillHandle();
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
            <button class="spreadsheet-table-select" type="button" data-result-table-select="${index}">Table${index + 1}</button>
          </div>
        ` : ''}
        <div class="spreadsheet-table" data-result-table-host="${index}" aria-label="${label} ${index + 1}"></div>
        <button class="spreadsheet-table-add-row" type="button" data-result-table-add-row="${index}">+ Add row</button>
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
      grid.on?.('cellEdited', (cell) => {
        // "5 uL" typed into a millilitre column is stored as the 0.005 it means:
        // converted here, once, so nothing downstream has to know about unit text.
        // row.update rather than cell.setValue, which would re-enter this handler.
        const field = cell?.getField?.();
        const title = cell?.getColumn?.()?.getDefinition?.()?.title;
        const normalized = normalizeCellForColumn(cell?.getValue?.(), title);
        if (field && normalized !== String(cell?.getValue?.() ?? '')) {
          cell?.getRow?.()?.update?.({ [field]: normalized });
        }
        handleEdited(index);
      });
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

  function onAddMolarity() {
    const tables = syncDraftFromGrid();
    tables.push(createMolarityNotebookResultTable(createId));
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
    const addRow = event?.target?.closest?.('[data-result-table-add-row]');
    if (addRow) {
      event?.preventDefault?.();
      activeTableIndex = Number(addRow.dataset.resultTableAddRow);
      onAddRow();
      return;
    }
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
  host?.addEventListener?.('mouseleave', hideFillHandle);
  host?.addEventListener?.('mousedown', onHostFillPointerDown, true);

  return {
    renderEditor,
    getCurrent,
    getCurrentTables,
    onAdd,
    onAddMolarity,
    onAddFromPlaceholder,
    onAddRow,
    onAddColumn,
    onRemove
  };
}
