import { CHART_FONT_FAMILY, DEFAULT_CHART_PALETTE } from './chart-style-model.js';

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

// Maps the style's tickFormat enum onto Plotly axis number-formatting attributes.
function tickFormatSpec(format) {
  switch (format) {
    case 'fixed1': return { tickformat: '.1f' };
    case 'fixed2': return { tickformat: '.2f' };
    case 'sci': return { exponentformat: 'e' };
    case 'si': return { exponentformat: 'SI' };
    case 'power': return { exponentformat: 'power' };
    default: return {};
  }
}

function legendLayout(position, font) {
  if (position === 'right') return { orientation: 'v', x: 1.02, xanchor: 'left', y: 1, yanchor: 'top', font };
  if (position === 'bottom') return { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.22, yanchor: 'top', font };
  return { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.12, yanchor: 'bottom', font }; // top
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
// chartModel = { chartType: 'line' | 'bar', xLabel, yLabel, showErrorBars?, series: [{ label, data:[{x,y,yVariance?}], markers? }] }
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
    unmount();
    if (!Plotly || !target || !chartModel || !Array.isArray(chartModel.series) || !chartModel.series.length) {
      return { seriesLabels: [] };
    }

    const st = style || {};
    const isBar = chartModel.chartType === 'bar';
    // The x axis follows the data, not the chart type. A summary model carries category
    // strings ("Sample A", "10 uM"); forcing it onto a linear axis coerces every x to
    // NaN and silently drops every point, which is what a bar -> line override used to do.
    const hasCategoryX = chartModel.series.some((series) => (series.data || [])
      .some((point) => point && !Number.isFinite(Number(point.x))));
    const textStyle = st.text || {};
    const fontFamily = textStyle.fontFamily
      ? `${textStyle.fontFamily}, ${CHART_FONT_FAMILY}`
      : CHART_FONT_FAMILY;
    const font = {
      family: fontFamily,
      size: Number.isFinite(textStyle.fontSize) ? textStyle.fontSize : 11,
      color: textStyle.color || st.frameStroke || '#000000',
      weight: textStyle.bold ? 700 : 400,
      style: textStyle.italic ? 'italic' : 'normal',
      lineposition: textStyle.underline ? 'under' : 'none'
    };
    const axisColor = st.frameStroke || '#9bb0c9';
    const gridColor = st.gridColor || '#9bb0c9';
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

    const traces = [];
    chartModel.series.forEach((series, index) => {
      const color = pickSeriesColor(st, series.label, index);
      const data = Array.isArray(series.data) ? series.data : [];
      const name = String(series.label || '');
      const sym = symbolFor(name);
      let error_y;
      if (chartModel.showErrorBars) {
        const array = data.map((p) => (Number.isFinite(p.yVariance) && p.yVariance > 0 ? p.yVariance : 0));
        if (array.some((v) => v > 0)) {
          error_y = { type: 'data', array, color, thickness: errThickness, width: errCapWidth, visible: true };
        }
      }

      if (isBar) {
        const marker = { color };
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
          marker: markerSpec(color)
        });
      }
    });

    const longestSeries = chartModel.series.reduce((max, s) => Math.max(max, (s.data || []).length), 0);
    const autoWidth = Math.max(420, Math.min(1280, (longestSeries || 1) * (isBar ? 70 : 60)));
    const useCustomSize = st.sizeAuto === false;
    const width = useCustomSize && Number.isFinite(st.frameWidth) ? st.frameWidth : autoWidth;
    const height = useCustomSize && Number.isFinite(st.frameHeight) ? st.frameHeight : 280;

    const frameStyle = st.frameStyle || 'box';
    const tickMark = st.tickDir === 'none' ? '' : (st.tickDir || 'outside');
    const tickLen = Number.isFinite(st.tickLen) ? st.tickLen : 5;
    const axisBase = {
      showline: frameStyle !== 'none',
      linecolor: axisColor,
      linewidth: st.frameStrokeWidth ?? 1,
      mirror: frameStyle === 'box',
      zeroline: false,
      gridcolor: gridColor,
      gridwidth: st.gridStrokeWidth ?? 1,
      tickfont: font,
      ticks: tickMark,
      ticklen: tickLen,
      tickcolor: axisColor,
      automargin: true,
      ...tickFormatSpec(st.tickFormat)
    };
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

    // An explicit axis title wins; otherwise the analysis names its own axes.
    const xaxis = {
      ...axisBase,
      title: { text: st.xTitle || chartModel.xLabel || '', font },
      type: xScaleCfg.type,
      showgrid: st.showVerticalGrid !== false,
      tickangle: isBar ? -35 : 0
    };
    const yaxis = {
      ...axisBase,
      title: { text: st.yTitle || chartModel.yLabel || '', font },
      type: yScaleCfg.type,
      showgrid: st.showHorizontalGrid !== false
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
      margin: { l: 70, r: 24, t: st.title ? 44 : 24, b: isBar ? 96 : 56 },
      paper_bgcolor: bgColor,
      plot_bgcolor: bgColor,
      font,
      xaxis,
      yaxis,
      showlegend,
      legend: legendLayout(st.legendPosition, font),
      barmode: st.barMode || 'group'
    };
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
        layout.shapes = [onY
          ? { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: v, y1: v, line }
          : { type: 'line', xref: 'x', yref: 'paper', x0: v, x1: v, y0: 0, y1: 1, line }];
      }
    }

    Plotly.newPlot(target, traces, layout, { displayModeBar: false, responsive: false });
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
