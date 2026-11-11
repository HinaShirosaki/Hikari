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
  const limits = [range.min, range.max].filter((value) => value !== null);
  if (!limits.every(Number.isFinite) || (limits.length === 2 && range.min >= range.max)) {
    return 'Enter a minimum smaller than the maximum.';
  }
  if (scale !== 'linear' && limits.some((value) => value <= 0)) {
    return 'Logarithmic limits must both be greater than zero.';
  }
  return '';
}

export function plotlyAxisRange(scale, range) {
  if (range?.auto !== false || (range.min === null && range.max === null) || validateAxisRange(scale, range)) return null;
  const limits = [range.min, range.max];
  return scale === 'linear' ? limits : limits.map((value) => value === null ? null : Math.log10(value));
}

export function figureClassicPatch() {
  const defaults = createDefaultChartStyle();
  const keys = [
    'frameStyle', 'frameStroke', 'frameStrokeWidth', 'backgroundColor', 'showVerticalGrid',
    'showHorizontalGrid', 'gridColor', 'gridStrokeWidth', 'gridStyle', 'axisStyles', 'tickDir', 'tickLen',
    'minorTicks', 'tickFormat', 'palette', 'seriesColors', 'seriesShapes', 'seriesStyles',
    'seriesColor', 'replicateStyle', 'pointShape', 'pointSize', 'markerFill', 'opacity', 'lineStyle', 'lineWidth',
    'barOutlineColor', 'barOutlineWidth', 'barCornerRadius', 'errorColor', 'errorCapWidth',
    'errorThickness', 'textStyles', 'text'
  ];
  return Object.fromEntries(keys.map((key) => [key, defaults[key]]));
}
