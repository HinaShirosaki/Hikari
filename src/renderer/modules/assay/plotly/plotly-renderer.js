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
const AXIS_GUTTER = 110;
const HOST_PADDING = 24;
const LABEL_GAP = 4;
const MIN_FRAME_HEIGHT = 250;
const MAX_FRAME_HEIGHT = 400;

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

// Axis title placement. Plotly's own axis title is centred on the axis and only
// exposes `standoff` (distance from the axis), so sliding a title along its axis needs
// a paper-anchored annotation instead -- paper 0..1 spans the plot area, so the title
// tracks the plot as it resizes.
const DEFAULT_TITLE_SHIFT = { x: 38, y: 52 };
function axisTitle(text, font, pos, offset, isY) {
  const title = { text, font };
  if (Number.isFinite(offset)) {
    title.standoff = offset;
  }
  if (!Number.isFinite(pos)) {
    return { title, annotation: null };
  }
  const shift = Number.isFinite(offset) ? offset : (isY ? DEFAULT_TITLE_SHIFT.y : DEFAULT_TITLE_SHIFT.x);
  const base = { text, font, xref: 'paper', yref: 'paper', showarrow: false };
  const annotation = isY
    ? { ...base, x: 0, y: pos, xanchor: 'right', yanchor: 'middle', xshift: -shift, textangle: -90 }
    : { ...base, x: pos, y: 0, xanchor: 'center', yanchor: 'top', yshift: -shift };
  return { title: { text: '', font }, annotation };
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
export function createAssayPlotlyRenderer() {
  let chartHost = null;

  const getPlotly = () => (typeof window !== 'undefined' ? window.Plotly : null);

  function unmount() {
    const Plotly = getPlotly();
    if (chartHost && Plotly?.purge) {
      Plotly.purge(chartHost);
    }
    chartHost = null;
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

    // The frame follows the data: room per bar (or per point) plus the axis gutters, and a
    // height tied to that width. A flat 420x280 floor left the axis running well past the
    // last bar on a two-group summary, and a flat 280 height turned a 24-category plot
    // into a letterbox.
    const categoryCount = chartModel.series.reduce((max, s) => Math.max(max, (s.data || []).length), 0) || 1;
    // Grouped bars share a category slot, so the slot grows with the series count -- but
    // only up to a point, past which the bars thin out instead of the plot getting wider.
    const slotWidth = isBar ? 34 + 30 * Math.min(chartModel.series.length, 4) : 44;
    const plotWidth = clampNumber(categoryCount * slotWidth, MIN_PLOT_WIDTH, MAX_PLOT_WIDTH);
    // Never wider than the fixed canvas it sits in: many categories thin the bars out
    // rather than pushing the figure into a scrollbar.
    const available = Math.floor((target.clientWidth || target.parentElement?.clientWidth || 0) - HOST_PADDING);
    const widthCap = available > MIN_PLOT_WIDTH + AXIS_GUTTER
      ? Math.min(MAX_PLOT_WIDTH + AXIS_GUTTER, available)
      : MAX_PLOT_WIDTH + AXIS_GUTTER;
    const autoWidth = Math.min(Math.round(plotWidth + AXIS_GUTTER), widthCap);
    const autoHeight = clampNumber(Math.round(autoWidth * 0.62), MIN_FRAME_HEIGHT, MAX_FRAME_HEIGHT);
    const useCustomSize = st.sizeAuto === false;
    const width = useCustomSize && Number.isFinite(st.frameWidth) ? st.frameWidth : autoWidth;
    const height = useCustomSize && Number.isFinite(st.frameHeight) ? st.frameHeight : autoHeight;

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
    const categorySlot = (width - AXIS_GUTTER) / categoryCount;
    const categoryTickAngle = isBar && labelWidth + LABEL_GAP > categorySlot ? -35 : 0;

    // An explicit axis title wins; otherwise the analysis names its own axes.
    const axisTitles = [
      axisTitle(st.xTitle || chartModel.xLabel || '', font, st.xTitlePos, st.xTitleOffset, false),
      axisTitle(st.yTitle || chartModel.yLabel || '', font, st.yTitlePos, st.yTitleOffset, true)
    ];
    const xaxis = {
      ...axisBase,
      title: axisTitles[0].title,
      type: xScaleCfg.type,
      showgrid: st.showVerticalGrid === true,
      tickangle: categoryTickAngle
    };
    const yaxis = {
      ...axisBase,
      title: axisTitles[1].title,
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
    const layout = {
      width,
      height,
      margin: {
        l: Math.max(70, Number.isFinite(st.yTitleOffset) ? st.yTitleOffset + 26 : 0),
        r: 24,
        t: st.title ? 44 : 24,
        b: Math.max(categoryTickAngle ? 96 : 56, Number.isFinite(st.xTitleOffset) ? st.xTitleOffset + 26 : 0)
      },
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
    const annotations = axisTitles.map((item) => item.annotation).filter(Boolean);
    if (annotations.length) {
      layout.annotations = annotations;
    }
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
    Plotly.react(target, traces, layout, { displayModeBar: false, responsive: false });
    chartHost = target;
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
    const rect = chartHost.getBoundingClientRect?.() || { width: 900, height: 500 };
    return Plotly.toImage(chartHost, {
      format: format === 'svg' ? 'svg' : 'png',
      width: Math.max(320, Math.round(rect.width) || 900),
      height: Math.max(180, Math.round(rect.height) || 500),
      scale: format === 'svg' ? 1 : 2
    });
  }

  return { render, unmount, captureDataUrl, toImage };
}
