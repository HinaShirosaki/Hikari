import { createDefaultChartStyle, normalizeChartStyle } from './chart-style-model.js';

// Assay-owned Plotly style state plus the data context (column headers + series labels)
// the controls need. onChange(style) fires after every style mutation.
export function createChartStyleStore({ initialStyle, onChange } = {}) {
  let style = initialStyle ? normalizeChartStyle(initialStyle) : createDefaultChartStyle();
  let context = { headers: [], seriesLabels: [], method: '' };

  function emit() {
    if (typeof onChange === 'function') onChange(style);
    return style;
  }

  return {
    getStyle: () => style,
    setStyle(patch) {
      style = normalizeChartStyle({ ...style, ...(patch || {}) });
      return emit();
    },
    resetStyle() {
      style = createDefaultChartStyle();
      return emit();
    },
    // Replace the style without firing onChange (e.g. loading a saved style).
    setStyleSilent(next) {
      style = next ? normalizeChartStyle(next) : createDefaultChartStyle();
      return style;
    },
    getContext: () => ({
      headers: context.headers.slice(),
      seriesLabels: context.seriesLabels.slice(),
      method: context.method
    }),
    setContext(ctx) {
      context = {
        headers: Array.isArray(ctx?.headers) ? ctx.headers.map(String) : [],
        seriesLabels: Array.isArray(ctx?.seriesLabels) ? ctx.seriesLabels.map(String) : [],
        method: ctx?.method || ''
      };
    }
  };
}
