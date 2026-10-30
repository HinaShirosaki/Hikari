import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { CAPTION_ANGLE, clamp, estimateTextEm, normalizeManualOverrides } from '../shared.js';
import { buildLadderLabels, drawLadderLabels } from './ladder-labels.js';
import { FIGURE_FONT_SIZE, FIGURE_WIDTH } from '../figure/model.js';

const MIN_LABEL_WIDTH_PX = 118;
const MAX_LABEL_WIDTH_PX = 260;
const MIN_ROW_HEIGHT_PX = 44;
const MAX_ROW_HEIGHT_PX = 88;
const MAX_FIGURE_DIMENSION_PX = 16000;
const MAX_FIGURE_PIXELS = 48000000;
const DEFAULT_RASTER_SCALE = 4;

function positiveInteger(value, fallback = 1) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveRasterScale(width, height, requestedScale = DEFAULT_RASTER_SCALE) {
  const logicalWidth = positiveInteger(width);
  const logicalHeight = positiveInteger(height);
  const requested = clamp(positiveInteger(requestedScale, DEFAULT_RASTER_SCALE), 1, DEFAULT_RASTER_SCALE);
  const byDimension = Math.floor(Math.min(
    MAX_FIGURE_DIMENSION_PX / logicalWidth,
    MAX_FIGURE_DIMENSION_PX / logicalHeight
  ));
  const byPixels = Math.floor(Math.sqrt(MAX_FIGURE_PIXELS / (logicalWidth * logicalHeight)));
  return Math.max(1, Math.min(requested, byDimension, byPixels));
}

function resolveVerticalCrop(segmentation, imageHeight) {
  const height = positiveInteger(imageHeight);
  if (!Number.isFinite(segmentation?.bandTop) || !Number.isFinite(segmentation?.bandBottom)) {
    return { sourceTop: 0, sourceBottom: height - 1, sourceHeight: height, croppedToBandLines: false };
  }

  const sourceTop = clamp(
    Math.floor(Math.min(segmentation.bandTop, segmentation.bandBottom)),
    0,
    height - 1
  );
  const sourceBottom = clamp(
    Math.floor(Math.max(segmentation.bandTop, segmentation.bandBottom)),
    sourceTop,
    height - 1
  );
  return {
    sourceTop,
    sourceBottom,
    sourceHeight: sourceBottom - sourceTop + 1,
    croppedToBandLines: true
  };
}

// Caption widths in ems from the export's own font, when the canvas can measure.
export function canvasTextEm(context) {
  if (typeof context?.measureText !== 'function') return undefined;
  return (text) => {
    context.font = '100px Arial, Helvetica, sans-serif';
    return context.measureText(text).width / 100;
  };
}

// The Stack figure's type proportion (FIGURE_FONT_SIZE across FIGURE_WIDTH), so
// a single gel's table reads the same as a Stack's.
function resolveFigureTypography(gelWidth) {
  const fontSize = clamp(Math.round(gelWidth * FIGURE_FONT_SIZE / FIGURE_WIDTH), 12, 40);
  return {
    fontSize,
    rowHeight: clamp(Math.round(fontSize * 1.9), MIN_ROW_HEIGHT_PX, MAX_ROW_HEIGHT_PX),
    labelWidth: clamp(Math.round(fontSize * 5.2), MIN_LABEL_WIDTH_PX, MAX_LABEL_WIDTH_PX)
  };
}

