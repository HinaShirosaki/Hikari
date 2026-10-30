import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("plate");
import { setTranslatedText } from '../../../lib/i18n/dom.js';
import { bindPlateMessage, setPlateAttribute, setPlateText } from '../localization.js';

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
    const resultCount = resultsManager.getResultValueCount();
    if (elements.assayClearResultsBtn) elements.assayClearResultsBtn.disabled = !resultCount;
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
    // The assay name is user data, so it replaces the fallback's binding.
    if (assay?.name) bindPlateMessage(find('assay-workspace-title'), assay.name);
    else setPlateText(find('assay-workspace-title'), 'workspace.title');
    if (assay) setPlateText(find('assay-workspace-meta'), 'workspace.meta', { wells: definition.rows * definition.columns, mapped: runtime.currentLayout.length });
    else setPlateText(find('assay-workspace-meta'), 'workspace.selectAssay');
    const methodKey = elements.assayAnalysisKindInput?.selectedOptions?.[0]?.dataset?.i18n;
    if (info.method === 'agent_plotly') setPlateText(find('assay-workspace-chart-title'), 'workspace.agentChart');
    else if (methodKey) setTranslatedText(find('assay-workspace-chart-title'), methodKey);
    else bindPlateMessage(find('assay-workspace-chart-title'), info.methodLabel);
    setPlateText(find('assay-workspace-chart-source'), info.dataSource === 'transformed' ? 'source.transformed' : 'source.raw');
    if (activeTab === 'summary') setPlateText(find('assay-workspace-table-label'), 'workspace.summaryLabel');
    else bindPlateMessage(find('assay-workspace-table-label'), comparing ? 'Table1 + Table2' : 'Table1');
    find('assay-show-empty-rows-field').hidden = activeTab === 'summary';
    find('assay-show-empty-rows').checked = runtime.showEmptyResultRows === true;
    const rows = resultsManager.buildResultGridData(definition, {
      ...runtime.currentResults, ...analysisView.getTransformSpec().formulas
    });
    const hiddenRows = runtime.showEmptyResultRows ? 0 : rows.filter((row) => !row.__hasContent).length;
    find('assay-workspace-row-status').hidden = activeTab === 'summary';
    if (hiddenRows) setPlateText(find('assay-workspace-row-status'), 'workspace.rowsHidden', { shown: rows.length - hiddenRows, hidden: hiddenRows });
    else setPlateText(find('assay-workspace-row-status'), 'workspace.rowsShown', { count: rows.length });
    const count = find('assay-transform-error-count');
    count.hidden = !info.errors.length;
    i18nUi.setText(count, String(info.errors.length));
    setPlateAttribute(count, 'aria-label', 'workspace.formulaErrors', { count: info.errors.length });
    const notice = find('assay-transform-error-notice');
    notice.hidden = !info.errors.length;
    if (info.errors.length) {
      setPlateText(notice, 'workspace.formulaErrorNotice', {
        count: info.errors.length, wells: info.errors.slice(0, 3).map(({ well }) => well).join(', ')
      });
    } else bindPlateMessage(notice, '');
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
    setPlateText(event.currentTarget, enabled ? 'workspace.chartFirst' : 'workspace.dataFirst');
  });
  find('assay-chart-focus-btn').addEventListener('click', (event) => {
    const focused = root.classList.toggle('is-chart-focused');
    event.currentTarget.setAttribute('aria-pressed', String(focused));
    requestAnimationFrame(() => analysisView.redrawChart());
  });
  find('assay-workspace-format-btn').addEventListener('click', () => analysisView.openChartFormat());
  refresh();
  return { refresh };
}
