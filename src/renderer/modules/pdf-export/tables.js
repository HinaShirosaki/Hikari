import { normalizeNotebookResultTable } from '../../lib/notebook-result-tables.js';
import { notebookTableColumnLetter } from '../../lib/notebook-table-formulas.js';
import {
  BODY_FONT_SIZE,
  LINE_HEIGHT,
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
import { writeMinorHeading, writeParagraph } from './text-blocks.js';

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
    const floor = Math.min(minWidth * 0.8, ctx.maxWidth / columnCount);
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

function writePdfTable(ctx, headers, rows, {
  emptyText = '-', repeatColumns = 1, banded = false, heading = '', sectionHeading = '', preamble = []
} = {}) {
  const safeHeaders = Array.isArray(headers) ? headers.map((header) => safeValue(header)) : [];
  const safeRows = Array.isArray(rows)
    ? rows.map((cells) => (Array.isArray(cells) ? cells.map((cell) => String(cell ?? '').trim()) : []))
    : [];

  if (!safeRows.length || !safeHeaders.length) {
    if (sectionHeading) writeMinorHeading(ctx, sectionHeading);
    if (heading) writeMinorHeading(ctx, heading);
    preamble.forEach(text => writeParagraph(ctx, text));
    if (!safeRows.length) writeParagraph(ctx, emptyText);
    else safeRows.forEach((cells) => writeParagraph(ctx, cells.join(' ')));
    return;
  }

  // Keep the selected paper size and readable type. Wide sheets continue in
  // column groups, with their row identity repeated in every group.
  if (!banded && ctx.maxWidth / safeHeaders.length < 42) {
    const fixed = Math.min(repeatColumns, safeHeaders.length - 1);
    const perBand = Math.max(1, Math.floor(ctx.maxWidth / 62) - fixed);
    const starts = [];
    for (let start = fixed; start < safeHeaders.length; start += perBand) starts.push(start);
    starts.forEach((start, band) => {
      const indices = [...Array.from({ length: fixed }, (_, i) => i),
        ...Array.from({ length: Math.min(perBand, safeHeaders.length - start) }, (_, i) => start + i)];
      writePdfTable(ctx, indices.map(i => safeHeaders[i]), safeRows.map(row => indices.map(i => row[i])),
        { emptyText, repeatColumns: fixed, banded: true, heading: `${heading || 'Table'} - part ${band + 1} of ${starts.length}`,
          sectionHeading: band === 0 ? sectionHeading : '', preamble: band === 0 ? preamble : [] });
    });
    return;
  }

  // Wrap with the font each row is drawn in: headers are bold, body rows normal.
  font(ctx, 'normal');
  ctx.doc.setFontSize(TABLE_FONT_SIZE);
  const widths = resolveTableColumnWidths(ctx, safeHeaders, safeRows);
  font(ctx, 'bold');
  const freshPageHeight = contentBottom(ctx) - ctx.marginTop - 29;
  const maxHeaderHeight = Math.min(120, freshPageHeight / 4);
  const fullHeadings = [];
  const repeatedHeaders = safeHeaders.map((header, index) => {
    const lines = splitTableCells(ctx, [header], [widths[index]], { fallback: '-' })[0];
    if (getTableRowHeight([lines]) <= maxHeaderHeight) return header;
    const reference = `Column ${header.match(/^([A-Z]+)\s*·/)?.[1] || notebookTableColumnLetter(index)}`;
    fullHeadings.push(`${reference}: ${header}`);
    return reference;
  });
  // Long titles are printed once at full width below the table. Repeating a
  // header taller than a page would otherwise leave no room for any body line.
  const headerLines = splitTableCells(ctx, repeatedHeaders, widths, { fallback: '-' });
  const headerHeight = getTableRowHeight(headerLines);
  font(ctx, 'normal');
  const firstRow = safeHeaders.map((_header, index) => String(safeRows[0]?.[index] ?? '').trim());
  const firstRowHeight = getTableRowHeight(splitTableCells(ctx, firstRow, widths));
  const shortTableHeight = safeRows.length <= 6
    ? safeRows.reduce((height, row) => height + getTableRowHeight(splitTableCells(ctx, safeHeaders.map((_header, index) => row[index] || ''), widths)), headerHeight)
    : Infinity;
  let introHeight = 0;
  for (const title of [sectionHeading, heading].filter(Boolean)) {
    font(ctx, 'bold');
    ctx.doc.setFontSize(BODY_FONT_SIZE);
    introHeight += 9 + splitWrappedLines(ctx.doc, title, ctx.maxWidth).length * (BODY_FONT_SIZE + 4);
  }
  font(ctx, 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  introHeight += preamble.reduce((height, text) => height + splitWrappedLines(ctx.doc, text, ctx.maxWidth).length * LINE_HEIGHT + 4, 0);
  const keepHeight = shortTableHeight + introHeight <= freshPageHeight
    ? shortTableHeight : headerHeight + Math.min(firstRowHeight, TABLE_LINE_HEIGHT * 3 + TABLE_CELL_PADDING * 2);
  ensureSpace(ctx, Math.min(freshPageHeight, keepHeight + introHeight));
  if (sectionHeading) writeMinorHeading(ctx, sectionHeading);
  if (heading) writeMinorHeading(ctx, heading);
  preamble.forEach(text => writeParagraph(ctx, text));

  function writeHeader() {
    ensureSpace(ctx, headerHeight);
    drawTableRow(ctx, headerLines, widths, { header: true });
  }

  function nextTablePage() {
    addPage(ctx);
    writeHeader();
    if (ctx.y + getTableRowHeight([['']]) > contentBottom(ctx)) {
      throw new Error('The PDF page has no room for a table row below its header.');
    }
  }

  writeHeader();
  safeRows.forEach((cells, rowIndex) => {
    const rowCells = safeHeaders.map((_header, index) => String(cells[index] ?? '').trim());
    font(ctx, 'normal');
    const rowLines = splitTableCells(ctx, rowCells, widths);
    const lineCount = Math.max(...rowLines.map(lines => lines.length));
    const rowHeight = getTableRowHeight(rowLines);
    const pageCapacity = contentBottom(ctx) - ctx.marginTop - 29 - headerHeight;
    if (rowHeight <= pageCapacity) {
      if (ctx.y + rowHeight > contentBottom(ctx)) {
        nextTablePage();
      }
      drawTableRow(ctx, rowLines, widths, { zebra: rowIndex % 2 === 1 });
      return;
    }
    // A row can be taller than an entire page. Split its wrapped lines across
    // pages, repeating column headings and short identity cells on continuation.
    let offset = 0;
    while (offset < lineCount) {
      const capacity = Math.floor((contentBottom(ctx) - ctx.y - TABLE_CELL_PADDING * 2) / TABLE_LINE_HEIGHT);
      if (capacity < 1) {
        nextTablePage();
        continue;
      }
      const count = Math.min(capacity, lineCount - offset);
      const fragment = rowLines.map((lines, index) => offset && index < repeatColumns && lines.length === 1
        ? lines : lines.slice(offset, offset + count));
      drawTableRow(ctx, fragment, widths, { zebra: rowIndex % 2 === 1 });
      offset += count;
      if (offset < lineCount) {
        nextTablePage();
      }
    }
  });
  ctx.y += 10;
  if (fullHeadings.length) {
    writeMinorHeading(ctx, 'Full column headings');
    fullHeadings.forEach(text => writeParagraph(ctx, text));
  }
}

function writeSimpleTable(ctx, headers, rows, options = {}) {
  writePdfTable(ctx, headers, rows, options);
}

function writeNotebookResultTable(ctx, table, heading = '') {
  const normalized = normalizeNotebookResultTable(table);
  if (!normalized) {
    if (heading) writeMinorHeading(ctx, heading);
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
  writePdfTable(ctx, headers, rows, { repeatColumns: 2, heading });
}

function writeNotebookToolCalculationTable(ctx, table, { heading = '', sectionHeading = '' } = {}) {
  const source = table && typeof table === 'object' ? table : null;
  if (!source) {
    writeParagraph(ctx, '-');
    return;
  }
  const headers = Array.isArray(source.headers)
    ? source.headers.map((header) => safeValue(header))
    : [];
  const rows = (Array.isArray(source.rows) ? source.rows : [])
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []))
    .filter((row) => row.some(Boolean));
  const preamble = (Array.isArray(source.metaRows) ? source.metaRows : []).map(row => {
    if (!Array.isArray(row) || !row.some(Boolean)) return '';
    const pairs = [];
    for (let index = 0; index < row.length; index += 2) {
      if (row[index]) pairs.push(`${row[index]}: ${row[index + 1] || '-'}`);
    }
    return pairs.join(' | ');
  }).filter(Boolean);
  writePdfTable(ctx, headers, rows, { heading, sectionHeading, preamble });
  (Array.isArray(source.footerRows) ? source.footerRows : []).forEach(row => {
    if (Array.isArray(row) && row.some(Boolean)) writeParagraph(ctx, row.filter(Boolean).join(': '));
  });
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
