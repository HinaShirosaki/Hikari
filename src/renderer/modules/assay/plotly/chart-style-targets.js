import { AXIS_STYLE_KEYS, SERIES_STYLE_KEYS, createDefaultChartStyle } from './chart-style-model.js';

export function resolveAxisStyle(style, axis) {
  return { ...style, ...(style.axisStyles?.[axis] || {}) };
}

export function resolveSeriesStyle(style, label, index = 0) {
  const colors = style.palette?.length ? style.palette : createDefaultChartStyle().palette;
  const oldColor = Object.hasOwn(style.seriesColors || {}, label) ? style.seriesColors[label] : null;
  const oldShape = Object.hasOwn(style.seriesShapes || {}, label) ? style.seriesShapes[label] : null;
  const override = Object.hasOwn(style.seriesStyles || {}, label) ? style.seriesStyles[label] : {};
  return {
    ...style,
    pointShape: oldShape || style.pointShape,
    ...override,
    color: override.color || oldColor || style.seriesColor || colors[index % colors.length]
  };
}

// A global edit replaces only this property's overrides, not the rest of a series.
export function seriesStylePatch(style, label, key, value) {
  if (!SERIES_STYLE_KEYS.includes(key)) return {};
  if (label !== null) {
    const previous = Object.hasOwn(style.seriesStyles || {}, label) ? style.seriesStyles[label] : {};
    return { seriesStyles: { ...style.seriesStyles, [label]: { ...previous, [key]: value } } };
  }
  const seriesStyles = Object.fromEntries(Object.entries(style.seriesStyles || {}).map(([name, values]) => {
    const next = { ...values };
    delete next[key];
    return [name, next];
  }));
  const replicateStyle = { ...style.replicateStyle };
  delete replicateStyle[key];
  if (key === 'markerFill') delete replicateStyle.outlineWidth;
  return {
    [key === 'color' ? 'seriesColor' : key]: value,
    seriesStyles,
    replicateStyle,
    ...(key === 'color' ? { seriesColors: {} } : {}),
    ...(key === 'pointShape' ? { seriesShapes: {} } : {})
  };
}

export function axisStylePatch(style, axis, key, value) {
  return AXIS_STYLE_KEYS.includes(key)
    ? { axisStyles: { ...style.axisStyles, [axis]: { ...style.axisStyles?.[axis], [key]: value } } }
    : { [`${axis}${key}`]: value };
}

export function validateAxisRange(scale, range) {
  if (range?.auto !== false) return '';
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) {
    return 'Enter a minimum smaller than the maximum.';
  }
  if (scale !== 'linear' && (range.min <= 0 || range.max <= 0)) {
    return 'Logarithmic limits must both be greater than zero.';
  }
  return '';
}

export function plotlyAxisRange(scale, range) {
  if (!range || range.auto !== false || validateAxisRange(scale, range)) return null;
  return scale === 'linear' ? [range.min, range.max] : [Math.log10(range.min), Math.log10(range.max)];
}

export function prismClassicPatch() {
  const defaults = createDefaultChartStyle();
  const keys = [
    'frameStyle', 'frameStroke', 'frameStrokeWidth', 'backgroundColor', 'showVerticalGrid',
    'showHorizontalGrid', 'gridColor', 'gridStrokeWidth', 'axisStyles', 'tickDir', 'tickLen',
    'minorTicks', 'tickFormat', 'palette', 'seriesColors', 'seriesShapes', 'seriesStyles',
    'seriesColor', 'replicateStyle', 'pointShape', 'pointSize', 'markerFill', 'opacity', 'lineStyle', 'lineWidth',
    'barOutlineColor', 'barOutlineWidth', 'barCornerRadius', 'errorColor', 'errorCapWidth',
    'errorThickness', 'textStyles', 'text'
  ];
  return Object.fromEntries(keys.map((key) => [key, defaults[key]]));
}
