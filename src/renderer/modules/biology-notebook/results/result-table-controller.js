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
import { showTransientNotice } from '../../../lib/notify.js';

function getResultTableHeight(table) {
  const rowCount = Array.isArray(table?.rows) ? table.rows.length : 0;
  if (rowCount <= 8) {
    return '';
  }
  return `${Math.min(420, 82 + (rowCount * 42))}px`;
}

function hasGeneratedColumnTitles(table) {
  const columns = Array.isArray(table?.columns) ? table.columns : [];
  return columns.length > 0 && columns.every((column, index) => (
    String(column?.title || '').trim() === `Column ${index + 1}`
  ));
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
    statusEl.hidden = hasTables;
    statusEl.textContent = hasTables ? '' : 'Add a table to capture structured notebook results.';
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
    setStatus(tables);
  }

  function renderEditor(rawTables = null, options = {}) {
    draftTables = cloneNotebookResultTables(rawTables);
    activeTableIndex = clampActiveIndex(
      Object.prototype.hasOwnProperty.call(options, 'activeIndex') ? options.activeIndex : activeTableIndex,
      draftTables
    );
    destroyGrids();
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
        <div class="biology-notebook-result-table${hasGeneratedColumnTitles(table) ? ' biology-notebook-result-table--untitled' : ''}" data-result-table-host="${index}" aria-label="Notebook result table ${index + 1}"></div>
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
        columns: table.columns.map((column) => ({
          title: column.title,
          field: column.field,
          editor: 'input',
          headerSort: false,
          resizable: true
        })),
        index: 'id',
        layout: 'fitColumns',
        headerVisible: !hasGeneratedColumnTitles(table),
        reactiveData: false,
        placeholder: 'Use Add row / Add column to shape this notebook table.',
        cellEdited: () => handleEdited(index)
      };
      const gridHeight = getResultTableHeight(table);
      if (gridHeight) {
        gridOptions.height = gridHeight;
      }
      return new TabulatorLib(tableHost, gridOptions);
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
    renderEditor(tables, { activeIndex: targetIndex });
  }

  function onAddColumn() {
    const tables = syncDraftFromGrid();
    const targetIndex = clampActiveIndex(activeTableIndex, tables);
    if (targetIndex < 0) {
      renderEditor([createDefaultNotebookResultTable(createId)], { activeIndex: 0 });
      return;
    }
    tables[targetIndex] = addNotebookResultTableColumn(tables[targetIndex], createId);
    renderEditor(tables, { activeIndex: targetIndex });
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
