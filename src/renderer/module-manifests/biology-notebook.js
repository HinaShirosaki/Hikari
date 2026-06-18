import { initLabNotebook as initBiologyNotebook } from '../modules/biology-notebook/index.js';

export const biologyNotebookManifest = {
  key: 'biologyNotebook',
  init: initBiologyNotebook,
  viewKey: 'BIOLOGY_NOTEBOOK',
  bootOrder: 50,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    rendererServices,
    showView,
    views,
    modules,
    selectionInsightsController
  }) => ({
    state,
    persist,
    createId,
    safeText,
    notebookType: 'biology',
    importProtocolsFromJson: rendererServices.protocol.importProtocolsFromJson,
    onCreateLinkedAssay: rendererServices.analysis.openAssayForNotebook,
    onCreateLinkedGel: rendererServices.analysis.openGelForNotebook,
    onOpenSampleRecorder: (context = {}) => {
      showView(views.SAMPLE_REGISTRY);
      modules.sampleRegistry?.startNotebookSampleCapture?.(context);
    },
    onOpenProjects: () => showView(views.PROJECT_MANAGEMENT),
    onNotebookEntriesChanged: rendererServices.notebook.handleNotebookEntriesChanged,
    selectionInsightsController
  }),
  render: ({ modules }) => {
    modules.biologyNotebook.renderProjectOptions();
    modules.biologyNotebook.renderProtocolOptions();
    modules.biologyNotebook.renderEntries();
  }
};
