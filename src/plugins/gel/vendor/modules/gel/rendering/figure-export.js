import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { clamp, normalizeManualOverrides } from '../shared.js';

const MIN_LABEL_WIDTH_PX = 118;
const MAX_LABEL_WIDTH_PX = 260;
const MIN_ROW_HEIGHT_PX = 44;
const MAX_ROW_HEIGHT_PX = 88;
const MAX_FIGURE_DIMENSION_PX = 16000;
const MAX_FIGURE_PIXELS = 24000000;

function positiveInteger(value, fallback = 1) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
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

function resolveFigureTypography(gelWidth, laneCount) {
  const averageLaneWidth = gelWidth / Math.max(1, laneCount);
  const fontSize = clamp(Math.round(averageLaneWidth * 0.26), 18, 36);
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
  ladderLane = null
} = {}) {
  const width = positiveInteger(imageWidth);
  const height = positiveInteger(imageHeight);
  const overrides = normalizeManualOverrides(manualOverrides);
  const rows = Array.isArray(overrides.laneTable?.rows) ? overrides.laneTable.rows : [];
  if (!rows.length) {
    throw new Error('Add at least one table row before generating an image.');
  }

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
  const typography = resolveFigureTypography(gelWidth, visibleLanes.length);
  const tableGap = Math.max(12, Math.round(typography.rowHeight * 0.32));
  const tableHeight = (rows.length * typography.rowHeight) + tableGap;
  const crop = resolveVerticalCrop(overrides.laneSegmentation, height);
  const canvasWidth = typography.labelWidth + gelWidth;
  const canvasHeight = tableHeight + crop.sourceHeight;

  if (
    canvasWidth > MAX_FIGURE_DIMENSION_PX
    || canvasHeight > MAX_FIGURE_DIMENSION_PX
    || (canvasWidth * canvasHeight) > MAX_FIGURE_PIXELS
  ) {
    throw new Error('The gel and table are too large to generate as one PNG. Remove table rows or crop the gel first.');
  }

  let gelOffset = 0;
  const slices = rawSlices.map((slice) => {
    const outputX = typography.labelWidth + gelOffset;
    gelOffset += slice.sourceWidth;
    return {
      ...slice,
      outputX,
      centerX: outputX + (slice.sourceWidth / 2)
    };
  });

  return {
    canvasWidth,
    canvasHeight,
    sourceTop: crop.sourceTop,
    sourceBottom: crop.sourceBottom,
    sourceHeight: crop.sourceHeight,
    croppedToBandLines: crop.croppedToBandLines,
    labelWidth: typography.labelWidth,
    fontSize: typography.fontSize,
    rowHeight: typography.rowHeight,
    tableGap,
    tableHeight,
    gelWidth,
    ladderLane: validLadderLane,
    includeLadder: Boolean(includeLadder || !validLadderLane),
    slices,
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
  ladderLane = null
} = {}) {
  if (!documentObject?.createElement || !imageData) {
    throw new Error('The current gel image is unavailable for PowerPoint generation.');
  }

  const plan = buildGelFigurePlan({
    imageWidth,
    imageHeight,
    manualOverrides,
    includeLadder,
    ladderLane
  });
  const sourceCanvas = documentObject.createElement('canvas');
  sourceCanvas.width = positiveInteger(imageWidth);
  sourceCanvas.height = positiveInteger(imageHeight);
  const sourceContext = sourceCanvas.getContext('2d');
  const gelCanvas = documentObject.createElement('canvas');
  gelCanvas.width = plan.gelWidth;
  gelCanvas.height = plan.sourceHeight;
  const gelContext = gelCanvas.getContext('2d');
  if (!sourceContext || !gelContext) {
    throw new Error('Canvas image generation is unavailable in this environment.');
  }

  sourceContext.putImageData(imageData, 0, 0);
  gelContext.clearRect(0, 0, plan.gelWidth, plan.sourceHeight);
  plan.slices.forEach((slice) => {
    gelContext.drawImage(
      sourceCanvas,
      slice.sourceX,
      plan.sourceTop,
      slice.sourceWidth,
      plan.sourceHeight,
      slice.outputX - plan.labelWidth,
      0,
      slice.sourceWidth,
      plan.sourceHeight
    );
  });
  return { canvas: gelCanvas, plan };
}

export function createGelFigureCanvas({
  documentObject = globalThis?.document,
  imageData,
  imageWidth,
  imageHeight,
  manualOverrides,
  includeLadder = true,
  ladderLane = null
} = {}) {
  if (!documentObject?.createElement || !imageData) {
    throw new Error('The current gel image is unavailable for figure generation.');
  }

  const plan = buildGelFigurePlan({
    imageWidth,
    imageHeight,
    manualOverrides,
    includeLadder,
    ladderLane
  });
  const sourceCanvas = documentObject.createElement('canvas');
  sourceCanvas.width = positiveInteger(imageWidth);
  sourceCanvas.height = positiveInteger(imageHeight);
  const sourceContext = sourceCanvas.getContext('2d');
  const outputCanvas = documentObject.createElement('canvas');
  outputCanvas.width = plan.canvasWidth;
  outputCanvas.height = plan.canvasHeight;
  const outputContext = outputCanvas.getContext('2d');
  if (!sourceContext || !outputContext) {
    throw new Error('Canvas image generation is unavailable in this environment.');
  }

  sourceContext.putImageData(imageData, 0, 0);
  outputContext.clearRect(0, 0, plan.canvasWidth, plan.canvasHeight);
  plan.slices.forEach((slice) => {
    outputContext.drawImage(
      sourceCanvas,
      slice.sourceX,
      plan.sourceTop,
      slice.sourceWidth,
      plan.sourceHeight,
      slice.outputX,
      plan.tableHeight,
      slice.sourceWidth,
      plan.sourceHeight
    );
  });

  outputContext.save();
  outputContext.fillStyle = '#000000';
  outputContext.font = `600 ${plan.fontSize}px Arial, Helvetica, sans-serif`;
  outputContext.textAlign = 'center';
  outputContext.textBaseline = 'middle';
  plan.rows.forEach((row, rowIndex) => {
    const centerY = (rowIndex * plan.rowHeight) + (plan.rowHeight / 2);
    if (row.label) {
      outputContext.fillText(row.label, plan.labelWidth / 2, centerY, plan.labelWidth - 16);
    }
    plan.slices.forEach((slice, visibleIndex) => {
      const value = row.values[visibleIndex];
      if (value) {
        outputContext.fillText(value, slice.centerX, centerY, Math.max(1, slice.sourceWidth - 12));
      }
    });
  });
  outputContext.restore();

  return { canvas: outputCanvas, plan };
}
