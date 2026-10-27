import { BODY_FONT_SIZE, LINE_HEIGHT, PLATE_DEFINITIONS } from './constants.js';
import { contentBottom, ensureSpace, font, splitWrappedLines } from './doc-context.js';
import { writeHeading, writeMinorHeading, writeParagraph } from './text-blocks.js';
import { writeSimpleTable } from './tables.js';
import { toRowLabel } from '../../lib/plate-wells.js';

function inferPdfImageFormat(dataUrl) {
  const source = String(dataUrl || '').trim().toLowerCase();
  if (source.startsWith('data:image/jpeg') || source.startsWith('data:image/jpg')) {
    return 'JPEG';
  }
  return 'PNG';
}

// jsPDF embeds whatever raster it is handed, at whatever resolution it arrives in.
// A 7650x9900 phone/scanner PNG dropped into a 250x320pt figure box used to cost
// ~10s and 200MB of PDF: jsPDF's JS PNG path decodes all 75M pixels, splits the
// alpha into an SMask and re-deflates it. Rasterize to the size the figure box can
// actually show, and hand over JPEG - the white fill below flattens alpha away
// regardless, and jsPDF embeds JPEG bytes directly instead of recompressing them.
// ponytail: fixed 200dpi; thread a setting through if archival-resolution scans matter.
const PDF_IMAGE_DPI = 200;
const PDF_IMAGE_QUALITY = 0.92;

function pdfRasterScale(width, height, maxWidthPt, maxHeightPt) {
  const perPoint = PDF_IMAGE_DPI / 72;
  const widthCap = maxWidthPt > 0 ? (maxWidthPt * perPoint) / width : Infinity;
  const heightCap = maxHeightPt > 0 ? (maxHeightPt * perPoint) / height : Infinity;
  return Math.min(1, widthCap, heightCap);
}

async function preparePdfImageAsset(dataUrl, { maxWidthPt = 0, maxHeightPt = 0 } = {}) {
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
      const naturalWidth = Math.max(1, Math.ceil(image.naturalWidth || image.width || 1));
      const naturalHeight = Math.max(1, Math.ceil(image.naturalHeight || image.height || 1));
      const scale = pdfRasterScale(naturalWidth, naturalHeight, maxWidthPt, maxHeightPt);
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
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
        dataUrl: canvas.toDataURL('image/jpeg', PDF_IMAGE_QUALITY),
        format: 'JPEG',
        width,
        height
      });
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

