import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { detectLanes } from '../analysis/auto-lanes.js';
import { resolveStackCrop } from './trim.js';
import { buildLadderLabels } from '../rendering/ladder-labels.js';
import { CAPTION_ANGLE, estimateTextEm } from '../shared.js';

export const MAX_BLOTS = 16;
export const FIGURE_WIDTH = 900;
export const LABEL_WIDTH = 190;
export const FIGURE_MARGIN = 24;
export const FIGURE_FONT_SIZE = 22;
// The first and last lane anchors land on these fractions of FIGURE_WIDTH.
export const GUIDE_LEFT = 0.08;
export const GUIDE_RIGHT = 0.92;
const MIN_CROP_SPAN = 1;
const estimateTextWidth = text => estimateTextEm(text) * FIGURE_FONT_SIZE;

export function inferBlotPlacement(draft) {
  const image = draft.currentImage;
  const segmentation = draft.manualOverrides?.laneSegmentation || {};
  const lanes = buildLanesFromManualSegmentation(draft.manualOverrides, image.width, image.height) || [];
  const centers = lanes.length >= 2
    ? lanes.map(lane => lane.center)
    : detectLanes({ gray: image.gray, width: image.width, height: image.height })?.peaks || [];
  return {
    first: centers.length >= 2 ? centers[0] / image.width * 100 : 10,
    last: centers.length >= 2 ? centers[centers.length - 1] / image.width * 100 : 90,
    top: Number.isFinite(segmentation.bandTop) ? segmentation.bandTop / image.height * 100 : 0,
    bottom: Number.isFinite(segmentation.bandBottom) ? (segmentation.bandBottom + 1) / image.height * 100 : 100
  };
}

// Anchors may sit up to one image width outside the blot, so a dragged blot
// can slide past the guides; they stay at least 2% apart.
export function validatePlacement(placement) {
  const { first, last, top, bottom } = placement || {};
  if (![first, last, top, bottom].every(Number.isFinite)
    || first < -100 || last > 200 || last - first < 2
    || top < 0 || bottom > 100 || bottom <= top) {
    throw new Error('Keep the lane anchors within one blot width of the image, at least 2% apart, and the crop bottom below its top.');
  }
  return { first, last, top, bottom };
}

export function blotSizePercent(placement, image) {
  return FIGURE_WIDTH * (GUIDE_RIGHT - GUIDE_LEFT) / (image.width * (placement.last - placement.first) / 100) * 100;
}

// Resize around the image's horizontal center. Both axes use this same scale;
// the source image and its crop are unchanged.
export function resizeBlotPlacement(placement, image, sizePercent) {
  validatePlacement(placement);
  if (!Number.isFinite(sizePercent) || sizePercent <= 0) throw new Error('Enter a positive gel size.');
  const factor = sizePercent / blotSizePercent(placement, image);
  return validatePlacement({ ...placement,
    first: 50 + (placement.first - 50) / factor,
    last: 50 + (placement.last - 50) / factor
  });
}

// A preview drag, in figure units, turned back into lane anchors and crop:
// "move" slides the blot, "left"/"right" stretch it with the other side fixed,
// "top"/"bottom" crop it. Same transform as buildBlotFigurePlan, inverted.
export function dragPlacement(placement, image, zone, dx, dy) {
  const { first, last, top, bottom } = placement;
  const scale = FIGURE_WIDTH * (GUIDE_RIGHT - GUIDE_LEFT) / (image.width * (last - first) / 100);
  if (zone === 'move') {
    const shift = dx / (scale * image.width) * 100;
    return validatePlacement({ ...placement, first: first - shift, last: last - shift });
  }
  if (zone === 'top' || zone === 'bottom') {
    const delta = dy / scale / image.height * 100;
    return validatePlacement(zone === 'top'
      ? { ...placement, top: Math.min(bottom - MIN_CROP_SPAN, Math.max(0, top + delta)) }
      : { ...placement, bottom: Math.max(top + MIN_CROP_SPAN, Math.min(100, bottom + delta)) });
  }
  const left = FIGURE_WIDTH * GUIDE_LEFT - image.width * first / 100 * scale;
  const right = left + image.width * scale;
  const minWidth = FIGURE_WIDTH * 0.05;
  const nextLeft = zone === 'left' ? Math.min(left + dx, right - minWidth) : left;
  const nextRight = zone === 'right' ? Math.max(right + dx, left + minWidth) : right;
  const nextScale = (nextRight - nextLeft) / image.width;
  const nextFirst = (FIGURE_WIDTH * GUIDE_LEFT - nextLeft) / (image.width * nextScale) * 100;
  return validatePlacement({ ...placement, first: nextFirst,
    last: nextFirst + FIGURE_WIDTH * (GUIDE_RIGHT - GUIDE_LEFT) / (image.width * nextScale) * 100 });
}

