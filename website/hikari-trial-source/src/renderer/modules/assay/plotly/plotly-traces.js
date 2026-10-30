import { resolveSeriesStyle } from './chart-style-targets.js';

const DASH = { solid: 'solid', dashed: 'dash', dotted: 'dot' };
const SYMBOL = { circle: 'circle', square: 'square', triangle: 'triangle-up', diamond: 'diamond', cross: 'cross' };
const SHAPE = { curveMonotoneX: 'spline', curveLinear: 'linear', curveStep: 'hv' };

export function buildPlotlyTraces(model, style, valueFont) {
  const isBar = model.chartType === 'bar';
  const background = style.backgroundColor || '#ffffff';
  const axisColor = style.frameStroke || '#000000';
  const traces = [];
  model.series.forEach((series, index) => {
    const name = String(series.label || '');
    const st = resolveSeriesStyle(style, name, index);
    const color = st.color;
    const data = Array.isArray(series.data) ? series.data : [];
    const marker = (values = st) => ({
      color: values.markerFill === 'open' ? background : values.color,
      size: values.pointSize,
      symbol: SYMBOL[values.pointShape] || 'circle',
      ...(values.markerFill === 'open' ? { line: { color: values.color, width: Math.max(1, st.lineWidth * 0.6) } } : {})
    });
    const errorBars = (points) => {
      if (!model.showErrorBars) return undefined;
      const array = points.map((point) => Number.isFinite(point.yVariance) && point.yVariance > 0 ? point.yVariance : 0);
      return array.some((value) => value > 0) ? {
        type: 'data', array, color: st.errorColor || (isBar ? axisColor : color),
        thickness: st.errorThickness, width: st.errorCapWidth, visible: true
      } : undefined;
    };
    if (isBar) {
      const bar = {
        type: 'bar', name, opacity: st.opacity,
        x: data.map((point) => point.x), y: data.map((point) => point.y),
        marker: { color, line: { color: st.barOutlineColor || axisColor, width: st.barOutlineWidth ?? 1 },
          ...(style.barCornerRadius > 0 ? { cornerradius: style.barCornerRadius } : {}) },
        error_y: errorBars(data)
      };
      if (style.barLabels) {
        bar.text = data.map((point) => Number.isFinite(point.y) ? String(Math.round(point.y * 100) / 100) : '');
        bar.textposition = 'outside'; bar.textfont = valueFont;
      }
      traces.push(bar);
      // Grouped bars need explicit scatter offsets; keep the established single-series overlay.
      if (model.series.length === 1) {
        const points = data.flatMap((point) => (Array.isArray(point.points) ? point.points : [])
          .filter(Number.isFinite).map((y) => ({ x: point.x, y })));
        if (points.length) {
          const legacy = style.replicateStyle || {};
          const overrides = style.seriesStyles?.[name] || {};
          const dotStyle = { ...st, ...legacy, ...overrides, pointShape: st.pointShape };
          const dots = marker(dotStyle);
          if (legacy.outlineWidth !== undefined && !Object.hasOwn(overrides, 'markerFill')) {
            dots.line = { color: dotStyle.color, width: legacy.outlineWidth };
          }
          traces.push({ type: 'scatter', mode: 'markers', name, showlegend: false, opacity: st.opacity,
            x: points.map((point) => point.x), y: points.map((point) => point.y), marker: dots });
        }
      }
      return;
    }
    const fitted = Array.isArray(series.markers);
    const mode = st.mode || 'lines+markers';
    const showLine = mode.includes('lines');
    const showMarkers = mode.includes('markers');
    if (!fitted || showLine) {
      traces.push({ type: 'scatter', name, opacity: st.opacity, mode: fitted ? 'lines' : mode,
        x: data.map((point) => point.x), y: data.map((point) => point.y),
        line: { color, width: st.lineWidth, dash: DASH[st.lineStyle] || 'solid', shape: SHAPE[st.curve] || 'spline' },
        marker: marker(), error_y: fitted ? undefined : errorBars(data) });
    }
    if (fitted && showMarkers && series.markers.length) {
      traces.push({ type: 'scatter', name, opacity: st.opacity, mode: 'markers', showlegend: !showLine,
        x: series.markers.map((point) => point.x), y: series.markers.map((point) => point.y),
        marker: marker(), error_y: errorBars(series.markers) });
    }
  });
  return traces;
}
