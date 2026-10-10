import { initHomeDashboard } from '../modules/home-dashboard/index.js';
import { createHomeNotebookAgent } from '../modules/home-dashboard/notebook-agent.js';
import { createSavedNotebookAppend } from '../modules/biology-notebook/agent/index.js';
import { initAgentChat, createScopedAgentChatState } from '../modules/agent-chat/public-api.js';

export const homeDashboardManifest = {
  key: 'homeDashboard',
  historyStateKeys: ['settings', 'notebookEntries'],
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
    onOpenPaper: (file) => {
      showView(views.PAPERS);
      return modules.papers?.openStoredPaper?.(file);
    },
    api: apiBridge,
    onSendQuickLogToAgent: createHomeNotebookAgent({
      rootDocument,
      // Reuse the complete conversation/review workflow with independent Home history.
      createAgent: () => initAgentChat({
        document: rootDocument, windowObject, idPrefix: 'home-agent',
        loadPersistentSessions: false,
        state: createScopedAgentChatState(state, { getScopeContext: () => ({ scopeType: 'home' }) }),
        persist, createId, safeText,
        onNotebookEntriesChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged,
        onProtocolsChanged: () => {
          rendererServices.protocol.handleProtocolsChanged();
          modules.protocol?.renderList?.();
        },
        onAppendNotebookEntry: createSavedNotebookAppend({ state, persist,
          onChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged })
      })
    })
  }),
  render: ({ modules }) => modules.homeDashboard?.render()
};
