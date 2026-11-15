import { getJsPdfCtor } from '../../pdf-export/doc-context.js';
import { plateText } from '../localization.js';
import { AXIS_FIELDS, hasWellValues } from '../axis-fields.js';

const CELL_WIDTH = 112;
const CELL_HEIGHT = 72;
const CONDITION_HEIGHT = 31;
const ROW_HEADER_WIDTH = 40;
const COLUMN_HEADER_HEIGHT = 26;
const PADDING = 24;
const FONT = 'system-ui, sans-serif';
const INK = '#17293b';
const MUTED = '#435970';
const RULE = '#b9c8d6';
const HEADER = '#edf2f6';
const MAPPED = '#f0f6ff';

function fitText(ctx, text, width) {
  let line = '';
  for (const character of text) {
    if (ctx.measureText(line + character).width > width) break;
    line += character;
  }
  return line;
}

function drawText(ctx, text, x, y, width, maxLines = 1) {
  let remaining = text.replace(/\s+/gu, ' ').trim();
  for (let index = 0; index < maxLines && remaining; index += 1) {
    let line = fitText(ctx, remaining, width);
    remaining = remaining.slice(line.length).trimStart();
    if (index === maxLines - 1 && remaining) {
      line = `${fitText(ctx, line, width - ctx.measureText('…').width).trimEnd()}…`;
    }
    ctx.fillText(line.trimEnd(), x, y + index * 15);
  }
}

export function renderPlateLayout({ title, subtitle, definition, wells, conditionFields }, {
  firstRow = 0, firstColumn = 0, rows = definition.rows, columns = definition.columns,
  scale = 2, pageLabel = ''
} = {}) {
  const gridTop = 96;
  const cellHeight = CELL_HEIGHT + conditionFields.length * CONDITION_HEIGHT;
  const gridWidth = Math.max(480, ROW_HEADER_WIDTH + columns * (conditionFields.length ? 144 : CELL_WIDTH));
  const gridHeight = COLUMN_HEADER_HEIGHT + rows * cellHeight;
  const conditionLabels = conditionFields.map(field => plateText(AXIS_FIELDS[field].label));
  const width = gridWidth + 2 * PADDING;
  const height = gridTop + gridHeight + PADDING;
  const cellWidth = (gridWidth - ROW_HEADER_WIDTH) / columns;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = `650 26px ${FONT}`;
  drawText(ctx, title, PADDING, 22, gridWidth);
  ctx.fillStyle = MUTED;
  ctx.font = `14px ${FONT}`;
  drawText(ctx, subtitle, PADDING, 56, gridWidth);
  if (pageLabel) {
    ctx.textAlign = 'right';
    ctx.fillText(pageLabel, width - PADDING, 76);
  }

  const firstWellX = PADDING + ROW_HEADER_WIDTH;
  ctx.fillStyle = HEADER;
  ctx.fillRect(PADDING, gridTop, gridWidth, COLUMN_HEADER_HEIGHT);
  ctx.fillRect(PADDING, gridTop + COLUMN_HEADER_HEIGHT, ROW_HEADER_WIDTH, rows * cellHeight);
  ctx.strokeStyle = RULE;
  ctx.strokeRect(PADDING, gridTop, gridWidth, gridHeight);
  ctx.fillStyle = INK;
  ctx.font = `650 14px ${FONT}`;
  ctx.textAlign = 'center';
  for (let column = 0; column < columns; column += 1) {
    ctx.fillText(String(firstColumn + column + 1), firstWellX + (column + 0.5) * cellWidth, gridTop + 6);
  }
  for (let row = 0; row < rows; row += 1) {
    const index = (firstRow + row) * definition.columns + firstColumn;
    const y = gridTop + COLUMN_HEADER_HEIGHT + row * cellHeight;
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.font = `650 14px ${FONT}`;
    ctx.fillText(wells[index].row, PADDING + ROW_HEADER_WIDTH / 2, y + (cellHeight - 16) / 2);
    ctx.textAlign = 'left';
    for (let column = 0; column < columns; column += 1) {
      const well = wells[index + column];
      const x = firstWellX + column * cellWidth;
      if (hasWellValues(well)) {
        ctx.fillStyle = MAPPED;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
      ctx.strokeRect(x, y, cellWidth, cellHeight);
      ctx.fillStyle = INK;
      ctx.font = `650 14px ${FONT}`;
      drawText(ctx, well.sampleId, x + 6, y + 6, cellWidth - 12, 2);
      ctx.fillStyle = MUTED;
      ctx.font = `14px ${FONT}`;
      let labelY = well.sampleId ? y + 37 : y + 6;
      if (well.concentration) {
        drawText(ctx, well.concentration, x + 6, labelY, cellWidth - 12, 2);
        labelY += CONDITION_HEIGHT;
      }
      conditionFields.forEach((field, fieldIndex) => {
        if (well[field]) {
          drawText(ctx, `${conditionLabels[fieldIndex]}: ${well[field]}`, x + 6, labelY, cellWidth - 12, 2);
          labelY += CONDITION_HEIGHT;
        }
      });
    }
  }
  return canvas;
}

export function createPlateLayoutPdf(plate) {
  const JsPdf = getJsPdfCtor();
  if (!JsPdf) {
    throw new Error('PDF library is unavailable');
  }
  const pdf = new JsPdf({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  pdf.setProperties({ title: plate.title });
  const { rows, columns } = plate.definition;
  // Repeat the plate coordinates for each tile so labels stay readable on paper.
  const pageRows = Math.min(8, Math.floor(800 / (CELL_HEIGHT + CONDITION_HEIGHT * plate.conditionFields.length)));
  const pageColumns = plate.conditionFields.length ? 8 : 12;
  const total = Math.ceil(rows / pageRows) * Math.ceil(columns / pageColumns);
  const margin = 20;
  const availableWidth = pdf.internal.pageSize.getWidth() - 2 * margin;
  const availableHeight = pdf.internal.pageSize.getHeight() - 2 * margin;
  const scale = 2;
  let page = 0;
  for (let firstRow = 0; firstRow < rows; firstRow += pageRows) {
    for (let firstColumn = 0; firstColumn < columns; firstColumn += pageColumns) {
      if (page > 0) pdf.addPage();
      page += 1;
      const canvas = renderPlateLayout(plate, {
        firstRow,
        firstColumn,
        rows: Math.min(pageRows, rows - firstRow),
        columns: Math.min(pageColumns, columns - firstColumn),
        scale,
        pageLabel: total > 1 ? plateText('export.page', { page, total }) : ''
      });
      const fit = Math.min(availableWidth / canvas.width, availableHeight / canvas.height, 0.75 / scale);
      pdf.addImage(canvas, 'PNG', margin, margin, canvas.width * fit, canvas.height * fit, undefined, 'FAST');
      canvas.width = 0;
    }
  }
  return pdf;
}
