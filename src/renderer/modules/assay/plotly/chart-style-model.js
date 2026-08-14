// Plotly defaults used by the Assay analysis view.
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
const SCALE_TYPES = Object.freeze(['linear', 'log10', 'log2', 'ln']);
const TEXT_BASELINES = Object.freeze(['baseline', 'super', 'sub']);
const TEXT_ALIGNMENTS = Object.freeze(['start', 'middle', 'end']);
const DISPLAY_MODES = Object.freeze(['lines+markers', 'lines', 'markers']);
const LEGEND_POSITIONS = Object.freeze(['top', 'bottom', 'right', 'none']);
const TICK_DIRECTIONS = Object.freeze(['outside', 'inside', 'none']);
const TICK_FORMATS = Object.freeze(['auto', 'fixed1', 'fixed2', 'sci', 'si', 'power']);
const MARKER_FILLS = Object.freeze(['filled', 'open']);
const BAR_MODES = Object.freeze(['group', 'stack']);
const REF_AXES = Object.freeze(['y', 'x']);
const CHART_TYPES = Object.freeze(['auto', 'line', 'bar']);

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
    chartType: 'auto',
    xColumn: 'auto',
    yColumn: 'auto',
    seriesColumn: 'auto',
    xTitle: '',
    yTitle: '',
    xScale: 'linear',
    yScale: 'linear',
    xRange: { auto: true, min: null, max: null },
    yRange: { auto: true, min: null, max: null },
    xTick: null,
    yTick: null,
    palette: DEFAULT_CHART_PALETTE.slice(),
    seriesColors: {},
    seriesShapes: {},
    pointShape: 'circle',
    pointSize: 6,
    lineStyle: 'solid',
    lineWidth: 2.5,
    curve: 'curveMonotoneX',
    frameStyle: 'l-shape',
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
    title: '',
    mode: 'lines+markers',
    legendPosition: 'top',
    tickDir: 'outside',
    tickLen: 5,
    minorTicks: false,
    tickFormat: 'auto',
    markerFill: 'filled',
    opacity: 1,
    refLineAxis: 'y',
    refLineValue: null,
    barMode: 'group',
    barLabels: false,
    barCornerRadius: 0,
    errorCapWidth: 4,
    errorThickness: 1.2,
    text: createDefaultChartTextStyle()
  };
}

function clampFinite(value) {
  if (value === null || value === undefined || value === '') return null;
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

// Migrate legacy scale values to the current set (linear/log10/log2/ln).
function migrateScale(value) {
  if (value === 'log') return 'log10';
  if (value === 'auto' || value === 'ordinal') return 'linear';
  return value;
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
  const seriesShapes = {};
  if (input.seriesShapes && typeof input.seriesShapes === 'object') {
    Object.entries(input.seriesShapes).forEach(([label, shape]) => {
      if (POINT_SHAPES.includes(shape)) {
        seriesShapes[String(label)] = shape;
      }
    });
  }
  return {
    chartType: sanitizeEnum(input.chartType, CHART_TYPES, base.chartType),
    xColumn: typeof input.xColumn === 'string' ? input.xColumn : base.xColumn,
    yColumn: typeof input.yColumn === 'string' ? input.yColumn : base.yColumn,
    seriesColumn: typeof input.seriesColumn === 'string' ? input.seriesColumn : base.seriesColumn,
    xTitle: typeof input.xTitle === 'string' ? input.xTitle.slice(0, 200) : base.xTitle,
    yTitle: typeof input.yTitle === 'string' ? input.yTitle.slice(0, 200) : base.yTitle,
    xScale: sanitizeEnum(migrateScale(input.xScale), SCALE_TYPES, base.xScale),
    yScale: sanitizeEnum(migrateScale(input.yScale), SCALE_TYPES, base.yScale),
    xRange: sanitizeRange(input.xRange),
    yRange: sanitizeRange(input.yRange),
    xTick: clampFinite(input.xTick),
    yTick: clampFinite(input.yTick),
    palette,
    seriesColors,
    seriesShapes,
    pointShape: sanitizeEnum(input.pointShape, POINT_SHAPES, base.pointShape),
    pointSize: clampNumber(input.pointSize, 1, 20, base.pointSize),
    lineStyle: sanitizeEnum(input.lineStyle, LINE_STYLES, base.lineStyle),
    lineWidth: clampNumber(input.lineWidth, 0.5, 8, base.lineWidth),
    curve: sanitizeEnum(input.curve, CURVE_TYPES, base.curve),
    frameStyle: sanitizeEnum(input.frameStyle, FRAME_STYLES, base.frameStyle),
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
    title: typeof input.title === 'string' ? input.title.slice(0, 200) : base.title,
    mode: sanitizeEnum(input.mode, DISPLAY_MODES, base.mode),
    legendPosition: sanitizeEnum(input.legendPosition, LEGEND_POSITIONS, base.legendPosition),
    tickDir: sanitizeEnum(input.tickDir, TICK_DIRECTIONS, base.tickDir),
    tickLen: clampNumber(input.tickLen, 0, 20, base.tickLen),
    minorTicks: Boolean(input.minorTicks),
    tickFormat: sanitizeEnum(input.tickFormat, TICK_FORMATS, base.tickFormat),
    markerFill: sanitizeEnum(input.markerFill, MARKER_FILLS, base.markerFill),
    opacity: clampNumber(input.opacity, 0.1, 1, base.opacity),
    refLineAxis: sanitizeEnum(input.refLineAxis, REF_AXES, base.refLineAxis),
    refLineValue: clampFinite(input.refLineValue),
    barMode: sanitizeEnum(input.barMode, BAR_MODES, base.barMode),
    barLabels: Boolean(input.barLabels),
    barCornerRadius: clampNumber(input.barCornerRadius, 0, 30, base.barCornerRadius),
    errorCapWidth: clampNumber(input.errorCapWidth, 0, 20, base.errorCapWidth),
    errorThickness: clampNumber(input.errorThickness, 0.5, 6, base.errorThickness),
    text: sanitizeChartTextStyle(input.text)
  };
}

export const CHART_STYLE_OPTIONS = Object.freeze({
  chartTypes: CHART_TYPES,
  pointShapes: POINT_SHAPES,
  lineStyles: LINE_STYLES,
  frameStyles: FRAME_STYLES,
  curves: CURVE_TYPES,
  scales: SCALE_TYPES,
  textBaselines: TEXT_BASELINES,
  textAlignments: TEXT_ALIGNMENTS,
  defaultPalette: DEFAULT_CHART_PALETTE
});
