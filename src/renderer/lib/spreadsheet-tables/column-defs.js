import { setNotebookResultTableColumnUnit } from '../notebook-result-tables.js';
import { notebookTableColumnLetter } from '../notebook-table-formulas.js';
import { columnBaseTitle, columnUnit, unitOptions } from '../table-units.js';

// How a spreadsheet cell and its column header are drawn: computed values, the
// per-column unit picker, the address letter, and the row-number gutter.
function createSpreadsheetColumnDefs({
  getComputedTables,
  syncDraftFromGrid,
  renderEditor
} = {}) {
  function formatCell(tableIndex, cell) {
    const raw = String(cell?.getValue?.() ?? '');
    const rowId = cell?.getRow?.()?.getData?.()?.id;
    const computed = getComputedTables()[tableIndex]?.[rowId]?.[cell?.getField?.()];
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
    // A solve table's formula is set by the table, not stored in the cell, so `source`
    // is where it lives -- and the tooltip is the only place it shows.
    const source = computed.source || raw;
    element.title = computed.error ? `${source} — ${computed.error}` : source;
    return element;
  }

  // The unit a whole column is kept in, offered where the header already names one.
  // Picking a different one converts what is already in the column rather than
  // reinterpreting it, so the numbers on screen keep meaning the same thing.
  function buildUnitPicker(unit, columnIndex, tableIndex) {
    const select = document.createElement('select');
    select.className = 'spreadsheet-head-unit';
    select.title = 'Unit for this column';
    unitOptions(unit.dimension).forEach((option) => {
      const item = document.createElement('option');
      item.value = option;
      item.textContent = option;
      item.selected = option === unit.unit;
      select.appendChild(item);
    });
    // The header is also a fill/reference surface, so a click meant for the picker
    // must not reach it.
    ['click', 'mousedown'].forEach((type) => {
      select.addEventListener(type, (event) => event.stopPropagation());
    });
    select.addEventListener('change', () => {
      const tables = syncDraftFromGrid();
      tables[tableIndex] = setNotebookResultTableColumnUnit(tables[tableIndex], columnIndex, select.value);
      renderEditor(tables, { activeIndex: tableIndex });
    });
    return select;
  }

  // The spreadsheet address goes in a titleFormatter rather than in `title`, because
  // syncDraftFromGrid reads `title` straight back into the stored table -- writing "A"
  // there would persist the letter as the column's name.
  function buildTitleFormatter(column, columnIndex, tableIndex) {
    return () => {
      const head = document.createElement('span');
      head.className = 'spreadsheet-head';
      const address = document.createElement('span');
      address.className = 'spreadsheet-head-address';
      address.textContent = notebookTableColumnLetter(columnIndex);
      head.appendChild(address);
      const unit = columnUnit(column.title);
      // The picker shows the unit, so the name drops the "(mL)" it would repeat.
      const label = String(unit ? columnBaseTitle(column.title) : column.title || '').trim();
      // A generated "Column 3" adds nothing next to the letter it duplicates.
      if (label && label !== `Column ${columnIndex + 1}`) {
        const name = document.createElement('span');
        name.className = 'spreadsheet-head-name';
        name.textContent = label;
        head.appendChild(name);
      }
      if (unit) {
        head.appendChild(buildUnitPicker(unit, columnIndex, tableIndex));
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
      titleFormatter: buildTitleFormatter(column, columnIndex, tableIndex),
      field: column.field,
      // 'input' edits the underlying value, so clicking a computed cell brings the
      // formula back the way a spreadsheet does.
      editor: 'input',
      formatter: (cell) => formatCell(tableIndex, cell),
      headerSort: false,
      resizable: true
    };
  }

  return {
    formatCell,
    buildUnitPicker,
    buildTitleFormatter,
    buildRowNumberColumn,
    buildColumnDefinition
  };
}

export { createSpreadsheetColumnDefs };
