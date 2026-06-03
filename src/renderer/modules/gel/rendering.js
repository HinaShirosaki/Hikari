import { buildLanesFromManualSegmentation } from './analysis-core.js';
import { buildQuantificationSignal } from './image-processing.js';
import {
  clamp,
  getLaneRectifiedWidth,
  getLaneRowSegment,
  getLaneVertexArray,
  getTargetBandWindowForLane,
  hasAnyTargetBandWindow,
  laneContainsPoint,
  lanePointToRectifiedRow,
  isPerLaneBandMode,
  mean,
  normalizeLaneBandWindows,
  normalizeManualOverrides,
  round
} from './shared.js';
import { formatAnalysisTypeLabel } from './presentation.js';

const LANE_PROFILE_VIEWBOX = Object.freeze({
  width: 320,
  height: 190,
  plotLeft: 14,
  plotTop: 14,
  plotRight: 306,
  plotBottom: 164
});

export function selectViewerBaseImageData(currentImage, preprocessed = null, viewerMode = 'original') {
  if (viewerMode === 'processed' && preprocessed?.previewImageData) {
    return preprocessed.previewImageData;
  }
  return currentImage?.imageData || null;
}

function smoothSeries(values, radius = 4) {
  if (!values.length) {
    return [];
  }

  const safeRadius = Math.max(1, Math.floor(radius));
  const output = new Float32Array(values.length);

  for (let index = 0; index < values.length; index += 1) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (let offset = -safeRadius; offset <= safeRadius; offset += 1) {
      const sampleIndex = clamp(index + offset, 0, values.length - 1);
      const weight = (safeRadius + 1) - Math.abs(offset);
      weightedSum += values[sampleIndex] * weight;
      totalWeight += weight;
    }
    output[index] = totalWeight ? (weightedSum / totalWeight) : values[index];
  }

  return Array.from(output);
}

