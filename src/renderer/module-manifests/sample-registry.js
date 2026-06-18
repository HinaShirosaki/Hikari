import { initSampleRegistry } from '../modules/sample-registry/index.js';

export const sampleRegistryManifest = {
  key: 'sampleRegistry',
  init: initSampleRegistry,
  viewKey: 'SAMPLE_REGISTRY',
  bootOrder: 60,
  createOptions: ({
    state,
    persist,
    safeText,
    rendererServices
  }) => ({
    state,
    persist,
    safeText,
    onNotebookSampleCaptured: rendererServices.notebook.handleNotebookEntriesChanged
  }),
  render: ({ modules }) => {
    modules.personalInventory.renderSections();
    modules.sampleRegistry.render();
  }
};
