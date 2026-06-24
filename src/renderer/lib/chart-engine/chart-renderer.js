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

// Generic chart renderer (Plotly.js engine): render(target, chartModel, style) -> { seriesLabels }.
// chartModel = { chartType: 'line' | 'bar', xLabel, yLabel, showErrorBars?, series: [{ label, data:[{x,y,yVariance?}], markers? }] }
// Plotly is loaded as a window global by index.html.
export function createChartRenderer() {
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
    const symbol = POINT_SYMBOL_MAP[st.pointShape] || 'circle';
    const lineShape = LINE_SHAPE_MAP[st.curve] || 'spline';
    const pointSize = Number.isFinite(st.pointSize) ? st.pointSize : 6;
    const lineWidth = Number.isFinite(st.lineWidth) ? st.lineWidth : 2.5;

    const traces = [];
    chartModel.series.forEach((series, index) => {
      const color = pickSeriesColor(st, series.label, index);
      const data = Array.isArray(series.data) ? series.data : [];
      const name = String(series.label || '');
      let error_y;
      if (chartModel.showErrorBars) {
        const array = data.map((p) => (Number.isFinite(p.yVariance) && p.yVariance > 0 ? p.yVariance : 0));
        if (array.some((v) => v > 0)) {
          error_y = { type: 'data', array, color, thickness: 1.2, width: 4, visible: true };
        }
      }

      if (isBar) {
        traces.push({
          type: 'bar',
          name,
          x: data.map((p) => p.x),
          y: data.map((p) => p.y),
          marker: { color },
          error_y
        });
        return;
      }

      const hasExplicitMarkers = Array.isArray(series.markers);
      traces.push({
        type: 'scatter',
        mode: hasExplicitMarkers ? 'lines' : 'lines+markers',
        name,
        x: data.map((p) => p.x),
        y: data.map((p) => p.y),
        line: { color, width: lineWidth, dash, shape: lineShape },
        marker: { color, size: pointSize, symbol },
        error_y
      });
      if (hasExplicitMarkers && series.markers.length) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name,
          showlegend: false,
          x: series.markers.map((p) => p.x),
          y: series.markers.map((p) => p.y),
          marker: { color, size: pointSize, symbol }
        });
      }
    });

    const longestSeries = chartModel.series.reduce((max, s) => Math.max(max, (s.data || []).length), 0);
    const autoWidth = Math.max(420, Math.min(1280, (longestSeries || 1) * (isBar ? 70 : 60)));
    const useCustomSize = st.sizeAuto === false;
    const width = useCustomSize && Number.isFinite(st.frameWidth) ? st.frameWidth : autoWidth;
    const height = useCustomSize && Number.isFinite(st.frameHeight) ? st.frameHeight : 280;

    const frameStyle = st.frameStyle || 'box';
    const axisBase = {
      showline: frameStyle !== 'none',
      linecolor: axisColor,
      linewidth: st.frameStrokeWidth ?? 1,
      mirror: frameStyle === 'box',
      zeroline: false,
      gridcolor: gridColor,
      gridwidth: st.gridStrokeWidth ?? 1,
      tickfont: font,
      automargin: true
    };

    const xAxisType = isBar
      ? 'category'
      : (st.xScale === 'log' ? 'log' : st.xScale === 'ordinal' ? 'category' : undefined);
    const yAxisType = st.yScale === 'log' ? 'log' : 'linear';

    const xaxis = {
      ...axisBase,
      title: { text: chartModel.xLabel || '', font },
      showgrid: st.showVerticalGrid !== false,
      tickangle: isBar ? -35 : 0
    };
    if (xAxisType) xaxis.type = xAxisType;
    const yaxis = {
      ...axisBase,
      title: { text: chartModel.yLabel || '', font },
      showgrid: st.showHorizontalGrid !== false,
      type: yAxisType
    };
    // ponytail: explicit ranges only on linear axes (Plotly log range is log10).
    if (!isBar && xAxisType !== 'log' && xAxisType !== 'category') {
      const xr = explicitRange(st.xRange);
      if (xr) xaxis.range = xr;
    }
    if (yAxisType !== 'log') {
      const yr = explicitRange(st.yRange);
      if (yr) yaxis.range = yr;
    }

    const bgColor = st.backgroundColor || '#ffffff';
    const layout = {
      width,
      height,
      margin: { l: 70, r: 24, t: 24, b: isBar ? 96 : 56 },
      paper_bgcolor: bgColor,
      plot_bgcolor: bgColor,
      font,
      xaxis,
      yaxis,
      showlegend: chartModel.series.length > 1,
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.12, yanchor: 'bottom', font },
      barmode: 'group'
    };

    target.style.borderRadius = `${st.frameCornerRadius ?? 0}px`;
    target.style.overflow = 'hidden';
    Plotly.newPlot(target, traces, layout, { displayModeBar: false, responsive: false });
    chartHost = target;
    return { seriesLabels: chartModel.series.map((s) => String(s.label || '')) };
  }

  return { render, unmount, captureDataUrl };
}
