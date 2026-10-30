import { createPresentation } from "../../i18n.mjs";
import { escapeHtml } from '../../lib/html.js';
const i18nUi = createPresentation("gel");

// The lane table typed on a white figure, shared by a single gel's table strip
// and the Stack figure. Callers place the inputs: cells are { row, lane,
// rotated, style } with lane 0 for the row label. Rows have the lane table's
// shape, [{ label, values: [lane 1, lane 2, …] }].
const valueOf = (rows, cell) => (cell.lane ? rows[cell.row]?.values?.[cell.lane - 1] : rows[cell.row]?.label) || '';

export const tableInputsShape = cells => JSON.stringify(cells.map(cell => [cell.row, cell.lane, Boolean(cell.rotated)]));

export function tableInputsMarkup(cells, rows) {
  return cells.map(cell => `<input type="text" class="gel-table-input${cell.lane ? '' : ' is-label'}${cell.rotated ? ' is-rotated' : ''}"`
    + ` maxlength="160" autocomplete="off" spellcheck="false" data-table-row="${cell.row}"`
    + (cell.lane ? ` data-table-lane="${cell.lane}" placeholder="${cell.lane}"` : ' placeholder="Label" data-i18n-placeholder="gel.full.9eccf29d"')
    + ` ${i18nUi.attributeMessage("aria-label", cell.lane
      ? i18nUi.message("Lane {p0}, row {p1}", { p0: cell.lane, p1: cell.row + 1 })
      : i18nUi.message("Row {p0} label", { p0: cell.row + 1 }))}`
    + ` style="${cell.style}" value="${escapeHtml(valueOf(rows, cell))}" />`).join('');
}

// Moves and refills the inputs already in place, so typing keeps the caret.
export function syncTableInputs(container, cells, rows) {
  container.querySelectorAll?.('.gel-table-input').forEach((input, index) => {
    if (!cells[index]) return;
    input.style.cssText = cells[index].style;
    const value = valueOf(rows, cells[index]);
    if (input.value !== value) input.value = value;
  });
}

export function writeTableInput(rows, input) {
  const row = rows[input.dataset.tableRow];
  if (!row) return false;
  const lane = Number(input.dataset.tableLane);
  const value = String(input.value).slice(0, 160);
  if (lane) row.values = Array.from({ length: Math.max(row.values.length, lane) }, (_, index) => (index === lane - 1 ? value : row.values[index] ?? ''));
  else row.label = value;
  return true;
}
