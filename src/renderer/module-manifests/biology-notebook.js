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
    onOpenSampleRecorder: (context = {}) => {
      showView(views.SAMPLE_REGISTRY);
      modules.sampleRegistry?.startNotebookSampleCapture?.(context);
    },
    onProjectsChanged: rendererServices.project.handleProjectsChanged,
    onNotebookEntriesChanged: rendererServices.notebook.handleNotebookEntriesChanged,
    onActiveNotebookPageChanged: () => {
      modules?.agentChatRail?.render?.();
    },
    selectionInsightsController
  }),
  render: ({ modules }) => {
    modules.biologyNotebook.renderProjectOptions();
    modules.biologyNotebook.renderProtocolOptions();
    modules.biologyNotebook.renderEntries();
  }
};
