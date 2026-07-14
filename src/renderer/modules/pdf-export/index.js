import {
  normalizeNotebookResultTable,
  normalizeNotebookResultTables
} from '../../lib/notebook-result-tables.js';
import { normalizeNotebookToolCalculations } from '../../lib/notebook-tool-calculations.js';

const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;

const PAGE_MARGIN = 72;
const TITLE_FONT_SIZE = 20;
const HEADING_FONT_SIZE = 15;
const BODY_FONT_SIZE = 11;
const LINE_HEIGHT = 14;
const TABLE_FONT_SIZE = 8.5;
const TABLE_LINE_HEIGHT = 10.5;
const TABLE_CELL_PADDING = 4;
const TABLE_HEADER_FILL = 238;
const TABLE_BORDER_COLOR = 175;

const PLATE_DEFINITIONS = {
  '6': { rows: 2, columns: 3, label: '6 well' },
  '12': { rows: 3, columns: 4, label: '12 well' },
  '24': { rows: 4, columns: 6, label: '24 well' },
  '48': { rows: 6, columns: 8, label: '48 well' },
  '96': { rows: 8, columns: 12, label: '96 well' },
  '384': { rows: 16, columns: 24, label: '384 well' },
  '1536': { rows: 32, columns: 48, label: '1536 well' }
};

function getJsPdfCtor() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window?.jspdf?.jsPDF || null;
}

