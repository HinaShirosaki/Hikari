import { resolveAxisStyle, plotlyAxisRange } from './chart-style-targets.js';
import { buildPlotlyTraces } from './plotly-traces.js';
import {
  PRISM_BAR_GAP,
  PRISM_BAR_GROUP_GAP,
  prismAxisDefaults,
  prismFonts,
  prismTextFont,
  prismFrameShapes
} from './prism-theme.js';

// Plotly log axes are positioned in log10; a log10-space dtick of log10(base) lands
// ticks on consecutive powers of that base (Plotly's documented multi-base trick).
const LOG10_2 = Math.log10(2);
const LOG10_E = Math.LOG10E;
function scaleAxis(scale) {
  if (scale === 'log10') return { type: 'log', dtick: 1 };
  if (scale === 'log2') return { type: 'log', dtick: LOG10_2 };
  if (scale === 'ln') return { type: 'log', dtick: LOG10_E };
  return { type: 'linear', dtick: null };
}

function legendLayout(position, font) {
  if (position === 'right') return { orientation: 'v', x: 1.02, xanchor: 'left', y: 1, yanchor: 'top', font };
  if (position === 'bottom') return { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.22, yanchor: 'top', font };
  return { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.12, yanchor: 'bottom', font }; // top
}

// Auto frame sizing. The plot area is what the data needs; the gutter is the y-axis
// labels/title plus the right margin, which do not scale with the category count.
const MIN_PLOT_WIDTH = 240;
const MAX_PLOT_WIDTH = 900;
const HOST_PADDING = 24;
const LABEL_GAP = 4;
const MIN_PLOT_HEIGHT = 180;
const MAX_PLOT_HEIGHT = 320;

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Axis titles are annotations, not Plotly axis titles. Plotly's own axis title is
// locked to the centre of its axis and only exposes `standoff`, so it can be neither
// slid along the axis nor dragged. An annotation can be both -- and with
// `edits.annotationPosition` it is a text box the user drags on the figure.
//
// Position is held entirely in paper coordinates (0..1 spans the plot area) so a drag
// round-trips: Plotly reports the dropped x/y, and titleEditPatch turns them straight
// back into the same `pos` / `offset` the text boxes hold.
const DEFAULT_TITLE_SHIFT = { x: 34, y: 46 };
function titleShift(offset, isY) {
  return Number.isFinite(offset) ? offset : (isY ? DEFAULT_TITLE_SHIFT.y : DEFAULT_TITLE_SHIFT.x);
}

function axisTitleAnnotation(text, font, pos, offset, isY, plotWidth, plotHeight) {
  const along = Number.isFinite(pos) ? pos : 0.5;
  const shift = titleShift(offset, isY);
  const base = {
    text,
    font,
    xref: 'paper',
    yref: 'paper',
    xanchor: 'center',
    yanchor: 'middle',
    showarrow: false
  };
  return isY
    ? { ...base, x: -(shift / Math.max(1, plotWidth)), y: along, textangle: -90 }
    : { ...base, x: along, y: -(shift / Math.max(1, plotHeight)) };
}

// Turns a Plotly relayout payload from a dragged/renamed title back into a style patch.
// annotations[0] is the X title and annotations[1] the Y title -- the order render()
// builds them in.
export function titleEditPatch(event, geometry) {
  const patch = {};
  if (!event || !geometry) {
    return patch;
  }
  const { plotWidth, plotHeight } = geometry;
  const read = (key) => {
    const value = event[key];
    return Number.isFinite(value) ? value : null;
  };
  const clamp01 = (value) => Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
  const distance = (value, span) => Math.max(0, Math.round(-value * span));

  const xAlong = read('annotations[0].x');
  if (xAlong !== null) patch.xTitlePos = clamp01(xAlong);
  const xAway = read('annotations[0].y');
  if (xAway !== null) patch.xTitleOffset = distance(xAway, plotHeight);
  if (typeof event['annotations[0].text'] === 'string') patch.xTitle = event['annotations[0].text'];

  const yAlong = read('annotations[1].y');
  if (yAlong !== null) patch.yTitlePos = clamp01(yAlong);
  const yAway = read('annotations[1].x');
  if (yAway !== null) patch.yTitleOffset = distance(yAway, plotWidth);
  if (typeof event['annotations[1].text'] === 'string') patch.yTitle = event['annotations[1].text'];

  return patch;
}

