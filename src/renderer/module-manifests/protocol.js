import { initProtocolManagement } from '../modules/protocol/index.js';

export const protocolManifest = {
  key: 'protocol',
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
    selectionInsightsController,
    __globals: {
      document: rootDocument,
      windowObject,
      hikariApi: apiBridge,
      FileReader: windowObject?.FileReader || globalThis?.FileReader || null
    }
  }),
  render: ({ modules }) => {
    modules.protocol.renderList();
  }
};
