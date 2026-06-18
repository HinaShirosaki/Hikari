import { createChartRenderer } from './chart-renderer.js';
import { createChartStyleStore } from './chart-style-store.js';
import { mountChartControls } from './chart-controls.js';

export {
  createDefaultChartStyle,
  normalizeChartStyle,
  CHART_STYLE_OPTIONS,
  DEFAULT_CHART_PALETTE,
  CHART_FONT_FAMILY
} from './chart-style-model.js';

// Reusable chart engine: renderer + style store + (optional) self-mounting adjust panel.
//
//   const engine = createChartEngine({
//     getChartTarget: () => document.querySelector('#chart'),  // re-evaluated each render
//     controlsTarget: document.querySelector('#chart-controls'), // optional; panel built here
//     ReactLib, ReactDOMLib, ReactVisLib,
//     initialStyle,            // optional saved style
//     onChange: (style) => {}, // optional; if given, engine does NOT auto-render
//     safeText                 // optional html escaper for column labels
//   });
//   engine.setContext({ headers, seriesLabels });  // feeds the column/series controls
//   engine.setData(chartModel);
//   engine.render();
//
// chartModel shape: see chart-renderer.js.
//
// If `onChange` is omitted the engine re-renders the current model on every style
// tweak (good enough for charts whose data doesn't depend on column selection).
// If `onChange` is provided the consumer owns re-rendering (e.g. rebuild the model
// when xColumn/yColumn/seriesColumn change, then call setData + render).
export function createChartEngine({
  getChartTarget,
  controlsTarget,
  ReactLib,
  ReactDOMLib,
  ReactVisLib,
  initialStyle,
  onChange,
  safeText
} = {}) {
  const hasReactVis = Boolean(ReactLib && ReactDOMLib && ReactVisLib);
  const renderer = createChartRenderer({ ReactLib, ReactDOMLib, ReactVisLib, hasReactVis });
  let currentModel = null;
  let lastSeriesLabels = [];

  const resolveTarget = () => (typeof getChartTarget === 'function' ? getChartTarget() : getChartTarget);

  function render() {
    const target = resolveTarget();
    if (!target || !currentModel) {
      lastSeriesLabels = [];
      return { seriesLabels: [] };
    }
    const info = renderer.render(target, currentModel, store.getStyle());
    lastSeriesLabels = info.seriesLabels;
    return info;
  }

  const store = createChartStyleStore({
    initialStyle,
    onChange: (style) => {
      if (typeof onChange === 'function') {
        onChange(style);
      } else {
        render();
      }
    }
  });

  const controls = controlsTarget
    ? mountChartControls(controlsTarget, { store, safeText })
    : null;

  return {
    getStyle: () => store.getStyle(),
    setStyle: (patch) => store.setStyle(patch),
    resetStyle: () => store.resetStyle(),
    // Adopt a saved style without triggering onChange, then re-sync the panel.
    loadStyle(style) { store.setStyleSilent(style); controls?.refresh(); return store.getStyle(); },
    setData(model) { currentModel = model || null; return this; },
    setContext(ctx) { store.setContext(ctx); controls?.refresh(); return this; },
    render,
    unmount() { renderer.unmount(); },
    toDataUrl() { return renderer.captureDataUrl(); },
    refreshControls() { controls?.refresh(); },
    getSeriesLabels: () => lastSeriesLabels.slice(),
    destroy() {
      controls?.destroy();
      renderer.unmount();
    }
  };
}
