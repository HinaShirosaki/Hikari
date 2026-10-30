import {
  matchesNotebookType,
  resolveEntryProject,
  resolveEntryProtocol
} from '../entry/entry-helpers.js';

// Project lookups shared across the notebook view, plus the project-dashboard
// description field and the page-starter's project chip.
function createNotebookProjectDashboard({
  state,
  persist,
  onProjectsChanged,
  notebookType,
  notebookPageStarter,
  notebookPageStarterProject,
  notebookProjectSelect,
  notebookProtocolSearchInput
} = {}) {
  function matchesType(entry) {
    return matchesNotebookType(entry, notebookType);
  }

  function getEntryProject(entry) {
    return resolveEntryProject(entry, state.projects);
  }

  function getEntryProtocol(entry) {
    return resolveEntryProtocol(entry, state.protocols);
  }

  function findSelectedProject() {
    return state.projects.find((item) => item.id === notebookProjectSelect.value) || null;
  }

  function syncPageStarterProject() {
    const project = findSelectedProject();
    if (notebookPageStarterProject) {
      notebookPageStarterProject.textContent = project?.name || 'Choose a project folder';
    }
    if (notebookPageStarter) {
      notebookPageStarter.dataset.projectId = project?.id || '';
    }
    if (notebookProtocolSearchInput) {
      notebookProtocolSearchInput.disabled = !project;
    }
  }

  function setPageStarterVisible() {
    if (notebookPageStarter) {
      notebookPageStarter.hidden = true;
    }
  }

  function findDashboardProject(projectId, projectName = '') {
    const cleanProjectId = String(projectId || '').trim();
    if (cleanProjectId) {
      const project = state.projects.find((item) => String(item?.id || '') === cleanProjectId);
      if (project) {
        return project;
      }
    }
    const cleanProjectName = String(projectName || '').trim().toLowerCase();
    if (!cleanProjectName) {
      return null;
    }
    return state.projects.find((item) => String(item?.name || '').trim().toLowerCase() === cleanProjectName) || null;
  }

  function findProjectDescriptionInputTarget(event) {
    const target = event?.target;
    if (!target) {
      return null;
    }
    return target?.closest?.('[data-project-description]')
      || (target?.dataset?.projectDescription ? target : null);
  }

  function updateProjectDescription(projectId, description) {
    const project = findDashboardProject(projectId);
    if (!project) {
      return;
    }
    const nextDescription = String(description || '').trim();
    if (String(project.description || '') === nextDescription) {
      return;
    }
    project.description = nextDescription;
    project.updatedAt = new Date().toISOString();
    persist();
    if (typeof onProjectsChanged === 'function') {
      onProjectsChanged();
    }
  }

  function onProjectDashboardDescriptionInput(event) {
    const input = findProjectDescriptionInputTarget(event);
    if (!input) {
      return;
    }
    updateProjectDescription(input.dataset.projectDescription, input.value);
  }

  return {
    matchesType,
    getEntryProject,
    getEntryProtocol,
    findSelectedProject,
    syncPageStarterProject,
    setPageStarterVisible,
    findDashboardProject,
    findProjectDescriptionInputTarget,
    updateProjectDescription,
    onProjectDashboardDescriptionInput
  };
}

export { createNotebookProjectDashboard };
