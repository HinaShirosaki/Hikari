// The publication-figure look, shared by the assay renderer and by agent-authored figures:
// offset axis frame, no gridlines, plain tick numbers, outlined bars.
import { CHART_FONT_FAMILY, DEFAULT_CHART_PALETTE } from './chart-style-model.js';
import { asArray, ensureObject } from '../../../lib/normalize.js';

// Fraction of the plot each offset axis arm leaves empty at the origin corner.
export const FIGURE_CORNER_GAP = 0.04;
export const FIGURE_BAR_GAP = 0.35;
export const FIGURE_BAR_GROUP_GAP = 0.12;

// Trace types drawn on cartesian axes. A figure with none of them (pie, sankey,
// polar, 3d) gets no axis frame - the arms would just float over the graphic.
const CARTESIAN_TYPES = new Set([
  'bar', 'box', 'candlestick', 'contour', 'heatmap', 'histogram', 'histogram2d',
  'histogram2dcontour', 'ohlc', 'scatter', 'scattergl', 'violin', 'waterfall'
]);

// Maps the style's tickFormat enum onto Plotly axis number-formatting attributes.
export function tickFormatSpec(format) {
  switch (format) {
    case 'fixed1': return { tickformat: '.1f' };
    case 'fixed2': return { tickformat: '.2f' };
    case 'sci': return { exponentformat: 'e' };
    case 'si': return { exponentformat: 'SI' };
    case 'power': return { exponentformat: 'power' };
    default: return {};
  }
}

// Tick numbers are never bold; only titles/legend follow the text style.
export function figureTextFont(style = {}, target = 'xTitle') {
  const specific = style.textStyles?.[target];
  const textStyle = ensureObject(specific || style.text);
  return {
    family: textStyle.fontFamily ? `${textStyle.fontFamily}, ${CHART_FONT_FAMILY}` : CHART_FONT_FAMILY,
    size: Number.isFinite(textStyle.fontSize) ? textStyle.fontSize : 11,
    color: textStyle.color || style.frameStroke || '#000000',
    weight: !specific && /Ticks$/.test(target) ? 400 : textStyle.bold ? 700 : 400,
    style: textStyle.italic ? 'italic' : 'normal',
    lineposition: textStyle.underline ? 'under' : 'none'
  };
}

export function figureFonts(style = {}) {
  return { font: figureTextFont(style, 'xTitle'), tickFont: figureTextFont(style, 'xTicks') };
}

export function figureAxisDefaults(style = {}, tickFont) {
  const frameStyle = style.frameStyle || 'offset';
  const axisColor = style.frameStroke || '#9bb0c9';
  const tickMark = style.tickDir === 'none' ? '' : (style.tickDir || 'outside');
  return {
    showline: frameStyle === 'box' || frameStyle === 'l-shape',
    linecolor: axisColor,
    linewidth: style.frameStrokeWidth ?? 1,
    mirror: frameStyle === 'box',
    zeroline: false,
    showgrid: false,
    gridcolor: style.gridColor || '#9bb0c9',
    gridwidth: style.gridStrokeWidth ?? 1,
    griddash: { dashed: 'dash', dotted: 'dot' }[style.gridStyle] || 'solid',
    tickfont: tickFont || figureFonts(style).tickFont,
    ticks: tickMark,
    tickwidth: style.frameStrokeWidth ?? 1,
    ticklen: Number.isFinite(style.tickLen) ? style.tickLen : 5,
    tickcolor: axisColor,
    automargin: true,
    ...tickFormatSpec(style.tickFormat)
  };
}

// Paper-space frames share the plot bounds with ticks at the axis limits.
export function figureFrameShapes(style = {}) {
  const frameStyle = style.frameStyle || 'offset';
  const line = { color: style.frameStroke || '#9bb0c9', width: style.frameStrokeWidth ?? 1 };
  const paper = { xref: 'paper', yref: 'paper', line };
  // Keep the connected frame in the primary SVG captured for notebook previews.
  if (frameStyle === 'box') {
    return [{ ...paper, layer: 'below', type: 'rect', x0: 0, x1: 1, y0: 0, y1: 1 }];
  }
  if (frameStyle === 'l-shape') {
    return [{ ...paper, layer: 'below', type: 'path', path: 'M 0,1 L 0,0 L 1,0' }];
  }
  if (frameStyle !== 'offset') {
    return [];
  }
  return [
    { ...paper, type: 'line', x0: FIGURE_CORNER_GAP, x1: 1, y0: 0, y1: 0 },
    { ...paper, type: 'line', x0: 0, x1: 0, y0: FIGURE_CORNER_GAP, y1: 1 }
  ];
}

function figureTrace(trace, index, style, axisColor) {
  const type = String(trace.type || 'scatter');
  const palette = asArray(style.palette).length ? style.palette : DEFAULT_CHART_PALETTE;
  const color = palette[index % palette.length];
  const marker = ensureObject(trace.marker);
  if (type === 'bar') {
    return {
      ...trace,
      marker: {
        color: marker.color === undefined ? color : marker.color,
        ...marker,
        // Every bar is outlined in the axis colour.
        line: { color: axisColor, width: 1, ...ensureObject(marker.line) }
      }
    };
  }
  if (type !== 'scatter' && type !== 'scattergl') {
    return trace;
  }
  return {
    ...trace,
    marker: { color, ...marker },
    line: { color, ...ensureObject(trace.line) }
  };
}

// Fills the figure defaults into a figure the agent authored. Everything the figure
// states itself wins, so an agent that picks colours or turns gridlines on keeps them.
export function applyFigureDefaults(figure = {}, style = {}) {
  const source = ensureObject(figure);
  const layout = ensureObject(source.layout);
  const data = asArray(source.data);
  const cartesian = data.some((trace) => CARTESIAN_TYPES.has(String(ensureObject(trace).type || 'scatter')));
  if (!cartesian) {
    return { ...source, data, layout };
  }
  const { font, tickFont } = figureFonts(style);
  const axisColor = style.frameStroke || '#9bb0c9';
  const background = style.backgroundColor || '#ffffff';
  const axisDefaults = figureAxisDefaults(style, tickFont);
  const frameShapes = axisDefaults.showline ? [] : figureFrameShapes(style);
  const axisKeys = new Set(['xaxis', 'yaxis', ...Object.keys(layout).filter((key) => /^[xy]axis\d*$/.test(key))]);
  const axes = {};
  axisKeys.forEach((key) => {
    axes[key] = { ...axisDefaults, ...ensureObject(layout[key]) };
  });
  return {
    ...source,
    data: data.map((trace, index) => figureTrace(ensureObject(trace), index, style, axisColor)),
    layout: {
      font,
      paper_bgcolor: background,
      plot_bgcolor: background,
      bargap: FIGURE_BAR_GAP,
      bargroupgap: FIGURE_BAR_GROUP_GAP,
      ...layout,
      ...axes,
      shapes: [...frameShapes, ...asArray(layout.shapes)]
    }
  };
}
