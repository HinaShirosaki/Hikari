// The Bench calculations demo's stand-in for Tabulator: just the part the notebook
// worksheet uses (input editors, formatters, rownum, cellEdited, add row/column).
// It keeps Tabulator's class names, so the app's spreadsheet CSS, fill handle,
// formula reference picker, and the website guide work unchanged.
// ponytail: no column resizing, sorting, or keyboard cell navigation; load the
// real Tabulator (trial-launch.js) if the worksheet ever needs them.
(function () {
  'use strict';
  const element = className => Object.assign(document.createElement('div'), { className });

  class Column {
    constructor(def) { this.def = def; }
    getField() { return this.def.field; }
    getDefinition() { return this.def; }
    render() {
      const col = element('tabulator-col'), content = element('tabulator-col-content'), title = element('tabulator-col-title');
      col.setAttribute('role', 'columnheader');
      if (this.def.field) col.setAttribute('tabulator-field', this.def.field);
      if (this.def.cssClass) col.classList.add(this.def.cssClass);
      const custom = this.def.titleFormatter?.();
      if (custom instanceof Node) title.append(custom); else title.textContent = this.def.title || ' ';
      content.append(title); col.append(content);
      return col;
    }
  }

  class Cell {
    constructor(row, column) {
      this.row = row; this.column = column; this.editing = false;
      const cell = this.element = element('tabulator-cell'), { field, cssClass, hozAlign, editor } = column.def;
      cell.setAttribute('role', 'gridcell');
      if (field) cell.setAttribute('tabulator-field', field);
      if (cssClass) cell.classList.add(cssClass);
      if (hozAlign) cell.style.textAlign = hozAlign;
      // Like Tabulator, clicking or tabbing into an editable cell opens its editor.
      if (editor) {
        cell.classList.add('tabulator-editable'); cell.tabIndex = 0;
        cell.addEventListener('focus', () => this.edit()); cell.addEventListener('click', () => this.edit());
      }
    }
    getValue() { return this.row.data[this.column.def.field]; }
    getField() { return this.column.def.field; }
    getRow() { return this.row; }
    getColumn() { return this.column; }
    getElement() { return this.element; }
    render() {
      if (this.editing) return;
      const { formatter } = this.column.def;
      if (formatter === 'rownum') { this.element.textContent = this.row.grid.rows.indexOf(this.row) + 1; return; }
      const shown = typeof formatter === 'function' ? formatter(this) : this.getValue() ?? '';
      this.element.replaceChildren(shown instanceof Node ? shown : String(shown));
    }
    edit() {
      if (this.editing) return;
      const before = String(this.getValue() ?? ''), input = document.createElement('input');
      input.type = 'text'; input.value = before;
      input.style.cssText = 'padding:4px;width:100%;box-sizing:border-box';
      // Enter or leaving the cell keeps the edit; Escape restores the old value.
      const finish = keep => {
        if (!this.editing) return;
        this.editing = false;
        this.element.classList.remove('tabulator-editing');
        const changed = keep && input.value !== before;
        if (changed) this.row.data[this.getField()] = input.value;
        this.render();
        if (changed) this.row.grid.emit('cellEdited', this);
      };
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Enter'); }
      });
      input.addEventListener('blur', () => finish(true));
      this.editing = true;
      this.element.classList.add('tabulator-editing');
      this.element.replaceChildren(input);
      input.focus();
    }
  }

  class Row {
    constructor(grid, data) {
      this.grid = grid; this.data = data;
      this.element = element('tabulator-row tabulator-selectable');
      this.element.setAttribute('role', 'row');
      this.cells = [];
    }
    addCell(column) { const cell = new Cell(this, column); this.cells.push(cell); this.element.append(cell.element); cell.render(); }
    getElement() { return this.element; }
    getData() { return this.data; }
    getCell(field) { return this.cells.find(cell => cell.getField() === field); }
    update(values) { Object.assign(this.data, values); this.reformat(); }
    reformat() { this.cells.forEach(cell => cell.render()); }
  }

  class Grid {
    constructor(host, options = {}) {
      this.element = host; this.listeners = {}; this.rows = []; this.columns = [];
      this.headers = element('tabulator-headers');
      this.headers.setAttribute('role', 'row');
      const header = element('tabulator-header'), holder = element('tabulator-tableholder');
      this.body = element('tabulator-table');
      header.append(this.headers); holder.append(this.body);
      host.classList.add('tabulator', 'trial-grid');
      host.setAttribute('role', 'grid');
      host.replaceChildren(header, holder);
      (options.columns || []).forEach(def => this.addColumn(def));
      (options.data || []).forEach(data => this.addRow(data));
      if (options.height) this.setHeight(options.height);
    }
    on(name, listener) { (this.listeners[name] ||= []).push(listener); }
    emit(name, ...args) { (this.listeners[name] || []).forEach(listener => listener(...args)); }
    getRows() { return [...this.rows]; }
    getColumns() { return [...this.columns]; }
    getData() { return this.rows.map(row => ({ ...row.data })); }
    addRow(data) {
      const row = new Row(this, { ...data });
      this.rows.push(row);
      row.element.classList.add(this.rows.length % 2 ? 'tabulator-row-odd' : 'tabulator-row-even');
      this.columns.forEach(column => row.addCell(column));
      this.body.append(row.element);
      return row;
    }
    addColumn(def) {
      const column = new Column(def);
      this.columns.push(column);
      this.headers.append(column.render());
      this.rows.forEach(row => row.addCell(column));
      // fitColumns: fixed widths stay, every other column shares the rest equally.
      this.element.style.setProperty('--trial-grid-columns',
        this.columns.map(({ def }) => def.width ? `${def.width}px` : 'minmax(0, 1fr)').join(' '));
      return column;
    }
    setHeight(height) { this.element.style.height = typeof height === 'number' ? `${height}px` : height; }
    destroy() { this.element.replaceChildren(); this.element.classList.remove('tabulator', 'trial-grid'); this.listeners = {}; }
  }

  window.Tabulator ||= Grid;
})();
