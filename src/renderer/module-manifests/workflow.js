import { initWorkflowManagement } from '../modules/workflow/index.js';

export const workflowManagementManifest = {
  key: 'workflowManagement',
  init: initWorkflowManagement,
  viewKey: 'WORKFLOW_MANAGEMENT',
  bootOrder: 30,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    rendererServices,
    showView,
    views,
    modules
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onWorkflowsChanged: () => {},
    onOpenNotebookEntry: (entryId = '') => {
      showView(views.BIOLOGY_NOTEBOOK);
      modules.biologyNotebook?.openEntry?.(entryId);
    },
    onCreateLinkedAssay: rendererServices.analysis.openAssayForNotebook,
    onCreateLinkedGel: rendererServices.analysis.openGelForNotebook
  }),
  render: ({ modules }) => modules.workflowManagement.render()
};
