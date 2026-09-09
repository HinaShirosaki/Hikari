import { createDefaultChartStyle, normalizeChartStyle } from './chart-style-model.js';

// Assay-owned Plotly style state plus the data context (column headers + series labels)
// the controls need. onChange(style) fires after every style mutation.
export function createChartStyleStore({ initialStyle, onChange } = {}) {
  let style = initialStyle ? normalizeChartStyle(initialStyle) : createDefaultChartStyle();
  // chartType / hasErrorBars / hasFittedCurve describe what was actually rendered, so
  // the controls can hide the settings that would do nothing for this figure.
  let context = {
    headers: [],
    numericHeaders: [],
    seriesLabels: [],
    method: '',
    chartType: '',
    hasErrorBars: false,
    hasCategoryX: false,
    hasReplicates: false,
    hasFittedCurve: false
  };

  // onChange receives the previous style too, so listeners can tell a redraw-only
  // change from one that invalidates the chart model.
  function emit(previous) {
    if (typeof onChange === 'function') onChange(style, previous);
    return style;
  }

  return {
    getStyle: () => style,
    getDefaultStyle: () => createDefaultChartStyle(),
    setStyle(patch) {
      const previous = style;
      style = normalizeChartStyle({ ...style, ...(patch || {}) });
      return emit(previous);
    },
    resetStyle() {
      const previous = style;
      style = createDefaultChartStyle();
      return emit(previous);
    },
    // Replace the style without firing onChange (e.g. loading a saved style).
    setStyleSilent(next) {
      style = next ? normalizeChartStyle(next) : createDefaultChartStyle();
      return style;
    },
    getContext: () => ({
      headers: context.headers.slice(),
      numericHeaders: context.numericHeaders.slice(),
      seriesLabels: context.seriesLabels.slice(),
      method: context.method,
      chartType: context.chartType,
      hasErrorBars: context.hasErrorBars,
      hasCategoryX: context.hasCategoryX,
      hasReplicates: context.hasReplicates,
      hasFittedCurve: context.hasFittedCurve
    }),
    setContext(ctx) {
      context = {
        headers: Array.isArray(ctx?.headers) ? ctx.headers.map(String) : [],
        numericHeaders: Array.isArray(ctx?.numericHeaders) ? ctx.numericHeaders.map(String) : [],
        seriesLabels: Array.isArray(ctx?.seriesLabels) ? ctx.seriesLabels.map(String) : [],
        method: ctx?.method || '',
        chartType: ctx?.chartType || '',
        hasErrorBars: Boolean(ctx?.hasErrorBars),
        hasCategoryX: Boolean(ctx?.hasCategoryX),
        hasReplicates: Boolean(ctx?.hasReplicates),
        hasFittedCurve: Boolean(ctx?.hasFittedCurve)
      };
    }
  };
}
