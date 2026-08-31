import { initHomeDashboard } from '../modules/home-dashboard.js';

export const homeDashboardManifest = {
  key: 'homeDashboard',
  init: initHomeDashboard,
  viewKey: 'HOME',
  bootOrder: 100,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    rendererServices,
    showView,
    views,
    rootDocument,
    apiBridge
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onOpenSampleSearch: rendererServices.inventory.openSampleSearch,
    onOpenSamples: () => rendererServices.inventory.openSampleSearch(''),
    onOpenNotebook: () => showView(views.BIOLOGY_NOTEBOOK),
    onOpenWorkflow: () => showView(views.WORKFLOW_MANAGEMENT),
    onOpenAssistant: () => showView(views.AGENT),
    api: apiBridge,
    onSendQuickLogToAgent: (message) => {
      const draft = String(message || '').trim();
      if (!draft) {
        return false;
      }
      showView(views.AGENT);
      const agentInput = rootDocument?.getElementById?.('agent-message-input');
      const sendButton = rootDocument?.getElementById?.('agent-send-btn');
      if (!(agentInput instanceof HTMLTextAreaElement) || !(sendButton instanceof HTMLButtonElement)) {
        return false;
      }
      agentInput.value = draft;
      sendButton.click();
      return true;
    }
  }),
  render: ({ modules }) => modules.homeDashboard?.render()
};
