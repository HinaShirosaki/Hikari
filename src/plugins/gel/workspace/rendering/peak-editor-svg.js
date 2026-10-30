import { createPresentation } from "../../i18n.mjs";
import "../../i18n.mjs";
const i18nUi = createPresentation("gel");
import { clamp, round } from '../shared.js';
import {
  buildLinearPath,
  downsampleLaneProfile,
  getProfileValueAtRow,
  makeProfilePoint
} from './profile-shape.js';

// The peak-integration editor's SVG: its scales, the shaded area under each peak,
// and the areas those shapes work out to.
const PEAK_EDITOR_VIEWBOX = Object.freeze({
  width: 920,
  height: 440,
  plotLeft: 16,
  plotTop: 20,
  plotRight: 904,
  plotBottom: 408
});

const PEAK_EDITOR_COLUMNS = Object.freeze([
  { title: 'Lane', field: 'laneIndex', hozAlign: 'right', width: 84, minWidth: 84 },
  { title: 'Baseline', field: 'baselineIndex', hozAlign: 'right', width: 124, minWidth: 124 },
  { title: 'Band', field: 'peakIndex', hozAlign: 'right', width: 84, minWidth: 84 },
  { title: 'Band area', field: 'area', hozAlign: 'right', minWidth: 124 },
  { title: 'Peak signal', field: 'apexValue', hozAlign: 'right', minWidth: 112 },
  { title: 'Raw area', field: 'rawArea', hozAlign: 'right', minWidth: 124 },
  { title: 'Baseline area', field: 'baselineArea', hozAlign: 'right', minWidth: 124 }
]);

function calculatePeakIntegrationRows(profile, integrations = []) {
  if (!profile?.values?.length || !Array.isArray(integrations)) {
    return [];
  }

  const rowMax = profile.values.length - 1;
  // Profile values are per-row means across the lane; areas are sums over its
  // pixels, so the same band reads the same in a narrow lane and a wide one.
  const laneWidth = profile.laneWidth || 1;
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
        area: round(area * laneWidth, 4),
        rawArea: round(rawArea * laneWidth, 4),
        baselineArea: round(baselineArea * laneWidth, 4)
      });
    }
  });

  return rows;
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

// One SVG unit is one displayed CSS pixel. Curves, overlays, labels and pointer
// sampling share these bounds even when the floating window changes shape.
function getPeakEditorLayout(svg, measured = false) {
  const rect = measured ? svg?.getBoundingClientRect?.() : null;
  const viewBox = String(svg?.getAttribute?.('viewBox') || '').trim().split(/\s+/).map(Number);
  const width = rect?.width > 0 ? rect.width : !measured && viewBox[2] > 0 ? viewBox[2] : PEAK_EDITOR_VIEWBOX.width;
  const height = rect?.height > 0 ? rect.height : !measured && viewBox[3] > 0 ? viewBox[3] : PEAK_EDITOR_VIEWBOX.height;
  const side = Math.min(16, width / 4);
  return { width, height, plotLeft: side, plotRight: width - side,
    plotTop: Math.min(20, height / 4), plotBottom: height - Math.min(32, height / 3) };
}