async function writeImageFigure(ctx, dataUrl, { caption = '', maxHeight = 260, heading = '', sectionHeading = '', description = '' } = {}) {
  font(ctx, 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  const captionHeight = caption ? splitWrappedLines(ctx.doc, caption, ctx.maxWidth).length * LINE_HEIGHT + 10 : 8;
  const headingHeight = (heading ? 24 : 0) + (sectionHeading ? 35 : 0);
  const descriptionHeight = description ? splitWrappedLines(ctx.doc, description, ctx.maxWidth).length * LINE_HEIGHT + 4 : 0;
  const availableHeight = Math.max(40, contentBottom(ctx) - ctx.marginTop - 29 - captionHeight - headingHeight - descriptionHeight);
  const targetMaxHeight = Math.min(maxHeight, availableHeight);
  const asset = await preparePdfImageAsset(dataUrl, {
    maxWidthPt: ctx.maxWidth,
    maxHeightPt: targetMaxHeight
  });
  if (!asset) {
    if (sectionHeading) writeHeading(ctx, sectionHeading);
    if (heading) writeMinorHeading(ctx, heading);
    if (description) writeParagraph(ctx, description);
    if (caption) {
      writeParagraph(ctx, caption);
    }
    return false;
  }

  const widthScale = ctx.maxWidth / asset.width;
  const heightScale = targetMaxHeight / asset.height;
  const scale = Math.min(widthScale, heightScale, 1);
  let drawWidth = Math.max(1, asset.width * scale);
  let drawHeight = Math.max(1, asset.height * scale);
  const roomHere = contentBottom(ctx) - ctx.y - captionHeight - headingHeight - descriptionHeight;
  if (ctx.compact && roomHere >= drawHeight * 0.72 && roomHere < drawHeight) {
    drawWidth *= roomHere / drawHeight;
    drawHeight = roomHere;
  }

  ensureSpace(ctx, drawHeight + captionHeight + headingHeight + descriptionHeight);
  if (sectionHeading) writeHeading(ctx, sectionHeading);
  if (heading) writeMinorHeading(ctx, heading);
  if (description) writeParagraph(ctx, description);
  ctx.doc.addImage(asset.dataUrl, asset.format, ctx.margin, ctx.y, drawWidth, drawHeight);
  ctx.y += drawHeight + 6;
  if (caption) {
    writeParagraph(ctx, caption);
  }
  return true;
}

function wellIdFor(rowIndex, columnIndex) {
  return `${toRowLabel(rowIndex)}${columnIndex + 1}`;
}

function compactPlateCellLabel(value, maxCharacters) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxCharacters) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxCharacters - 3)).trimEnd()}...`;
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

function assayPlotMetrics(ctx, def) {
  const totalWells = def.rows * def.columns;
  const maxRows = def.rows;
  const maxColumns = def.columns;
  const rowHeaderWidth = 20;
  const colHeaderHeight = 16;
  const maxPlotWidth = ctx.maxWidth - rowHeaderWidth;
  const naturalCellSize = maxPlotWidth / maxColumns;
  const plotHeightCap = Math.max(40, Math.min(totalWells > 96 ? 210 : 330,
    contentBottom(ctx) - ctx.marginTop - 150));
  const cellSize = Math.min(naturalCellSize, plotHeightCap / maxRows,
    ctx.visualStyle === 'editorial' ? 42 : Infinity);
  const plotHeight = cellSize * maxRows;
  const neededHeight = plotHeight + colHeaderHeight + 24;
  return { maxRows, maxColumns, rowHeaderWidth, colHeaderHeight, cellSize, plotHeight, neededHeight };
}

function writeAssayAssignments(ctx, map, def) {
  const at = (row, col) => map[wellIdFor(row, col)] || {};
  const modes = ['row', 'column'];
  const mode = modes.find(axis => Array.from({ length: def.rows }, (_, row) =>
    Array.from({ length: def.columns }, (_, col) => {
      const sample = axis === 'row' ? at(row, 0).sampleId : at(0, col).sampleId;
      const concentration = axis === 'row' ? at(0, col).concentration : at(row, 0).concentration;
      return at(row, col).sampleId === sample && at(row, col).concentration === concentration;
    }).every(Boolean)).every(Boolean));
  if (mode) {
    for (const axis of ['row', 'column']) {
      const count = axis === 'row' ? def.rows : def.columns;
      const isSample = axis === mode;
      const items = Array.from({ length: count }, (_, index) => [
        axis === 'row' ? toRowLabel(index) : String(index + 1),
        (axis === 'row' ? at(index, 0) : at(0, index))[isSample ? 'sampleId' : 'concentration'] || '-'
      ]);
      const paired = [];
      const half = Math.ceil(items.length / 2);
      for (let index = 0; index < half; index++) paired.push([...items[index], ...(items[index + half] || ['', ''])]);
      const axisLabel = axis === 'row' ? 'Row' : 'Column';
      const valueLabel = isSample ? 'Sample' : 'Concentration';
      writeSimpleTable(ctx, [axisLabel, valueLabel, axisLabel, valueLabel], paired, { heading: valueLabel + ' assignments' });
    }
    return;
  }
  writeSimpleTable(ctx, ['Well', 'Sample', 'Concentration'], Object.entries(map)
    .filter(([_well, value]) => value.sampleId || value.concentration)
    .map(([well, value]) => [well, value.sampleId, value.concentration]), { heading: 'Well assignments' });
}

function estimateAssayPlotHeight(ctx, def) {
  return assayPlotMetrics(ctx, def).neededHeight + (LINE_HEIGHT * 3);
}

function renderAssayPlot(ctx, assay, def) {
  const monochrome = ctx.visualStyle === 'editorial';
  const {
    maxRows,
    maxColumns,
    rowHeaderWidth,
    colHeaderHeight,
    cellSize,
    plotHeight,
    neededHeight
  } = assayPlotMetrics(ctx, def);
  const startX = ctx.margin + rowHeaderWidth;

  ensureSpace(ctx, neededHeight);
  const startY = ctx.y + colHeaderHeight;

  const map = {};
  (Array.isArray(assay?.wellLayout) ? assay.wellLayout : []).forEach((item) => {
    const well = String(item?.well || '').trim().toUpperCase();
    if (!well) {
      return;
    }
    map[well] = {
      sampleId: String(item?.sampleId || '').trim(),
      concentration: String(item?.concentration || '').trim()
    };
  });

  const dense = cellSize < 30;
  const cellLabelFontSize = 7;
  const cellLabelLineHeight = 8;
  const cellLabelMaxCharacters = Math.max(
    3,
    Math.floor((cellSize - 4) / (cellLabelFontSize * 0.54))
  );
  let mappedCount = 0;
  let shortened = false;

  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'normal');
  ctx.doc.setFontSize(7);

  for (let col = 0; col < maxColumns; col += 1) {
    if (col % Math.max(1, Math.ceil(12 / cellSize)) && col !== maxColumns - 1) continue;
    const label = String(col + 1);
    const x = startX + (col * cellSize) + (cellSize / 2);
    ctx.doc.text(label, x, ctx.y + 11, { align: 'center' });
  }

  for (let row = 0; row < maxRows; row += 1) {
    if (row % Math.max(1, Math.ceil(9 / cellSize)) && row !== maxRows - 1) continue;
    const rowLabel = toRowLabel(row);
    const y = startY + (row * cellSize) + (cellSize / 2) + 3;
    ctx.doc.text(rowLabel, ctx.margin + 10, y, { align: 'center' });
  }

  for (let row = 0; row < maxRows; row += 1) {
    for (let col = 0; col < maxColumns; col += 1) {
      const well = wellIdFor(row, col);
      const layout = map[well];
      const sampleId = String(layout?.sampleId || '').trim();
      const concentration = String(layout?.concentration || '').trim();
      const mapped = Boolean(sampleId || concentration);
      const x = startX + (col * cellSize);
      const y = startY + (row * cellSize);
      if (mapped) {
        mappedCount += 1;
        ctx.doc.setFillColor(...(monochrome ? [224, 224, 224] : [209, 227, 255]));
      } else {
        ctx.doc.setFillColor(255, 255, 255);
      }
      ctx.doc.setDrawColor(...(monochrome ? [125, 125, 125] : [170, 180, 190]));
      ctx.doc.rect(x, y, cellSize, cellSize, 'FD');

      const labels = [sampleId, concentration]
        .filter(Boolean)
        .map((value) => {
          const label = compactPlateCellLabel(value, cellLabelMaxCharacters);
          shortened ||= label !== value;
          return label;
        });
      if (labels.length && !dense) {
        const labelBlockHeight = (labels.length - 1) * cellLabelLineHeight;
        const labelStartY = y + (cellSize / 2) - (labelBlockHeight / 2) + (cellLabelFontSize * 0.34);
        ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'normal');
        ctx.doc.setFontSize(cellLabelFontSize);
        ctx.doc.setTextColor(...(monochrome ? [30, 30, 30] : [26, 52, 74]));
        labels.forEach((label, index) => {
          ctx.doc.text(label, x + (cellSize / 2), labelStartY + (index * cellLabelLineHeight), { align: 'center' });
        });
      }
    }
  }

  ctx.y = startY + plotHeight + 14;
  ctx.doc.setTextColor(0, 0, 0);
  ctx.doc.setFontSize(9);
  const mappedLabel = `${mappedCount} mapped well${mappedCount === 1 ? '' : 's'}`;
  writeParagraph(ctx, dense
    ? `Legend: ${monochrome ? 'shaded' : 'blue'} = mapped well; white = empty. ${mappedLabel}. Full sample and concentration assignments follow.`
    : `Legend: ${monochrome ? 'shaded' : 'blue'} cells show saved sample (top) and concentration (bottom); white = empty well. ${mappedLabel}.`);
  if (mappedCount && (dense || shortened)) writeAssayAssignments(ctx, map, def);
}

export {
  inferPdfImageFormat,
  preparePdfImageAsset,
  writeImageFigure,
  toRowLabel,
  wellIdFor,
  resolveAssayDefinition,
  estimateAssayPlotHeight,
  renderAssayPlot
};
