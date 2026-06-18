import { initProjectManagement } from '../modules/project-management/index.js';

export const projectManagementManifest = {
  key: 'projectManagement',
  init: initProjectManagement,
  viewKey: 'PROJECT_MANAGEMENT',
  bootOrder: 20,
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
    onProjectsChanged: rendererServices.project.handleProjectsChanged
  }),
  render: ({ modules }) => modules.projectManagement.render()
};
