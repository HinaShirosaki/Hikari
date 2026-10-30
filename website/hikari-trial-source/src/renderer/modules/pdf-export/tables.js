import { normalizeNotebookResultTable } from '../../lib/notebook-result-tables.js';
import { notebookTableColumnLetter } from '../../lib/notebook-table-formulas.js';
import {
  TABLE_FONT_SIZE,
  TABLE_LINE_HEIGHT,
  TABLE_CELL_PADDING,
  ACCENT,
  ACCENT_TINT,
  ZEBRA_FILL,
  RULE_COLOR,
  EDITORIAL_INK,
  EDITORIAL_RULE
} from './constants.js';
import {
  safeValue,
  font,
  setTextColor,
  addPage,
  contentBottom,
  ensureSpace,
  splitWrappedLines,
  estimateTextWidth
} from './doc-context.js';
import { writeParagraph } from './text-blocks.js';

function resolveTableColumnWidths(ctx, headers, rows) {
  const columnCount = headers.length;
  if (!columnCount) {
    return [];
  }
  const minWidth = Math.max(34, Math.min(62, ctx.maxWidth / Math.max(columnCount * 2.8, 1)));
  const maxWidth = Math.max(minWidth, Math.min(190, ctx.maxWidth * 0.36));
  const desiredWidths = headers.map((header, columnIndex) => {
    const values = [
      header,
      ...rows.map((row) => (Array.isArray(row) ? row[columnIndex] : ''))
    ];
    const measured = values.reduce((max, value) => {
      const text = String(value || '');
      const naturalWidth = estimateTextWidth(ctx, text, TABLE_FONT_SIZE) + (TABLE_CELL_PADDING * 2);
      return Math.max(max, Math.min(maxWidth, naturalWidth));
    }, minWidth);
    return Math.max(minWidth, measured);
  });

  const desiredTotal = desiredWidths.reduce((sum, width) => sum + width, 0);
  if (desiredTotal <= 0) {
    return Array.from({ length: columnCount }, () => ctx.maxWidth / columnCount);
  }
  if (desiredTotal >= ctx.maxWidth) {
    const floor = minWidth * 0.8;
    const scaled = desiredWidths.map((width) => Math.max(floor, width * (ctx.maxWidth / desiredTotal)));
    // Columns held at the floor push the sum past maxWidth; take that excess from the rest.
    const floored = scaled.reduce((sum, width) => sum + (width <= floor ? width : 0), 0);
    const flexible = scaled.reduce((sum, width) => sum + (width > floor ? width : 0), 0);
    const squeeze = flexible > 0 ? Math.max(0, ctx.maxWidth - floored) / flexible : 1;
    return scaled.map((width) => (width > floor ? width * squeeze : width));
  }
  const extra = ctx.maxWidth - desiredTotal;
  return desiredWidths.map((width) => width + (extra * (width / desiredTotal)));
}

function splitTableCells(ctx, cells, widths, { fallback = '' } = {}) {
  return cells.map((cell, index) => {
    const width = Math.max(12, widths[index] - (TABLE_CELL_PADDING * 2));
    // jsPDF breaks over-long tokens (sequences, URLs) at the measured width itself.
    return splitWrappedLines(ctx.doc, safeValue(cell, fallback), width);
  });
}

function getTableRowHeight(lineGroups) {
  const maxLines = lineGroups.reduce((max, lines) => Math.max(max, Array.isArray(lines) ? lines.length : 1), 1);
  return Math.max(18, (maxLines * TABLE_LINE_HEIGHT) + (TABLE_CELL_PADDING * 2));
}

// Zebra rows with horizontal rules only — vertical grid lines add noise at this density.
function drawTableRow(ctx, lineGroups, widths, { header = false, zebra = false } = {}) {
  const rowHeight = getTableRowHeight(lineGroups);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const editorial = ctx.visualStyle === 'editorial';

  if (editorial && header) {
    ctx.doc.setDrawColor(...EDITORIAL_INK);
    ctx.doc.setLineWidth(0.8);
    ctx.doc.line(ctx.margin, ctx.y, ctx.margin + totalWidth, ctx.y);
  } else if (header) {
    ctx.doc.setFillColor(ACCENT_TINT[0], ACCENT_TINT[1], ACCENT_TINT[2]);
    ctx.doc.rect(ctx.margin, ctx.y, totalWidth, rowHeight, 'F');
  } else if (zebra && !editorial) {
    ctx.doc.setFillColor(ZEBRA_FILL[0], ZEBRA_FILL[1], ZEBRA_FILL[2]);
    ctx.doc.rect(ctx.margin, ctx.y, totalWidth, rowHeight, 'F');
  }

  font(ctx, header ? 'bold' : 'normal');
  ctx.doc.setFontSize(TABLE_FONT_SIZE);
  setTextColor(ctx, editorial ? EDITORIAL_INK : (header ? ACCENT : [0, 0, 0]));

  let x = ctx.margin;
  lineGroups.forEach((lines, columnIndex) => {
    const cellLines = Array.isArray(lines) && lines.length ? lines : [''];
    let textY = ctx.y + TABLE_CELL_PADDING + TABLE_FONT_SIZE;
    cellLines.forEach((line) => {
      ctx.doc.text(String(line || ''), x + TABLE_CELL_PADDING, textY);
      textY += TABLE_LINE_HEIGHT;
    });
    x += widths[columnIndex];
  });
  setTextColor(ctx, [0, 0, 0]);

  ctx.y += rowHeight;
  const rule = editorial ? EDITORIAL_RULE : RULE_COLOR;
  ctx.doc.setDrawColor(rule[0], rule[1], rule[2]);
  ctx.doc.setLineWidth(0.5);
  ctx.doc.line(ctx.margin, ctx.y, ctx.margin + totalWidth, ctx.y);
}

