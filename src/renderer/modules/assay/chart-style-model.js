export const DEFAULT_CHART_PALETTE = Object.freeze([
  '#1f77b4',
  '#ef6c3e',
  '#2ca25f',
  '#9467bd',
  '#d4a72c',
  '#8c564b'
]);

const POINT_SHAPES = Object.freeze(['circle', 'square', 'triangle', 'diamond', 'cross']);
const LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted']);
const FRAME_STYLES = Object.freeze(['box', 'l-shape', 'none']);
const CURVE_TYPES = Object.freeze(['curveMonotoneX', 'curveLinear', 'curveStep']);
const SCALE_TYPES = Object.freeze(['linear', 'log', 'ordinal']);

export const CHART_FONT_FAMILY = 'Arial, sans-serif';

export function createDefaultChartStyle() {
  return {
    xColumn: 'auto',
    yColumn: 'auto',
    seriesColumn: 'auto',
    xScale: 'auto',
    yScale: 'linear',
    xRange: { auto: true, min: null, max: null },
    yRange: { auto: true, min: null, max: null },
    palette: DEFAULT_CHART_PALETTE.slice(),
    seriesColors: {},
    pointShape: 'circle',
    pointSize: 3,
    lineStyle: 'solid',
    lineWidth: 1.5,
    curve: 'curveMonotoneX',
    frameStyle: 'box',
    frameCornerRadius: 0,
    frameStroke: '#9bb0c9',
    frameStrokeWidth: 1,
    backgroundColor: '#ffffff',
    sizeAuto: true,
    frameWidth: null,
    frameHeight: null,
    showVerticalGrid: true,
    showHorizontalGrid: true,
    gridColor: '#9bb0c9',
    gridStrokeWidth: 1
  };
}

function clampFinite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sanitizeRange(range) {
  const fallback = { auto: true, min: null, max: null };
  if (!range || typeof range !== 'object') {
    return fallback;
  }
  return {
    auto: range.auto !== false,
    min: clampFinite(range.min),
    max: clampFinite(range.max)
  };
}

function sanitizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeColor(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : fallback;
}

export function normalizeChartStyle(input) {
  const base = createDefaultChartStyle();
  if (!input || typeof input !== 'object') {
    return base;
  }
  const palette = Array.isArray(input.palette) && input.palette.length
    ? input.palette.map((color, index) => sanitizeColor(color, base.palette[index % base.palette.length]))
    : base.palette;
  const seriesColors = {};
  if (input.seriesColors && typeof input.seriesColors === 'object') {
    Object.entries(input.seriesColors).forEach(([label, color]) => {
      const safe = sanitizeColor(color, null);
      if (safe) {
        seriesColors[String(label)] = safe;
      }
    });
  }
  return {
    xColumn: typeof input.xColumn === 'string' ? input.xColumn : base.xColumn,
    yColumn: typeof input.yColumn === 'string' ? input.yColumn : base.yColumn,
    seriesColumn: typeof input.seriesColumn === 'string' ? input.seriesColumn : base.seriesColumn,
    xScale: input.xScale === 'auto' ? 'auto' : sanitizeEnum(input.xScale, SCALE_TYPES, base.xScale),
    yScale: sanitizeEnum(input.yScale, ['linear', 'log'], base.yScale),
    xRange: sanitizeRange(input.xRange),
    yRange: sanitizeRange(input.yRange),
    palette,
    seriesColors,
    pointShape: sanitizeEnum(input.pointShape, POINT_SHAPES, base.pointShape),
    pointSize: Number.isFinite(input.pointSize) ? Math.max(1, Math.min(20, input.pointSize)) : base.pointSize,
    lineStyle: sanitizeEnum(input.lineStyle, LINE_STYLES, base.lineStyle),
    lineWidth: Number.isFinite(input.lineWidth) ? Math.max(0.5, Math.min(8, input.lineWidth)) : base.lineWidth,
    curve: sanitizeEnum(input.curve, CURVE_TYPES, base.curve),
    frameStyle: sanitizeEnum(input.frameStyle, FRAME_STYLES, base.frameStyle),
    frameCornerRadius: Number.isFinite(input.frameCornerRadius)
      ? Math.max(0, Math.min(40, input.frameCornerRadius))
      : base.frameCornerRadius,
    frameStroke: sanitizeColor(input.frameStroke, base.frameStroke),
    frameStrokeWidth: Number.isFinite(input.frameStrokeWidth)
      ? Math.max(0, Math.min(6, input.frameStrokeWidth))
      : base.frameStrokeWidth,
    backgroundColor: sanitizeColor(input.backgroundColor, base.backgroundColor),
    sizeAuto: input.sizeAuto !== false,
    frameWidth: Number.isFinite(input.frameWidth)
      ? Math.max(320, Math.min(2000, input.frameWidth))
      : base.frameWidth,
    frameHeight: Number.isFinite(input.frameHeight)
      ? Math.max(180, Math.min(1200, input.frameHeight))
      : base.frameHeight,
    showVerticalGrid: input.showVerticalGrid !== false,
    showHorizontalGrid: input.showHorizontalGrid !== false,
    gridColor: sanitizeColor(input.gridColor, base.gridColor),
    gridStrokeWidth: Number.isFinite(input.gridStrokeWidth)
      ? Math.max(0, Math.min(6, input.gridStrokeWidth))
      : base.gridStrokeWidth
  };
}

export const CHART_STYLE_OPTIONS = Object.freeze({
  pointShapes: POINT_SHAPES,
  lineStyles: LINE_STYLES,
  frameStyles: FRAME_STYLES,
  curves: CURVE_TYPES,
  scales: SCALE_TYPES,
  defaultPalette: DEFAULT_CHART_PALETTE
});
