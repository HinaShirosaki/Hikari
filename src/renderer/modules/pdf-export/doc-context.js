import {
  LINE_HEIGHT,
  TABLE_FONT_SIZE,
  FOOTER_BASELINE
} from './constants.js';

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

function font(ctx, style = 'normal') {
  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', style);
}

function setTextColor(ctx, color) {
  ctx.doc.setTextColor(color[0], color[1], color[2]);
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

function contentBottom(ctx) {
  return ctx.pageHeight - Math.max(ctx.margin, FOOTER_BASELINE + 24);
}

function ensureSpace(ctx, neededHeight) {
  if (ctx.y + neededHeight <= contentBottom(ctx)) {
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

export {
  getJsPdfCtor,
  safeValue,
  formatTimestamp,
  sanitizeFileName,
  font,
  setTextColor,
  refreshPageMetrics,
  addPage,
  contentBottom,
  ensureSpace,
  writeWrappedLines,
  splitWrappedLines,
  writeWrappedBlock,
  estimateTextWidth,
  splitLongToken
};
