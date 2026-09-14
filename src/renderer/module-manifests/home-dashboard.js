import { createHomeNotebookAgent } from '../modules/home-dashboard/notebook-agent.js';
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
    showView,
    views,
    modules,
    apiBridge,
    rootDocument,
    windowObject,
    rendererServices
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onOpenNotebook: () => showView(views.BIOLOGY_NOTEBOOK),
    api: apiBridge,
    onSendQuickLogToAgent: createHomeNotebookAgent({
      state, persist, createId, safeText, rootDocument, windowObject, rendererServices, modules
    })
  }),
  render: ({ modules }) => modules.homeDashboard?.render()
};
