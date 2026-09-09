import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { buildQuantificationSignal } from '../analysis/image-processing.js';
import {
  clamp,
  getLaneRectifiedWidth,
  getLaneRowSegment,
  getTargetBandWindowForLane,
  normalizeManualOverrides,
  sampleArrayValue
} from '../shared.js';
import { createCanvasDrawController } from './canvas-draw.js';
import { createPeakEditorController } from './peak-editor.js';
import { buildSmoothPath, downsampleLaneProfile } from './profile-shape.js';

export { calculatePeakIntegrationRows } from './peak-editor-svg.js';
export { selectViewerBaseImageData } from './canvas-draw.js';

const LANE_PROFILE_VIEWBOX = Object.freeze({
  width: 320,
  height: 190,
  plotLeft: 14,
  plotTop: 14,
  plotRight: 306,
  plotBottom: 164
});

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

  const values = rowMeans;

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
    ${highlightedBand}
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop + (plotHeight / 4)}" x2="${plotRight}" y2="${plotTop + (plotHeight / 4)}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop + (plotHeight / 2)}" x2="${plotRight}" y2="${plotTop + (plotHeight / 2)}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop + ((plotHeight * 3) / 4)}" x2="${plotRight}" y2="${plotTop + ((plotHeight * 3) / 4)}" />
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

export function createRenderingController({ runtime, elements, safeText, deps = {} }) {
  function renderLaneProfile() {
    if (
      !elements.gelLaneProfilePanel
      || !elements.gelLaneProfileSelect
      || !elements.gelLaneProfileChart
    ) {
      return;
    }

    elements.gelLaneProfilePanel.hidden = !runtime.currentImage;

    if (!runtime.currentImage) {
      runtime.selectedLaneProfileLane = null;
      elements.gelLaneProfileSelect.disabled = true;
      elements.gelLaneProfileSelect.innerHTML = '<option value="">Select lane</option>';
      renderLaneProfilePlaceholder(elements.gelLaneProfileChart, 'Lane profile appears here after you divide the gel into lanes.');
      return;
    }

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const lanes = getLaneProfileLanes(runtime);

    if (!lanes.length) {
      runtime.selectedLaneProfileLane = null;
      elements.gelLaneProfileSelect.disabled = true;
      elements.gelLaneProfileSelect.innerHTML = '<option value="">Select lane</option>';
      renderLaneProfilePlaceholder(elements.gelLaneProfileChart, 'Set the lane dividers first.');
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

    const { signal } = buildQuantificationSignal(runtime.currentImage.gray);
    const profile = signal ? computeLaneIntensityProfile({
      signal,
      width: runtime.currentImage.width,
      height: runtime.currentImage.height,
      lane: selectedLane
    }) : null;

    if (!profile) {
      renderLaneProfilePlaceholder(elements.gelLaneProfileChart, 'Lane profile unavailable.');
      return;
    }

    const selectedBandWindow = getTargetBandWindowForLane(overrides.laneSegmentation, selectedLane.laneIndex);
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

  let canvasDrawController = null;
  const peakEditorController = createPeakEditorController({
    runtime,
    elements,
    safeText,
    deps,
    computeLaneIntensityProfile,
    drawCanvas: () => canvasDrawController?.drawCanvas(),
    getLaneProfileLanes: () => getLaneProfileLanes(runtime),
    renderLaneProfile
  });
  canvasDrawController = createCanvasDrawController({
    runtime,
    elements,
    safeText,
    deps,
    clearLaneProfileHover,
    getLaneProfileLanes: () => getLaneProfileLanes(runtime),
    getLastProfile: () => lastProfile,
    getLastProfileLane: () => lastProfileLane,
    laneProfileViewbox: LANE_PROFILE_VIEWBOX,
    renderLaneProfile,
    renderPeakEditor: peakEditorController.renderPeakEditor,
    setLaneProfileHover
  });

  const {
    onPeakEditorChartClick,
    onPeakEditorChartMouseLeave,
    onPeakEditorChartMouseMove,
    onPeakEditorClearAll,
    onPeakEditorClearLane,
    onPeakEditorClose,
    onPeakEditorLaneChange,
    onPeakEditorModeSelected,
    onPeakEditorOpen,
    renderPeakEditor
  } = peakEditorController;
  const {
    onCanvasHoverLeave,
    onCanvasHoverMove,
    onLaneProfileChartMouseLeave,
    onLaneProfileChartMouseMove,
    renderCanvas,
    renderCellTable
  } = canvasDrawController;

  function onCellTableOpen() {
    if (elements.gelOpenCellTableBtn?.disabled) {
      deps.setStatus?.('Measure a target band before opening the band intensity report.');
      return;
    }
    runtime.cellTableDialogOpen = true;
    renderCellTable();
    elements.gelCellTableCloseBtn?.focus?.();
  }

  function onCellTableClose() {
    if (!runtime.cellTableDialogOpen) {
      return;
    }
    runtime.cellTableDialogOpen = false;
    renderCellTable();
    elements.gelOpenCellTableBtn?.focus?.();
  }

  function onCellTableOverlayClick(event) {
    if (event?.target === elements.gelCellTableOverlay) {
      onCellTableClose();
    }
  }

  function onCellTableKeyDown(event) {
    if (event?.key !== 'Escape') {
      return;
    }
    if (runtime.cellTableDialogOpen) {
      event.preventDefault?.();
      onCellTableClose();
    }
  }

  return {
    onCanvasHoverLeave,
    onCellTableClose,
    onCellTableKeyDown,
    onCellTableOpen,
    onCellTableOverlayClick,
    onCanvasHoverMove,
    onLaneProfileChartMouseLeave,
    onLaneProfileChartMouseMove,
    onPeakEditorChartClick,
    onPeakEditorChartMouseLeave,
    onPeakEditorChartMouseMove,
    onPeakEditorClearAll,
    onPeakEditorClearLane,
    onPeakEditorClose,
    onPeakEditorLaneChange,
    onPeakEditorModeSelected,
    onPeakEditorOpen,
    renderCanvas,
    renderCellTable,
    renderLaneProfile,
    renderPeakEditor
  };
}
