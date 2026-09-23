import { initAssay } from '../modules/assay/index.js';

export const assayManifest = {
  key: 'assay',
  init: initAssay,
  viewKey: 'ASSAY',
  bootOrder: 70,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    rendererServices,
    modules,
    rootDocument
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onAssaysChanged: rendererServices.analysis.handleAssaysChanged,
    onActiveAssayChanged: () => {
      modules?.agentChatRail?.render?.();
    },
    onAssayModeChanged: (mode) => {
      const assayView = rootDocument?.getElementById?.('assay-view');
      if (assayView?.dataset) {
        assayView.dataset.agentChatRail = mode === 'results' ? 'enabled' : 'disabled';
      }
      const EventCtor = rootDocument?.defaultView?.CustomEvent;
      if (typeof EventCtor === 'function') {
        rootDocument.dispatchEvent(new EventCtor('hikari:agent-chat-rail-availability-changed'));
      }
    }
  }),
  render: ({ modules }) => modules.assay.render()
};
