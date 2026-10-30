import { showTransientNotice } from '../../lib/notify.js';
import {
  PAGE_MARGIN,
  TITLE_FONT_SIZE,
  ACCENT,
  ACCENT_TINT,
  MUTED_TEXT,
  RULE_COLOR,
  FOOTER_BASELINE,
  LABEL_FONT_SIZE,
  EDITORIAL_INK,
  EDITORIAL_MUTED,
  EDITORIAL_RULE
} from './constants.js';
import {
  getJsPdfCtor,
  safeValue,
  sanitizeFileName,
  sanitizeDocText,
  font,
  setTextColor,
  addPage,
  ensureSpace,
  writeWrappedLines,
  estimateTextWidth
} from './doc-context.js';
import { drawHikariPdfCornerIcon } from './branding.js';
import { printPdfBytes } from '../print/index.js';

// Returns null (after a notice) when jsPDF is not loaded; callers bail out.
// `margins` overrides the single `margin` per side (used for staple edges).
function createContext({
  title,
  eyebrow = '',
  badge = '',
  meta = [],
  footerLabel = '',
  orientation = 'p',
  format = 'letter',
  margin = PAGE_MARGIN,
  margins = null,
  cornerIconDataUrl = '',
  serif = false,
  visualStyle = 'classic'
}) {
  const JsPdf = getJsPdfCtor();
  if (!JsPdf) {
    showTransientNotice('PDF generator is not loaded. Please restart the app and try again.', { type: 'error' });
    return null;
  }

  const doc = sanitizeDocText(new JsPdf({
    orientation,
    unit: 'pt',
    format
  }));
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageMargins = margins && typeof margins === 'object'
    ? {
      top: Number.isFinite(Number(margins.top)) ? Number(margins.top) : margin,
      right: Number.isFinite(Number(margins.right)) ? Number(margins.right) : margin,
      bottom: Number.isFinite(Number(margins.bottom)) ? Number(margins.bottom) : margin,
      left: Number.isFinite(Number(margins.left)) ? Number(margins.left) : margin
    }
    : { top: margin, right: margin, bottom: margin, left: margin };

  const ctx = {
    doc,
    pageWidth,
    pageHeight,
    maxWidth: pageWidth - pageMargins.left - pageMargins.right,
    margin: pageMargins.left,
    marginTop: pageMargins.top,
    marginRight: pageMargins.right,
    marginBottom: pageMargins.bottom,
    marginLeft: pageMargins.left,
    orientation,
    format,
    y: pageMargins.top,
    serif,
    visualStyle,
    cornerIconDataUrl: String(cornerIconDataUrl || ''),
    footerLabel: String(footerLabel || title || ''),
    runningTitle: String(title || ''),
    sectionCount: 0
  };

  writeDocumentHeader(ctx, { title, eyebrow, badge, meta });
  return ctx;
}

function writeLabel(ctx, text, x, y) {
  font(ctx, 'normal');
  ctx.doc.setFontSize(LABEL_FONT_SIZE);
  setTextColor(ctx, ctx.visualStyle === 'editorial' ? EDITORIAL_MUTED : MUTED_TEXT);
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
  if (ctx.visualStyle === 'editorial') {
    font(ctx, 'bold');
    setTextColor(ctx, EDITORIAL_INK);
    ctx.doc.text(label.toUpperCase(), x + 7, baselineY);
    setTextColor(ctx, [0, 0, 0]);
    return;
  }
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
  const editorial = ctx.visualStyle === 'editorial';

  for (let start = 0; start < cells.length; start += perRow) {
    const row = cells.slice(start, start + perRow);
    font(ctx, 'normal');
    ctx.doc.setFontSize(editorial ? 9.25 : 9.5);
    const valueLines = row.map((cell) => ctx.doc.splitTextToSize(safeValue(cell.value), cellWidth - 8));
    const rowHeight = editorial
      ? Math.max(43, 31 + Math.max(...valueLines.map((lines) => lines.length)) * 12)
      : 26;
    ensureSpace(ctx, rowHeight + 4);
    const rule = editorial ? EDITORIAL_RULE : RULE_COLOR;
    ctx.doc.setDrawColor(rule[0], rule[1], rule[2]);
    ctx.doc.setLineWidth(0.5);
    ctx.doc.line(ctx.margin, ctx.y, ctx.margin + ctx.maxWidth, ctx.y);
    row.forEach((cell, index) => {
      const x = ctx.margin + (index * cellWidth);
      writeLabel(ctx, cell.label, x, ctx.y + (editorial ? 16 : 10));
      font(ctx, 'normal');
      ctx.doc.setFontSize(editorial ? 9.25 : 9.5);
      const lines = valueLines[index];
      if (editorial) {
        lines.forEach((value, lineIndex) => {
          ctx.doc.text(value, x, ctx.y + 34 + lineIndex * 12);
        });
      } else {
        ctx.doc.text(lines[0] || '-', x, ctx.y + 21);
      }
    });
    ctx.y += rowHeight;
    ctx.doc.line(ctx.margin, ctx.y, ctx.margin + ctx.maxWidth, ctx.y);
  }
  ctx.y += editorial ? 24 : 28;
}

