// Self-check: Tabulator builds a grid on a setTimeout after `new Tabulator`, so a
// read in the same tick as renderEditor (markDraftSaved does one on page open) sees
// no columns. That must not drop the table from the draft, or the next Add Table
// re-renders from an empty model and the page's existing table disappears.
const path = require('node:path');
const assert = require('node:assert/strict');
const { loadEsmStyleModule, flushAsync } = require('./support/runtime.js');
const ROOT = path.join(__dirname, '..');

class FakeTabulator {
  constructor(element, options) {
    this.options = options;
    this.built = false;
    setTimeout(() => { this.built = true; });
  }
  getColumns() {
    if (!this.built) return [];
    return this.options.columns.filter((c) => c.field).map((c) => ({ getField: () => c.field, getDefinition: () => c }));
  }
  getData() { return this.built ? this.options.data : []; }
  on() {}
  destroy() {}
}

const host = {
  innerHTML: '',
  addEventListener() {},
  querySelectorAll() {
    const count = (this.innerHTML.match(/data-result-table-host="/g) || []).length;
    return Array.from({ length: count }, (_u, i) => ({ dataset: { resultTableHost: String(i) } }));
  }
};
const { createSpreadsheetTables } = loadEsmStyleModule(
  path.join(ROOT, 'src', 'renderer', 'lib', 'spreadsheet-tables.js'),
  { document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }), addEventListener() {} }, window: { addEventListener() {} } }
);
let n = 0;
const tables = createSpreadsheetTables({ host, TabulatorLib: FakeTabulator, createId: () => `id${++n}` });
const saved = [{ columns: [{ field: 'a', title: 'Input' }, { field: 'b', title: 'Response' }], rows: [{ id: 'r0', a: '1', b: '2' }] }];

(async () => {
  tables.renderEditor(saved);
  assert.equal(tables.getCurrentTables().length, 1, 'same-tick read keeps the unbuilt table');
  await flushAsync();
  tables.onAdd({ columnCount: 3, rowCount: 3 });
  await flushAsync();
  const shapes = tables.getCurrentTables().map((t) => `${t.columns.length}x${t.rows.length}`);
  assert.deepEqual(shapes, ['2x1', '3x3'], 'adding a table keeps the one already on the page');
  assert.equal(tables.getCurrentTables()[0].rows[0].a, '1', 'built grid is still what is read back');
})();
