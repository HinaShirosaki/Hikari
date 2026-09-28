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

function calculatePeakIntegrationRows(profile, integrations = []) {
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

export {
  PEAK_EDITOR_COLUMNS,
  calculatePeakIntegrationRows,
  getPeakEditorScales,
  getPeakEditorSvgXFromEvent,
  renderPeakEditorSvg
};
