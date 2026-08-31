import { DEFAULT_CHART_PALETTE } from './chart-style-model.js';
import {
  PRISM_BAR_GAP,
  PRISM_BAR_GROUP_GAP,
  prismAxisDefaults,
  prismFonts,
  prismFrameShapes
} from './prism-theme.js';

const LINE_DASH_MAP = { solid: 'solid', dashed: 'dash', dotted: 'dot' };
const POINT_SYMBOL_MAP = {
  circle: 'circle',
  square: 'square',
  triangle: 'triangle-up',
  diamond: 'diamond',
  cross: 'cross'
};
const LINE_SHAPE_MAP = { curveMonotoneX: 'spline', curveLinear: 'linear', curveStep: 'hv' };

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

function formatValue(value) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '';
}

function pickSeriesColor(style, label, index) {
  const labelKey = String(label || '');
  if (labelKey && style.seriesColors && style.seriesColors[labelKey]) {
    return style.seriesColors[labelKey];
  }
  const palette = style.palette && style.palette.length ? style.palette : DEFAULT_CHART_PALETTE;
  return palette[index % palette.length];
}

function explicitRange(range) {
  if (range && range.auto === false
    && Number.isFinite(range.min) && Number.isFinite(range.max)
    && range.min < range.max) {
    return [range.min, range.max];
  }
  return null;
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
    const axisColor = st.frameStroke || '#9bb0c9';
    const dash = LINE_DASH_MAP[st.lineStyle] || 'solid';
    const lineShape = LINE_SHAPE_MAP[st.curve] || 'spline';
    const pointSize = Number.isFinite(st.pointSize) ? st.pointSize : 6;
    const lineWidth = Number.isFinite(st.lineWidth) ? st.lineWidth : 2.5;
    const bgColor = st.backgroundColor || '#ffffff';
    const opacity = Number.isFinite(st.opacity) ? st.opacity : 1;
    const errThickness = Number.isFinite(st.errorThickness) ? st.errorThickness : 1.2;
    const errCapWidth = Number.isFinite(st.errorCapWidth) ? st.errorCapWidth : 4;
    // Per-series shape overrides the global pointShape default (mirrors seriesColors).
    const seriesShapes = st.seriesShapes || {};
    const symbolFor = (label) => POINT_SYMBOL_MAP[seriesShapes[label] || st.pointShape] || 'circle';
    // Open markers = background-filled symbol with a colored outline (Prism convention).
    const markerSpec = (color, sym) => (st.markerFill === 'open'
      ? { color: bgColor, size: pointSize, symbol: sym, line: { color, width: Math.max(1, lineWidth * 0.6) } }
      : { color, size: pointSize, symbol: sym });

    // Prism draws bar error bars in the axis colour and line error bars in the series
    // colour. Whichever points carry the spread get the bars: a fitted curve's spread
    // lives on its observed markers, not on the sampled line.
    const errorBarsFor = (points, color) => {
      if (!chartModel.showErrorBars) {
        return undefined;
      }
      const array = points.map((p) => (Number.isFinite(p.yVariance) && p.yVariance > 0 ? p.yVariance : 0));
      return array.some((v) => v > 0)
        ? { type: 'data', array, color, thickness: errThickness, width: errCapWidth, visible: true }
        : undefined;
    };

    const traces = [];
    chartModel.series.forEach((series, index) => {
      const color = pickSeriesColor(st, series.label, index);
      const data = Array.isArray(series.data) ? series.data : [];
      const name = String(series.label || '');
      const sym = symbolFor(name);
      const error_y = errorBarsFor(data, isBar ? axisColor : color);

      if (isBar) {
        // Prism outlines every bar in the axis colour.
        const marker = { color, line: { color: axisColor, width: 1 } };
        if (Number.isFinite(st.barCornerRadius) && st.barCornerRadius > 0) {
          marker.cornerradius = st.barCornerRadius;
        }
        const bar = {
          type: 'bar',
          name,
          opacity,
          x: data.map((p) => p.x),
          y: data.map((p) => p.y),
          marker,
          error_y
        };
        if (st.barLabels) {
          bar.text = data.map((p) => formatValue(p.y));
          bar.textposition = 'outside';
          bar.textfont = font;
        }
        traces.push(bar);
        // Prism's scatter-over-bar: each replicate dotted above its own bar, aligned in a
        // column (no jitter) so the same data always renders identically.
        // ponytail: single-series only - Plotly scatter traces ignore bar offsetgroup, so
        // with grouped bars every dot would land on the category centre. Compute manual
        // x offsets if grouped bars ever need dots.
        if (chartModel.series.length === 1) {
          const dotX = [];
          const dotY = [];
          data.forEach((point) => {
            (Array.isArray(point.points) ? point.points : []).forEach((value) => {
              if (Number.isFinite(value)) {
                dotX.push(point.x);
                dotY.push(value);
              }
            });
          });
          if (dotX.length) {
            traces.push({
              type: 'scatter',
              mode: 'markers',
              name,
              showlegend: false,
              x: dotX,
              y: dotY,
              marker: {
                color: bgColor,
                size: Math.max(4, pointSize - 1),
                symbol: sym,
                line: { color: axisColor, width: 1 }
              }
            });
          }
        }
        return;
      }

      const hasExplicitMarkers = Array.isArray(series.markers);
      traces.push({
        type: 'scatter',
        mode: hasExplicitMarkers ? 'lines' : (st.mode || 'lines+markers'),
        name,
        opacity,
        x: data.map((p) => p.x),
        y: data.map((p) => p.y),
        line: { color, width: lineWidth, dash, shape: lineShape },
        marker: markerSpec(color, sym),
        error_y
      });
      if (hasExplicitMarkers && series.markers.length) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name,
          opacity,
          showlegend: false,
          x: series.markers.map((p) => p.x),
          y: series.markers.map((p) => p.y),
          marker: markerSpec(color, sym),
          error_y: errorBarsFor(series.markers, color)
        });
      }
    });

    // Everything below is sized in plot-area terms, and the margins are added back on
    // top at the end. Plotly's width/height are the whole figure, so sizing the figure
    // instead would let a pushed-out axis title eat the plot rather than grow the frame.
    // The plot area follows the data: room per bar (or per point), and a height tied to
    // that width. A flat 420x280 floor left the axis running well past the last bar on a
    // two-group summary, and a flat 280 height turned a 24-category plot into a letterbox.
    const marginLeft = Math.max(70, titleShift(st.yTitleOffset, true) + 26);
    const marginRight = 24;
    const marginTop = st.title ? 44 : 24;
    const categoryCount = chartModel.series.reduce((max, s) => Math.max(max, (s.data || []).length), 0) || 1;
    // Grouped bars share a category slot, so the slot grows with the series count -- but
    // only up to a point, past which the bars thin out instead of the plot getting wider.
    const slotWidth = isBar ? 34 + 30 * Math.min(chartModel.series.length, 4) : 44;
    // Never wider than the fixed canvas it sits in: many categories thin the bars out
    // rather than pushing the figure into a scrollbar.
    const available = Math.floor((target.clientWidth || target.parentElement?.clientWidth || 0) - HOST_PADDING);
    const widthCap = available > MIN_PLOT_WIDTH + marginLeft + marginRight
      ? Math.min(MAX_PLOT_WIDTH, available - marginLeft - marginRight)
      : MAX_PLOT_WIDTH;
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

    const tickMark = st.tickDir === 'none' ? '' : (st.tickDir || 'outside');
    const tickLen = Number.isFinite(st.tickLen) ? st.tickLen : 5;
    const axisBase = prismAxisDefaults(st, tickFont);
    const minorFor = (cfg) => {
      if (!st.minorTicks) return undefined;
      const minor = {
        ticks: tickMark || 'outside',
        ticklen: Math.max(2, tickLen * 0.6),
        tickcolor: axisColor,
        showgrid: false
      };
      if (cfg.type === 'linear') minor.nticks = 5;
      return minor;
    };

    const xScaleCfg = isBar || hasCategoryX ? { type: 'category', dtick: null } : scaleAxis(st.xScale);
    const yScaleCfg = scaleAxis(st.yScale);

    // Prism writes category labels horizontally; only tilt them when they would collide.
    // Collision is label width against the slot each category actually gets, so 24 short
    // labels tilt for the same reason two long ones do.
    const longestCategory = !isBar ? 0 : chartModel.series.reduce((max, series) => (series.data || [])
      .reduce((inner, point) => Math.max(inner, String(point.x ?? '').length), max), 0);
    const labelWidth = longestCategory * (tickFont.size || 12) * 0.62;
    const categorySlot = plotAreaWidth / categoryCount;
    const categoryTickAngle = isBar && labelWidth + LABEL_GAP > categorySlot ? -35 : 0;

    // An explicit axis title wins; otherwise the analysis names its own axes. Both are
    // drawn as annotations (see axisTitleAnnotation), so the axes themselves stay untitled.
    const axisTitles = [
      axisTitleAnnotation(st.xTitle || chartModel.xLabel || '', font,
        st.xTitlePos, st.xTitleOffset, false, plotAreaWidth, plotAreaHeight),
      axisTitleAnnotation(st.yTitle || chartModel.yLabel || '', font,
        st.yTitlePos, st.yTitleOffset, true, plotAreaWidth, plotAreaHeight)
    ];
    const xaxis = {
      ...axisBase,
      // automargin grows the margin into the plot area, which would shrink the exact
      // size that was asked for. In auto mode it still guards against clipped labels.
      automargin: !exactSize,
      title: { text: '', font },
      type: xScaleCfg.type,
      showgrid: st.showVerticalGrid === true,
      tickangle: categoryTickAngle
    };
    const yaxis = {
      ...axisBase,
      automargin: !exactSize,
      title: { text: '', font },
      type: yScaleCfg.type,
      showgrid: st.showHorizontalGrid === true
    };
    // Tick interval: user value on linear axes; log axes tick by their base (2/e/10).
    const xDtick = xScaleCfg.type === 'linear' && Number.isFinite(st.xTick) && st.xTick > 0
      ? st.xTick : xScaleCfg.dtick;
    if (xDtick != null) xaxis.dtick = xDtick;
    const yDtick = yScaleCfg.type === 'linear' && Number.isFinite(st.yTick) && st.yTick > 0
      ? st.yTick : yScaleCfg.dtick;
    if (yDtick != null) yaxis.dtick = yDtick;
    // ponytail: explicit ranges only on linear axes (Plotly log range is log10).
    if (xScaleCfg.type === 'linear') {
      const xr = explicitRange(st.xRange);
      if (xr) xaxis.range = xr;
    }
    if (yScaleCfg.type === 'linear') {
      const yr = explicitRange(st.yRange);
      if (yr) yaxis.range = yr;
    }

    const xMinor = minorFor(xScaleCfg);
    if (xMinor) xaxis.minor = xMinor;
    const yMinor = minorFor(yScaleCfg);
    if (yMinor) yaxis.minor = yMinor;

    const showlegend = st.legendPosition !== 'none' && chartModel.series.length > 1;
    const margin = {
      l: marginLeft,
      r: marginRight,
      t: marginTop,
      // Only known once the tick angle is: tilted category labels need the deeper gutter.
      b: Math.max(categoryTickAngle ? 96 : 56, titleShift(st.xTitleOffset, false) + 26)
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
      legend: legendLayout(st.legendPosition, font),
      barmode: st.barMode || 'group',
      // Prism bars sit apart with tight groups.
      bargap: PRISM_BAR_GAP,
      bargroupgap: PRISM_BAR_GROUP_GAP
    };
    layout.annotations = axisTitles;
    const shapes = prismFrameShapes(st);
    if (st.title) {
      layout.title = { text: st.title, font, x: 0.5, xanchor: 'center' };
    }
    // Reference line: value is in data space; on a log axis Plotly shape coords are log10.
    if (Number.isFinite(st.refLineValue)) {
      const onY = st.refLineAxis !== 'x';
      const cfg = onY ? yScaleCfg : xScaleCfg;
      const v = cfg.type === 'log' ? (st.refLineValue > 0 ? Math.log10(st.refLineValue) : null) : st.refLineValue;
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
      hasErrorBars: traces.some((trace) => Boolean(trace.error_y))
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