function sampleArrayValue(data, width, height, x, y) {
  const safeX = clamp(Number(x) || 0, 0, width - 1);
  const safeY = clamp(Number(y) || 0, 0, height - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const top = (data[(y0 * width) + x0] * (1 - tx)) + (data[(y0 * width) + x1] * tx);
  const bottom = (data[(y1 * width) + x0] * (1 - tx)) + (data[(y1 * width) + x1] * tx);
  return (top * (1 - ty)) + (bottom * ty);
}

function computeLaneIntensityProfile({ signal, width, height, lane }) {
  if (!signal?.length || !lane || width <= 0 || height <= 0) {
    return null;
  }

  const rowMeans = new Float32Array(height);
  const laneWidth = getLaneRectifiedWidth(lane);

  for (let y = 0; y < height; y += 1) {
    const segment = getLaneRowSegment(lane, y, height);
    let rowSum = 0;
    for (let sampleIndex = 0; sampleIndex < laneWidth; sampleIndex += 1) {
      const fraction = laneWidth <= 1 ? 0.5 : sampleIndex / (laneWidth - 1);
      const x = segment.left.x + ((segment.right.x - segment.left.x) * fraction);
      const sampleY = segment.left.y + ((segment.right.y - segment.left.y) * fraction);
      rowSum += sampleArrayValue(signal, width, height, x, sampleY);
    }
    rowMeans[y] = rowSum / Math.max(1, laneWidth);
  }

  const smoothingRadius = Math.max(2, Math.min(10, Math.round(height / 90)));
  const values = smoothSeries(rowMeans, smoothingRadius);

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  let total = 0;
  let peakRow = 0;
  let peakValue = Number.NEGATIVE_INFINITY;

  values.forEach((value, index) => {
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
    total += value;
    if (value > peakValue) {
      peakValue = value;
      peakRow = index;
    }
  });

  return {
    values,
    meanValue: values.length ? (total / values.length) : 0,
    minValue: Number.isFinite(minValue) ? minValue : 0,
    maxValue: Number.isFinite(maxValue) ? maxValue : 0,
    peakRow,
    peakValue: Number.isFinite(peakValue) ? peakValue : 0,
    laneWidth
  };
}

function downsampleLaneProfile(values, maxPoints = 220) {
  if (!values.length) {
    return [];
  }

  const targetCount = Math.min(maxPoints, values.length);
  if (targetCount === values.length) {
    return values.map((value, row) => ({ row, value }));
  }

  const bucketSize = values.length / targetCount;
  const points = [];

  for (let bucketIndex = 0; bucketIndex < targetCount; bucketIndex += 1) {
    const start = Math.floor(bucketIndex * bucketSize);
    const end = bucketIndex === targetCount - 1
      ? values.length
      : Math.max(start + 1, Math.floor((bucketIndex + 1) * bucketSize));

    let sum = 0;
    for (let index = start; index < end; index += 1) {
      sum += values[index];
    }

    points.push({
      row: (start + (end - 1)) / 2,
      value: sum / Math.max(1, end - start)
    });
  }

  return points;
}

function buildSmoothPath(points) {
  if (!points.length) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  path += ` T ${last.x} ${last.y}`;
  return path;
}

function getLaneProfileLanes(runtime) {
  if (!runtime.currentImage) {
    return [];
  }

  const overrides = normalizeManualOverrides(runtime.manualOverrides);
  const segmented = buildLanesFromManualSegmentation(
    overrides,
    runtime.currentImage.width,
    runtime.currentImage.height
  ) || [];
  if (segmented.length) {
    return segmented.map((lane) => ({
      laneIndex: lane.index + 1,
      xStart: lane.xStart,
      xEnd: lane.xEnd,
      vertices: lane.vertices || null
    }));
  }

  return (runtime.currentReport?.lanes || []).map((lane) => ({
    laneIndex: lane.laneIndex,
    xStart: lane.xStart,
    xEnd: lane.xEnd,
    vertices: lane.vertices || null
  }));
}


function renderLaneProfilePlaceholder(svg, message) {
  const {
    width,
    height,
    plotLeft,
    plotTop,
    plotRight,
    plotBottom
  } = LANE_PROFILE_VIEWBOX;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect class="lane-profile-frame" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" />
    <text class="lane-profile-empty" x="${width / 2}" y="${height / 2}" text-anchor="middle">${message}</text>
    <text class="lane-profile-axis-label" x="${plotLeft}" y="${height - 8}">Top</text>
    <text class="lane-profile-axis-label" x="${plotRight}" y="${height - 8}" text-anchor="end">Bottom</text>
  `;
}

function renderLaneProfileSvg(svg, profile, bandTop = null, bandBottom = null) {
  const {
    width,
    height,
    plotLeft,
    plotTop,
    plotRight,
    plotBottom
  } = LANE_PROFILE_VIEWBOX;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const rowMax = Math.max(1, profile.values.length - 1);
  const valueSpan = Math.max(1e-6, profile.maxValue - profile.minValue);
  const points = downsampleLaneProfile(profile.values).map((point) => ({
    x: plotLeft + ((point.row / rowMax) * plotWidth),
    y: plotBottom - (((point.value - profile.minValue) / valueSpan) * plotHeight)
  }));
  const path = buildSmoothPath(points);
  const peakX = plotLeft + ((profile.peakRow / rowMax) * plotWidth);
  const peakY = plotBottom - (((profile.peakValue - profile.minValue) / valueSpan) * plotHeight);

  let highlightedBand = '';
  if (Number.isFinite(bandTop) && Number.isFinite(bandBottom)) {
    const start = clamp(Math.min(bandTop, bandBottom), 0, rowMax);
    const end = clamp(Math.max(bandTop, bandBottom), start, rowMax);
    const rectX = plotLeft + ((start / rowMax) * plotWidth);
    const rectWidth = Math.max(2, ((end - start) / rowMax) * plotWidth);
    highlightedBand = `<rect class="lane-profile-window" x="${rectX}" y="${plotTop}" width="${rectWidth}" height="${plotHeight}" rx="8" />`;
  }

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect class="lane-profile-frame" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" />
    ${highlightedBand}
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop + (plotHeight / 4)}" x2="${plotRight}" y2="${plotTop + (plotHeight / 4)}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop + (plotHeight / 2)}" x2="${plotRight}" y2="${plotTop + (plotHeight / 2)}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop + ((plotHeight * 3) / 4)}" x2="${plotRight}" y2="${plotTop + ((plotHeight * 3) / 4)}" />
    <path class="lane-profile-path-shadow" d="${path}" />
    <path class="lane-profile-path" d="${path}" />
    <circle class="lane-profile-peak" cx="${peakX}" cy="${peakY}" r="4" />
    <text class="lane-profile-axis-label" x="${plotLeft}" y="${height - 8}">Top</text>
    <text class="lane-profile-axis-label" x="${plotRight}" y="${height - 8}" text-anchor="end">Bottom</text>
    <g class="lane-profile-hover" data-role="hover" style="display: none;">
      <line class="lane-profile-hover-line" x1="0" y1="${plotTop}" x2="0" y2="${plotBottom}" />
      <circle class="lane-profile-hover-dot" cx="0" cy="0" r="4" />
      <text class="lane-profile-hover-label" x="0" y="${plotTop - 4}" text-anchor="middle"></text>
    </g>
  `;
}

function setLaneProfileHover(svg, profile, rowIndex) {
  if (!svg || !profile) return;
  const group = svg.querySelector('[data-role="hover"]');
  if (!group) return;
  const { plotLeft, plotRight, plotTop, plotBottom } = LANE_PROFILE_VIEWBOX;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const rowMax = Math.max(1, profile.values.length - 1);
  const valueSpan = Math.max(1e-6, profile.maxValue - profile.minValue);
  const safeRow = Math.min(Math.max(0, Math.round(rowIndex)), rowMax);
  const value = profile.values[safeRow];
  const x = plotLeft + ((safeRow / rowMax) * plotWidth);
  const y = plotBottom - (((value - profile.minValue) / valueSpan) * plotHeight);
  group.style.display = '';
  const line = group.querySelector('line');
  if (line) {
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
  }
  const dot = group.querySelector('circle');
  if (dot) {
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
  }
  const label = group.querySelector('text');
  if (label) {
    label.setAttribute('x', String(x));
    label.textContent = `y=${safeRow}`;
  }
}

function clearLaneProfileHover(svg) {
  const group = svg?.querySelector?.('[data-role="hover"]');
  if (group) group.style.display = 'none';
}

function formatIntensity(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  return value.toFixed(2);
}

function readSnrThreshold(input) {
  if (!input) {
    return 3;
  }
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) {
    return 3;
  }
  return value;
}