function safeValue(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatTimestamp(value) {
  const parsed = Date.parse(String(value || '').trim());
  if (!Number.isFinite(parsed)) {
    return '-';
  }
  return new Date(parsed).toLocaleString();
}

function sanitizeFileName(value, fallback = 'export') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function createContext({
  title,
  orientation = 'p',
  format = 'letter',
  margin = PAGE_MARGIN,
  serif = false
}) {
  const JsPdf = getJsPdfCtor();
  if (!JsPdf) {
    window.alert('PDF generator is not loaded. Please restart the app and try again.');
    return null;
  }

  const doc = new JsPdf({
    orientation,
    unit: 'pt',
    format
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - (margin * 2);

  let y = margin;
  doc.setFont(serif ? 'times' : 'helvetica', 'bold');
  doc.setFontSize(TITLE_FONT_SIZE);
  y = writeWrappedLines(doc, String(title || 'Export'), margin, y, maxWidth, TITLE_FONT_SIZE + 8);
  y += 4;

  return {
    doc,
    pageWidth,
    pageHeight,
    maxWidth,
    margin,
    orientation,
    format,
    y,
    serif,
    sectionCount: 0
  };
}

function refreshPageMetrics(ctx) {
  ctx.pageWidth = ctx.doc.internal.pageSize.getWidth();
  ctx.pageHeight = ctx.doc.internal.pageSize.getHeight();
  ctx.maxWidth = ctx.pageWidth - (ctx.margin * 2);
}

function addPage(ctx, orientation = ctx.orientation) {
  if (typeof ctx.doc.addPage === 'function') {
    ctx.doc.addPage(ctx.format, orientation);
  }
  ctx.orientation = orientation || ctx.orientation;
  refreshPageMetrics(ctx);
  ctx.y = ctx.margin;
}

function ensureSpace(ctx, neededHeight) {
  if (ctx.y + neededHeight <= ctx.pageHeight - ctx.margin) {
    return;
  }
  addPage(ctx);
}

function writeWrappedLines(doc, text, x, y, maxWidth, lineHeight = LINE_HEIGHT) {
  const lines = doc.splitTextToSize(String(text || ''), maxWidth);
  doc.text(lines, x, y);
  return y + (lines.length * lineHeight);
}

function splitWrappedLines(doc, text, maxWidth) {
  const rawLines = String(text || '').split(/\r?\n/);
  const lines = rawLines.flatMap((line) => {
    const wrapped = doc.splitTextToSize(line || ' ', maxWidth);
    return Array.isArray(wrapped) && wrapped.length ? wrapped : [''];
  });
  return lines.length ? lines : [''];
}

function writeWrappedBlock(ctx, text, x, maxWidth, lineHeight = LINE_HEIGHT) {
  const lines = splitWrappedLines(ctx.doc, text, maxWidth);
  lines.forEach((line) => {
    ensureSpace(ctx, lineHeight);
    ctx.doc.text(String(line || ''), x, ctx.y);
    ctx.y += lineHeight;
  });
}

function writeHeading(ctx, heading) {
  const spacingBefore = ctx.sectionCount > 0 ? 8 : 0;
  if (spacingBefore > 0) {
    ensureSpace(ctx, spacingBefore);
    ctx.y += spacingBefore;
  }
  ensureSpace(ctx, HEADING_FONT_SIZE + 12);
  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'bold');
  ctx.doc.setFontSize(HEADING_FONT_SIZE);
  writeWrappedBlock(ctx, heading, ctx.margin, ctx.maxWidth, HEADING_FONT_SIZE + 8);
  ctx.y += 4;
  ctx.sectionCount += 1;
}

function writeParagraph(ctx, text) {
  ensureSpace(ctx, LINE_HEIGHT + 2);
  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  writeWrappedBlock(ctx, text || '-', ctx.margin, ctx.maxWidth, LINE_HEIGHT);
  ctx.y += 4;
}

function writeKeyValue(ctx, key, value) {
  writeParagraph(ctx, `${key}: ${safeValue(value)}`);
}

function writeBulletLines(ctx, lines) {
  const values = Array.isArray(lines) ? lines : [];
  if (!values.length) {
    writeParagraph(ctx, '-');
    return;
  }
  values.forEach((line) => {
    writeParagraph(ctx, `- ${String(line || '').trim()}`);
  });
}

function writeMinorHeading(ctx, heading) {
  ensureSpace(ctx, BODY_FONT_SIZE + 8);
  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'bold');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  writeWrappedBlock(ctx, heading, ctx.margin, ctx.maxWidth, BODY_FONT_SIZE + 4);
  ctx.y += 2;
}

function estimateTextWidth(ctx, text, fontSize = TABLE_FONT_SIZE) {
  if (typeof ctx.doc.getTextWidth === 'function') {
    const measured = Number(ctx.doc.getTextWidth(String(text || '')));
    if (Number.isFinite(measured)) {
      return measured;
    }
  }
  return String(text || '').length * fontSize * 0.52;
}

function splitLongToken(token, maxChars) {
  const source = String(token || '');
  if (source.length <= maxChars) {
    return source;
  }
  const chunks = [];
  for (let index = 0; index < source.length; index += maxChars) {
    chunks.push(source.slice(index, index + maxChars));
  }
  return chunks.join(' ');
}

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

function drawTableRow(ctx, lineGroups, widths, { header = false } = {}) {
  const rowHeight = getTableRowHeight(lineGroups);
  let x = ctx.margin;

  ctx.doc.setDrawColor(TABLE_BORDER_COLOR, TABLE_BORDER_COLOR, TABLE_BORDER_COLOR);
  if (header) {
    ctx.doc.setFillColor(TABLE_HEADER_FILL, TABLE_HEADER_FILL, TABLE_HEADER_FILL);
  } else {
    ctx.doc.setFillColor(255, 255, 255);
  }
  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', header ? 'bold' : 'normal');
  ctx.doc.setFontSize(TABLE_FONT_SIZE);

  widths.forEach((width) => {
    ctx.doc.rect(x, ctx.y, width, rowHeight, header ? 'FD' : 'S');
    x += width;
  });

  x = ctx.margin;
  lineGroups.forEach((lines, columnIndex) => {
    const cellLines = Array.isArray(lines) && lines.length ? lines : [''];
    let textY = ctx.y + TABLE_CELL_PADDING + TABLE_FONT_SIZE;
    cellLines.forEach((line) => {
      ctx.doc.text(String(line || ''), x + TABLE_CELL_PADDING, textY);
      textY += TABLE_LINE_HEIGHT;
    });
    x += widths[columnIndex];
  });

  ctx.y += rowHeight;
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
  safeRows.forEach((cells) => {
    const rowCells = safeHeaders.map((_header, index) => String(cells[index] ?? '').trim());
    const rowLines = splitTableCells(ctx, rowCells, widths);
    const rowHeight = getTableRowHeight(rowLines);
    if (ctx.y + rowHeight > ctx.pageHeight - ctx.margin) {
      addPage(ctx);
      writeHeader();
    }
    drawTableRow(ctx, rowLines, widths);
  });
  ctx.y += 6;
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

function finishAndSave(ctx, fileNameBase) {
  ctx.doc.save(`${sanitizeFileName(fileNameBase, 'export')}.pdf`);
}

function notebookStateLabel(entry) {
  return String(entry?.notebookState || '').trim().toLowerCase() === 'planned' ? 'Planned' : 'Executed';
}

function formatGelAnalysisTypeLabel(type) {
  if (type === 'western') {
    return 'Western Blot';
  }
  if (type === 'agarose') {
    return 'DNA/RNA Agarose';
  }
  return 'SDS-PAGE';
}

function formatAssayAnalysisMethodLabel(method) {
  const source = String(method || '').trim();
  if (!source) {
    return 'Analysis plot';
  }
  return source
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function hasSerialDilutionContent(summary) {
  return Boolean(
    summary
    && (
      (Array.isArray(summary.feedbackMessages) && summary.feedbackMessages.length)
      || (Array.isArray(summary.initialDilutionRows) && summary.initialDilutionRows.length)
      || (Array.isArray(summary.followingDilutionRows) && summary.followingDilutionRows.length)
      || summary.hasValidPlans
    )
  );
}

function inferPdfImageFormat(dataUrl) {
  const source = String(dataUrl || '').trim().toLowerCase();
  if (source.startsWith('data:image/jpeg') || source.startsWith('data:image/jpg')) {
    return 'JPEG';
  }
  return 'PNG';
}

async function preparePdfImageAsset(dataUrl) {
  const source = String(dataUrl || '').trim();
  if (!source.startsWith('data:image/')) {
    return null;
  }

  if (
    typeof Image !== 'function'
    || typeof document === 'undefined'
    || typeof document.createElement !== 'function'
  ) {
    return {
      dataUrl: source,
      format: inferPdfImageFormat(source),
      width: 1200,
      height: 800
    };
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = Math.max(1, Math.ceil(image.naturalWidth || image.width || 1));
      const height = Math.max(1, Math.ceil(image.naturalHeight || image.height || 1));
      const canvas = document.createElement('canvas');
      if (!canvas || typeof canvas.getContext !== 'function' || typeof canvas.toDataURL !== 'function') {
        resolve({
          dataUrl: source,
          format: inferPdfImageFormat(source),
          width,
          height
        });
        return;
      }

      canvas.width = width;
      canvas.height = height;
      const context2d = canvas.getContext('2d');
      if (!context2d) {
        resolve({
          dataUrl: source,
          format: inferPdfImageFormat(source),
          width,
          height
        });
        return;
      }

      context2d.fillStyle = '#ffffff';
      context2d.fillRect(0, 0, width, height);
      context2d.drawImage(image, 0, 0, width, height);
      resolve({
        dataUrl: canvas.toDataURL('image/png'),
        format: 'PNG',
        width,
        height
      });
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

async function writeImageFigure(ctx, dataUrl, { caption = '', maxHeight = 260 } = {}) {
  const asset = await preparePdfImageAsset(dataUrl);
  if (!asset) {
    if (caption) {
      writeParagraph(ctx, caption);
    }
    return false;
  }

  const availableHeight = Math.max(80, ctx.pageHeight - (ctx.margin * 2) - 20);
  const targetMaxHeight = Math.min(maxHeight, availableHeight);
  const widthScale = ctx.maxWidth / asset.width;
  const heightScale = targetMaxHeight / asset.height;
  const scale = Math.min(widthScale, heightScale, 1);
  const drawWidth = Math.max(1, asset.width * scale);
  const drawHeight = Math.max(1, asset.height * scale);

  ensureSpace(ctx, drawHeight + (caption ? LINE_HEIGHT + 8 : 8));
  ctx.doc.addImage(asset.dataUrl, asset.format, ctx.margin, ctx.y, drawWidth, drawHeight);
  ctx.y += drawHeight + 6;
  if (caption) {
    writeParagraph(ctx, caption);
  }
  return true;
}

function renderStepText(step, values = null) {
  const source = String(step?.text || '');
  const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
  const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

  if (!matches.length) {
    if (!placeholders.length) {
      return source.trim();
    }
    const trailing = placeholders.map((placeholder) => {
      const key = `${step.id}:${placeholder.id}`;
      const rawValue = values ? String(values[key] || '').trim() : '';
      return rawValue || `[${String(placeholder?.name || 'value').trim()}]`;
    }).join(' ');
    return `${source} ${trailing}`.trim();
  }

  let cursor = 0;
  let text = '';
  matches.forEach((match) => {
    const startIndex = Number(match.index || 0);
    const placeholderId = String(match[1] || '');
    const placeholder = placeholders.find((item) => String(item?.id || '') === placeholderId);
    const key = `${step.id}:${placeholderId}`;
    const rawValue = values ? String(values[key] || '').trim() : '';
    text += source.slice(cursor, startIndex);
    text += rawValue || `[${String(placeholder?.name || 'value').trim()}]`;
    cursor = startIndex + match[0].length;
  });
  text += source.slice(cursor);
  return text.trim();
}

function toRowLabel(rowIndex) {
  let value = Number(rowIndex) + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function wellIdFor(rowIndex, columnIndex) {
  return `${toRowLabel(rowIndex)}${columnIndex + 1}`;
}

function resolveAssayDefinition(assay) {
  const rows = Number(assay?.plateRows);
  const columns = Number(assay?.plateColumns);
  if (Number.isFinite(rows) && Number.isFinite(columns) && rows > 0 && columns > 0) {
    return {
      rows,
      columns,
      label: String(assay?.plateLabel || `${rows * columns} well`)
    };
  }
  const fromType = PLATE_DEFINITIONS[String(assay?.plateType || '')] || PLATE_DEFINITIONS['96'];
  return { ...fromType };
}

function renderAssayPlot(ctx, assay, def) {
  const totalWells = def.rows * def.columns;
  const maxRows = totalWells > 384 ? Math.min(16, def.rows) : def.rows;
  const maxColumns = totalWells > 384 ? Math.min(24, def.columns) : def.columns;
  const rowHeaderWidth = 20;
  const colHeaderHeight = 16;
  const maxPlotWidth = ctx.maxWidth - rowHeaderWidth;
  const cellSize = Math.max(8, Math.floor(maxPlotWidth / maxColumns));
  const plotWidth = cellSize * maxColumns;
  const plotHeight = cellSize * maxRows;
  const neededHeight = plotHeight + colHeaderHeight + 24;
  const startX = ctx.margin + rowHeaderWidth;

  ensureSpace(ctx, neededHeight);
  const startY = ctx.y + colHeaderHeight;

  const map = {};
  (Array.isArray(assay?.wellLayout) ? assay.wellLayout : []).forEach((item) => {
    const well = String(item?.well || '').trim().toUpperCase();
    if (!well) {
      return;
    }
    map[well] = true;
  });

  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'normal');
  ctx.doc.setFontSize(8);

  for (let col = 0; col < maxColumns; col += 1) {
    const label = String(col + 1);
    const x = startX + (col * cellSize) + (cellSize / 2);
    ctx.doc.text(label, x, ctx.y + 11, { align: 'center' });
  }

  for (let row = 0; row < maxRows; row += 1) {
    const rowLabel = toRowLabel(row);
    const y = startY + (row * cellSize) + (cellSize / 2) + 3;
    ctx.doc.text(rowLabel, ctx.margin + 10, y, { align: 'center' });
  }

  for (let row = 0; row < maxRows; row += 1) {
    for (let col = 0; col < maxColumns; col += 1) {
      const well = wellIdFor(row, col);
      const mapped = Boolean(map[well]);
      const x = startX + (col * cellSize);
      const y = startY + (row * cellSize);
      if (mapped) {
        ctx.doc.setFillColor(209, 227, 255);
      } else {
        ctx.doc.setFillColor(255, 255, 255);
      }
      ctx.doc.setDrawColor(170, 180, 190);
      ctx.doc.rect(x, y, cellSize, cellSize, 'FD');
    }
  }

  ctx.y = startY + plotHeight + 14;
  ctx.doc.setFontSize(9);
  writeParagraph(ctx, 'Legend: blue = mapped well, white = empty well');
}

export function exportProtocolPdf(protocol) {
  if (!protocol) {
    return false;
  }

  const title = `Protocol: ${safeValue(protocol.name, 'Untitled Protocol')}`;
  const ctx = createContext({
    title,
    orientation: 'p',
    format: 'letter',
    margin: 72,
    serif: true
  });
  if (!ctx) {
    return false;
  }

  writeHeading(ctx, 'Summary');
  writeKeyValue(ctx, 'Name', protocol.name);
  writeKeyValue(ctx, 'Created', formatTimestamp(protocol.createdAt));
  writeKeyValue(ctx, 'Updated', formatTimestamp(protocol.updatedAt));

  writeHeading(ctx, 'Purpose');
  writeParagraph(ctx, safeValue(protocol.purpose));

  writeHeading(ctx, 'Materials');
  writeBulletLines(ctx, Array.isArray(protocol.materials) ? protocol.materials : []);

  writeHeading(ctx, 'Steps');
  const steps = Array.isArray(protocol.steps) ? protocol.steps : [];
  if (!steps.length) {
    writeParagraph(ctx, '-');
  } else {
    steps.forEach((step, index) => {
      writeParagraph(ctx, `${index + 1}. ${renderStepText(step, null)}`);
    });
  }

  writeHeading(ctx, 'Troubleshooting');
  writeParagraph(ctx, safeValue(protocol.troubleshooting));

  finishAndSave(ctx, `protocol-${protocol.name || protocol.id || 'export'}`);
  return true;
}

async function writeNotebookEntryBody(ctx, {
  entry,
  protocol,
  linkedGel = null,
  linkedGelPreviewImage = '',
  linkedAssay = null,
  linkedAssayPlotImage = ''
}) {
  const resultTables = normalizeNotebookResultTables(entry.resultTables, entry.resultTable);

  writeHeading(ctx, 'Summary');
  writeKeyValue(ctx, 'Project', entry.projectName);
  if (String(entry.experimentName || '').trim()) {
    writeKeyValue(ctx, 'Experiment', entry.experimentName);
  }
  writeKeyValue(ctx, 'Protocol', entry.protocolName);
  writeKeyValue(ctx, 'State', notebookStateLabel(entry));
  writeKeyValue(ctx, 'Updated', formatTimestamp(entry.updatedAt));
  if (String(entry.executedAt || '').trim()) {
    writeKeyValue(ctx, 'Executed', formatTimestamp(entry.executedAt));
  }

  writeHeading(ctx, 'Protocol Steps (Filled)');
  const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];
  if (!steps.length) {
    writeParagraph(ctx, 'No protocol steps available for this entry.');
  } else {
    steps.forEach((step, index) => {
      writeParagraph(ctx, `${index + 1}. ${renderStepText(step, entry.values || {})}`);
    });
  }

  if (linkedGel || linkedAssay) {
    writeHeading(ctx, 'Linked Results');

    if (linkedGel) {
      writeMinorHeading(ctx, 'Gel');
      writeParagraph(
        ctx,
        `${safeValue(linkedGel.name, 'Linked Gel')} | ${formatGelAnalysisTypeLabel(linkedGel.analysisType)} | Updated ${formatTimestamp(linkedGel.updatedAt)}`
      );
      const gelCaption = `${formatGelAnalysisTypeLabel(linkedGel.analysisType)} preview`;
      if (linkedGelPreviewImage) {
        await writeImageFigure(ctx, linkedGelPreviewImage, {
          caption: gelCaption,
          maxHeight: 260
        });
      } else {
        writeParagraph(ctx, gelCaption);
      }
    }

    if (linkedAssay) {
      writeMinorHeading(ctx, 'Assay');
      writeParagraph(
        ctx,
        `${safeValue(linkedAssay.name, 'Linked Assay')} | ${safeValue(linkedAssay.assayNumber || linkedAssay.id)} | ${safeValue(linkedAssay.plateLabel || `${linkedAssay.wellCount || '-'} well plate`)} | Updated ${formatTimestamp(linkedAssay.updatedAt)}`
      );
      const latestAnalysis = linkedAssay.latestAnalysis && typeof linkedAssay.latestAnalysis === 'object'
        ? linkedAssay.latestAnalysis
        : null;
      if (latestAnalysis) {
        writeParagraph(
          ctx,
          `Analysis: ${formatAssayAnalysisMethodLabel(latestAnalysis.method)}${String(latestAnalysis.summary || '').trim() ? ` | ${latestAnalysis.summary}` : ''}`
        );
      }

      writeMinorHeading(ctx, 'Plate Layout');
      renderAssayPlot(ctx, linkedAssay, resolveAssayDefinition(linkedAssay));

      const serialDilutionSummary = linkedAssay.serialDilutionSummary && typeof linkedAssay.serialDilutionSummary === 'object'
        ? linkedAssay.serialDilutionSummary
        : null;
      if (hasSerialDilutionContent(serialDilutionSummary)) {
        writeMinorHeading(ctx, 'Serial Dilution');
        if (Number.isFinite(serialDilutionSummary?.volumePerWellUl) && serialDilutionSummary.volumePerWellUl > 0) {
          writeParagraph(ctx, `Volume per well: ${serialDilutionSummary.volumePerWellUl} uL`);
        }
        (Array.isArray(serialDilutionSummary.feedbackMessages) ? serialDilutionSummary.feedbackMessages : []).forEach((item) => {
          writeParagraph(ctx, safeValue(item?.text));
        });
        if (Array.isArray(serialDilutionSummary.initialDilutionRows) && serialDilutionSummary.initialDilutionRows.length) {
          writeMinorHeading(ctx, 'Initial Dilution');
          writeSimpleTable(
            ctx,
            ['Sample', 'Stock Vol.', 'Buffer Vol.'],
            serialDilutionSummary.initialDilutionRows.map((row) => [
              row?.sample || '',
              row?.stockVolume || '',
              row?.bufferVolume || ''
            ])
          );
        }
        if (Array.isArray(serialDilutionSummary.followingDilutionRows) && serialDilutionSummary.followingDilutionRows.length) {
          writeMinorHeading(ctx, 'Following Dilution');
          writeSimpleTable(
            ctx,
            ['Step', 'Target Conc.', 'From Previous Well', 'Buffer Vol.', 'Transfer / Discard', 'Final Vol.'],
            serialDilutionSummary.followingDilutionRows.map((row) => [
              row?.step || '',
              row?.targetConcentration || '',
              row?.fromPreviousWell || '',
              row?.bufferVolume || '',
              row?.transferOrDiscard || '',
              row?.finalVolume || ''
            ])
          );
        } else if (serialDilutionSummary?.hasValidPlans) {
          writeParagraph(ctx, 'No downstream dilution steps are needed for this assay.');
        }
      }

      const assayPlotImage = String(linkedAssayPlotImage || latestAnalysis?.chartDataUrl || '').trim();
      if (assayPlotImage) {
        writeMinorHeading(ctx, 'Analysis Plot');
        await writeImageFigure(ctx, assayPlotImage, {
          caption: `${formatAssayAnalysisMethodLabel(latestAnalysis?.method)}${String(latestAnalysis?.summary || '').trim() ? ` | ${latestAnalysis.summary}` : ''}`,
          maxHeight: 220
        });
      }
    }
  }

  writeHeading(ctx, 'Notes / Results');
  writeParagraph(ctx, safeValue(entry.result));
  const toolCalculations = normalizeNotebookToolCalculations(entry.toolCalculations);
  if (toolCalculations.length) {
    writeMinorHeading(ctx, toolCalculations.length === 1 ? 'Tool Calculation' : 'Tool Calculations');
    toolCalculations.forEach((calculation) => {
      if (calculation.table) {
        writeMinorHeading(ctx, calculation.title);
        writeNotebookToolCalculationTable(ctx, calculation.table);
      } else {
        writeParagraph(ctx, `${calculation.title}: ${safeValue(calculation.result || calculation.summary)}`);
      }
      if (calculation.formula && !calculation.table) {
        writeParagraph(ctx, `Formula: ${calculation.formula}`);
      }
    });
  }
  if (resultTables.length) {
    writeMinorHeading(ctx, resultTables.length === 1 ? 'Result Table' : 'Result Tables');
    resultTables.forEach((table, index) => {
      if (resultTables.length > 1) {
        writeMinorHeading(ctx, `Table ${index + 1}`);
      }
      writeNotebookResultTable(ctx, table);
    });
  }
  if (Array.isArray(entry.resultFiles) && entry.resultFiles.length) {
    writeMinorHeading(ctx, 'Result Files');
    writeBulletLines(ctx, entry.resultFiles);
  }
}

export const exportNotebookEntryPdf = async (params = {}) => {
  try {
    const { entry } = params;
    if (!entry) {
      return false;
    }

    const title = `Notebook: ${safeValue(entry.projectName)} / ${safeValue(entry.experimentName || entry.protocolName)}`;
    const resultTables = normalizeNotebookResultTables(entry.resultTables, entry.resultTable);
    const useWideLayout = hasWideNotebookResultTable(resultTables);
    const ctx = createContext({
      title,
      orientation: useWideLayout ? 'l' : 'p',
      format: 'letter',
      margin: useWideLayout ? 54 : 72,
      serif: true
    });
    if (!ctx) {
      return false;
    }

    await writeNotebookEntryBody(ctx, params);

    finishAndSave(ctx, `notebook-${entry.projectName || 'project'}-${entry.experimentName || entry.protocolName || entry.id || 'entry'}`);
    return true;
  } catch (error) {
    console.error('Failed to export notebook PDF:', error);
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(String(error?.message || error || 'Failed to export notebook PDF.'));
    }
    return false;
  }
};

export const exportProjectNotebookEntriesPdf = async ({
  project,
  entries = [],
  protocolsByEntryId = new Map(),
  linkedGelByEntryId = new Map(),
  linkedGelPreviewImagesByEntryId = new Map(),
  linkedAssayByEntryId = new Map(),
  linkedAssayPlotImagesByEntryId = new Map()
} = {}) => {
  try {
    if (!project) {
      return false;
    }
    const pages = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!pages.length) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('No notebook pages to export for this project.');
      }
      return false;
    }

    const title = `Project Notebook: ${safeValue(project.name, 'Untitled Project')}`;
    const ctx = createContext({
      title,
      orientation: 'p',
      format: 'letter',
      margin: 72,
      serif: true
    });
    if (!ctx) {
      return false;
    }

    writeHeading(ctx, 'Project');
    writeKeyValue(ctx, 'Name', project.name);
    if (String(project.description || '').trim()) {
      writeKeyValue(ctx, 'Description', project.description);
    }
    writeKeyValue(ctx, 'Pages', String(pages.length));

    for (let index = 0; index < pages.length; index += 1) {
      const entry = pages[index];
      addPage(ctx);
      ctx.sectionCount = 0;
      ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'bold');
      ctx.doc.setFontSize(TITLE_FONT_SIZE);
      ctx.y = writeWrappedLines(
        ctx.doc,
        `Page ${index + 1}: ${safeValue(entry.experimentName || entry.protocolName, 'Untitled Page')}`,
        ctx.margin,
        ctx.y,
        ctx.maxWidth,
        TITLE_FONT_SIZE + 8
      );
      ctx.y += 4;

      // eslint-disable-next-line no-await-in-loop
      await writeNotebookEntryBody(ctx, {
        entry,
        protocol: protocolsByEntryId.get(entry.id) || entry.protocolSnapshot || null,
        linkedGel: linkedGelByEntryId.get(entry.id) || null,
        linkedGelPreviewImage: linkedGelPreviewImagesByEntryId.get(entry.id) || '',
        linkedAssay: linkedAssayByEntryId.get(entry.id) || null,
        linkedAssayPlotImage: linkedAssayPlotImagesByEntryId.get(entry.id) || ''
      });
    }

    finishAndSave(ctx, `project-notebook-${project.name || project.id || 'export'}`);
    return true;
  } catch (error) {
    console.error('Failed to export project notebook PDF:', error);
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(String(error?.message || error || 'Failed to export project notebook PDF.'));
    }
    return false;
  }
};

