import { initProtocolManagement } from '../modules/protocol-management.js';

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
    selectionInsightsController
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onProtocolsChanged: rendererServices.protocol.handleProtocolsChanged,
    trackGrowthEvent,
    selectionInsightsController
  }),
  render: ({ modules }) => {
    modules.protocol.renderShareTargets();
    modules.protocol.renderList();
  }
};
