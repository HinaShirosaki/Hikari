import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { buildQuantificationSignal } from '../analysis/image-processing.js';
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
  round,
  sampleArrayValue
} from '../shared.js';
import { formatAnalysisTypeLabel } from './presentation.js';

const LANE_PROFILE_VIEWBOX = Object.freeze({
  width: 320,
  height: 190,
  plotLeft: 14,
  plotTop: 14,
  plotRight: 306,
  plotBottom: 164
});

const PEAK_EDITOR_VIEWBOX = Object.freeze({
  width: 920,
  height: 440,
  plotLeft: 58,
  plotTop: 28,
  plotRight: 884,
  plotBottom: 372
});

const PEAK_EDITOR_COLUMNS = Object.freeze([
  { title: 'Lane', field: 'laneIndex', hozAlign: 'right', width: 72 },
  { title: 'Baseline', field: 'baselineIndex', hozAlign: 'right', width: 96 },
  { title: 'Peak', field: 'peakIndex', hozAlign: 'right', width: 72 },
  { title: 'Start row', field: 'startRow', hozAlign: 'right' },
  { title: 'End row', field: 'endRow', hozAlign: 'right' },
  { title: 'Apex row', field: 'apexRow', hozAlign: 'right' },
  { title: 'Apex signal', field: 'apexValue', hozAlign: 'right' },
  { title: 'Area', field: 'area', hozAlign: 'right' },
  { title: 'Raw area', field: 'rawArea', hozAlign: 'right' },
  { title: 'Baseline area', field: 'baselineArea', hozAlign: 'right' }
]);

export function selectViewerBaseImageData(currentImage, preprocessed = null, viewerMode = 'original') {
  if (viewerMode === 'processed' && preprocessed?.previewImageData) {
    return preprocessed.previewImageData;
  }
  return currentImage?.imageData || null;
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

function getProfileValueAtRow(profile, row) {
  if (!profile?.values?.length) {
    return 0;
  }
  const safeRow = clamp(Math.round(Number(row) || 0), 0, profile.values.length - 1);
  return Number(profile.values[safeRow]) || 0;
}

function makeProfilePoint(profile, row) {
  const safeRow = clamp(Math.round(Number(row) || 0), 0, Math.max(0, (profile?.values?.length || 1) - 1));
  return {
    row: safeRow,
    value: getProfileValueAtRow(profile, safeRow)
  };
}

function formatTableNumber(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-';
}

export function calculatePeakIntegrationRows(profile, integrations = []) {
  if (!profile?.values?.length || !Array.isArray(integrations)) {
    return [];
  }

  const rowMax = profile.values.length - 1;
  const rows = [];
  integrations.forEach((integration, integrationIndex) => {
    if (!integration?.left || !integration?.right) {
      return;
    }

    const laneIndex = Math.max(1, Math.floor(Number(integration.laneIndex) || 1));
    const left = makeProfilePoint(profile, integration.left.row);
    const right = makeProfilePoint(profile, integration.right.row);
    const start = Math.min(left.row, right.row);
    const end = Math.max(left.row, right.row);
    if (end <= start) {
      return;
    }

    const startValue = left.row <= right.row ? left.value : right.value;
    const endValue = left.row <= right.row ? right.value : left.value;
    const dividerRows = (Array.isArray(integration.dividers) ? integration.dividers : [])
      .map((divider) => clamp(Math.round(Number(divider) || 0), 0, rowMax))
      .filter((divider) => divider > start && divider < end)
      .sort((a, b) => a - b)
      .filter((divider, index, all) => index === 0 || divider !== all[index - 1]);
    const boundaries = [start, ...dividerRows, end];

    for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
      const segmentStart = boundaryIndex === 0 ? boundaries[boundaryIndex] : boundaries[boundaryIndex] + 1;
      const segmentEnd = boundaries[boundaryIndex + 1];
      if (segmentStart > segmentEnd) {
        continue;
      }
      let area = 0;
      let rawArea = 0;
      let baselineArea = 0;
      let apexRow = segmentStart;
      let apexValue = Number.NEGATIVE_INFINITY;

      for (let row = segmentStart; row <= segmentEnd; row += 1) {
        const fraction = (row - start) / Math.max(1, end - start);
        const baselineValue = startValue + ((endValue - startValue) * fraction);
        const signalValue = getProfileValueAtRow(profile, row);
        rawArea += signalValue;
        baselineArea += baselineValue;
        area += Math.max(0, signalValue - baselineValue);
        if (signalValue > apexValue) {
          apexValue = signalValue;
          apexRow = row;
        }
      }

      rows.push({
        laneIndex,
        baselineIndex: integrationIndex + 1,
        peakIndex: boundaryIndex + 1,
        startRow: segmentStart,
        endRow: segmentEnd,
        apexRow,
        apexValue: round(apexValue, 4),
        area: round(area, 4),
        rawArea: round(rawArea, 4),
        baselineArea: round(baselineArea, 4)
      });
    }
  });

  return rows;
}

