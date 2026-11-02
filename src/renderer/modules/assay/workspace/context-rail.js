import { setPlateText } from '../localization.js';

// Plate tools and chat share one host rail. Keep the controls mounted while
// switching panels so drafts, colour pickers and chart targets retain state.
export function createAssayContextRail({ elements, runtime, onViewChange, onLayoutChange }) {
  const doc = elements.assayAnalyzeWorkspace.ownerDocument;
  const view = elements.assayAnalyzeWorkspace.closest('#assay-view');
  const host = doc.getElementById('universal-agent-chat-rail');
  const tools = doc.getElementById('assay-workspace-tools');
  const rail = doc.getElementById('assay-context-rail');
  if (!host || !tools || !rail) return { refresh() {} };
  host.querySelector('.universal-agent-chat-rail__tools').prepend(tools);
  host.append(rail);
  const panels = { analysis: elements.assayAnalysisPanel, format: elements.assayChartFormatPanel };
  const buttons = {
    analysis: doc.getElementById('assay-analysis-toggle-btn'),
    format: doc.getElementById('assay-format-toggle-btn')
  };
  let activePanel = 'analysis';
  let lastLayout = '';

  function refresh() {
    const active = runtime.assayMode === 'results'
      && (!doc.body.dataset.activeView || doc.body.dataset.activeView === 'assay-view');
    const availability = active ? 'available' : '';
    const changed = view.dataset.workspaceTools !== availability;
    view.dataset.workspaceTools = availability;
    doc.body.classList.toggle('has-assay-workspace-tools', active);
    doc.body.classList.toggle('has-assay-context-expanded', active && Boolean(activePanel));
    tools.hidden = !active;
    rail.hidden = !active || !activePanel;
    for (const [name, panel] of Object.entries(panels)) {
      panel.hidden = name !== activePanel;
      panel.open = name === activePanel;
      buttons[name].setAttribute('aria-expanded', String(active && name === activePanel));
    }
    if (activePanel) setPlateText(doc.getElementById('assay-context-title'),
      activePanel === 'format' ? 'chart.formatTitle' : 'analysis.title');
    const layout = `${active}:${Boolean(activePanel)}:${doc.body.classList.contains('has-agent-chat-rail-expanded')}`;
    if (layout !== lastLayout && active) onLayoutChange();
    lastLayout = layout;
    if (changed) doc.dispatchEvent(new doc.defaultView.CustomEvent('hikari:workspace-tools-changed'));
  }

  function open(panel) {
    doc.dispatchEvent(new doc.defaultView.CustomEvent('hikari:close-agent-chat-rail'));
    activePanel = panel;
    if (panel === 'format') onViewChange('chart');
    refresh();
  }
  function close(returnFocus = false) {
    const button = buttons[activePanel];
    activePanel = '';
    refresh();
    if (returnFocus) button?.focus();
  }
  for (const [name, button] of Object.entries(buttons)) {
    button.addEventListener('click', () => activePanel === name ? close() : open(name));
  }
  panels.format.addEventListener('assay:open-chart-format', () => open('format'));
  doc.getElementById('assay-context-close-btn').addEventListener('click', () => close(true));
  rail.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close(true);
  });
  doc.addEventListener('hikari:agent-chat-rail-state', event => {
    if (event.detail?.viewId !== 'assay-view') return;
    if (event.detail.expanded) close();
    else refresh();
  });
  new doc.defaultView.MutationObserver(refresh).observe(doc.body, {
    attributes: true, attributeFilter: ['data-active-view']
  });
  return { refresh };
}