function getPeakEditorScales(profile, svg = null) {
  const {
    plotLeft,
    plotTop,
    plotRight,
    plotBottom
  } = getPeakEditorLayout(svg);
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
  const { width, height } = getPeakEditorLayout(svg);
  if (rect?.width && rect?.height) {
    const preserveAspectRatio = String(svg?.getAttribute?.('preserveAspectRatio') || '');
    if (preserveAspectRatio.includes('none')) {
      return ((clientX - rect.left) / rect.width) * width;
    }

    const scale = Math.min(
      rect.width / width,
      rect.height / height
    );
    if (Number.isFinite(scale) && scale > 0) {
      const renderedWidth = width * scale;
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

function renderPeakEditorPlaceholder(svg) {
  const {
    width,
    height,
    plotLeft,
    plotRight,
    plotBottom
  } = getPeakEditorLayout(svg, true);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  i18nUi.setHtml(svg, `
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" />
  `);
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

function renderPeakEditorSvg(svg, profile, integrations = [], hoverRow = null, mode = 'baseline', measurement = null) {
  const {
    width,
    height,
    plotLeft,
    plotTop,
    plotRight,
    plotBottom
  } = getPeakEditorLayout(svg, true);
  if (!profile) {
    renderPeakEditorPlaceholder(svg);
    return;
  }

  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const scales = getPeakEditorScales(profile, svg);
  const labelAnchor = x => x < plotLeft + 28 ? 'start' : x > plotRight - 28 ? 'end' : 'middle';
  const points = getPeakEditorProfilePoints(profile.values).map((point) => ({
    x: scales.rowToX(point.row),
    y: scales.valueToY(point.value)
  }));
  const path = buildLinearPath(points);
  const peakX = scales.rowToX(profile.peakRow);
  const peakY = scales.valueToY(profile.peakValue);

  const areaMarkup = [];
  const overlayMarkup = [];
  let targetMarkup = '';
  if (Number.isFinite(measurement?.top) && Number.isFinite(measurement?.bottom)) {
    const start = scales.rowToX(measurement.top), end = scales.rowToX(measurement.bottom);
    targetMarkup = `<rect class="peak-editor-target-window" x="${start}" y="${plotTop}" width="${Math.max(1, end - start)}" height="${plotBottom - plotTop}" />`;
    const anchors = (measurement.baselineAnchors || []).filter(point => Number.isFinite(point.row) && Number.isFinite(point.value));
    if (anchors.length) {
      const a = anchors[0], b = anchors[anchors.length - 1];
      const value = row => a.value + (b.value - a.value) * (row - a.row) / (b.row - a.row || 1);
      targetMarkup += `<line class="peak-editor-target-baseline" data-band-baseline="${measurement.baselineMode === 'manual-peak' ? 'manual' : 'auto'}" x1="${start}" y1="${scales.valueToY(value(measurement.top))}" x2="${end}" y2="${scales.valueToY(value(measurement.bottom))}" />`;
    }
  }
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
        overlayMarkup.push(`<text class="peak-editor-divider-label" x="${dividerX}" y="${Math.max(12, plotTop - 8)}" text-anchor="${labelAnchor(dividerX)}">${divider}</text>`);
      });
      overlayMarkup.push(`<line class="peak-editor-baseline" x1="${leftX}" y1="${leftY}" x2="${rightX}" y2="${rightY}" />`);
      overlayMarkup.push(`<text class="peak-editor-baseline-label" x="${(leftX + rightX) / 2}" y="${Math.max(12, Math.min(leftY, rightY) - 8)}" text-anchor="${labelAnchor((leftX + rightX) / 2)}">B${baselineLabel}</text>`);
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
        <text class="peak-editor-hover-label" x="${hoverX}" y="${Math.max(12, hoverY - 10)}" text-anchor="${labelAnchor(hoverX)}">${hoverPoint.row}</text>
      </g>
    `;
  }

  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  i18nUi.setHtml(svg, `
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotTop + ((plotBottom - plotTop) / 4)}" x2="${plotRight}" y2="${plotTop + ((plotBottom - plotTop) / 4)}" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotTop + ((plotBottom - plotTop) / 2)}" x2="${plotRight}" y2="${plotTop + ((plotBottom - plotTop) / 2)}" />
    <line class="peak-editor-grid" x1="${plotLeft}" y1="${plotTop + (((plotBottom - plotTop) * 3) / 4)}" x2="${plotRight}" y2="${plotTop + (((plotBottom - plotTop) * 3) / 4)}" />
    ${targetMarkup}
    ${areaMarkup.join('')}
    <path class="peak-editor-path" d="${path}" />
    <circle class="peak-editor-apex" cx="${peakX}" cy="${peakY}" r="5" />
    ${overlayMarkup.join('')}
    ${hoverMarkup}
    <text class="peak-editor-axis-label" x="${plotLeft}" y="${height - Math.min(10, height / 8)}">${i18nUi.svg("Top")}</text>
    <text class="peak-editor-axis-label" x="${plotRight}" y="${height - Math.min(10, height / 8)}" text-anchor="end">${i18nUi.svg("Bottom")}</text>
  `);
}

export {
  PEAK_EDITOR_COLUMNS,
  calculatePeakIntegrationRows,
  getPeakEditorProfilePoints,
  getPeakEditorScales,
  getPeakEditorSvgXFromEvent,
  renderPeakEditorSvg
};