function writeDocumentHeader(ctx, { title, eyebrow = '', badge = '', meta = [] }) {
  if (ctx.visualStyle === 'editorial') {
    ctx.y = ctx.marginTop;
    ctx.doc.setFillColor(...EDITORIAL_INK);
    ctx.doc.rect(ctx.margin, ctx.y + 3, 19, 2.5, 'F');
    const eyebrowText = String(eyebrow || '').trim();
    if (eyebrowText) {
      font(ctx, 'bold');
      ctx.doc.setFontSize(8);
      setTextColor(ctx, EDITORIAL_INK);
      ctx.doc.text(`HIKARI  /  ${eyebrowText.toUpperCase()}`, ctx.margin + 28, ctx.y);
      drawBadge(ctx, badge, ctx.margin + ctx.maxWidth, ctx.y);
      ctx.y += 30;
    }
    ctx.doc.setFont('times', 'bold');
    ctx.doc.setFontSize(25);
    setTextColor(ctx, EDITORIAL_INK);
    ctx.y = writeWrappedLines(ctx.doc, String(title || 'Export'), ctx.margin, ctx.y + 9, ctx.maxWidth, 31);
    ctx.y += 11;
    writeMetaGrid(ctx, meta);
    return;
  }
  ctx.doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  ctx.doc.rect(0, 0, ctx.pageWidth, 5, 'F');

  ctx.y = ctx.marginTop;
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
  addPage(ctx, ctx.orientation, { runningHeader: false });
  ctx.runningTitle = String(title || '');
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
    const left = ctx.marginLeft;
    const right = width - ctx.marginRight;
    const editorial = ctx.visualStyle === 'editorial';
    const rule = editorial ? EDITORIAL_RULE : RULE_COLOR;
    doc.setDrawColor(rule[0], rule[1], rule[2]);
    doc.setLineWidth(0.5);
    doc.line(left, height - FOOTER_BASELINE - 10, right, height - FOOTER_BASELINE - 10);
    font(ctx, 'normal');
    doc.setFontSize(8);
    const muted = editorial ? EDITORIAL_MUTED : MUTED_TEXT;
    doc.setTextColor(muted[0], muted[1], muted[2]);
    const label = doc.splitTextToSize(ctx.footerLabel, ctx.maxWidth - 90)[0] || '';
    doc.text(label, left, height - FOOTER_BASELINE);
    doc.text(`Page ${page} of ${total}`, right, height - FOOTER_BASELINE, { align: 'right' });
    drawHikariPdfCornerIcon(ctx, width, height);
    doc.setTextColor(0, 0, 0);
  }
}

// print: true sends the same PDF to the print dialog instead of saving it,
// so the printed page and the exported PDF are always identical.
function finishAndSave(ctx, fileNameBase, { print = false } = {}) {
  writeFooters(ctx);
  if (print) {
    printPdfBytes(ctx.doc.output('arraybuffer'), { title: ctx.footerLabel || 'Print' });
    return;
  }
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
