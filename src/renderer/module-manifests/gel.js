import { initGelAnalysis } from '../modules/gel-analysis.js';

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
    rendererServices
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onGelAnalysesChanged: rendererServices.analysis.handleGelAnalysesChanged
  }),
  render: ({ modules }) => modules.gel.render()
};
