// The Prism look, shared by the assay renderer and by agent-authored figures:
// offset axis frame, no gridlines, plain tick numbers, outlined bars.
import { CHART_FONT_FAMILY, DEFAULT_CHART_PALETTE } from './chart-style-model.js';
import { asArray, ensureObject } from '../../../lib/normalize.js';

// Fraction of the plot each offset axis arm leaves empty at the origin corner.
export const PRISM_CORNER_GAP = 0.04;
export const PRISM_BAR_GAP = 0.35;
export const PRISM_BAR_GROUP_GAP = 0.12;

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

// Prism never sets tick numbers in bold; only titles/legend follow the text style.
export function prismTextFont(style = {}, target = 'xTitle') {
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

export function prismFonts(style = {}) {
  return { font: prismTextFont(style, 'xTitle'), tickFont: prismTextFont(style, 'xTicks') };
}

export function prismAxisDefaults(style = {}, tickFont) {
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
    tickfont: tickFont || prismFonts(style).tickFont,
    ticks: tickMark,
    tickwidth: style.frameStrokeWidth ?? 1,
    ticklen: Number.isFinite(style.tickLen) ? style.tickLen : 5,
    tickcolor: axisColor,
    automargin: true,
    ...tickFormatSpec(style.tickFormat)
  };
}

// 'offset' is the Prism frame: an L whose two arms stop short of the origin corner.
// Plotly's own axis lines always meet, so the arms are drawn as paper-space shapes.
export function prismFrameShapes(style = {}) {
  if ((style.frameStyle || 'offset') !== 'offset') {
    return [];
  }
  const line = { color: style.frameStroke || '#9bb0c9', width: style.frameStrokeWidth ?? 1 };
  return [
    {
      type: 'line', xref: 'paper', yref: 'paper', x0: PRISM_CORNER_GAP, x1: 1, y0: 0, y1: 0, line
    },
    {
      type: 'line', xref: 'paper', yref: 'paper', x0: 0, x1: 0, y0: PRISM_CORNER_GAP, y1: 1, line
    }
  ];
}

function prismTrace(trace, index, style, axisColor) {
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
        // Prism outlines every bar in the axis colour.
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

// Fills the Prism defaults into a figure the agent authored. Everything the figure
// states itself wins, so an agent that picks colours or turns gridlines on keeps them.
export function applyPrismDefaults(figure = {}, style = {}) {
  const source = ensureObject(figure);
  const layout = ensureObject(source.layout);
  const data = asArray(source.data);
  const cartesian = data.some((trace) => CARTESIAN_TYPES.has(String(ensureObject(trace).type || 'scatter')));
  if (!cartesian) {
    return { ...source, data, layout };
  }
  const { font, tickFont } = prismFonts(style);
  const axisColor = style.frameStroke || '#9bb0c9';
  const background = style.backgroundColor || '#ffffff';
  const axisDefaults = prismAxisDefaults(style, tickFont);
  const axisKeys = new Set(['xaxis', 'yaxis', ...Object.keys(layout).filter((key) => /^[xy]axis\d*$/.test(key))]);
  const axes = {};
  axisKeys.forEach((key) => {
    axes[key] = { ...axisDefaults, ...ensureObject(layout[key]) };
  });
  return {
    ...source,
    data: data.map((trace, index) => prismTrace(ensureObject(trace), index, style, axisColor)),
    layout: {
      font,
      paper_bgcolor: background,
      plot_bgcolor: background,
      bargap: PRISM_BAR_GAP,
      bargroupgap: PRISM_BAR_GROUP_GAP,
      ...layout,
      ...axes,
      shapes: [...prismFrameShapes(style), ...asArray(layout.shapes)]
    }
  };
}
