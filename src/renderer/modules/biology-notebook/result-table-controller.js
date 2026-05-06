import {
  addNotebookResultTableColumn,
  addNotebookResultTableRow,
  cloneNotebookResultTable,
  createDefaultNotebookResultTable,
  normalizeNotebookResultTable,
  summarizeNotebookResultTable
} from '../notebook-result-table.js';

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
  let grid = null;
  let draft = null;

  function destroyGrid() {
    if (grid && typeof grid.destroy === 'function') {
      grid.destroy();
    }
    grid = null;
    if (host) {
      host.innerHTML = '';
    }
  }

  function setStatus(table, message = '') {
    if (!statusEl) {
      return;
    }
    if (message) {
      statusEl.textContent = message;
      return;
    }
    const summary = summarizeNotebookResultTable(table);
    statusEl.textContent = summary
      ? `Result table: ${summary}. Edit cells directly.`
      : 'Add a table to capture structured notebook results.';
  }

  function syncControls(table = null) {
    const hasTable = Boolean(table);
    if (wrapEl) {
      wrapEl.hidden = !hasTable;
    }
    if (addBtn) {
      addBtn.hidden = hasTable;
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
    if (!grid) {
      draft = cloneNotebookResultTable(draft);
      return draft;
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

    draft = normalizeNotebookResultTable({
      columns,
      rows
    });
    return cloneNotebookResultTable(draft);
  }

  function handleEdited() {
    const table = syncDraftFromGrid();
    setStatus(table);
  }

  function renderEditor(rawTable = null) {
    draft = cloneNotebookResultTable(rawTable);
    destroyGrid();
    syncControls(draft);
    setStatus(draft);

    if (!draft || !host) {
      return;
    }

    if (!TabulatorLib) {
      host.innerHTML = '<p class="small-note">Table editing is unavailable because Tabulator did not load.</p>';
      setStatus(draft, 'Table data is saved, but the Tabulator editor is unavailable right now.');
      return;
    }

    const gridOptions = {
      data: draft.rows.map((row) => ({ ...row })),
      columns: draft.columns.map((column) => ({
        title: column.title,
        field: column.field,
        editor: 'input',
        headerSort: false,
        resizable: true
      })),
      index: 'id',
      layout: 'fitColumns',
      reactiveData: false,
      placeholder: 'Use Add row / Add column to shape this notebook table.',
      cellEdited: handleEdited
    };
    const gridHeight = getResultTableHeight(draft);
    if (gridHeight) {
      gridOptions.height = gridHeight;
    }
    grid = new TabulatorLib(host, gridOptions);
  }

  function getCurrent() {
    return syncDraftFromGrid();
  }

  function onAdd() {
    if (draft) {
      return;
    }
    renderEditor(createDefaultNotebookResultTable(createId));
  }

  function onAddRow() {
    renderEditor(addNotebookResultTableRow(getCurrent(), createId));
  }

  function onAddColumn() {
    renderEditor(addNotebookResultTableColumn(getCurrent(), createId));
  }

  function onRemove() {
    renderEditor(null);
  }

  return {
    renderEditor,
    getCurrent,
    onAdd,
    onAddRow,
    onAddColumn,
    onRemove
  };
}
