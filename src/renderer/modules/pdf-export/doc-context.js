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

// jsPDF's built-in Helvetica/Times are WinAnsi-only: a single character outside
// that set (Greek μ, ≥, →, …) flips the whole string to UTF-16 and it renders as
// letter-spaced garbage that overflows the margin. Swap common lab symbols for
// WinAnsi lookalikes; anything else is NFKD-folded, then replaced with "?".
// ponytail: substitution table; embed a Unicode TTF via doc.addFont() if real Greek is needed.
const WINANSI_EXTRAS = '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d'
  + '\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178';
const WINANSI_SUBSTITUTES = {
  '\u03bc': '\u00b5', '\u2212': '-', '\u2264': '<=', '\u2265': '>=', '\u2248': '~',
  '\u2192': '->', '\u2190': '<-', '\u03b1': 'alpha', '\u03b2': 'beta', '\u03b3': 'gamma',
  '\u03b4': 'delta', '\u0394': 'delta', '\u03bb': 'lambda', '\u03a9': 'ohm'
};
function toWinAnsi(value) {
  return String(value ?? '').replace(/[^\u0000-\u00ff]/g, (ch) => {
    if (WINANSI_EXTRAS.includes(ch)) {
      return ch;
    }
    if (ch in WINANSI_SUBSTITUTES) {
      return WINANSI_SUBSTITUTES[ch];
    }
    if (/\s/.test(ch)) {
      return ' ';
    }
    return ch.normalize('NFKD').replace(/[^\u0000-\u00ff]/g, '?');
  });
}

// Every string reaching jsPDF goes through text/splitTextToSize/getTextWidth,
// so sanitizing those three on the instance covers measurement and drawing alike.
function sanitizeDocText(doc) {
  const clean = (text) => (Array.isArray(text) ? text.map(clean) : toWinAnsi(text));
  ['text', 'splitTextToSize', 'getTextWidth'].forEach((method) => {
    const original = doc[method];
    if (typeof original !== 'function') {
      return;
    }
    doc[method] = (text, ...rest) => original.call(doc, clean(text), ...rest);
  });
  return doc;
}

// Protocol text is often hard-wrapped by its generator; the on-screen view
// collapses those newlines, so the PDF does too. Blank lines still separate paragraphs.
function flowText(value) {
  return String(value ?? '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
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
  ctx.maxWidth = ctx.pageWidth - ctx.marginLeft - ctx.marginRight;
}

function addPage(ctx, orientation = ctx.orientation) {
  if (typeof ctx.doc.addPage === 'function') {
    ctx.doc.addPage(ctx.format, orientation);
  }
  ctx.orientation = orientation || ctx.orientation;
  refreshPageMetrics(ctx);
  ctx.y = ctx.marginTop;
}

function contentBottom(ctx) {
  return ctx.pageHeight - Math.max(ctx.marginBottom, FOOTER_BASELINE + 24);
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

export {
  getJsPdfCtor,
  safeValue,
  toWinAnsi,
  sanitizeDocText,
  flowText,
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
  estimateTextWidth
};
