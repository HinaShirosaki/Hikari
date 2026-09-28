import { initToolBox } from '../modules/tool-box/index.js';

export const toolBoxManifest = {
  key: 'toolBox',
  init: initToolBox,
  createOptions: ({ rendererServices, state, safeText }) => ({
    onOpenSequenceViewer: rendererServices.sequence.openFromToolBox,
    safeText,
    getStoredCompounds: () => (Array.isArray(state.labInventory?.chemicals) ? state.labInventory.chemicals : [])
  })
};
