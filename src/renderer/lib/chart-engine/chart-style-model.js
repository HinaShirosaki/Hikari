// GraphPad Prism-style pastel palette (lavender / cyan / teal / coral / amber / green).
export const DEFAULT_CHART_PALETTE = Object.freeze([
  '#9b87c9',
  '#1fc3e6',
  '#84c8c4',
  '#ef6c6c',
  '#f0b429',
  '#5cb85c'
]);

const POINT_SHAPES = Object.freeze(['circle', 'square', 'triangle', 'diamond', 'cross']);
const LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted']);
const FRAME_STYLES = Object.freeze(['box', 'l-shape', 'none']);
const CURVE_TYPES = Object.freeze(['curveMonotoneX', 'curveLinear', 'curveStep']);
const SCALE_TYPES = Object.freeze(['linear', 'log', 'ordinal']);
const TEXT_BASELINES = Object.freeze(['baseline', 'super', 'sub']);
const TEXT_ALIGNMENTS = Object.freeze(['start', 'middle', 'end']);

export const CHART_FONT_FAMILY = 'Arial, sans-serif';

function createDefaultChartTextStyle() {
  return {
    fontFamily: 'Arial',
    fontSize: 14,
    color: '#000000',
    bold: true,
    italic: false,
    underline: false,
    baseline: 'baseline',
    textAlign: 'middle'
  };
}

function sanitizeChartTextStyle(input) {
  const base = createDefaultChartTextStyle();
  if (!input || typeof input !== 'object') return base;
  return {
    fontFamily: typeof input.fontFamily === 'string' && input.fontFamily.trim()
      ? input.fontFamily.trim()
      : base.fontFamily,
    fontSize: clampNumber(input.fontSize, 6, 72, base.fontSize),
    color: sanitizeColor(input.color, base.color),
    bold: Boolean(input.bold),
    italic: Boolean(input.italic),
    underline: Boolean(input.underline),
    baseline: TEXT_BASELINES.includes(input.baseline) ? input.baseline : base.baseline,
    textAlign: TEXT_ALIGNMENTS.includes(input.textAlign) ? input.textAlign : base.textAlign
  };
}

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
    pointSize: 6,
    lineStyle: 'solid',
    lineWidth: 2.5,
    curve: 'curveMonotoneX',
    frameStyle: 'l-shape',
    frameCornerRadius: 0,
    frameStroke: '#000000',
    frameStrokeWidth: 2,
    backgroundColor: '#ffffff',
    sizeAuto: true,
    frameWidth: null,
    frameHeight: null,
    showVerticalGrid: false,
    showHorizontalGrid: false,
    gridColor: '#9bb0c9',
    gridStrokeWidth: 1,
    text: createDefaultChartTextStyle()
  };
}

function clampFinite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampNumber(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
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
    pointSize: clampNumber(input.pointSize, 1, 20, base.pointSize),
    lineStyle: sanitizeEnum(input.lineStyle, LINE_STYLES, base.lineStyle),
    lineWidth: clampNumber(input.lineWidth, 0.5, 8, base.lineWidth),
    curve: sanitizeEnum(input.curve, CURVE_TYPES, base.curve),
    frameStyle: sanitizeEnum(input.frameStyle, FRAME_STYLES, base.frameStyle),
    frameCornerRadius: clampNumber(input.frameCornerRadius, 0, 40, base.frameCornerRadius),
    frameStroke: sanitizeColor(input.frameStroke, base.frameStroke),
    frameStrokeWidth: clampNumber(input.frameStrokeWidth, 0, 6, base.frameStrokeWidth),
    backgroundColor: sanitizeColor(input.backgroundColor, base.backgroundColor),
    sizeAuto: input.sizeAuto !== false,
    frameWidth: clampNumber(input.frameWidth, 320, 2000, base.frameWidth),
    frameHeight: clampNumber(input.frameHeight, 180, 1200, base.frameHeight),
    showVerticalGrid: input.showVerticalGrid !== false,
    showHorizontalGrid: input.showHorizontalGrid !== false,
    gridColor: sanitizeColor(input.gridColor, base.gridColor),
    gridStrokeWidth: clampNumber(input.gridStrokeWidth, 0, 6, base.gridStrokeWidth),
    text: sanitizeChartTextStyle(input.text)
  };
}

export const CHART_STYLE_OPTIONS = Object.freeze({
  pointShapes: POINT_SHAPES,
  lineStyles: LINE_STYLES,
  frameStyles: FRAME_STYLES,
  curves: CURVE_TYPES,
  scales: SCALE_TYPES,
  textBaselines: TEXT_BASELINES,
  textAlignments: TEXT_ALIGNMENTS,
  defaultPalette: DEFAULT_CHART_PALETTE
});
