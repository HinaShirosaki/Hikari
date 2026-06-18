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
    trackGrowthEvent,
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
    trackGrowthEvent,
    selectionInsightsController,
    __globals: {
      document: rootDocument,
      windowObject,
      hikariApi: apiBridge,
      navigator: windowObject?.navigator || globalThis?.navigator || null,
      FileReader: windowObject?.FileReader || globalThis?.FileReader || null,
      TextEncoder: windowObject?.TextEncoder || globalThis?.TextEncoder || null,
      btoa: windowObject?.btoa || globalThis?.btoa || null
    }
  }),
  render: ({ modules }) => {
    modules.protocol.renderShareTargets();
    modules.protocol.renderList();
  }
};
