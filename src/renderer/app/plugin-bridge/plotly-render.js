const SVG_TRACE_TYPES = new Set(['scatter', 'bar', 'box', 'violin', 'histogram', 'histogram2d', 'histogram2dcontour', 'heatmap', 'contour', 'pie', 'scatterpolar', 'barpolar', 'scatterternary', 'waterfall', 'funnel', 'funnelarea', 'indicator', 'table', 'sunburst', 'treemap', 'icicle', 'sankey']);
const loads = new WeakMap();
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

export function normalizePluginPlot(input = {}) {
  const figure = input.figure;
  if (!plain(figure) || !Array.isArray(figure.data) || !figure.data.length || figure.data.length > 100
    || (figure.layout !== undefined && !plain(figure.layout))) throw new Error('plotly.render needs figure:{data:[traces],layout:{...}} with 1–100 traces.');
  const visit = (value, depth = 0) => {
    if (depth > 32) throw new Error('The plot specification is too deeply nested.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Plot specifications must contain JSON values and finite numbers only.');
    for (const item of Object.values(value)) visit(item, depth + 1);
  };
  visit(figure);
  if (JSON.stringify(figure).length > 2000000) throw new Error('Plot specifications must be at most 2 million characters.');
  if (figure.data.some(trace => !plain(trace) || !SVG_TRACE_TYPES.has(trace.type || 'scatter'))) throw new Error('Use a supported offline scientific Plotly trace, such as scatter, bar, box, violin, histogram, heatmap or contour.');
  const layout = figure.layout || {};
  if (layout.images?.length || layout.geo || layout.map || layout.mapbox || layout.template?.layout?.images?.length) throw new Error('Plotly plots must be self-contained. Place images separately on the plugin canvas.');
  const width = Math.round(input.width ?? 800), height = Math.round(input.height ?? 500);
  if (![width, height].every(value => Number.isFinite(value) && value >= 64 && value <= 8000)) throw new Error('Plot dimensions must be 64–8000 pixels.');
  return { figure: JSON.parse(JSON.stringify({ data: figure.data, layout })), width, height };
}

function loadPlotly(windowObject) {
  if (windowObject.Plotly?.newPlot) return Promise.resolve(windowObject.Plotly);
  if (!loads.has(windowObject)) loads.set(windowObject, new Promise((resolve, reject) => {
    const script = windowObject.document.createElement('script');
    script.src = new URL('../../../../vendor/plotly/plotly.min.js', import.meta.url).href;
    script.onload = () => windowObject.Plotly?.newPlot ? resolve(windowObject.Plotly) : reject(new Error('The vendored Plotly library is unavailable.'));
    script.onerror = () => { script.remove(); reject(new Error('Could not load the vendored Plotly library.')); };
    windowObject.document.head.append(script);
  }).catch(error => { loads.delete(windowObject); throw error; }));
  return loads.get(windowObject);
}

export async function renderPluginPlot(input, windowObject) {
  const { figure, width, height } = normalizePluginPlot(input);
  const Plotly = await loadPlotly(windowObject);
  const target = windowObject.document.createElement('div');
  target.setAttribute('aria-hidden', 'true');
  Object.assign(target.style, { position: 'fixed', left: '-20000px', top: '0', width: `${width}px`, height: `${height}px`, pointerEvents: 'none' });
  windowObject.document.body.append(target);
  try {
    const layout = { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', ...figure.layout,
      font: { family: 'Inter, Arial, sans-serif', size: 16, color: '#222222', ...figure.layout.font }, width, height, autosize: false };
    for (const axis of new Set(['xaxis', 'yaxis', ...Object.keys(layout).filter(key => /^[xy]axis\d*$/.test(key))])) layout[axis] = { automargin: true, ...layout[axis] };
    await Plotly.newPlot(target, figure.data, layout, { staticPlot: true, responsive: false, displayModeBar: false, showLink: false, plotlyServerURL: '', topojsonURL: '' });
    const image = await Plotly.toImage(target, { format: 'svg', width, height });
    if (!image.startsWith('data:image/svg+xml,')) throw new Error('Plotly did not return an SVG plot.');
    const parsed = new windowObject.DOMParser().parseFromString(decodeURIComponent(image.slice('data:image/svg+xml,'.length)), 'image/svg+xml');
    // Plotly emits inline CSS. Convert its graphic properties in the host so
    // strict-CSP plugin documents only ever parse presentation attributes.
    for (const node of [parsed.documentElement, ...parsed.querySelectorAll('[style]')]) {
      for (const property of [...node.style]) {
        if (/^(?:fill(?:-opacity|-rule)?|stroke(?:-[a-z-]+)?|font-(?:family|size|weight|style|variant)|text-(?:anchor|decoration|rendering)|(?:dominant|alignment)-baseline|opacity|color|clip-path|display|visibility|overflow|white-space|pointer-events|shape-rendering|image-rendering|vector-effect|paint-order|letter-spacing|word-spacing|stop-(?:color|opacity))$/.test(property)) node.setAttribute(property, node.style.getPropertyValue(property));
      }
      node.removeAttribute('style');
    }
    return { svg: new windowObject.XMLSerializer().serializeToString(parsed.documentElement), width, height, engine: 'plotly.js', version: Plotly.version };
  } finally { Plotly.purge(target); target.remove(); }
}
