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
    apiBridge
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onOpenNotebook: () => showView(views.BIOLOGY_NOTEBOOK),
    api: apiBridge,
    onSendQuickLogToAgent: async (message) => {
      const draft = String(message || '').trim();
      if (!draft) {
        return { ok: false, reason: 'empty' };
      }
      const submitExternalMessage = modules.agentChat?.submitExternalMessage;
      if (typeof submitExternalMessage !== 'function') {
        return { ok: false, reason: 'unavailable' };
      }
      const result = await submitExternalMessage(draft);
      if (result?.ok) {
        showView(views.AGENT);
      }
      return result;
    }
  }),
  render: ({ modules }) => modules.homeDashboard?.render()
};