export function createRenderingController({ runtime, elements, safeText, deps = {} }) {
  function renderLaneProfile() {
    if (
      !elements.gelLaneProfilePanel
      || !elements.gelLaneProfileSelect
      || !elements.gelLaneProfileCaption
      || !elements.gelLaneProfileChart
      || !elements.gelLaneProfileMeta
    ) {
      return;
    }

    elements.gelLaneProfilePanel.hidden = !runtime.currentImage;

    if (!runtime.currentImage) {
      runtime.selectedLaneProfileLane = null;
      elements.gelLaneProfileSelect.disabled = true;
      elements.gelLaneProfileSelect.innerHTML = '<option value="">Select lane</option>';
      elements.gelLaneProfileCaption.textContent = 'Load a gel image to inspect a lane profile.';
      elements.gelLaneProfileMeta.textContent = '';
      renderLaneProfilePlaceholder(elements.gelLaneProfileChart, 'Lane profile appears here after you divide the gel into lanes.');
      return;
    }

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const lanes = getLaneProfileLanes(runtime);

    if (!lanes.length) {
      runtime.selectedLaneProfileLane = null;
      elements.gelLaneProfileSelect.disabled = true;
      elements.gelLaneProfileSelect.innerHTML = '<option value="">Select lane</option>';
      elements.gelLaneProfileCaption.textContent = 'Finish lane division to plot the average row intensity for a lane.';
      elements.gelLaneProfileMeta.textContent = '';
      renderLaneProfilePlaceholder(elements.gelLaneProfileChart, 'Set left/right borders and lane dividers first.');
      return;
    }

    const availableLaneIds = new Set(lanes.map((lane) => lane.laneIndex));
    if (!availableLaneIds.has(runtime.selectedLaneProfileLane)) {
      runtime.selectedLaneProfileLane = lanes[0].laneIndex;
    }

    const selectedLane = lanes.find((lane) => lane.laneIndex === runtime.selectedLaneProfileLane) || lanes[0];
    runtime.selectedLaneProfileLane = selectedLane.laneIndex;

    elements.gelLaneProfileSelect.disabled = false;
    elements.gelLaneProfileSelect.innerHTML = lanes
      .map((lane) => `<option value="${lane.laneIndex}">Lane ${lane.laneIndex}</option>`)
      .join('');
    elements.gelLaneProfileSelect.value = String(selectedLane.laneIndex);

    const { signal, polarity } = buildQuantificationSignal(runtime.currentImage.gray);
    const profile = signal ? computeLaneIntensityProfile({
      signal,
      width: runtime.currentImage.width,
      height: runtime.currentImage.height,
      lane: selectedLane
    }) : null;

    if (!profile) {
      elements.gelLaneProfileCaption.textContent = 'Lane profile could not be calculated for this image.';
      elements.gelLaneProfileMeta.textContent = '';
      renderLaneProfilePlaceholder(elements.gelLaneProfileChart, 'Lane profile unavailable.');
      return;
    }

    const selectedBandWindow = getTargetBandWindowForLane(overrides.laneSegmentation, selectedLane.laneIndex);
    const hasBandWindow = Boolean(selectedBandWindow);
    const polarityNote = polarity === 'dark-on-light'
      ? 'Dark-on-light gel: signal inverted so bands appear as peaks.'
      : 'Bright-on-dark gel: bands appear as peaks.';
    elements.gelLaneProfileCaption.textContent = hasBandWindow
      ? `Row signal from grayscale image for lane ${selectedLane.laneIndex}. Band window follows steps 6 and 7${selectedBandWindow.perLane ? ' for this lane' : ''}. ${polarityNote}`
      : `Row signal from grayscale image for lane ${selectedLane.laneIndex}. ${polarityNote}`;
    elements.gelLaneProfileMeta.innerHTML = [
      `x ${selectedLane.xStart}-${selectedLane.xEnd}`,
      `width ${profile.laneWidth}px`,
      `peak row ${profile.peakRow}`,
      `peak ${round(profile.peakValue, 4) ?? '-'}`,
      `mean ${round(profile.meanValue, 4) ?? '-'}`
    ]
      .map((item) => `<span>${safeText(item)}</span>`)
      .join('');

    renderLaneProfileSvg(
      elements.gelLaneProfileChart,
      profile,
      selectedBandWindow?.bandTop,
      selectedBandWindow?.bandBottom
    );

    lastProfile = profile;
    lastProfileLane = selectedLane;
    if (runtime.laneProfileHoverY != null) {
      setLaneProfileHover(elements.gelLaneProfileChart, profile, runtime.laneProfileHoverY);
    }
  }

  let lastProfile = null;
  let lastProfileLane = null;

  function strokeLaneOutline(context, lane, height) {
    const vertices = getLaneVertexArray(lane);
    if (vertices.length >= 4) {
      context.beginPath();
      context.moveTo(vertices[0].x + 0.5, vertices[0].y + 0.5);
      vertices.slice(1).forEach((point) => {
        context.lineTo(point.x + 0.5, point.y + 0.5);
      });
      context.closePath();
      context.stroke();
      return;
    }
    context.strokeRect(
      lane.xStart + 0.5,
      0.5,
      Math.max(1, lane.xEnd - lane.xStart),
      Math.max(1, height - 1)
    );
  }

  function strokeLaneRowSegment(context, lane, y) {
    const segment = getLaneRowSegment(lane, y, runtime.currentImage?.height);
    context.beginPath();
    context.moveTo(segment.left.x + 0.5, segment.left.y + 0.5);
    context.lineTo(segment.right.x + 0.5, segment.right.y + 0.5);
    context.stroke();
    return true;
  }

  function strokeLaneWindow(context, lane, top, bottom) {
    const topSegment = getLaneRowSegment(lane, top, runtime.currentImage?.height);
    const bottomSegment = getLaneRowSegment(lane, bottom, runtime.currentImage?.height);
    context.beginPath();
    context.moveTo(topSegment.left.x + 0.5, topSegment.left.y + 0.5);
    context.lineTo(topSegment.right.x + 0.5, topSegment.right.y + 0.5);
    context.lineTo(bottomSegment.right.x + 0.5, bottomSegment.right.y + 0.5);
    context.lineTo(bottomSegment.left.x + 0.5, bottomSegment.left.y + 0.5);
    context.closePath();
    context.stroke();
    return true;
  }

  function drawLaneVertexHandles(context, lanes) {
    if (runtime.selectedViewerTool !== 'lane-vertices' || !lanes.length) {
      return;
    }
    context.save();
    context.lineWidth = 1.7;
    context.strokeStyle = 'rgba(14, 165, 233, 0.95)';
    context.setLineDash([5, 3]);
    lanes.forEach((lane) => {
      strokeLaneOutline(context, lane, runtime.currentImage.height);
    });
    context.setLineDash([]);
    context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
    lanes.forEach((lane) => {
      const points = getLaneVertexArray(lane);
      points.forEach((point, index) => {
        context.beginPath();
        context.arc(point.x + 0.5, point.y + 0.5, 5, 0, Math.PI * 2);
        context.fillStyle = 'rgba(14, 165, 233, 0.95)';
        context.fill();
        context.lineWidth = 1.5;
        context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        context.stroke();
        context.fillStyle = 'rgba(255, 255, 255, 0.98)';
        context.fillText(String(index + 1), point.x + 7, point.y - 5);
      });
    });
    context.restore();
  }

  function drawHoverLineOnCanvas(context) {
    if (runtime.laneProfileHoverY == null || !lastProfileLane) return;
    const y = Math.max(0, Math.min(runtime.currentImage.height - 1, Math.round(runtime.laneProfileHoverY)));
    const segment = getLaneRowSegment(lastProfileLane, y, runtime.currentImage.height);
    context.save();
    context.lineWidth = 1.4;
    context.strokeStyle = 'rgba(250, 204, 21, 0.95)';
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(segment.left.x + 0.5, segment.left.y + 0.5);
    context.lineTo(segment.right.x + 0.5, segment.right.y + 0.5);
    context.stroke();
    context.setLineDash([]);
    context.restore();
  }

  function strokeRowsForLanes(context, lanes, rowY, fallbackColor = 'rgba(56, 189, 248, 0.95)') {
    const y = clamp(rowY, 0, runtime.currentImage.height - 1);
    context.strokeStyle = fallbackColor;
    if (lanes.length) {
      lanes.forEach((lane) => {
        strokeLaneRowSegment(context, lane, y);
      });
      return;
    }
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(runtime.currentImage.width, y + 0.5);
    context.stroke();
  }

  function onLaneProfileChartMouseMove(event) {
    if (!lastProfile || !elements.gelLaneProfileChart) return;
    const svg = elements.gelLaneProfileChart;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const { plotLeft, plotRight, width: viewBoxWidth } = LANE_PROFILE_VIEWBOX;
    const svgX = ((event.clientX - rect.left) / rect.width) * viewBoxWidth;
    if (svgX < plotLeft - 1 || svgX > plotRight + 1) {
      onLaneProfileChartMouseLeave();
      return;
    }
    const rowMax = Math.max(1, lastProfile.values.length - 1);
    const fraction = (svgX - plotLeft) / (plotRight - plotLeft);
    const rowIndex = Math.min(Math.max(0, Math.round(fraction * rowMax)), rowMax);
    setLaneProfileHover(svg, lastProfile, rowIndex);
    runtime.laneProfileHoverY = rowIndex;
    drawCanvas();
  }

  function onLaneProfileChartMouseLeave() {
    clearLaneProfileHover(elements.gelLaneProfileChart);
    if (runtime.laneProfileHoverY != null) {
      runtime.laneProfileHoverY = null;
      drawCanvas();
    }
  }

  function canvasPointFromEvent(event) {
    const canvas = elements.gelCanvas;
    if (!canvas || !runtime.currentImage) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((event.clientX - rect.left) / rect.width) * runtime.currentImage.width;
    const y = ((event.clientY - rect.top) / rect.height) * runtime.currentImage.height;
    return {
      x: clamp(Math.round(x), 0, runtime.currentImage.width - 1),
      y: clamp(Math.round(y), 0, runtime.currentImage.height - 1)
    };
  }

  function findLaneAtPoint(point) {
    const lanes = getLaneProfileLanes(runtime);
    if (!lanes.length) return null;
    return lanes.find((lane) => laneContainsPoint(lane, point.x, point.y, runtime.currentImage.width))
      || lanes.find((lane) => point.x >= lane.xStart && point.x <= lane.xEnd)
      || null;
  }

  function onCanvasHoverMove(event) {
    if (!runtime.currentImage || runtime.cropperActive) return;
    const point = canvasPointFromEvent(event);
    if (!point) return;
    const lane = findLaneAtPoint(point);
    if (!lane) {
      onCanvasHoverLeave();
      return;
    }
    let needsProfileRender = false;
    if (lane.laneIndex !== runtime.selectedLaneProfileLane) {
      runtime.selectedLaneProfileLane = lane.laneIndex;
      needsProfileRender = true;
    }
    const rowY = lanePointToRectifiedRow(lane, point, runtime.currentImage.height) ?? point.y;
    runtime.laneProfileHoverY = rowY;
    if (needsProfileRender) {
      renderLaneProfile();
    } else if (lastProfile) {
      setLaneProfileHover(elements.gelLaneProfileChart, lastProfile, rowY);
    }
    drawCanvas();
  }

  function onCanvasHoverLeave() {
    if (runtime.laneProfileHoverY == null) return;
    runtime.laneProfileHoverY = null;
    clearLaneProfileHover(elements.gelLaneProfileChart);
    drawCanvas();
  }

  function renderCellTable() {
    const panel = elements.gelCellTablePanel;
    const host = elements.gelCellTableHost;
    const summary = elements.gelCellTableSummary;
    if (!panel || !host) {
      return;
    }

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const segmentation = overrides.laneSegmentation || {};
    const hasBandWindow = hasAnyTargetBandWindow(segmentation);
    const reportLanes = runtime.currentReport?.lanes || [];
    const cells = reportLanes
      .map((lane) => ({ lane, cell: lane.targetBand || null }))
      .filter((entry) => entry.cell);

    if (!hasBandWindow || !cells.length) {
      panel.hidden = true;
      host.innerHTML = '';
      if (summary) {
        summary.textContent = '';
      }
      return;
    }

    panel.hidden = false;
    const threshold = readSnrThreshold(elements.gelCellSnrThresholdInput);
    const labelRow = (overrides.laneTable?.rows || []).find((row) => /label/i.test(row?.label || '')) || null;

    const rowsHtml = cells.map(({ lane, cell }) => {
      const snr = Number(cell.snr);
      const hasBand = Number.isFinite(snr) && snr >= threshold;
      const label = labelRow ? safeText(labelRow.values?.[lane.laneIndex - 1] || '') : '';
      const className = `gel-cell-row ${hasBand ? 'is-has-band' : 'is-empty'}`;
      const intensity = formatIntensity(Number(cell.correctedIntensity));
      const bandSum = formatIntensity(Number(cell.bandSignalSum));
      const baselineSum = formatIntensity(Number(cell.baselineSum));
      const saturationPct = Number.isFinite(Number(cell.saturationFraction))
        ? `${(Number(cell.saturationFraction) * 100).toFixed(1)}%`
        : '-';
      return `
        <tr class="${className}">
          <td>${safeText(String(lane.laneIndex))}</td>
          <td>${label}</td>
          <td class="num">${safeText(bandSum)}</td>
          <td class="num">${safeText(baselineSum)}</td>
          <td class="num gel-cell-intensity">${safeText(intensity)}</td>
          <td class="num">${safeText(Number.isFinite(snr) ? snr.toFixed(2) : '-')}</td>
          <td class="gel-cell-hasband">${hasBand ? 'yes' : 'no'}</td>
          <td class="num">${safeText(saturationPct)}</td>
        </tr>
      `;
    }).join('');

    host.innerHTML = `
      <table class="gel-cell-table">
        <thead>
          <tr>
            <th>Lane</th>
            <th>Label</th>
            <th class="num">Band sum</th>
            <th class="num">Baseline sum</th>
            <th class="num">Corrected</th>
            <th class="num">SNR</th>
            <th>Has band?</th>
            <th class="num">Sat %</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    if (summary) {
      const presentCells = cells.filter(({ cell }) => Number(cell.snr) >= threshold).length;
      const baselineMode = cells[0]?.cell?.baselineMode || 'lane-profile';
      summary.textContent = `${presentCells}/${cells.length} cells classified as band (SNR ≥ ${threshold.toFixed(1)}). Baseline: ${baselineMode}.`;
    }
  }

  function drawCellOverlays(context, overrides) {
    const reportLanes = runtime.currentReport?.lanes || [];
    if (!reportLanes.length) {
      return;
    }
    const segmentation = overrides.laneSegmentation || {};
    if (!hasAnyTargetBandWindow(segmentation)) {
      return;
    }
    const threshold = readSnrThreshold(elements.gelCellSnrThresholdInput);

    context.save();
    context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
    reportLanes.forEach((lane) => {
      const cell = lane.targetBand;
      if (!cell) {
        return;
      }
      const top = clamp(Math.min(cell.top, cell.bottom), 0, runtime.currentImage.height - 1);
      const bottom = clamp(Math.max(cell.top, cell.bottom), top + 1, runtime.currentImage.height - 1);
      const hasBand = Number(cell.snr) >= threshold;
      context.lineWidth = 1.4;
      if (hasBand) {
        context.setLineDash([]);
        context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
      } else {
        context.setLineDash([4, 3]);
        context.strokeStyle = 'rgba(148, 163, 184, 0.85)';
      }
      strokeLaneWindow(context, lane, top, bottom);
      context.setLineDash([]);
      const label = formatIntensity(Number(cell.correctedIntensity));
      const topSegment = getLaneRowSegment(lane, top, runtime.currentImage.height);
      context.fillStyle = hasBand ? 'rgba(34, 197, 94, 0.95)' : 'rgba(148, 163, 184, 0.9)';
      const textY = Math.max(10, topSegment.left.y - 2);
      context.fillText(label, topSegment.left.x + 2, textY);
    });
    context.restore();
  }

  function drawCanvas() {
    if (!elements.gelCanvas) {
      return;
    }
    const context = elements.gelCanvas.getContext('2d');
    if (!runtime.currentImage || !context) {
      elements.gelCanvas.width = 1;
      elements.gelCanvas.height = 1;
      context?.clearRect(0, 0, 1, 1);
      return;
    }

    elements.gelCanvas.width = runtime.currentImage.width;
    elements.gelCanvas.height = runtime.currentImage.height;
    const viewerMode = runtime.viewerMode === 'processed' ? 'processed' : 'original';
    const preprocessed = viewerMode === 'processed'
      ? deps.getPreprocessedImageForCurrentSettings?.()
      : null;
    const baseImageData = selectViewerBaseImageData(runtime.currentImage, preprocessed, viewerMode);
    context.putImageData(baseImageData, 0, 0);

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const segmentation = overrides.laneSegmentation || {};
    const segmentationLanes = buildLanesFromManualSegmentation(
      overrides,
      runtime.currentImage.width,
      runtime.currentImage.height
    ) || [];
    if (
      Number.isFinite(segmentation.gelLeft)
      || Number.isFinite(segmentation.gelRight)
      || (Array.isArray(segmentation.dividers) && segmentation.dividers.length)
    ) {
      context.save();
      context.lineWidth = 1.4;
      if (Number.isFinite(segmentation.gelLeft)) {
        const x = clamp(segmentation.gelLeft, 0, runtime.currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 214, 10, 0.95)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, runtime.currentImage.height);
        context.stroke();
      }
      if (Number.isFinite(segmentation.gelRight)) {
        const x = clamp(segmentation.gelRight, 0, runtime.currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 214, 10, 0.95)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, runtime.currentImage.height);
        context.stroke();
      }
      (Array.isArray(segmentation.dividers) ? segmentation.dividers : []).forEach((divider) => {
        const x = clamp(divider, 0, runtime.currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, runtime.currentImage.height);
        context.stroke();
      });

      const laneBandMode = isPerLaneBandMode(segmentation);
      if (!laneBandMode && Number.isFinite(segmentation.bandTop)) {
        const y = clamp(segmentation.bandTop, 0, runtime.currentImage.height - 1);
        strokeRowsForLanes(context, segmentationLanes, y);
      }
      if (!laneBandMode && Number.isFinite(segmentation.bandBottom)) {
        const y = clamp(segmentation.bandBottom, 0, runtime.currentImage.height - 1);
        strokeRowsForLanes(context, segmentationLanes, y);
      }

      if (!laneBandMode && Number.isFinite(segmentation.bandTop) && Number.isFinite(segmentation.bandBottom) && segmentationLanes.length) {
        const top = clamp(Math.min(segmentation.bandTop, segmentation.bandBottom), 0, runtime.currentImage.height - 1);
        const bottom = clamp(Math.max(segmentation.bandTop, segmentation.bandBottom), top + 1, runtime.currentImage.height - 1);
        segmentationLanes.forEach((lane) => {
          context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
          context.lineWidth = 1.2;
          strokeLaneWindow(context, lane, top, bottom);
        });
      }

      if (laneBandMode && segmentationLanes.length) {
        const laneWindowByIndex = new Map(
          normalizeLaneBandWindows(segmentation.laneBandWindows)
            .map((window) => [window.laneIndex, window])
        );
        segmentationLanes.forEach((lane) => {
          const laneIndex = lane.index + 1;
          const window = laneWindowByIndex.get(laneIndex);
          if (!window) {
            return;
          }
          context.lineWidth = 1.4;
          context.strokeStyle = 'rgba(56, 189, 248, 0.95)';
          if (Number.isFinite(window.bandTop)) {
            const y = clamp(window.bandTop, 0, runtime.currentImage.height - 1);
            strokeLaneRowSegment(context, lane, y);
          }
          if (Number.isFinite(window.bandBottom)) {
            const y = clamp(window.bandBottom, 0, runtime.currentImage.height - 1);
            strokeLaneRowSegment(context, lane, y);
          }
          if (Number.isFinite(window.bandTop) && Number.isFinite(window.bandBottom)) {
            const top = clamp(Math.min(window.bandTop, window.bandBottom), 0, runtime.currentImage.height - 1);
            const bottom = clamp(Math.max(window.bandTop, window.bandBottom), top + 1, runtime.currentImage.height - 1);
            context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
            context.lineWidth = 1.2;
            strokeLaneWindow(context, lane, top, bottom);
          }
        });
      }

      if (Number.isFinite(overrides.ladderLane) && segmentationLanes.length) {
        const ladder = segmentationLanes.find((lane) => lane.index + 1 === overrides.ladderLane);
        if (ladder) {
          context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
          context.lineWidth = 2.2;
          strokeLaneOutline(context, ladder, runtime.currentImage.height);
        }
      }

      (Array.isArray(overrides.ladderBands) ? overrides.ladderBands : []).forEach((item) => {
        const y = clamp(Math.round(item.pixelY), 0, runtime.currentImage.height - 1);
        const ladderLane = Number.isFinite(overrides.ladderLane)
          ? segmentationLanes.find((lane) => lane.index + 1 === overrides.ladderLane)
          : null;
        const labelSegment = ladderLane
          ? getLaneRowSegment(ladderLane, y, runtime.currentImage.height)
          : null;
        context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
        context.lineWidth = 1.2;
        if (ladderLane) {
          strokeLaneRowSegment(context, ladderLane, y);
        } else {
          context.beginPath();
          context.moveTo(0, y + 0.5);
          context.lineTo(runtime.currentImage.width, y + 0.5);
          context.stroke();
        }
        context.fillStyle = 'rgba(255, 197, 61, 0.98)';
        context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(
          `${round(item.mw, 1)}kDa`,
          labelSegment ? labelSegment.right.x + 3 : 4,
          labelSegment ? labelSegment.right.y - 3 : Math.max(10, y - 3)
        );
      });
      context.restore();
    }

    drawCellOverlays(context, overrides);

    if (runtime.currentReport?.lanes?.length) {
      runtime.currentReport.lanes.forEach((lane) => {
        const isLadder = (overrides.ladderLane === lane.laneIndex)
          || (runtime.currentReport.calibration?.ladderLane === lane.laneIndex);
        context.strokeStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.9)';
        context.lineWidth = isLadder ? 2.2 : 1.6;
        strokeLaneOutline(context, lane, runtime.currentImage.height);

        const labelSegment = getLaneRowSegment(lane, 0, runtime.currentImage.height);
        context.fillStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.95)';
        context.font = '12px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(String(lane.laneIndex), labelSegment.left.x + 2, Math.max(12, labelSegment.left.y + 12));

        lane.bands.forEach((band) => {
          context.strokeStyle = band.manual ? 'rgba(34, 197, 94, 0.98)' : 'rgba(255, 99, 132, 0.95)';
          context.lineWidth = 1.3;
          strokeLaneRowSegment(context, lane, band.pixelY);

          if (Number.isFinite(band.estimatedMw)) {
            const bandSegment = getLaneRowSegment(lane, band.pixelY, runtime.currentImage.height);
            context.fillStyle = band.manualMw ? 'rgba(34, 197, 94, 0.95)' : 'rgba(255, 99, 132, 0.92)';
            context.fillText(`${round(band.estimatedMw, 1)}kDa`, bandSegment.right.x + 3, bandSegment.right.y - 1);
          }
        });
      });
    }

    drawLaneVertexHandles(context, segmentationLanes);
    drawHoverLineOnCanvas(context);
  }

  function renderCanvas() {
    drawCanvas();
    deps.renderLaneTable?.();
    renderLaneProfile();
    renderCellTable();
  }

  function renderReport() {
    if (!elements.gelReportSummary || !elements.gelReportJson) {
      return;
    }

    if (!runtime.currentReport) {
      elements.gelReportSummary.innerHTML = '<p class="small-note">No analysis report yet.</p>';
      elements.gelReportJson.textContent = '';
      return;
    }

    const totalBands = (runtime.currentReport.lanes || []).reduce((sum, lane) => sum + (lane.bands?.length || 0), 0);
    const targetIntensities = (runtime.currentReport.lanes || [])
      .map((lane) => Number(lane.targetBandIntensity))
      .filter((value) => Number.isFinite(value));
    const averageTargetIntensity = targetIntensities.length
      ? round(mean(targetIntensities), 4)
      : null;
    const calibrationText = runtime.currentReport.calibration?.ok
      ? `R^2 ${runtime.currentReport.calibration.r2}`
      : 'Not calibrated';
    const enhancementText = `${runtime.currentReport.preprocessing?.denoiseStrength ?? '-'}% denoise / ${runtime.currentReport.preprocessing?.contrastBoost ?? '-'}% contrast`;
    const tiffPageText = runtime.currentReport.image?.tiffPageCount
      ? `${runtime.currentReport.image.tiffPage}/${runtime.currentReport.image.tiffPageCount}`
      : '-';
    elements.gelReportSummary.innerHTML = `
      <article class="card">
        <h3>${safeText(formatAnalysisTypeLabel(runtime.currentReport.analysisType))}</h3>
        <p><strong>Lanes:</strong> ${safeText(String(runtime.currentReport.lanes?.length || 0))}</p>
        <p><strong>Total Bands:</strong> ${safeText(String(totalBands))}</p>
        <p><strong>TIFF Page:</strong> ${safeText(String(tiffPageText))}</p>
        <p><strong>Calibration:</strong> ${safeText(calibrationText)}</p>
        <p><strong>Enhancement:</strong> ${safeText(enhancementText)}</p>
        <p><strong>Avg Target Intensity:</strong> ${safeText(String(averageTargetIntensity ?? '-'))}</p>
        <p><strong>Confidence:</strong> ${safeText(runtime.currentReport.confidence?.label || '-')} (${safeText(String(runtime.currentReport.confidence?.score ?? '-'))})</p>
      </article>
      <article class="card">
        <h3>Warnings</h3>
        <p>${safeText((runtime.currentReport.warnings || []).join(' | ') || 'None')}</p>
      </article>
    `;

    elements.gelReportJson.textContent = JSON.stringify(runtime.currentReport, null, 2);
  }

  return {
    onCanvasHoverLeave,
    onCanvasHoverMove,
    onLaneProfileChartMouseLeave,
    onLaneProfileChartMouseMove,
    renderCanvas,
    renderCellTable,
    renderLaneProfile,
    renderReport
  };
}
