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
    modules,
    showView,
    views,
    selectionInsightsController
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onCreateWorkflowProcess: (options) => modules.workflowManagement?.createProcess?.(options),
    onOpenWorkflowProcess: (id) => {
      showView(views.WORKFLOW_MANAGEMENT);
      modules.workflowManagement?.openProcess?.(id);
    },
    notebookType: 'biology',
    importProtocolsFromJson: rendererServices.protocol.importProtocolsFromJson,
    onCreateLinkedAssay: rendererServices.analysis.openAssayForNotebook,
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
    modules.biologyNotebook.refreshProjectDashboard?.();
  }
};
