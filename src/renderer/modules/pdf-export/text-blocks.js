import {
  HEADING_FONT_SIZE,
  BODY_FONT_SIZE,
  LINE_HEIGHT,
  ACCENT
} from './constants.js';
import {
  safeValue,
  font,
  setTextColor,
  ensureSpace,
  splitWrappedLines,
  writeWrappedBlock
} from './doc-context.js';
import { writeLabel } from './page-chrome.js';

function writeHeading(ctx, heading) {
  const spacingBefore = ctx.sectionCount > 0 ? 14 : 0;
  ensureSpace(ctx, spacingBefore + HEADING_FONT_SIZE + 16);
  ctx.y += spacingBefore;
  font(ctx, 'bold');
  ctx.doc.setFontSize(HEADING_FONT_SIZE);
  setTextColor(ctx, ACCENT);
  ctx.doc.text(String(heading || '').toUpperCase(), ctx.margin, ctx.y);
  setTextColor(ctx, [0, 0, 0]);
  ctx.y += 6;
  ctx.doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  ctx.doc.setLineWidth(0.5);
  ctx.doc.line(ctx.margin, ctx.y, ctx.margin + ctx.maxWidth, ctx.y);
  ctx.y += 14;
  ctx.sectionCount += 1;
}

function writeParagraph(ctx, text) {
  ensureSpace(ctx, LINE_HEIGHT + 2);
  font(ctx, 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  writeWrappedBlock(ctx, text || '-', ctx.margin, ctx.maxWidth, LINE_HEIGHT);
  ctx.y += 4;
}

// Numbered step: index sits in a hanging indent so wrapped lines align under the text.
function writeNumberedItem(ctx, index, text) {
  const gutter = 22;
  const bodyWidth = ctx.maxWidth - gutter;
  const lines = splitWrappedLines(ctx.doc, text, bodyWidth);
  lines.forEach((line, lineIndex) => {
    ensureSpace(ctx, LINE_HEIGHT);
    if (lineIndex === 0) {
      font(ctx, 'bold');
      ctx.doc.setFontSize(BODY_FONT_SIZE - 1);
      setTextColor(ctx, ACCENT);
      ctx.doc.text(`${index}`, ctx.margin, ctx.y);
      setTextColor(ctx, [0, 0, 0]);
    }
    font(ctx, 'normal');
    ctx.doc.setFontSize(BODY_FONT_SIZE);
    ctx.doc.text(String(line || ''), ctx.margin + gutter, ctx.y);
    ctx.y += LINE_HEIGHT;
  });
  ctx.y += 4;
}

function writeKeyValue(ctx, key, value) {
  ensureSpace(ctx, LINE_HEIGHT + 2);
  const labelWidth = 96;
  writeLabel(ctx, key, ctx.margin, ctx.y);
  font(ctx, 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  const lines = splitWrappedLines(ctx.doc, safeValue(value), ctx.maxWidth - labelWidth);
  lines.forEach((line, index) => {
    if (index > 0) {
      ensureSpace(ctx, LINE_HEIGHT);
    }
    ctx.doc.text(String(line || ''), ctx.margin + labelWidth, ctx.y);
    ctx.y += LINE_HEIGHT;
  });
  ctx.y += 2;
}

function writeBulletLines(ctx, lines) {
  const values = Array.isArray(lines) ? lines : [];
  if (!values.length) {
    writeParagraph(ctx, '-');
    return;
  }
  values.forEach((line) => {
    const gutter = 14;
    const lines = splitWrappedLines(ctx.doc, String(line || '').trim(), ctx.maxWidth - gutter);
    lines.forEach((part, index) => {
      ensureSpace(ctx, LINE_HEIGHT);
      font(ctx, 'normal');
      ctx.doc.setFontSize(BODY_FONT_SIZE);
      if (index === 0) {
        setTextColor(ctx, ACCENT);
        ctx.doc.text('•', ctx.margin + 3, ctx.y);
        setTextColor(ctx, [0, 0, 0]);
      }
      ctx.doc.text(String(part || ''), ctx.margin + gutter, ctx.y);
      ctx.y += LINE_HEIGHT;
    });
  });
  ctx.y += 4;
}

function writeMinorHeading(ctx, heading) {
  ensureSpace(ctx, BODY_FONT_SIZE + 12);
  ctx.y += 6;
  font(ctx, 'bold');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  writeWrappedBlock(ctx, heading, ctx.margin, ctx.maxWidth, BODY_FONT_SIZE + 4);
  ctx.y += 3;
}

export {
  writeHeading,
  writeParagraph,
  writeNumberedItem,
  writeKeyValue,
  writeBulletLines,
  writeMinorHeading
};