function writePdfTable(ctx, headers, rows, { emptyText = '-' } = {}) {
  const safeHeaders = Array.isArray(headers) ? headers.map((header) => safeValue(header)) : [];
  const safeRows = Array.isArray(rows)
    ? rows.map((cells) => (Array.isArray(cells) ? cells.map((cell) => String(cell ?? '').trim()) : []))
    : [];

  if (!safeRows.length) {
    writeParagraph(ctx, emptyText);
    return;
  }

  if (!safeHeaders.length) {
    safeRows.forEach((cells) => writeParagraph(ctx, cells.join(' ')));
    return;
  }

  // Wrap with the font each row is drawn in: headers are bold, body rows normal.
  font(ctx, 'normal');
  ctx.doc.setFontSize(TABLE_FONT_SIZE);
  const widths = resolveTableColumnWidths(ctx, safeHeaders, safeRows);
  font(ctx, 'bold');
  const headerLines = splitTableCells(ctx, safeHeaders, widths, { fallback: '-' });
  const headerHeight = getTableRowHeight(headerLines);
  font(ctx, 'normal');
  const firstRow = safeHeaders.map((_header, index) => String(safeRows[0]?.[index] ?? '').trim());
  const firstRowHeight = getTableRowHeight(splitTableCells(ctx, firstRow, widths));
  ensureSpace(ctx, headerHeight + firstRowHeight);

  function writeHeader() {
    ensureSpace(ctx, headerHeight);
    drawTableRow(ctx, headerLines, widths, { header: true });
  }

  writeHeader();
  safeRows.forEach((cells, rowIndex) => {
    const rowCells = safeHeaders.map((_header, index) => String(cells[index] ?? '').trim());
    font(ctx, 'normal');
    const rowLines = splitTableCells(ctx, rowCells, widths);
    const rowHeight = getTableRowHeight(rowLines);
    if (ctx.y + rowHeight > contentBottom(ctx)) {
      addPage(ctx);
      writeHeader();
    }
    drawTableRow(ctx, rowLines, widths, { zebra: rowIndex % 2 === 1 });
  });
  ctx.y += 10;
}

function writeSimpleTable(ctx, headers, rows, { emptyText = '-' } = {}) {
  writePdfTable(ctx, headers, rows, { emptyText });
}

function writeNotebookResultTable(ctx, table) {
  const normalized = normalizeNotebookResultTable(table);
  if (!normalized) {
    writeParagraph(ctx, '-');
    return;
  }
  // Same furniture as the on-screen grid: column letters and row numbers, so a
  // formula like C2/(B2*D2) written in the notebook still reads in the export.
  const headers = ['#', ...normalized.columns.map((column, index) => (
    `${notebookTableColumnLetter(index)} · ${column.title}`
  ))];
  const rows = normalized.rows.map((row, rowIndex) => (
    [String(rowIndex + 1), ...normalized.columns.map((column) => row[column.field] || '')]
  ));
  writePdfTable(ctx, headers, rows);
}

function writeNotebookToolCalculationTable(ctx, table) {
  const source = table && typeof table === 'object' ? table : null;
  if (!source) {
    writeParagraph(ctx, '-');
    return;
  }
  const headers = Array.isArray(source.headers)
    ? source.headers.map((header) => safeValue(header))
    : [];
  const rows = [
    ...(Array.isArray(source.metaRows) ? source.metaRows : []),
    ...(Array.isArray(source.rows) ? source.rows : []),
    ...(Array.isArray(source.footerRows) ? source.footerRows : [])
  ].map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []))
    .filter((row) => row.some(Boolean));
  writePdfTable(ctx, headers, rows);
}

export {
  resolveTableColumnWidths,
  splitTableCells,
  getTableRowHeight,
  drawTableRow,
  writePdfTable,
  writeSimpleTable,
  writeNotebookResultTable,
  writeNotebookToolCalculationTable
};
