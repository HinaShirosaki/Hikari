import { initWorkflowManagement } from '../modules/workflow/index.js';

export const workflowManagementManifest = {
  key: 'workflowManagement',
  historyStateKeys: ['workflows', 'workflowTemplates', 'notebookEntries', 'projects'],
  renderHistory: ({ modules }) => modules.workflowManagement.restoreHistory?.(),
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
    onWorkflowsChanged: () => {
      modules.biologyNotebook?.renderEntries?.();
      modules.biologyNotebook?.refreshProjectDashboard?.();
    },
    onOpenNotebookEntry: (entryId = '') => {
      showView(views.BIOLOGY_NOTEBOOK);
      modules.biologyNotebook?.openEntry?.(entryId);
    },
    onCreateLinkedAssay: rendererServices.analysis.openAssayForNotebook,
  }),
  render: ({ modules }) => modules.workflowManagement.render()
};