export function buildGelFigurePlan({
  imageWidth,
  imageHeight,
  manualOverrides,
  includeLadder = true,
  ladderLane = null,
  showLadderLabels = false,
  ladderPreset = null,
  measureTextEm = estimateTextEm
} = {}) {
  const width = positiveInteger(imageWidth);
  const height = positiveInteger(imageHeight);
  const overrides = normalizeManualOverrides(manualOverrides);
  const rows = Array.isArray(overrides.laneTable?.rows) ? overrides.laneTable.rows : [];

  const lanes = buildLanesFromManualSegmentation(overrides, width, height) || [];
  if (!lanes.length) {
    throw new Error('Finish the lane dividers before generating an image.');
  }

  const requestedLadderLane = Math.floor(Number(ladderLane ?? overrides.ladderLane));
  const validLadderLane = Number.isFinite(requestedLadderLane)
    && requestedLadderLane >= 1
    && requestedLadderLane <= lanes.length
    ? requestedLadderLane
    : null;
  const visibleLanes = includeLadder || !validLadderLane
    ? lanes
    : lanes.filter((lane) => lane.index + 1 !== validLadderLane);
  if (!visibleLanes.length) {
    throw new Error('The ladder is the only lane, so it cannot be excluded from the image.');
  }

  const rawSlices = visibleLanes.map((lane) => {
    const sourceX = clamp(Math.floor(lane.xStart), 0, width - 1);
    const sourceRight = clamp(Math.floor(lane.xEnd), sourceX, width - 1);
    return {
      laneIndex: lane.index + 1,
      sourceX,
      sourceWidth: sourceRight - sourceX + 1
    };
  });
  const gelWidth = rawSlices.reduce((sum, slice) => sum + slice.sourceWidth, 0);
  const typography = resolveFigureTypography(gelWidth);
  // Without a lane table there is nothing to label, so the header strip and the
  // label column collapse and the figure is the bare gel.
  const labelWidth = rows.length ? typography.labelWidth : 0;
  const tableGap = rows.length ? Math.max(12, Math.round(typography.rowHeight * 0.32)) : 0;
  // A one-row table becomes captions rising from each lane center; the strip
  // grows to fit the longest one.
  const sin = Math.sin(CAPTION_ANGLE * Math.PI / 180);
  const cos = Math.cos(CAPTION_ANGLE * Math.PI / 180);
  const captionWidths = rows.length === 1
    ? rawSlices.map((slice) => measureTextEm(String(rows[0]?.values?.[slice.laneIndex - 1] ?? '')) * typography.fontSize)
    : null;
  const rowsHeight = captionWidths
    ? Math.max(typography.rowHeight, Math.ceil((Math.max(...captionWidths) * sin) + (typography.fontSize * cos) + 12))
    : rows.length * typography.rowHeight;
  const tableHeight = rowsHeight + tableGap;
  const crop = resolveVerticalCrop(overrides.laneSegmentation, height);
  const ladderLabels = buildLadderLabels({ manualOverrides: showLadderLabels ? overrides : null,
    ladderPreset, sourceTop: crop.sourceTop, sourceHeight: crop.sourceHeight, sourceImageHeight: height,
    fontSize: clamp(Math.round(typography.fontSize * .75), 12, 22) });
  let gelOffset = 0;
  const slices = rawSlices.map((slice) => {
    const outputX = labelWidth + ladderLabels.width + gelOffset;
    gelOffset += slice.sourceWidth;
    return {
      ...slice,
      outputX,
      centerX: outputX + (slice.sourceWidth / 2)
    };
  });
  const captionRight = captionWidths
    ? Math.max(...slices.map((slice, index) => slice.centerX + (captionWidths[index] * cos) + (typography.fontSize / 2 * sin)))
    : 0;
  const canvasWidth = Math.max(labelWidth + ladderLabels.width + gelWidth, Math.ceil(captionRight));
  const canvasHeight = tableHeight + ladderLabels.height;

  if (
    canvasWidth > MAX_FIGURE_DIMENSION_PX
    || canvasHeight > MAX_FIGURE_DIMENSION_PX
    || (canvasWidth * canvasHeight) > MAX_FIGURE_PIXELS
  ) {
    throw new Error('The gel and table are too large to generate as one PNG. Remove table rows or crop the gel first.');
  }

  return {
    canvasWidth,
    canvasHeight,
    sourceTop: crop.sourceTop,
    sourceBottom: crop.sourceBottom,
    sourceHeight: crop.sourceHeight,
    croppedToBandLines: crop.croppedToBandLines,
    labelWidth,
    fontSize: typography.fontSize,
    rowHeight: typography.rowHeight,
    tableGap,
    tableHeight,
    gelTop: tableHeight + ladderLabels.imageTop,
    ladderLabels,
    gelWidth,
    ladderLane: validLadderLane,
    includeLadder: Boolean(includeLadder || !validLadderLane),
    slices,
    // Each caption starts at its lane center on line y; widths are in figure pixels.
    captions: captionWidths ? { y: rowsHeight - 6 - (typography.fontSize / 2 * cos), widths: captionWidths } : null,
    rows: rows.map((row) => ({
      label: String(row?.label ?? ''),
      values: slices.map((slice) => String(row?.values?.[slice.laneIndex - 1] ?? ''))
    }))
  };
}

