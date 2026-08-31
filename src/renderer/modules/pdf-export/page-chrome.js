import { showTransientNotice } from '../../lib/notify.js';
import {
  PAGE_MARGIN,
  TITLE_FONT_SIZE,
  ACCENT,
  ACCENT_TINT,
  MUTED_TEXT,
  RULE_COLOR,
  FOOTER_BASELINE,
  LABEL_FONT_SIZE
} from './constants.js';
import {
  getJsPdfCtor,
  safeValue,
  sanitizeFileName,
  font,
  setTextColor,
  addPage,
  ensureSpace,
  writeWrappedLines,
  estimateTextWidth
} from './doc-context.js';

function createContext({
  title,
  eyebrow = '',
  badge = '',
  meta = [],
  footerLabel = '',
  orientation = 'p',
  format = 'letter',
  margin = PAGE_MARGIN,
  serif = false
}) {
  const JsPdf = getJsPdfCtor();
  if (!JsPdf) {
    showTransientNotice('PDF generator is not loaded. Please restart the app and try again.', { type: 'error' });
    return null;
  }

  const doc = new JsPdf({
    orientation,
    unit: 'pt',
    format
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const ctx = {
    doc,
    pageWidth,
    pageHeight,
    maxWidth: pageWidth - (margin * 2),
    margin,
    orientation,
    format,
    y: margin,
    serif,
    footerLabel: String(footerLabel || title || ''),
    sectionCount: 0
  };

  writeDocumentHeader(ctx, { title, eyebrow, badge, meta });
  return ctx;
}

function writeLabel(ctx, text, x, y) {
  font(ctx, 'normal');
  ctx.doc.setFontSize(LABEL_FONT_SIZE);
  setTextColor(ctx, MUTED_TEXT);
  ctx.doc.text(String(text || '').toUpperCase(), x, y);
  setTextColor(ctx, [0, 0, 0]);
}

function drawBadge(ctx, text, rightEdge, baselineY) {
  const label = String(text || '').trim();
  if (!label) {
    return;
  }
  font(ctx, 'normal');
  ctx.doc.setFontSize(8);
  const width = estimateTextWidth(ctx, label, 8) + 14;
  const height = 15;
  const x = rightEdge - width;
  ctx.doc.setFillColor(ACCENT_TINT[0], ACCENT_TINT[1], ACCENT_TINT[2]);
  ctx.doc.roundedRect(x, baselineY - 11, width, height, 3, 3, 'F');
  setTextColor(ctx, ACCENT);
  ctx.doc.text(label, x + 7, baselineY);
  setTextColor(ctx, [0, 0, 0]);
}

// ponytail: metadata grid wraps at 4 cells per row, plenty for every current caller
function writeMetaGrid(ctx, meta) {
  const cells = (Array.isArray(meta) ? meta : []).filter((cell) => cell && cell.label);
  if (!cells.length) {
    return;
  }
  const perRow = Math.min(4, cells.length);
  const cellWidth = ctx.maxWidth / perRow;
  const rowHeight = 26;

  for (let start = 0; start < cells.length; start += perRow) {
    const row = cells.slice(start, start + perRow);
    ensureSpace(ctx, rowHeight + 4);
    ctx.doc.setDrawColor(RULE_COLOR[0], RULE_COLOR[1], RULE_COLOR[2]);
    ctx.doc.setLineWidth(0.5);
    ctx.doc.line(ctx.margin, ctx.y, ctx.margin + ctx.maxWidth, ctx.y);
    row.forEach((cell, index) => {
      const x = ctx.margin + (index * cellWidth);
      writeLabel(ctx, cell.label, x, ctx.y + 10);
      font(ctx, 'normal');
      ctx.doc.setFontSize(9.5);
      const value = ctx.doc.splitTextToSize(safeValue(cell.value), cellWidth - 8)[0] || '-';
      ctx.doc.text(value, x, ctx.y + 21);
    });
    ctx.y += rowHeight;
    ctx.doc.line(ctx.margin, ctx.y, ctx.margin + ctx.maxWidth, ctx.y);
  }
  ctx.y += 28;
}

function writeDocumentHeader(ctx, { title, eyebrow = '', badge = '', meta = [] }) {
  ctx.doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  ctx.doc.rect(0, 0, ctx.pageWidth, 5, 'F');

  ctx.y = ctx.margin;
  const eyebrowText = String(eyebrow || '').trim();
  if (eyebrowText) {
    font(ctx, 'bold');
    ctx.doc.setFontSize(LABEL_FONT_SIZE + 0.5);
    setTextColor(ctx, ACCENT);
    ctx.doc.text(eyebrowText.toUpperCase(), ctx.margin, ctx.y);
    setTextColor(ctx, [0, 0, 0]);
    drawBadge(ctx, badge, ctx.margin + ctx.maxWidth, ctx.y);
    ctx.y += 14;
  }

  font(ctx, 'bold');
  ctx.doc.setFontSize(TITLE_FONT_SIZE);
  ctx.y = writeWrappedLines(ctx.doc, String(title || 'Export'), ctx.margin, ctx.y + 8, ctx.maxWidth, TITLE_FONT_SIZE + 6);
  ctx.y += 10;

  writeMetaGrid(ctx, meta);
}

function writePageHeader(ctx, { title, eyebrow = '', badge = '', meta = [] }) {
  addPage(ctx);
  writeDocumentHeader(ctx, { title, eyebrow, badge, meta });
  ctx.sectionCount = 0;
}

function writeFooters(ctx) {
  const doc = ctx.doc;
  if (typeof doc.setPage !== 'function' || typeof doc.internal?.getNumberOfPages !== 'function') {
    return;
  }
  const total = doc.internal.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    const left = ctx.margin;
    const right = width - ctx.margin;
    doc.setDrawColor(RULE_COLOR[0], RULE_COLOR[1], RULE_COLOR[2]);
    doc.setLineWidth(0.5);
    doc.line(left, height - FOOTER_BASELINE - 10, right, height - FOOTER_BASELINE - 10);
    font(ctx, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED_TEXT[0], MUTED_TEXT[1], MUTED_TEXT[2]);
    const label = doc.splitTextToSize(ctx.footerLabel, ctx.maxWidth - 90)[0] || '';
    doc.text(label, left, height - FOOTER_BASELINE);
    doc.text(`Page ${page} of ${total}`, right, height - FOOTER_BASELINE, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }
}

function finishAndSave(ctx, fileNameBase) {
  writeFooters(ctx);
  ctx.doc.save(`${sanitizeFileName(fileNameBase, 'export')}.pdf`);
}

export {
  createContext,
  writeLabel,
  drawBadge,
  writeMetaGrid,
  writeDocumentHeader,
  writePageHeader,
  writeFooters,
  finishAndSave
};
