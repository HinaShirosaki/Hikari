import { preprocessWithJs } from '../analysis/image-processing.js';
import { buildBlotFigurePlan, FIGURE_FONT_SIZE, FIGURE_MARGIN, LABEL_WIDTH } from './model.js';
import { drawLadderLabels } from '../rendering/ladder-labels.js';

export function blotImageData(row, preprocess = preprocessWithJs) {
  if (!row.displayData) {
    const draft = row.draft;
    row.displayData = draft.viewerMode === 'processed'
      ? preprocess(draft.currentImage.gray, draft.currentImage.width, draft.currentImage.height, {
        denoiseStrength: draft.controls['gel-denoise-strength'],
        contrastBoost: draft.controls['gel-contrast-strength']
      }).previewImageData
      : draft.currentImage.imageData;
  }
  return row.displayData;
}

export function createBlotFigureCanvas(rows, documentObject, { rasterScale = 3, trim, preprocess, showLadderLabels = false } = {}) {
  const canvas = documentObject.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${FIGURE_FONT_SIZE}px Arial, Helvetica, sans-serif`;
  const plan = buildBlotFigurePlan(rows, { measureText: text => ctx.measureText(text).width, trim, showLadderLabels });
  const scale = Math.max(1, Math.min(rasterScale, 12000 / Math.max(plan.width, plan.height),
    Math.sqrt(36000000 / (plan.width * plan.height))));
  canvas.width = Math.ceil(plan.width * scale);
  canvas.height = Math.ceil(plan.height * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.font = `${FIGURE_FONT_SIZE}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  function drawLines(lines, x, y, height, align) {
    ctx.fillStyle = '#000'; ctx.textAlign = align;
    lines.forEach((line, index) => ctx.fillText(line, x, y + height / 2 + (index - (lines.length - 1) / 2) * 28));
  }
  plan.tables.forEach(table => table.rows.forEach(row => {
    drawLines(row.labelLines, FIGURE_MARGIN + LABEL_WIDTH - 20, row.y, row.height, 'right');
    table.columns.forEach((column, index) => drawLines(row.values[index], plan.imageLeft + column.center, row.y, row.height, 'center'));
  }));
  const blotCanvases = [];
  plan.rows.forEach((part, index) => {
    const image = rows[index].draft.currentImage;
    const source = documentObject.createElement('canvas');
    source.width = image.width; source.height = image.height;
    source.getContext('2d').putImageData(blotImageData(rows[index], preprocess), 0, 0);
    const blot = documentObject.createElement('canvas');
    blot.width = Math.ceil(plan.imageWidth * scale);
    blot.height = Math.ceil(part.imageHeight * scale);
    const blotCtx = blot.getContext('2d');
    blotCtx.fillStyle = '#fff'; blotCtx.fillRect(0, 0, blot.width, blot.height);
    const horizontalScale = blot.width / plan.imageWidth;
    blotCtx.drawImage(source, 0, part.sourceTop, image.width, part.sourceHeight,
      part.imageX * horizontalScale, 0, part.imageWidth * horizontalScale, blot.height);
    ctx.drawImage(blot, plan.imageLeft, part.imageY, plan.imageWidth, part.imageHeight);
    drawLadderLabels(ctx, part.ladderLabels, plan.imageLeft - part.ladderLabels.width,
      part.imageY - part.ladderLabels.imageTop);
    drawLines(part.labelLines, FIGURE_MARGIN + LABEL_WIDTH - 20, part.y, part.rowHeight, 'right');
    blotCanvases.push(blot);
  });
  return { canvas, plan, blotCanvases };
}
