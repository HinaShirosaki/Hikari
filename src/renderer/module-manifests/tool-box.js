import { initToolBox } from '../modules/tool-box.js';

export const toolBoxManifest = {
  key: 'toolBox',
  init: initToolBox,
  createOptions: ({ rendererServices }) => ({
    onOpenSequenceViewer: rendererServices.sequence.openFromToolBox
  })
};