function serializeSvgToDataUrl(svgElement) {
  if (!svgElement || String(svgElement.tagName || '').toLowerCase() !== 'svg') {
    return '';
  }
  const clone = svgElement.cloneNode(true);
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  const ownerDoc = clone.ownerDocument || document;
  const bg = ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clone.outerHTML)}`;
}

// Assay Plotly renderer: render(target, chartModel, style) -> { seriesLabels }.
// chartModel = { chartType: 'line' | 'bar', xLabel, yLabel, showErrorBars?, series: [{ label, data:[{x,y,yVariance?,points?}], markers? }] }
// data[].points = the group's raw replicates, dotted over a single-series bar (Prism style).
// Plotly is loaded as a window global by index.html.
export function createAssayPlotlyRenderer({ onTitleEdit } = {}) {
  let chartHost = null;
  // A dragged title reports paper coordinates, which only mean pixels against the plot
  // area it was dropped on.
  let titleGeometry = null;
  let editBoundHost = null;
  // The host is a fixed-size canvas, so its box is not the figure's -- exports have to
  // use the size the figure was actually drawn at.
  let chartSize = null;

  const getPlotly = () => (typeof window !== 'undefined' ? window.Plotly : null);

  function unmount() {
    const Plotly = getPlotly();
    if (chartHost && Plotly?.purge) {
      Plotly.purge(chartHost);
    }
    chartHost = null;
    chartSize = null;
    titleGeometry = null;
    editBoundHost = null;
  }

  // ponytail: best-effort sync thumbnail from the rendered SVG. For full-fidelity
  // (legend layer, exact pixels) switch to async Plotly.toImage.
  function captureDataUrl() {
    return serializeSvgToDataUrl(chartHost?.querySelector?.('.main-svg'));
  }

  function render(target, chartModel, style) {
    const Plotly = getPlotly();
    if (!Plotly || !target || !chartModel || !Array.isArray(chartModel.series) || !chartModel.series.length) {
      unmount();
      return { seriesLabels: [] };
    }
    // Only tear down when the host element itself changed. Purging the live host
    // collapses it to zero height, and the layout read below flushes that collapse --
    // which clamps the workspace's scrollTop, so every style tweak scrolled to the top.
    if (chartHost && chartHost !== target) {
      unmount();
    }

    const st = style || {};
    const isBar = chartModel.chartType === 'bar';
    // The x axis follows the data, not the chart type. A summary model carries category
    // strings ("Sample A", "10 uM"); forcing it onto a linear axis coerces every x to
    // NaN and silently drops every point, which is what a bar -> line override used to do.
    const hasCategoryX = chartModel.series.some((series) => (series.data || [])
      .some((point) => point && !Number.isFinite(Number(point.x))));
    const { font, tickFont } = prismFonts(st);
    const axisColor = st.frameStroke || '#000000';
    const bgColor = st.backgroundColor || '#ffffff';
    const traces = buildPlotlyTraces(chartModel, st, prismTextFont(st, 'barLabels'));

    // Everything below is sized in plot-area terms, and the margins are added back on
    // top at the end. Plotly's width/height are the whole figure, so sizing the figure
    // instead would let a pushed-out axis title eat the plot rather than grow the frame.
    // The plot area follows the data: room per bar (or per point), and a height tied to
    // that width. A flat 420x280 floor left the axis running well past the last bar on a
    // two-group summary, and a flat 280 height turned a 24-category plot into a letterbox.
    const yTickFont = prismTextFont(st, 'yTicks');
    const xTitleFont = prismTextFont(st, 'xTitle');
    const yTitleFont = prismTextFont(st, 'yTitle');
    const legendFont = prismTextFont(st, 'legend');
    const titleFont = prismTextFont(st, 'title');
    const yValues = chartModel.series.flatMap((series) => [...(series.data || []), ...(series.markers || [])])
      .flatMap((point) => [point.y, point.y + (point.yVariance || 0)]).filter(Number.isFinite);
    if (Number.isFinite(st.yRange?.max)) yValues.push(st.yRange.max);
    const largestY = Math.max(1, ...yValues.map(Math.abs));
    const magnitude = 10 ** Math.floor(Math.log10(largestY));
    yValues.push(Math.ceil(largestY / magnitude) * magnitude);
    const yNumbers = yValues.map((value) => String(Number(value.toPrecision(5))));
    const yNumberWidth = Math.max(2, ...yNumbers.map((label) => label.length)) * yTickFont.size * 0.62;
    const yShift = st.yTitleOffset ?? Math.max(46, yNumberWidth + yTitleFont.size / 2 + 14);
    const marginLeft = Math.max(70, yShift + yTitleFont.size + 12);
    const showLegend = st.legendPosition !== 'none' && chartModel.series.length > 1;
    const legendWidth = Math.max(0, ...chartModel.series.map((series) => String(series.label || '').length)) * legendFont.size * 0.62 + 48;
    const lastXWidth = Math.max(0, ...chartModel.series.flatMap((series) => series.data || [])
      .map((point) => String(point.x ?? '').length)) * tickFont.size * 0.62;
    // Rotated labels at the right endpoint also need room in exported SVGs.
    const rightLabelGutter = Math.max(24, Math.ceil(lastXWidth + 10));
    const marginRight = rightLabelGutter + (showLegend && st.legendPosition === 'right' ? Math.ceil(legendWidth + 12) : 0);
    const marginTop = (st.title ? Math.max(44, titleFont.size * 1.5 + 12) + (st.titleOffset || 0) : 24)
      + (showLegend && st.legendPosition === 'top' ? legendFont.size * 2 + 38 : 0);
    const categoryCount = chartModel.series.reduce((max, s) => Math.max(max, (s.data || []).length), 0) || 1;
    // Grouped bars share a category slot, so the slot grows with the series count -- but
    // only up to a point, past which the bars thin out instead of the plot getting wider.
    const slotWidth = isBar ? 34 + 30 * Math.min(chartModel.series.length, 4) : 44;
    // Never wider than the fixed canvas it sits in: many categories thin the bars out
    // rather than pushing the figure into a scrollbar.
    const available = Math.floor((target.clientWidth || target.parentElement?.clientWidth || 0) - HOST_PADDING);
    const widthCap = available > MIN_PLOT_WIDTH + marginLeft + marginRight
      ? Math.min(MAX_PLOT_WIDTH, available - marginLeft - marginRight)
      : available > 0 ? Math.max(MIN_PLOT_WIDTH, available - marginLeft - marginRight) : MAX_PLOT_WIDTH;
    const autoWidth = Math.min(clampNumber(categoryCount * slotWidth, MIN_PLOT_WIDTH, MAX_PLOT_WIDTH), widthCap);
    // The control promises a plot size, so a custom value is the plot area: equal
    // numbers give an actually square plot.
    const useCustomSize = st.sizeAuto === false;
    const customPlotWidth = useCustomSize && Number.isFinite(st.frameWidth) ? st.frameWidth : null;
    const customPlotHeight = useCustomSize && Number.isFinite(st.frameHeight) ? st.frameHeight : null;
    const exactSize = customPlotWidth !== null || customPlotHeight !== null;
    const plotAreaWidth = customPlotWidth ?? autoWidth;
    const autoHeight = clampNumber(Math.round(plotAreaWidth * 0.62), MIN_PLOT_HEIGHT, MAX_PLOT_HEIGHT);
    const plotAreaHeight = customPlotHeight ?? autoHeight;

    const xStyle = resolveAxisStyle(st, 'x');
    const yStyle = resolveAxisStyle(st, 'y');
    const minorFor = (cfg, axisStyle) => {
      if (!axisStyle.minorTicks || cfg.type === 'category') return undefined;
      return {
        ticks: axisStyle.tickDir === 'none' ? '' : axisStyle.tickDir || 'outside',
        ticklen: Math.max(2, (axisStyle.tickLen ?? 5) * 0.6),
        tickcolor: axisColor, showgrid: false,
        ...(cfg.type === 'linear' ? { nticks: 5 } : {})
      };
    };

    const xScaleCfg = isBar || hasCategoryX ? { type: 'category', dtick: null } : scaleAxis(st.xScale);
    const yScaleCfg = scaleAxis(st.yScale);

    // Prism writes category labels horizontally; only tilt them when they would collide.
    // Collision is label width against the slot each category actually gets, so 24 short
    // labels tilt for the same reason two long ones do.
    const longestCategory = !isBar && !hasCategoryX ? 0 : chartModel.series.reduce((max, series) => (series.data || [])
      .reduce((inner, point) => Math.max(inner, String(point.x ?? '').length), max), 0);
    const labelWidth = longestCategory ? longestCategory * (tickFont.size || 12) * 0.62 : lastXWidth;
    const categorySlot = plotAreaWidth / categoryCount;
    const categoryTickAngle = Number.isFinite(xStyle.tickAngle) ? xStyle.tickAngle
      : (isBar || hasCategoryX) && labelWidth + LABEL_GAP > categorySlot ? -35 : 0;

    const angle = Math.abs(categoryTickAngle) * Math.PI / 180;
    const tickHeight = Math.sin(angle) * labelWidth + Math.cos(angle) * tickFont.size;
    const xShift = st.xTitleOffset ?? Math.max(34, tickHeight + xTitleFont.size / 2 + 12);

    // An explicit axis title wins; otherwise the analysis names its own axes. Both are
    // drawn as annotations (see axisTitleAnnotation), so the axes themselves stay untitled.
    const axisTitles = [
      axisTitleAnnotation(st.xTitle || chartModel.xLabel || '', prismTextFont(st, 'xTitle'),
        st.xTitlePos, xShift, false, plotAreaWidth, plotAreaHeight),
      axisTitleAnnotation(st.yTitle || chartModel.yLabel || '', prismTextFont(st, 'yTitle'),
        st.yTitlePos, yShift, true, plotAreaWidth, plotAreaHeight)
    ];
    const xaxis = {
      ...prismAxisDefaults(xStyle, prismTextFont(st, 'xTicks')),
      // automargin grows the margin into the plot area, which would shrink the exact
      // size that was asked for. In auto mode it still guards against clipped labels.
      automargin: !exactSize,
      title: { text: '', font },
      type: xScaleCfg.type,
      showgrid: st.showVerticalGrid === true,
      tickangle: categoryTickAngle
    };
    const yaxis = {
      ...prismAxisDefaults(yStyle, prismTextFont(st, 'yTicks')),
      automargin: !exactSize,
      title: { text: '', font: prismTextFont(st, 'yTitle') },
      tickangle: yStyle.tickAngle ?? 0,
      type: yScaleCfg.type,
      showgrid: st.showHorizontalGrid === true
    };
    // Log intervals count powers of the selected base, while linear intervals use data units.
    const xDtick = xScaleCfg.type !== 'category' && Number.isFinite(st.xTick) && st.xTick > 0
      ? st.xTick * (xScaleCfg.type === 'log' ? xScaleCfg.dtick : 1) : xScaleCfg.dtick;
    if (xDtick != null) xaxis.dtick = xDtick;
    const yDtick = Number.isFinite(st.yTick) && st.yTick > 0
      ? st.yTick * (yScaleCfg.type === 'log' ? yScaleCfg.dtick : 1) : yScaleCfg.dtick;
    if (yDtick != null) yaxis.dtick = yDtick;
    if (xScaleCfg.type !== 'category') {
      const range = plotlyAxisRange(st.xScale, st.xRange);
      if (range) xaxis.range = range;
    }
    const yr = plotlyAxisRange(st.yScale, st.yRange);
    if (yr) yaxis.range = yr;
    const xMinor = minorFor(xScaleCfg, xStyle);
    if (xMinor) xaxis.minor = xMinor;
    const yMinor = minorFor(yScaleCfg, yStyle);
    if (yMinor) yaxis.minor = yMinor;

    const showlegend = st.legendPosition !== 'none' && chartModel.series.length > 1;
    const margin = {
      l: marginLeft,
      r: marginRight,
      t: marginTop,
      // Only known once the tick angle is: tilted category labels need the deeper gutter.
      b: Math.max(categoryTickAngle ? 96 : 56, xShift + xTitleFont.size + 12)
        + (showlegend && st.legendPosition === 'bottom' ? legendFont.size * 2 + 38 : 0)
    };
    // The figure carries the margins on top of the plot, so pushing a title further out
    // grows the frame instead of squeezing the plot.
    const width = plotAreaWidth + margin.l + margin.r;
    const height = plotAreaHeight + margin.t + margin.b;
    const layout = {
      width,
      height,
      margin,
      paper_bgcolor: bgColor,
      plot_bgcolor: bgColor,
      font,
      xaxis,
      yaxis,
      showlegend,
      legend: { ...legendLayout(st.legendPosition, legendFont),
        ...(st.legendPosition === 'bottom' ? { y: -(xShift + xTitleFont.size + 12) / plotAreaHeight } : {}) },
      barmode: st.barMode || 'group',
      // Prism bars sit apart with tight groups.
      bargap: PRISM_BAR_GAP,
      bargroupgap: PRISM_BAR_GROUP_GAP
    };
    layout.annotations = axisTitles;
    const shapes = prismFrameShapes(st);
    if (st.title) {
      layout.title = { text: st.title, font: prismTextFont(st, 'title'), x: st.titlePos ?? 0.5, xanchor: 'center',
        yref: 'container', y: 1, yanchor: 'top', pad: { t: (st.titleOffset ?? 0) + Math.ceil(titleFont.size * 0.4) + 6 } };
    }
    // Shape endpoints use data units, including on log axes (unlike axis ranges).
    if (Number.isFinite(st.refLineValue)) {
      const onY = st.refLineAxis !== 'x';
      const cfg = onY ? yScaleCfg : xScaleCfg;
      const v = cfg.type === 'log' && st.refLineValue <= 0 ? null : st.refLineValue;
      if (v != null) {
        const line = { color: '#666666', width: 1.5, dash: 'dash' };
        shapes.push(onY
          ? { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: v, y1: v, line }
          : { type: 'line', xref: 'x', yref: 'paper', x0: v, x1: v, y0: 0, y1: 1, line });
      }
    }
    if (shapes.length) {
      layout.shapes = shapes;
    }

    // react() diffs against what is already drawn instead of rebuilding the node.
    Plotly.react(target, traces, layout, {
      displayModeBar: false,
      responsive: false,
      // The axis titles are the only annotations, so this makes exactly them draggable
      // and renameable in place -- the text-box handling of the title.
      edits: { annotationPosition: true, annotationText: true }
    });
    chartHost = target;
    chartSize = { width, height };
    titleGeometry = { plotWidth: plotAreaWidth, plotHeight: plotAreaHeight };
    // Plotly re-emits on every redraw, so bind once per host or a drag stacks handlers.
    if (typeof onTitleEdit === 'function' && editBoundHost !== target && typeof target.on === 'function') {
      editBoundHost = target;
      target.on('plotly_relayout', (event) => {
        const patch = titleEditPatch(event, titleGeometry);
        if (Object.keys(patch).length) {
          onTitleEdit(patch);
        }
      });
    }
    return {
      seriesLabels: chartModel.series.map((s) => String(s.label || '')),
      chartType: isBar ? 'bar' : 'line',
      hasErrorBars: traces.some((trace) => Boolean(trace.error_y)),
      hasCategoryX: isBar || hasCategoryX,
      hasReplicates: isBar && chartModel.series.length === 1 && chartModel.series.some((series) =>
        series.data?.some((point) => point.points?.some(Number.isFinite)))
    };
  }

  // Full-fidelity export straight from the live figure. Plotly.toImage resolves to a
  // data URL for both raster and vector formats.
  function toImage(format = 'png') {
    const Plotly = getPlotly();
    if (!chartHost || typeof Plotly?.toImage !== 'function') {
      return Promise.resolve('');
    }
    return Plotly.toImage(chartHost, {
      format: format === 'svg' ? 'svg' : 'png',
      width: Math.max(320, Math.round(chartSize?.width) || 900),
      height: Math.max(180, Math.round(chartSize?.height) || 500),
      scale: format === 'svg' ? 1 : 2
    });
  }

  return { render, unmount, captureDataUrl, toImage };
}
