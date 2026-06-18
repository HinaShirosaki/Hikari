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
    rendererServices
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onAssaysChanged: rendererServices.analysis.handleAssaysChanged
  }),
  render: ({ modules }) => modules.assay.render()
};
