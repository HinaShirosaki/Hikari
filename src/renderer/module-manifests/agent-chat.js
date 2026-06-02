import { initAgentChat } from '../modules/agent-chat.js';

function createAgentChatOptions({
  state,
  persist,
  createId,
  safeText,
  rendererServices,
  showView,
  views,
  modules
}) {
  return {
    state,
    persist,
    createId,
    safeText,
    onNotebookEntriesChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged,
    onProtocolsChanged: () => {
      rendererServices.protocol.handleProtocolsChanged();
      modules.protocol?.renderList?.();
    },
    onOpenNotebookEntry: (entryId = '') => {
      showView(views.BIOLOGY_NOTEBOOK);
      modules.biologyNotebook?.openEntry?.(entryId);
    }
  };
}

export const agentChatManifest = {
  key: 'agentChat',
  init: initAgentChat,
  viewKey: 'AGENT',
  bootOrder: 120,
  createOptions: createAgentChatOptions,
  render: ({ modules }) => modules.agentChat.render()
};