function downsampleLaneProfile(values, maxPoints = 220) {
  if (!values.length) {
    return [];
  }

  const targetCount = Math.min(maxPoints, values.length);
  if (targetCount === values.length) {
    return Array.from(values, (value, row) => ({ row, value: Number(value) || 0 }));
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

function getPeakEditorProfilePoints(values) {
  const exactPointLimit = 12000;
  if (!values?.length) {
    return [];
  }
  if (values.length <= exactPointLimit) {
    return Array.from(values, (value, row) => ({ row, value: Number(value) || 0 }));
  }
  return downsampleLaneProfile(values, exactPointLimit);
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

function buildLinearPath(points) {
  if (!points.length) {
    return '';
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
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

function getPeakEditorScales(profile) {
  const {
    plotLeft,
    plotTop,
    plotRight,
    plotBottom
  } = PEAK_EDITOR_VIEWBOX;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const rowMax = Math.max(1, (profile?.values?.length || 1) - 1);
  const valueSpan = Math.max(1e-6, (profile?.maxValue || 0) - (profile?.minValue || 0));
  return {
    rowMax,
    rowToX: (row) => plotLeft + ((clamp(row, 0, rowMax) / rowMax) * plotWidth),
    valueToY: (value) => plotBottom - ((((Number(value) || 0) - (profile?.minValue || 0)) / valueSpan) * plotHeight),
    xToRow: (x) => clamp(Math.round(((x - plotLeft) / Math.max(1, plotWidth)) * rowMax), 0, rowMax)
  };
}

function getPeakEditorSvgXFromEvent(svg, event) {
  const clientX = Number(event?.clientX);
  if (!Number.isFinite(clientX)) {
    return null;
  }

  const rect = svg?.getBoundingClientRect?.();
  if (rect?.width && rect?.height) {
    const preserveAspectRatio = String(svg?.getAttribute?.('preserveAspectRatio') || '');
    if (preserveAspectRatio.includes('none')) {
      return ((clientX - rect.left) / rect.width) * PEAK_EDITOR_VIEWBOX.width;
    }

    const scale = Math.min(
      rect.width / PEAK_EDITOR_VIEWBOX.width,
      rect.height / PEAK_EDITOR_VIEWBOX.height
    );
    if (Number.isFinite(scale) && scale > 0) {
      const renderedWidth = PEAK_EDITOR_VIEWBOX.width * scale;
      const offsetX = (rect.width - renderedWidth) / 2;
      return (clientX - rect.left - offsetX) / scale;
    }
  }

  if (typeof svg?.createSVGPoint === 'function' && typeof svg?.getScreenCTM === 'function') {
    try {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = Number.isFinite(Number(event?.clientY)) ? Number(event.clientY) : 0;
      const matrix = svg.getScreenCTM();
      const inverse = typeof matrix?.inverse === 'function' ? matrix.inverse() : null;
      const transformed = inverse ? point.matrixTransform(inverse) : null;
      if (Number.isFinite(transformed?.x)) {
        return transformed.x;
      }
    } catch {
      // Fall through when a browser cannot provide a usable SVG transform.
    }
  }

  return null;
}

function renderPeakEditorPlaceholder(svg, message) {
  const {
    width,
    height,
    plotLeft,
    plotTop,
    plotRight,
    plotBottom
  } = PEAK_EDITOR_VIEWBOX;
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect class="peak-editor-frame" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" />
    <text class="peak-editor-empty" x="${width / 2}" y="${height / 2}" text-anchor="middle">${message}</text>
  `;
}

function buildPeakAreaPath(profile, integration, startRow, endRow, scales) {
  const baselineStart = makeProfilePoint(profile, integration.left.row);
  const baselineEnd = makeProfilePoint(profile, integration.right.row);
  const left = baselineStart.row <= baselineEnd.row ? baselineStart : baselineEnd;
  const right = baselineStart.row <= baselineEnd.row ? baselineEnd : baselineStart;
  const step = Math.max(1, Math.ceil((endRow - startRow) / 180));
  const points = [];
  for (let row = startRow; row <= endRow; row += step) {
    points.push({
      row,
      value: getProfileValueAtRow(profile, row)
    });
  }
  if (points[points.length - 1]?.row !== endRow) {
    points.push({
      row: endRow,
      value: getProfileValueAtRow(profile, endRow)
    });
  }
  const baselineValueAt = (row) => {
    const fraction = (row - left.row) / Math.max(1, right.row - left.row);
    return left.value + ((right.value - left.value) * fraction);
  };
  const curvePath = points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L';
      return `${command} ${scales.rowToX(point.row)} ${scales.valueToY(point.value)}`;
    })
    .join(' ');
  return `${curvePath} L ${scales.rowToX(endRow)} ${scales.valueToY(baselineValueAt(endRow))} L ${scales.rowToX(startRow)} ${scales.valueToY(baselineValueAt(startRow))} Z`;
}

function renderPeakEditorSvg(svg, profile, integrations = [], hoverRow = null, mode = 'baseline') {
  const {
    width,
    height,
    plotLeft,
    plotTop,
    plotRight,
    plotBottom
  } = PEAK_EDITOR_VIEWBOX;
  if (!profile) {
    renderPeakEditorPlaceholder(svg, 'Select a lane to edit peak areas.');
    return;
  }

  const scales = getPeakEditorScales(profile);
  const points = getPeakEditorProfilePoints(profile.values).map((point) => ({
    x: scales.rowToX(point.row),
    y: scales.valueToY(point.value)
  }));
  const path = buildLinearPath(points);
  const peakX = scales.rowToX(profile.peakRow);
  const peakY = scales.valueToY(profile.peakValue);

  const areaMarkup = [];
  const overlayMarkup = [];
  let hoverMarkup = '';
  integrations.forEach((integration, integrationIndex) => {
    if (!integration?.left) {
      return;
    }
    const leftPoint = makeProfilePoint(profile, integration.left.row);
    const rightPoint = integration.right ? makeProfilePoint(profile, integration.right.row) : null;
    const leftX = scales.rowToX(leftPoint.row);
    const leftY = scales.valueToY(leftPoint.value);
    const rightX = rightPoint ? scales.rowToX(rightPoint.row) : null;
    const rightY = rightPoint ? scales.valueToY(rightPoint.value) : null;
    const baselineLabel = integrationIndex + 1;

    if (rightPoint && rightPoint.row !== leftPoint.row) {
      const start = Math.min(leftPoint.row, rightPoint.row);
      const end = Math.max(leftPoint.row, rightPoint.row);
      const dividers = (Array.isArray(integration.dividers) ? integration.dividers : [])
        .map((divider) => clamp(Math.round(Number(divider) || 0), 0, scales.rowMax))
        .filter((divider) => divider > start && divider < end)
        .sort((a, b) => a - b)
        .filter((divider, index, all) => index === 0 || divider !== all[index - 1]);
      const boundaries = [start, ...dividers, end];
      boundaries.slice(0, -1).forEach((boundary, boundaryIndex) => {
        const segmentEnd = boundaries[boundaryIndex + 1];
        areaMarkup.push(`<path class="peak-editor-area" d="${buildPeakAreaPath(profile, integration, boundary, segmentEnd, scales)}" />`);
      });
      dividers.forEach((divider) => {
        const dividerX = scales.rowToX(divider);
        overlayMarkup.push(`<line class="peak-editor-divider" x1="${dividerX}" y1="${plotTop}" x2="${dividerX}" y2="${plotBottom}" />`);
        overlayMarkup.push(`<text class="peak-editor-divider-label" x="${dividerX}" y="${plotTop - 8}" text-anchor="middle">${divider}</text>`);
      });
      overlayMarkup.push(`<line class="peak-editor-baseline" x1="${leftX}" y1="${leftY}" x2="${rightX}" y2="${rightY}" />`);
      overlayMarkup.push(`<text class="peak-editor-baseline-label" x="${(leftX + rightX) / 2}" y="${Math.min(leftY, rightY) - 8}" text-anchor="middle">B${baselineLabel}</text>`);
    }

    overlayMarkup.push(`<circle class="peak-editor-baseline-dot" cx="${leftX}" cy="${leftY}" r="6" />`);
    if (rightPoint) {
      overlayMarkup.push(`<circle class="peak-editor-baseline-dot" cx="${rightX}" cy="${rightY}" r="6" />`);
    }
  });

  if (mode === 'baseline' && hoverRow !== null && hoverRow !== undefined && Number.isFinite(Number(hoverRow))) {
    const hoverPoint = makeProfilePoint(profile, hoverRow);
    const hoverX = scales.rowToX(hoverPoint.row);
    const hoverY = scales.valueToY(hoverPoint.value);
    hoverMarkup = `
      <g class="peak-editor-hover">
        <circle class="peak-editor-hover-dot" cx="${hoverX}" cy="${hoverY}" r="7" />
        <text class="peak-editor-hover-label" x="${hoverX}" y="${Math.max(plotTop + 14, hoverY - 12)}" text-anchor="middle">${hoverPoint.row}</text>
      </g>
    `;
  }

  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect class="peak-editor-frame" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotTop + ((plotBottom - plotTop) / 4)}" x2="${plotRight}" y2="${plotTop + ((plotBottom - plotTop) / 4)}" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotTop + ((plotBottom - plotTop) / 2)}" x2="${plotRight}" y2="${plotTop + ((plotBottom - plotTop) / 2)}" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotTop + (((plotBottom - plotTop) * 3) / 4)}" x2="${plotRight}" y2="${plotTop + (((plotBottom - plotTop) * 3) / 4)}" />
    ${areaMarkup.join('')}
    <path class="peak-editor-path-shadow" d="${path}" />
    <path class="peak-editor-path" d="${path}" />
    <circle class="peak-editor-apex" cx="${peakX}" cy="${peakY}" r="5" />
    ${overlayMarkup.join('')}
    ${hoverMarkup}
    <text class="peak-editor-axis-label" x="${plotLeft}" y="${height - 22}">Top</text>
    <text class="peak-editor-axis-label" x="${plotRight}" y="${height - 22}" text-anchor="end">Bottom</text>
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

  function ensurePeakEditorState() {
    runtime.peakEditor = {
      open: false,
      mode: 'baseline',
      laneIndex: runtime.selectedLaneProfileLane || null,
      ...(runtime.peakEditor || {})
    };
    if (runtime.peakEditor.mode !== 'divider') {
      runtime.peakEditor.mode = 'baseline';
    }
    return runtime.peakEditor;
  }

  function setPeakEditorStatus(message) {
    if (elements.gelPeakEditorSummary) {
      elements.gelPeakEditorSummary.textContent = message || '';
    }
  }

  function computeProfileForLane(lane) {
    if (!runtime.currentImage || !lane) {
      return null;
    }
    const { signal } = buildQuantificationSignal(runtime.currentImage.gray);
    return signal ? computeLaneIntensityProfile({
      signal,
      width: runtime.currentImage.width,
      height: runtime.currentImage.height,
      lane
    }) : null;
  }

  function getSelectedPeakEditorLane(lanes = getLaneProfileLanes(runtime)) {
    const state = ensurePeakEditorState();
    if (!lanes.length) {
      state.laneIndex = null;
      return null;
    }
    const preferredLane = Number(state.laneIndex || runtime.selectedLaneProfileLane);
    const selected = lanes.find((lane) => lane.laneIndex === preferredLane) || lanes[0];
    state.laneIndex = selected.laneIndex;
    runtime.selectedLaneProfileLane = selected.laneIndex;
    return selected;
  }

  function getPeakIntegrationsForLane(laneIndex) {
    return normalizeManualOverrides(runtime.manualOverrides).peakIntegrations
      .filter((integration) => integration.laneIndex === laneIndex);
  }

  function setPeakIntegrations(integrations) {
    runtime.manualOverrides = {
      ...normalizeManualOverrides(runtime.manualOverrides),
      peakIntegrations: integrations
    };
  }

  function getPeakEditorRowFromEvent(event, profile) {
    const rowMax = Math.max(0, (profile?.values?.length || 1) - 1);
    if (Number.isFinite(Number(event?.row))) {
      return clamp(Math.round(Number(event.row)), 0, rowMax);
    }
    const svg = elements.gelPeakEditorChart;
    const svgX = getPeakEditorSvgXFromEvent(svg, event);
    if (!Number.isFinite(svgX)) {
      return null;
    }
    return clamp(getPeakEditorScales(profile).xToRow(svgX), 0, rowMax);
  }

  function getAllPeakIntegrationRows() {
    const lanes = getLaneProfileLanes(runtime);
    if (!lanes.length) {
      return [];
    }
    const integrations = normalizeManualOverrides(runtime.manualOverrides).peakIntegrations;
    return lanes.flatMap((lane) => {
      const profile = computeProfileForLane(lane);
      if (!profile) {
        return [];
      }
      return calculatePeakIntegrationRows(
        profile,
        integrations.filter((integration) => integration.laneIndex === lane.laneIndex)
      );
    });
  }

  function renderPeakEditorChartOnly(nextHoverRow) {
    if (!elements.gelPeakEditorChart) {
      return;
    }
    const hasHoverOverride = arguments.length > 0;
    const state = ensurePeakEditorState();
    if (!state.open) {
      return;
    }
    const lanes = getLaneProfileLanes(runtime);
    const selectedLane = getSelectedPeakEditorLane(lanes);
    const profile = selectedLane ? computeProfileForLane(selectedLane) : null;
    const laneIntegrations = selectedLane ? getPeakIntegrationsForLane(selectedLane.laneIndex) : [];
    renderPeakEditorSvg(
      elements.gelPeakEditorChart,
      profile,
      laneIntegrations,
      hasHoverOverride ? nextHoverRow : state.hoverRow,
      state.mode
    );
  }

  function renderPeakIntegrationTable(rows) {
    const host = elements.gelPeakEditorTable;
    if (!host) {
      return;
    }

    const tableRows = rows.map((row) => ({
      ...row,
      apexValue: formatTableNumber(row.apexValue),
      area: formatTableNumber(row.area),
      rawArea: formatTableNumber(row.rawArea),
      baselineArea: formatTableNumber(row.baselineArea)
    }));

    if (typeof window !== 'undefined' && typeof window.Tabulator === 'function') {
      if (!runtime.peakIntegrationTable) {
        runtime.peakIntegrationTable = new window.Tabulator(host, {
          data: tableRows,
          columns: PEAK_EDITOR_COLUMNS,
          layout: 'fitColumns',
          height: '260px',
          placeholder: 'No peak areas selected'
        });
      } else if (typeof runtime.peakIntegrationTable.setData === 'function') {
        runtime.peakIntegrationTable.setData(tableRows);
      }
      return;
    }

    const rowsHtml = tableRows.map((row) => `
      <tr>
        <td class="num">${safeText(row.laneIndex)}</td>
        <td class="num">${safeText(row.baselineIndex)}</td>
        <td class="num">${safeText(row.peakIndex)}</td>
        <td class="num">${safeText(row.startRow)}</td>
        <td class="num">${safeText(row.endRow)}</td>
        <td class="num">${safeText(row.apexRow)}</td>
        <td class="num">${safeText(row.apexValue)}</td>
        <td class="num">${safeText(row.area)}</td>
        <td class="num">${safeText(row.rawArea)}</td>
        <td class="num">${safeText(row.baselineArea)}</td>
      </tr>
    `).join('');
    host.innerHTML = `
      <table class="gel-peak-table">
        <thead>
          <tr>
            ${PEAK_EDITOR_COLUMNS.map((column) => `<th>${safeText(column.title)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${rowsHtml || '<tr><td colspan="10">No peak areas selected</td></tr>'}</tbody>
      </table>
    `;
  }

  function renderPeakEditor() {
    const overlay = elements.gelPeakEditorOverlay;
    if (!overlay) {
      return;
    }

    const state = ensurePeakEditorState();
    overlay.hidden = !state.open;
    if (!state.open) {
      return;
    }

    const lanes = getLaneProfileLanes(runtime);
    const selectedLane = getSelectedPeakEditorLane(lanes);
    if (elements.gelPeakEditorLaneSelect) {
      elements.gelPeakEditorLaneSelect.disabled = !lanes.length;
      elements.gelPeakEditorLaneSelect.innerHTML = lanes.length
        ? lanes.map((lane) => `<option value="${lane.laneIndex}">Lane ${lane.laneIndex}</option>`).join('')
        : '<option value="">No lanes</option>';
      elements.gelPeakEditorLaneSelect.value = selectedLane ? String(selectedLane.laneIndex) : '';
    }
    if (elements.gelPeakEditorBaselineModeBtn) {
      elements.gelPeakEditorBaselineModeBtn.classList.toggle('is-active', state.mode === 'baseline');
      elements.gelPeakEditorBaselineModeBtn.setAttribute?.('aria-pressed', String(state.mode === 'baseline'));
    }
    if (elements.gelPeakEditorDividerModeBtn) {
      elements.gelPeakEditorDividerModeBtn.classList.toggle('is-active', state.mode === 'divider');
      elements.gelPeakEditorDividerModeBtn.setAttribute?.('aria-pressed', String(state.mode === 'divider'));
    }

    const profile = selectedLane ? computeProfileForLane(selectedLane) : null;
    const laneIntegrations = selectedLane ? getPeakIntegrationsForLane(selectedLane.laneIndex) : [];
    if (elements.gelPeakEditorChart) {
      renderPeakEditorSvg(
        elements.gelPeakEditorChart,
        profile,
        laneIntegrations,
        state.hoverRow,
        state.mode
      );
    }

    const rows = getAllPeakIntegrationRows();
    renderPeakIntegrationTable(rows);
    const completeBaselines = laneIntegrations.filter((integration) => integration.left && integration.right).length;
    const draftBaselines = laneIntegrations.filter((integration) => integration.left && !integration.right).length;
    setPeakEditorStatus(selectedLane
      ? `Lane ${selectedLane.laneIndex}: ${completeBaselines} baseline(s), ${draftBaselines} draft, ${rows.length} peak area row(s).`
      : 'Divide the gel into lanes before editing peak areas.');
  }

  function onPeakEditorOpen() {
    if (!runtime.currentImage) {
      deps.setStatus?.('Load a gel image before opening the peak editor.');
      return;
    }
    const state = ensurePeakEditorState();
    state.open = true;
    state.laneIndex = runtime.selectedLaneProfileLane || state.laneIndex;
    renderPeakEditor();
  }

  function onPeakEditorClose() {
    const state = ensurePeakEditorState();
    state.open = false;
    state.hoverRow = null;
    renderPeakEditor();
  }

  function onPeakEditorModeSelected(mode) {
    const state = ensurePeakEditorState();
    state.mode = mode === 'divider' ? 'divider' : 'baseline';
    if (state.mode !== 'baseline') {
      state.hoverRow = null;
    }
    renderPeakEditor();
  }

  function onPeakEditorLaneChange(event) {
    const nextLane = Number(event?.target?.value);
    const state = ensurePeakEditorState();
    state.laneIndex = Number.isFinite(nextLane) && nextLane > 0 ? Math.floor(nextLane) : null;
    state.hoverRow = null;
    runtime.selectedLaneProfileLane = state.laneIndex;
    runtime.laneProfileHoverY = null;
    renderLaneProfile();
    renderPeakEditor();
    drawCanvas();
  }

  function onPeakEditorChartClick(event) {
    const lanes = getLaneProfileLanes(runtime);
    const selectedLane = getSelectedPeakEditorLane(lanes);
    const profile = selectedLane ? computeProfileForLane(selectedLane) : null;
    if (!selectedLane || !profile) {
      setPeakEditorStatus('Divide the gel into lanes before editing peak areas.');
      return;
    }

    const row = getPeakEditorRowFromEvent(event, profile);
    if (!Number.isFinite(row)) {
      return;
    }

    const point = makeProfilePoint(profile, row);
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const nextIntegrations = overrides.peakIntegrations.map((integration) => ({
      ...integration,
      dividers: [...(integration.dividers || [])]
    }));
    const state = ensurePeakEditorState();

    if (state.mode === 'divider') {
      const candidates = nextIntegrations
        .map((integration, index) => ({ integration, index }))
        .filter(({ integration }) => {
          if (integration.laneIndex !== selectedLane.laneIndex || !integration.left || !integration.right) {
            return false;
          }
          const start = Math.min(integration.left.row, integration.right.row);
          const end = Math.max(integration.left.row, integration.right.row);
          return row > start && row < end;
        })
        .sort((a, b) => {
          const aSpan = Math.abs(a.integration.right.row - a.integration.left.row);
          const bSpan = Math.abs(b.integration.right.row - b.integration.left.row);
          return aSpan - bSpan;
        });
      const target = candidates[0];
      if (!target) {
        setPeakEditorStatus('Add a complete baseline before adding vertical peak dividers.');
        return;
      }
      const dividers = new Set(target.integration.dividers || []);
      dividers.add(point.row);
      nextIntegrations[target.index] = {
        ...target.integration,
        dividers: [...dividers].sort((a, b) => a - b)
      };
      setPeakIntegrations(nextIntegrations);
      renderPeakEditor();
      return;
    }

    const draftIndex = nextIntegrations.findIndex((integration) => (
      integration.laneIndex === selectedLane.laneIndex
      && integration.left
      && !integration.right
    ));
    if (draftIndex >= 0) {
      if (nextIntegrations[draftIndex].left.row === point.row) {
        setPeakEditorStatus('Choose a second baseline point at a different row.');
        return;
      }
      nextIntegrations[draftIndex] = {
        ...nextIntegrations[draftIndex],
        right: point
      };
    } else {
      nextIntegrations.push({
        laneIndex: selectedLane.laneIndex,
        left: point,
        right: null,
        dividers: []
      });
    }
    setPeakIntegrations(nextIntegrations);
    renderPeakEditor();
  }

  function onPeakEditorChartMouseMove(event) {
    const state = ensurePeakEditorState();
    if (!state.open || state.mode !== 'baseline') {
      return;
    }
    const lanes = getLaneProfileLanes(runtime);
    const selectedLane = getSelectedPeakEditorLane(lanes);
    const profile = selectedLane ? computeProfileForLane(selectedLane) : null;
    if (!profile) {
      return;
    }
    const row = getPeakEditorRowFromEvent(event, profile);
    if (!Number.isFinite(row)) {
      return;
    }
    if (state.hoverRow === row) {
      return;
    }
    state.hoverRow = row;
    renderPeakEditorChartOnly(row);
  }

  function onPeakEditorChartMouseLeave() {
    const state = ensurePeakEditorState();
    if (!state.open) {
      return;
    }
    state.hoverRow = null;
    renderPeakEditorChartOnly(null);
  }

  function onPeakEditorClearLane() {
    const selectedLane = getSelectedPeakEditorLane();
    if (!selectedLane) {
      return;
    }
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    setPeakIntegrations(overrides.peakIntegrations.filter((integration) => integration.laneIndex !== selectedLane.laneIndex));
    renderPeakEditor();
  }

  function onPeakEditorClearAll() {
    setPeakIntegrations([]);
    renderPeakEditor();
  }

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

  function drawLaneVertexHandles(context, lanes, savedLaneVertices = []) {
    const vertexToolActive = runtime.selectedViewerTool === 'lane-vertices';
    const savedLaneIndexes = new Set(
      (Array.isArray(savedLaneVertices) ? savedLaneVertices : [])
        .map((item) => Number(item?.laneIndex))
        .filter(Number.isFinite)
    );
    const outlineLanes = vertexToolActive
      ? lanes
      : lanes.filter((lane) => savedLaneIndexes.has(lane.index + 1));
    if (!outlineLanes.length) {
      return;
    }
    context.save();
    context.lineWidth = 1.7;
    context.strokeStyle = 'rgba(14, 165, 233, 0.95)';
    context.setLineDash([5, 3]);
    outlineLanes.forEach((lane) => {
      strokeLaneOutline(context, lane, runtime.currentImage.height);
    });
    if (!vertexToolActive) {
      context.restore();
      return;
    }
    context.setLineDash([]);
    context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
    outlineLanes.forEach((lane) => {
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

    drawLaneVertexHandles(context, segmentationLanes, segmentation.laneVertices);
    drawHoverLineOnCanvas(context);
  }

  function renderCanvas() {
    drawCanvas();
    deps.renderLaneTable?.();
    renderLaneProfile();
    renderCellTable();
    renderPeakEditor();
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
    renderPeakEditor,
    renderReport
  };
}
