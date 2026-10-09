import { createSavedNotebookAppend } from '../modules/biology-notebook/agent/saved-append.js';
import { initAgentChat } from '../modules/agent-chat/index.js';

function createAgentChatOptions({
  state,
  persist,
  createId,
  safeText,
  rendererServices,
  showView,
  views,
  modules,
  rootDocument,
  windowObject
}) {
  return {
    state,
    persist,
    createId,
    safeText,
    document: rootDocument,
    windowObject,
    onNotebookEntriesChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged,
    onProtocolsChanged: () => {
      rendererServices.protocol.handleProtocolsChanged();
      modules.protocol?.renderList?.();
    },
    onAppendNotebookEntry: createSavedNotebookAppend({ state, persist,
      onChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged }),
    onOpenNotebookEntry: (entryId = '') => {
      showView(views.BIOLOGY_NOTEBOOK);
      modules.biologyNotebook?.openEntry?.(entryId);
    }
  };
}

export const agentChatManifest = {
  key: 'agentChat',
  historyStateKeys: ['agentChat'],
  init: initAgentChat,
  viewKey: 'AGENT',
  bootOrder: 120,
  createOptions: createAgentChatOptions,
  render: ({ modules }) => modules.agentChat.render()
};
