// Presentation state lives here, outside saved scientific data and chart models.
export function createAnalyzeWorkspace({ elements, runtime, resultsManager, analysisView, getAssay, getDefinition }) {
  const root = elements.assayAnalyzeWorkspace;
  if (!root?.querySelector) return { refresh() {} };
  const find = (id) => root.querySelector(`#${id}`);
  const tabs = Array.from(root.querySelectorAll('[data-assay-data-tab]'));
  const panels = {
    raw: find('assay-result-table-panel'),
    transformed: find('assay-transformed-data-panel'),
    summary: find('assay-summary-panel')
  };
  let activeTab = 'raw';
  let lastAssayId = '';

  function redraw() {
    requestAnimationFrame(() => {
      if (!panels.raw.hidden) resultsManager.redrawResultGrid();
      if (!panels.transformed.hidden) analysisView.redrawTransformGrid();
    });
  }

  function selectTab(tab, focus = false) {
    activeTab = tab;
    refresh();
    if (focus) tabs.find((button) => button.dataset.assayDataTab === activeTab)?.focus();
    redraw();
  }

  function refresh(options = {}) {
    const assay = getAssay();
    const info = analysisView.getWorkspaceState();
    const definition = getDefinition();
    if (lastAssayId !== (assay?.id || '') || options.tab) {
      activeTab = 'raw';
      root.classList.remove('is-chart-focused');
      find('assay-chart-focus-btn').setAttribute('aria-pressed', 'false');
      lastAssayId = assay?.id || '';
    }
    if (options.tab) activeTab = options.tab;
    if (!info.transformActive && activeTab === 'transformed') activeTab = 'raw';
    // Table2 formulas point at Table1 cells, so the Transformed tab always shows its
    // source plate above it; point-mode clicks need both grids on screen.
    const comparing = activeTab === 'transformed';
    root.dataset.dataTab = activeTab;
    root.classList.toggle('is-comparing-plates', comparing);
    tabs.forEach((button) => {
      const selected = button.dataset.assayDataTab === activeTab;
      button.hidden = button.dataset.assayDataTab === 'transformed' && !info.transformActive;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    Object.entries(panels).forEach(([tab, panel]) => {
      panel.hidden = tab !== activeTab && !(comparing && tab === 'raw');
    });
    find('assay-workspace-title').textContent = assay?.name || 'Assay analysis';
    find('assay-workspace-meta').textContent = assay
      ? `${definition.rows * definition.columns}-well plate · ${runtime.currentLayout.length} mapped wells` : 'Select an assay to analyze';
    find('assay-workspace-chart-title').textContent = info.method === 'agent_plotly' ? 'Agent chart'
      : elements.assayAnalysisKindInput?.selectedOptions?.[0]?.textContent || info.methodLabel;
    find('assay-workspace-chart-source').textContent = info.transformActive ? 'Transformed plate · Table2' : 'Plate results · Table1';
    find('assay-workspace-table-label').textContent = activeTab === 'summary'
      ? 'Analysis summary' : (comparing ? 'Table1 + Table2' : 'Table1');
    find('assay-show-empty-rows-field').hidden = activeTab === 'summary';
    find('assay-show-empty-rows').checked = runtime.showEmptyResultRows === true;
    const rows = resultsManager.buildResultGridData(definition, {
      ...runtime.currentResults, ...analysisView.getTransformSpec().formulas
    });
    const hiddenRows = runtime.showEmptyResultRows ? 0 : rows.filter((row) => !row.__hasContent).length;
    find('assay-workspace-row-status').hidden = activeTab === 'summary';
    find('assay-workspace-row-status').textContent = hiddenRows
      ? `${rows.length - hiddenRows} rows shown · ${hiddenRows} empty rows hidden` : `${rows.length} rows shown`;
    const count = find('assay-transform-error-count');
    count.hidden = !info.errors.length;
    count.textContent = String(info.errors.length);
    count.setAttribute('aria-label', `${info.errors.length} formula errors`);
    const notice = find('assay-transform-error-notice');
    notice.hidden = !info.errors.length;
    notice.textContent = info.errors.length
      ? `${info.errors.length} formula error${info.errors.length === 1 ? '' : 's'} · ${info.errors.slice(0,3).map(({well}) => well).join(', ')}. Select an error cell to edit.` : '';
    const hasChart = Boolean(root.querySelector('[data-assay-analysis-chart]'));
    root.querySelectorAll('[data-assay-chart-type]').forEach((button) => {
      button.disabled = !hasChart || info.hasFittedCurve;
      button.setAttribute('aria-pressed', String(button.dataset.assayChartType === info.chartType));
    });
    if (options.tab) redraw();
  }

  tabs.forEach((button) => {
    button.addEventListener('click', () => selectTab(button.dataset.assayDataTab));
    button.addEventListener('keydown', (event) => {
      const visible = tabs.filter((tab) => !tab.hidden);
      const index = visible.indexOf(button);
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % visible.length
          : event.key === 'ArrowLeft' ? (index + visible.length - 1) % visible.length : -1;
      if (target < 0) return;
      event.preventDefault();
      selectTab(visible[target].dataset.assayDataTab, true);
    });
  });
  find('assay-show-empty-rows').addEventListener('change', (event) => {
    runtime.showEmptyResultRows = event.target.checked;
    resultsManager.refreshRowVisibility();
    analysisView.refreshRowVisibility();
    refresh();
  });
  find('assay-data-order-btn').addEventListener('click', (event) => {
    const enabled = root.classList.toggle('is-data-first');
    event.currentTarget.setAttribute('aria-pressed', String(enabled));
    event.currentTarget.textContent = enabled ? 'Chart first' : 'Data first';
  });
  find('assay-chart-focus-btn').addEventListener('click', (event) => {
    const focused = root.classList.toggle('is-chart-focused');
    event.currentTarget.setAttribute('aria-pressed', String(focused));
    requestAnimationFrame(() => analysisView.redrawChart());
  });
  find('assay-workspace-format-btn').addEventListener('click', () => analysisView.openChartFormat());
  root.querySelectorAll('[data-assay-chart-type]').forEach((button) => {
    button.addEventListener('click', () => analysisView.setChartType(button.dataset.assayChartType));
  });
  refresh();
  return { refresh };
}
