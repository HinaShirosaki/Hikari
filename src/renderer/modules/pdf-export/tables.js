import {
  normalizeNotebookResultTable,
  normalizeNotebookResultTables
} from '../../lib/notebook-result-tables.js';
import {
  TABLE_FONT_SIZE,
  TABLE_LINE_HEIGHT,
  TABLE_CELL_PADDING,
  ACCENT,
  ACCENT_TINT,
  ZEBRA_FILL,
  RULE_COLOR
} from './constants.js';
import {
  safeValue,
  font,
  setTextColor,
  addPage,
  contentBottom,
  ensureSpace,
  splitWrappedLines,
  estimateTextWidth,
  splitLongToken
} from './doc-context.js';
import { writeParagraph } from './text-blocks.js';

function prepareTableCellText(value, columnWidth, fallback = '') {
  const text = safeValue(value, fallback);
  const maxChars = Math.max(
    6,
    Math.floor((columnWidth - (TABLE_CELL_PADDING * 2)) / (TABLE_FONT_SIZE * 0.52))
  );
  return text
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : splitLongToken(part, maxChars)))
    .join('');
}

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
    const scale = ctx.maxWidth / desiredTotal;
    return desiredWidths.map((width) => Math.max(minWidth * 0.8, width * scale));
  }
  const extra = ctx.maxWidth - desiredTotal;
  return desiredWidths.map((width) => width + (extra * (width / desiredTotal)));
}

function splitTableCells(ctx, cells, widths, { fallback = '' } = {}) {
  return cells.map((cell, index) => {
    const width = Math.max(12, widths[index] - (TABLE_CELL_PADDING * 2));
    return splitWrappedLines(ctx.doc, prepareTableCellText(cell, widths[index], fallback), width);
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

  if (header) {
    ctx.doc.setFillColor(ACCENT_TINT[0], ACCENT_TINT[1], ACCENT_TINT[2]);
    ctx.doc.rect(ctx.margin, ctx.y, totalWidth, rowHeight, 'F');
  } else if (zebra) {
    ctx.doc.setFillColor(ZEBRA_FILL[0], ZEBRA_FILL[1], ZEBRA_FILL[2]);
    ctx.doc.rect(ctx.margin, ctx.y, totalWidth, rowHeight, 'F');
  }

  font(ctx, header ? 'bold' : 'normal');
  ctx.doc.setFontSize(TABLE_FONT_SIZE);
  setTextColor(ctx, header ? ACCENT : [0, 0, 0]);

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
  ctx.doc.setDrawColor(RULE_COLOR[0], RULE_COLOR[1], RULE_COLOR[2]);
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

  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'normal');
  ctx.doc.setFontSize(TABLE_FONT_SIZE);
  const widths = resolveTableColumnWidths(ctx, safeHeaders, safeRows);
  const headerLines = splitTableCells(ctx, safeHeaders, widths, { fallback: '-' });
  const headerHeight = getTableRowHeight(headerLines);

  function writeHeader() {
    ensureSpace(ctx, headerHeight);
    drawTableRow(ctx, headerLines, widths, { header: true });
  }

  writeHeader();
  safeRows.forEach((cells, rowIndex) => {
    const rowCells = safeHeaders.map((_header, index) => String(cells[index] ?? '').trim());
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
  const headers = normalized.columns.map((column) => column.title);
  const rows = normalized.rows.map((row) => (
    normalized.columns.map((column) => row[column.field] || '')
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

function isWideNotebookResultTable(table) {
  const normalized = normalizeNotebookResultTable(table);
  if (!normalized) {
    return false;
  }
  const maxCellLength = normalized.rows.reduce((max, row) => (
    normalized.columns.reduce((cellMax, column) => (
      Math.max(cellMax, String(row[column.field] || '').trim().length)
    ), max)
  ), 0);
  return normalized.columns.length > 4 || maxCellLength > 48;
}

function hasWideNotebookResultTable(tables) {
  return normalizeNotebookResultTables(tables).some((table) => isWideNotebookResultTable(table));
}

export {
  prepareTableCellText,
  resolveTableColumnWidths,
  splitTableCells,
  getTableRowHeight,
  drawTableRow,
  writePdfTable,
  writeSimpleTable,
  writeNotebookResultTable,
  writeNotebookToolCalculationTable,
  isWideNotebookResultTable,
  hasWideNotebookResultTable
};