export function createGelImageCanvas({
  documentObject = globalThis?.document,
  imageData,
  imageWidth,
  imageHeight,
  manualOverrides,
  includeLadder = true,
  ladderLane = null,
  showLadderLabels = false,
  ladderPreset = null,
  rasterScale = DEFAULT_RASTER_SCALE
} = {}) {
  if (!documentObject?.createElement || !imageData) {
    throw new Error('The current gel image is unavailable for PowerPoint generation.');
  }

  const sourceCanvas = documentObject.createElement('canvas');
  const gelCanvas = documentObject.createElement('canvas');
  const gelContext = gelCanvas.getContext('2d');
  const plan = buildGelFigurePlan({
    imageWidth,
    imageHeight,
    manualOverrides,
    includeLadder,
    ladderLane,
    showLadderLabels,
    ladderPreset,
    measureTextEm: canvasTextEm(gelContext)
  });
  sourceCanvas.width = positiveInteger(imageWidth);
  sourceCanvas.height = positiveInteger(imageHeight);
  const sourceContext = sourceCanvas.getContext('2d');
  const scale = resolveRasterScale(plan.gelWidth, plan.sourceHeight, rasterScale);
  gelCanvas.width = plan.gelWidth * scale;
  gelCanvas.height = plan.sourceHeight * scale;
  if (!sourceContext || !gelContext) {
    throw new Error('Canvas image generation is unavailable in this environment.');
  }

  sourceContext.putImageData(imageData, 0, 0);
  gelContext.imageSmoothingEnabled = true;
  gelContext.imageSmoothingQuality = 'high';
  gelContext.clearRect(0, 0, gelCanvas.width, gelCanvas.height);
  plan.slices.forEach((slice) => {
    gelContext.drawImage(
      sourceCanvas,
      slice.sourceX,
      plan.sourceTop,
      slice.sourceWidth,
      plan.sourceHeight,
      (slice.outputX - plan.labelWidth - plan.ladderLabels.width) * scale,
      0,
      slice.sourceWidth * scale,
      plan.sourceHeight * scale
    );
  });
  return { canvas: gelCanvas, plan, scale };
}

export function createGelFigureCanvas({
  documentObject = globalThis?.document,
  imageData,
  imageWidth,
  imageHeight,
  manualOverrides,
  includeLadder = true,
  ladderLane = null,
  showLadderLabels = false,
  ladderPreset = null,
  rasterScale = DEFAULT_RASTER_SCALE
} = {}) {
  if (!documentObject?.createElement || !imageData) {
    throw new Error('The current gel image is unavailable for figure generation.');
  }

  const sourceCanvas = documentObject.createElement('canvas');
  const outputCanvas = documentObject.createElement('canvas');
  const outputContext = outputCanvas.getContext('2d');
  const plan = buildGelFigurePlan({
    imageWidth,
    imageHeight,
    manualOverrides,
    includeLadder,
    ladderLane,
    showLadderLabels,
    ladderPreset,
    measureTextEm: canvasTextEm(outputContext)
  });
  sourceCanvas.width = positiveInteger(imageWidth);
  sourceCanvas.height = positiveInteger(imageHeight);
  const sourceContext = sourceCanvas.getContext('2d');
  const scale = resolveRasterScale(plan.canvasWidth, plan.canvasHeight, rasterScale);
  outputCanvas.width = plan.canvasWidth * scale;
  outputCanvas.height = plan.canvasHeight * scale;
  if (!sourceContext || !outputContext) {
    throw new Error('Canvas image generation is unavailable in this environment.');
  }

  sourceContext.putImageData(imageData, 0, 0);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  outputContext.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  plan.slices.forEach((slice) => {
    outputContext.drawImage(
      sourceCanvas,
      slice.sourceX,
      plan.sourceTop,
      slice.sourceWidth,
      plan.sourceHeight,
      slice.outputX * scale,
      plan.gelTop * scale,
      slice.sourceWidth * scale,
      plan.sourceHeight * scale
    );
  });

  outputContext.save();
  outputContext.fillStyle = '#000000';
  outputContext.font = `${plan.fontSize * scale}px Arial, Helvetica, sans-serif`;
  outputContext.textAlign = 'center';
  outputContext.textBaseline = 'middle';
  plan.rows.forEach((row, rowIndex) => {
    const centerY = (plan.captions ? plan.captions.y : (rowIndex * plan.rowHeight) + (plan.rowHeight / 2)) * scale;
    // Row labels end beside the first lane, right-aligned like a Stack's.
    if (row.label) {
      outputContext.textAlign = 'right';
      outputContext.fillText(row.label, (plan.labelWidth - 12) * scale, centerY, (plan.labelWidth - 16) * scale);
      outputContext.textAlign = 'center';
    }
    plan.slices.forEach((slice, visibleIndex) => {
      const value = row.values[visibleIndex];
      if (value && plan.captions) {
        outputContext.save();
        outputContext.translate(slice.centerX * scale, centerY);
        outputContext.rotate(-CAPTION_ANGLE * Math.PI / 180);
        outputContext.textAlign = 'left';
        outputContext.fillText(value, 0, 0);
        outputContext.restore();
      } else if (value) {
        outputContext.fillText(
          value,
          slice.centerX * scale,
          centerY,
          Math.max(1, slice.sourceWidth - 12) * scale
        );
      }
    });
  });
  outputContext.restore();
  if (plan.ladderLabels.labels.length) {
    outputContext.save();
    outputContext.scale(scale, scale);
    drawLadderLabels(outputContext, plan.ladderLabels, plan.labelWidth, plan.tableHeight);
    outputContext.restore();
  }

  return { canvas: outputCanvas, plan, scale };
}
