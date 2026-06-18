import { initGelAnalysis } from '../modules/gel/index.js';

export const gelManifest = {
  key: 'gel',
  init: initGelAnalysis,
  viewKey: 'GEL',
  bootOrder: 80,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    rendererServices,
    rootDocument
  }) => ({
    state,
    persist,
    createId,
    safeText,
    document: rootDocument,
    onGelAnalysesChanged: rendererServices.analysis.handleGelAnalysesChanged
  }),
  render: ({ modules }) => modules.gel.render()
};
