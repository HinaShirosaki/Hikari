import {
  HEADING_FONT_SIZE,
  BODY_FONT_SIZE,
  LINE_HEIGHT,
  ACCENT,
  EDITORIAL_INK,
  EDITORIAL_MUTED,
  EDITORIAL_RULE
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
  if (ctx.visualStyle === 'editorial') {
    const spacingBefore = ctx.sectionCount > 0 ? 17 : 0;
    ensureSpace(ctx, spacingBefore + 35);
    ctx.y += spacingBefore;
    font(ctx, 'bold');
    ctx.doc.setFontSize(9);
    setTextColor(ctx, EDITORIAL_INK);
    ctx.doc.text(String(heading || '').toUpperCase(), ctx.margin, ctx.y);
    ctx.doc.setDrawColor(...EDITORIAL_RULE);
    ctx.doc.setLineWidth(0.6);
    ctx.doc.line(ctx.margin, ctx.y + 9, ctx.margin + ctx.maxWidth, ctx.y + 9);
    ctx.y += 29;
    ctx.sectionCount += 1;
    return;
  }
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
  const editorial = ctx.visualStyle === 'editorial';
  const gutter = editorial ? 30 : 22;
  const bodyWidth = ctx.maxWidth - gutter;
  // Set the body font before wrapping: splitTextToSize measures with the current
  // font, and the heading font that precedes the first item is wider.
  font(ctx, 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  const lines = splitWrappedLines(ctx.doc, text, bodyWidth);
  lines.forEach((line, lineIndex) => {
    ensureSpace(ctx, LINE_HEIGHT);
    if (lineIndex === 0) {
      font(ctx, 'bold');
      ctx.doc.setFontSize(BODY_FONT_SIZE - 1);
      setTextColor(ctx, editorial ? EDITORIAL_MUTED : ACCENT);
      ctx.doc.text(editorial ? String(index).padStart(2, '0') : `${index}`, ctx.margin, ctx.y);
      setTextColor(ctx, [0, 0, 0]);
      font(ctx, 'normal');
      ctx.doc.setFontSize(BODY_FONT_SIZE);
    }
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
  font(ctx, 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  values.forEach((line) => {
    const gutter = 14;
    const lines = splitWrappedLines(ctx.doc, String(line || '').trim(), ctx.maxWidth - gutter);
    lines.forEach((part, index) => {
      ensureSpace(ctx, LINE_HEIGHT);
      if (index === 0) {
        setTextColor(ctx, ctx.visualStyle === 'editorial' ? EDITORIAL_INK : ACCENT);
        ctx.doc.text('•', ctx.margin + 3, ctx.y);
        setTextColor(ctx, [0, 0, 0]);
      }
      ctx.doc.text(String(part || ''), ctx.margin + gutter, ctx.y);
      ctx.y += LINE_HEIGHT;
    });
  });
  ctx.y += 4;
}

function writeEditorialMaterials(ctx, values) {
  const materials = Array.isArray(values) ? values.filter((item) => String(item || '').trim()) : [];
  if (!materials.length) {
    writeParagraph(ctx, '-');
    return;
  }
  if (materials.length > 10 || materials.some((item) => String(item).length > 80)) {
    writeBulletLines(ctx, materials);
    return;
  }

  const gap = 18;
  const columnWidth = (ctx.maxWidth - gap) / 2;
  const textWidth = columnWidth - 14;
  font(ctx, 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  for (let index = 0; index < materials.length; index += 2) {
    const pair = materials.slice(index, index + 2);
    const wrapped = pair.map((item) => splitWrappedLines(ctx.doc, String(item).trim(), textWidth));
    const rowHeight = Math.max(...wrapped.map((lines) => lines.length)) * LINE_HEIGHT + 5;
    ensureSpace(ctx, rowHeight);
    wrapped.forEach((lines, columnIndex) => {
      const x = ctx.margin + columnIndex * (columnWidth + gap);
      ctx.doc.setFontSize(BODY_FONT_SIZE);
      setTextColor(ctx, EDITORIAL_INK);
      ctx.doc.text('•', x + 2, ctx.y);
      lines.forEach((line, lineIndex) => {
        ctx.doc.text(String(line || ''), x + 14, ctx.y + lineIndex * LINE_HEIGHT);
      });
    });
    ctx.y += rowHeight;
  }
  ctx.y += 4;
}

function writeMinorHeading(ctx, heading) {
  ensureSpace(ctx, BODY_FONT_SIZE + 12);
  ctx.y += 6;
  font(ctx, 'bold');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  if (ctx.visualStyle === 'editorial') {
    setTextColor(ctx, EDITORIAL_INK);
  }
  writeWrappedBlock(ctx, heading, ctx.margin, ctx.maxWidth, BODY_FONT_SIZE + 4);
  ctx.y += 3;
}

export {
  writeHeading,
  writeParagraph,
  writeNumberedItem,
  writeKeyValue,
  writeBulletLines,
  writeEditorialMaterials,
  writeMinorHeading
};