export function exportAssayDefinitionPdf(assay) {
  if (!assay) {
    return false;
  }

  const def = resolveAssayDefinition(assay);
  const isLarge = def.columns > 12;
  const title = `Assay: ${safeValue(assay.name, assay.assayNumber || 'Unnamed')}`;
  const ctx = createContext({ title, orientation: isLarge ? 'l' : 'p' });
  if (!ctx) {
    return false;
  }

  writeHeading(ctx, 'Summary');
  writeKeyValue(ctx, 'Assay Number', assay.assayNumber || '-');
  writeKeyValue(ctx, 'Name', assay.name || '-');
  writeKeyValue(ctx, 'Project', assay.projectName || '-');
  writeKeyValue(ctx, 'Plate', `${safeValue(def.label)} (${def.rows} x ${def.columns})`);
  writeKeyValue(ctx, 'Sample Axis', assay.sampleAxis === 'column' ? 'Column' : 'Row');
  writeKeyValue(ctx, 'Concentration Axis', assay.concentrationAxis === 'column' ? 'Column' : 'Row');
  writeKeyValue(ctx, 'Notebook Page', assay.notebookEntryProtocolName || '-');
  writeKeyValue(ctx, 'Updated', formatTimestamp(assay.updatedAt));

  writeHeading(ctx, 'Well Definition Plot');
  renderAssayPlot(ctx, assay, def);

  finishAndSave(ctx, `assay-${assay.assayNumber || assay.id || assay.name || 'definition'}`);
  return true;
}
