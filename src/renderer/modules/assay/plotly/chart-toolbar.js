// Chart toolbar: the handful of settings people change constantly, kept in the same
// eyeline as the figure instead of four sections down the left rail. Everything else
// lives behind Format.

const TOOLBAR_HTML = `
  <div class="assay-chart-toolbar-group" data-tb="chartTypeGroup">
    <span class="assay-chart-toolbar-label">Chart</span>
    <div class="assay-chart-toolbar-seg" role="group" aria-label="Chart type">
      <button type="button" data-tb-chart-type="auto">Auto</button>
      <button type="button" data-tb-chart-type="line">Line</button>
      <button type="button" data-tb-chart-type="bar">Bar</button>
    </div>
  </div>
  <div class="assay-chart-toolbar-group">
    <span class="assay-chart-toolbar-label">Y</span>
    <div class="assay-chart-toolbar-seg" role="group" aria-label="Y axis scale">
      <button type="button" data-tb-y-scale="linear">Lin</button>
      <button type="button" data-tb-y-scale="log10">Log</button>
    </div>
  </div>
  <label class="assay-chart-toolbar-group">
    <span class="assay-chart-toolbar-label">Legend</span>
    <select data-tb="legend" aria-label="Legend position">
      <option value="top">Top</option>
      <option value="bottom">Bottom</option>
      <option value="right">Right</option>
      <option value="none">Hidden</option>
    </select>
  </label>
  <button type="button" class="ghost-btn assay-chart-toolbar-btn" data-tb="errorBars" aria-pressed="false">
    Error bars
  </button>
  <span class="assay-chart-toolbar-spacer"></span>
  <span class="assay-chart-toolbar-label">Export</span>
  <button type="button" class="ghost-btn assay-chart-toolbar-btn" data-tb="exportPng">PNG</button>
  <button type="button" class="ghost-btn assay-chart-toolbar-btn" data-tb="exportSvg">SVG</button>
  <button type="button" class="primary-btn assay-chart-toolbar-btn" data-tb="format">Format&hellip;</button>
`;

// container: the toolbar host. store: the chart style store.
// errorBars: { isApplicable(), get(), toggle() } — error bars belong to the analysis
// spec, so the toolbar drives the existing checkbox rather than holding its own state.
export function mountChartToolbar(container, {
  store,
  errorBars,
  onFormat,
  onExport
} = {}) {
  if (!container || !store) {
    return { refresh() {}, destroy() {} };
  }
  container.innerHTML = TOOLBAR_HTML;
  const q = (key) => container.querySelector(`[data-tb="${key}"]`);

  function setSegment(attribute, value, disabled) {
    container.querySelectorAll(`[${attribute}]`).forEach((button) => {
      button.setAttribute('aria-pressed', button.getAttribute(attribute) === value ? 'true' : 'false');
      button.disabled = Boolean(disabled);
    });
  }

  function refresh() {
    const style = store.getStyle();
    const context = store.getContext();
    // A fitted curve is a sampled line plus its observed markers; drawing that as bars
    // is meaningless, so the override is unavailable rather than silently ignored.
    const typeLocked = context.chartType === 'line' && context.hasFittedCurve;
    setSegment('data-tb-chart-type', style.chartType, typeLocked);
    const group = q('chartTypeGroup');
    if (group) {
      group.title = typeLocked
        ? 'This analysis draws a fitted curve, so the chart type is fixed to a line.'
        : '';
    }
    setSegment('data-tb-y-scale', style.yScale === 'linear' ? 'linear' : 'log10', false);
    const legend = q('legend');
    if (legend) {
      legend.value = style.legendPosition;
    }
    const errorBarsBtn = q('errorBars');
    if (errorBarsBtn) {
      const applicable = Boolean(errorBars?.isApplicable?.());
      errorBarsBtn.hidden = !applicable;
      errorBarsBtn.setAttribute('aria-pressed', applicable && errorBars.get() ? 'true' : 'false');
    }
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !container.contains(button)) {
      return;
    }
    const chartType = button.getAttribute('data-tb-chart-type');
    if (chartType) {
      store.setStyle({ chartType });
      refresh();
      return;
    }
    const yScale = button.getAttribute('data-tb-y-scale');
    if (yScale) {
      store.setStyle({ yScale });
      refresh();
      return;
    }
    const action = button.getAttribute('data-tb');
    if (action === 'errorBars') {
      errorBars?.toggle?.();
      refresh();
    } else if (action === 'format') {
      onFormat?.();
    } else if (action === 'exportPng') {
      onExport?.('png');
    } else if (action === 'exportSvg') {
      onExport?.('svg');
    }
  }

  function onLegendChange() {
    store.setStyle({ legendPosition: q('legend')?.value || 'top' });
  }

  container.addEventListener('click', onClick);
  q('legend')?.addEventListener('change', onLegendChange);
  refresh();

  return {
    refresh,
    destroy() {
      container.removeEventListener('click', onClick);
      q('legend')?.removeEventListener('change', onLegendChange);
      container.innerHTML = '';
    }
  };
}