export function wrapAntibodyLabel(value, measureText = estimateTextWidth, maxWidth = LABEL_WIDTH - 20) {
  const lines = [];
  for (const paragraph of String(value || '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (measureText(line ? `${line} ${word}` : word) <= maxWidth) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) { lines.push(line); line = ''; }
      for (const char of word) {
        if (line && measureText(line + char) > maxWidth) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

// A Stack's own table follows the lanes of its first gel with lane dividers.
export function stackTableReference(rows) {
  for (const row of rows) {
    const image = row.draft.currentImage;
    const lanes = buildLanesFromManualSegmentation(row.draft.manualOverrides, image.width, image.height) || [];
    if (lanes.length) return { row, lanes };
  }
  return null;
}

// One affine horizontal transform per intact blot. The same factor is used on
// Y, preserving band proportions; no lanes are cut apart or independently warped.
export function buildBlotFigurePlan(rows, { measureText, trim, table, showLadderLabels = false } = {}) {
  if (!rows?.length) throw new Error('Add at least one blot to the figure.');
  if (rows.length > MAX_BLOTS) throw new Error(`A figure can contain up to ${MAX_BLOTS} blots.`);
  const plannedRows = rows.map(row => {
    const { width, height } = row.draft.currentImage;
    const placement = validatePlacement(row.placement);
    const scale = FIGURE_WIDTH * (GUIDE_RIGHT - GUIDE_LEFT) / (width * (placement.last - placement.first) / 100);
    const sourceTop = Math.floor(height * placement.top / 100);
    const sourceBottom = Math.min(height, Math.max(sourceTop + 1, Math.ceil(height * placement.bottom / 100)));
    const imageHeight = (sourceBottom - sourceTop) * scale;
    const ladderLabels = buildLadderLabels({ manualOverrides: showLadderLabels ? row.draft.manualOverrides : null,
      ladderPreset: row.draft.controls?.['gel-ladder-preset'], sourceTop,
      sourceHeight: sourceBottom - sourceTop, sourceImageHeight: height, imageHeight, fontSize: 18 });
    const labelLines = wrapAntibodyLabel(row.label, measureText);
    const rowHeight = Math.max(ladderLabels.height, labelLines.length * 28 + 12);
    const result = {
      id: row.id, labelLines, rowHeight, imageHeight, ladderLabels,
      sourceTop, sourceHeight: sourceBottom - sourceTop,
      imageX: FIGURE_WIDTH * GUIDE_LEFT - width * placement.first / 100 * scale,
      imageWidth: width * scale
    };
    return result;
  });
  // Expand the shared image area to include every transformed source. In
  // particular, a two-lane blot can have wide outer bands: clipping at the
  // nominal 8%/92% guide margins would silently cut those bands in half.
  const left = Math.min(0, ...plannedRows.map(row => row.imageX));
  const right = Math.max(FIGURE_WIDTH, ...plannedRows.map(row => row.imageX + row.imageWidth));
  const fullImageWidth = right - left;
  plannedRows.forEach(row => { row.imageX -= left; });
  const crop = resolveStackCrop(plannedRows, fullImageWidth, trim);
  const imageWidth = crop.sourceWidth;
  plannedRows.forEach(row => { row.imageX -= crop.sourceLeft; });
  let y = FIGURE_MARGIN;
  let captionRight = 0;
  const sin = Math.sin(CAPTION_ANGLE * Math.PI / 180), cos = Math.cos(CAPTION_ANGLE * Math.PI / 180);
  const tables = [];
  function laneColumns(index) {
    const part = plannedRows[index];
    const image = rows[index].draft.currentImage;
    const lanes = buildLanesFromManualSegmentation(rows[index].draft.manualOverrides, image.width, image.height) || [];
    const centers = lanes.map(lane => part.imageX + lane.center / image.width * part.imageWidth);
    return lanes.map((lane, index) => {
      const width = Math.max(8, Math.min(
        (lane.xEnd - lane.xStart + 1) / image.width * part.imageWidth,
        index ? (centers[index] - centers[index - 1]) * 0.96 : Infinity,
        index < lanes.length - 1 ? (centers[index + 1] - centers[index]) * 0.96 : Infinity,
        centers[index] * 2, (imageWidth - centers[index]) * 2
      ));
      return { laneIndex: lane.index + 1, center: centers[index], width, x: centers[index] - width / 2 };
    }).filter(column => column.center >= 0 && column.center <= imageWidth);
  }
  function placeTable(laneTableRows, columns, sourceId, label) {
    const rotated = laneTableRows.length === 1;
    let tableY = y;
    const tableRows = laneTableRows.map(row => {
      const labelLines = wrapAntibodyLabel(row.label, measureText);
      if (!rotated) {
        const values = columns.map(column => wrapAntibodyLabel(row.values?.[column.laneIndex - 1] || '', measureText, Math.max(8, column.width - 12)));
        const height = Math.max(44, Math.max(labelLines.length, ...values.map(lines => lines.length)) * 28 + 12);
        const result = { labelLines, values, y: tableY, height, labelY: tableY, labelHeight: height };
        tableY += height;
        return result;
      }
      // Each caption starts at its lane center (captionY) and rises to the
      // right; the row label sits beside the captions' starting line.
      const values = columns.map(column => [String(row.values?.[column.laneIndex - 1] || '').replace(/\s+/g, ' ').trim()]);
      const widths = values.map(([text]) => (measureText || estimateTextWidth)(text));
      widths.forEach((width, index) => { captionRight = Math.max(captionRight, columns[index].center + width * cos + FIGURE_FONT_SIZE / 2 * sin); });
      const height = Math.max(44, labelLines.length * 28 + 12, Math.max(...widths) * sin + FIGURE_FONT_SIZE * cos + 12);
      const captionY = tableY + height - 6 - FIGURE_FONT_SIZE / 2 * cos;
      const result = { labelLines, values, widths, y: tableY, height, captionY,
        labelY: captionY + 14 - labelLines.length * 28, labelHeight: labelLines.length * 28 };
      tableY += height;
      return result;
    });
    const table = { sourceId, label, columns, rows: tableRows, rotated, y, height: tableY - y };
    tables.push(table);
    y = tableY + 16;
    return table;
  }
  // The Stack's own table heads the figure and replaces the gels' own tables.
  const stackTable = table?.rows?.length ? table.rows : null;
  const tableReference = stackTable && stackTableReference(rows);
  const referenceIndex = tableReference ? rows.indexOf(tableReference.row) : -1;
  const referenceColumns = referenceIndex >= 0 ? laneColumns(referenceIndex) : [];
  if (referenceColumns.length) placeTable(stackTable, referenceColumns, rows[referenceIndex].id, 'Stack').stack = true;
  plannedRows.forEach((part, index) => {
    const laneTableRows = stackTable ? [] : rows[index].draft.manualOverrides?.laneTable?.rows || [];
    const columns = laneTableRows.length ? laneColumns(index) : [];
    if (columns.length) part.table = placeTable(laneTableRows, columns, rows[index].id, rows[index].label);
    part.y = y;
    part.imageY = y + (part.rowHeight - part.imageHeight) / 2;
    y += part.rowHeight + 16;
  });
  const ladderLabelWidth = Math.max(...plannedRows.map(row => row.ladderLabels.width));
  const width = Math.ceil(FIGURE_MARGIN * 2 + LABEL_WIDTH + ladderLabelWidth + Math.max(imageWidth, captionRight));
  const height = Math.ceil(y - 16 + FIGURE_MARGIN);
  if (height > 12000 || width > 12000 || width * height > 24000000) {
    throw new Error('This figure is too large. Check the lane anchors, crop the blots, or use fewer rows.');
  }
  return { width, height, imageWidth, fullImageWidth, crop, guideLeft: FIGURE_WIDTH * GUIDE_LEFT - left - crop.sourceLeft,
    guideRight: FIGURE_WIDTH * GUIDE_RIGHT - left - crop.sourceLeft, imageLeft: FIGURE_MARGIN + LABEL_WIDTH + ladderLabelWidth,
    tables, blotTop: plannedRows[0].imageY, rows: plannedRows };
}
