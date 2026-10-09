import { initProtocolManagement } from '../modules/protocol/index.js';

export const protocolManifest = {
  key: 'protocol',
  historyStateKeys: ['protocols'],
  init: initProtocolManagement,
  viewKey: 'PROTOCOL_MANAGEMENT',
  bootOrder: 10,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    rendererServices,
    selectionInsightsController,
    rootDocument,
    windowObject,
    apiBridge
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onProtocolsChanged: rendererServices.protocol.handleProtocolsChanged,
    logNotebookPageEvent: rendererServices.notebook.logPageEvent,
    selectionInsightsController,
    contextActions: rendererServices.contextActions,
    __globals: {
      document: rootDocument,
      windowObject,
      hikariApi: apiBridge,
      FileReader: windowObject?.FileReader || globalThis?.FileReader || null
    }
  }),
  render: ({ modules }) => {
    modules.protocol.renderList();
  },
  renderHistory: ({ modules }) => {
    modules.protocol.restoreHistory();
  }
};
