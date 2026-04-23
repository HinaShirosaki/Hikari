import { summarizeNotebookResultTable } from './notebook-result-table.js';

export function initProjectManagement({ state, persist, createId, safeText, onProjectsChanged }) {
  const projectForm = document.getElementById('project-form');
  const projectIdInput = document.getElementById('project-id');
  const projectNameInput = document.getElementById('project-name');
  const projectDescriptionInput = document.getElementById('project-description');
  const projectCancelBtn = document.getElementById('project-cancel-btn');
  const projectList = document.getElementById('project-list');
  const projectNotebookFilter = document.getElementById('project-notebook-filter');
  const projectNotebookPages = document.getElementById('project-notebook-pages');

  projectForm.addEventListener('submit', onProjectSubmit);
  projectCancelBtn.addEventListener('click', resetProjectForm);
  projectNotebookFilter.addEventListener('change', renderNotebookPages);

  function notebookStateLabel(entry) {
    return String(entry?.notebookState || '').trim().toLowerCase() === 'planned' ? 'Planned' : 'Executed';
  }

  async function onProjectSubmit(event) {
    event.preventDefault();

    const project = {
      id: projectIdInput.value || createId(),
      name: projectNameInput.value.trim(),
      description: projectDescriptionInput.value.trim()
    };

    if (!project.name) {
      return;
    }

    const index = state.projects.findIndex((item) => item.id === project.id);
    const isNewProject = index < 0;
    if (index >= 0) {
      state.projects[index] = project;
    } else {
      state.projects.push(project);
    }

    persist();
    if (isNewProject) {
      await ensureProjectDirectory(project.name);
    }
    resetProjectForm();
    render();
    renderNotebookPages();
    onProjectsChanged();
  }

  function sanitizeFolderName(value) {
    return String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  async function ensureProjectDirectory(projectName) {
    const rootPath = String(state.settings?.storagePath || '').trim();
    if (!rootPath || !window.enanaApi?.ensureStorageDirectory) {
      return;
    }

    const safeProjectName = sanitizeFolderName(projectName) || 'Untitled_Project';
    const projectFolder = `${rootPath}/Project/${safeProjectName}`;
    try {
      const result = await window.enanaApi.ensureStorageDirectory(projectFolder);
      if (result?.ok !== true) {
        console.warn('Failed to create project directory:', result?.error || projectFolder);
      }
    } catch (error) {
      console.warn('Failed to create project directory:', error);
    }
  }

  function resetProjectForm() {
    projectIdInput.value = '';
    projectForm.reset();
  }

  function editProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    projectIdInput.value = project.id;
    projectNameInput.value = project.name;
    projectDescriptionInput.value = project.description || '';
  }

  function deleteProject(projectId) {
    const deletedNotebookEntryIds = new Set(
      state.notebookEntries
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => entry.id)
    );

    state.projects = state.projects.filter((item) => item.id !== projectId);
    state.notebookEntries = state.notebookEntries.filter((entry) => entry.projectId !== projectId);
    state.assays = (state.assays || []).filter((assay) => assay.projectId !== projectId);
    state.gelAnalyses = (state.gelAnalyses || []).filter((analysis) => analysis.projectId !== projectId);
    state.workflows = (state.workflows || []).map((workflow) => ({
      ...workflow,
      projectId: workflow.projectId === projectId ? '' : workflow.projectId,
      notebookEntryIds: (workflow.notebookEntryIds || []).filter((entryId) => !deletedNotebookEntryIds.has(entryId))
    }));
    persist();
    render();
    renderNotebookPages();
    onProjectsChanged();
  }

  function renderProjectFilterOptions() {
    const selected = projectNotebookFilter.value;
    const options = ['<option value="">Select project</option>'];
    state.projects.forEach((project) => {
      const isSelected = selected === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });
    projectNotebookFilter.innerHTML = options.join('');
    if (selected && state.projects.some((project) => project.id === selected)) {
      projectNotebookFilter.value = selected;
    } else if (state.projects.length) {
      projectNotebookFilter.value = state.projects[0].id;
    }
  }

  function renderNotebookPages() {
    projectNotebookPages.classList.remove('cards');
    projectNotebookPages.classList.add('project-notebook-list');

    const projectId = projectNotebookFilter.value;
    if (!projectId) {
      projectNotebookPages.innerHTML = '<p class="small-note">Select a project to view related lab notebook pages.</p>';
      return;
    }

    const entries = state.notebookEntries
      .filter((entry) => entry.projectId === projectId)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    if (!entries.length) {
      projectNotebookPages.innerHTML = '<p class="small-note">No notebook pages for this project yet.</p>';
      return;
    }

    projectNotebookPages.innerHTML = entries.map((entry) => `
      <article class="project-notebook-item">
        <h3>${safeText(entry.protocolName || '-')}</h3>
        <p><strong>State:</strong> ${safeText(notebookStateLabel(entry))}</p>
        <p><strong>Updated:</strong> ${safeText(formatTimestamp(entry.updatedAt))}</p>
        <p><strong>Result:</strong> ${safeText(entry.result || '-')}</p>
        <p><strong>Result Table:</strong> ${safeText(summarizeNotebookResultTable(entry.resultTable) || '-')}</p>
        <p><strong>Files:</strong> ${safeText((entry.resultFiles || []).join(', ') || '-')}</p>
        <p><strong>Linked Assays:</strong> ${safeText(formatLinkedAssays(entry.id))}</p>
        <p><strong>Linked Gels:</strong> ${safeText(formatLinkedGels(entry.id))}</p>
      </article>
    `).join('');
  }

  function parseTimestamp(raw) {
    const value = Date.parse(String(raw || ''));
    return Number.isFinite(value) ? value : 0;
  }

  function formatTimestamp(raw) {
    const value = parseTimestamp(raw);
    if (!value) {
      return '-';
    }
    return new Date(value).toLocaleString();
  }

  function formatLinkedAssays(notebookEntryId) {
    const assays = (state.assays || [])
      .filter((assay) => assay.notebookEntryId === notebookEntryId)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
    if (!assays.length) {
      return '-';
    }
    return assays.map((assay) => assay.name || assay.id).join(', ');
  }

  function formatLinkedGels(notebookEntryId) {
    const analyses = (state.gelAnalyses || [])
      .filter((analysis) => analysis.notebookEntryId === notebookEntryId)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
    if (!analyses.length) {
      return '-';
    }
    return analyses.map((analysis) => analysis.name || analysis.id).join(', ');
  }

  function render() {
    renderProjectFilterOptions();
    projectList.classList.remove('cards');
    projectList.classList.add('list-table');
    if (!state.projects.length) {
      projectList.innerHTML = '<p class="small-note">No projects yet.</p>';
      renderNotebookPages();
      return;
    }

    const rows = state.projects.map((project) => `
      <article class="list-row">
        <button class="list-main-btn text-list-btn" data-project-edit="${project.id}">
          ${safeText(project.name)}
        </button>
        <span class="small-note">${safeText(project.description || 'No description')}</span>
        <div class="card-actions list-actions">
          <button class="ghost-btn" data-project-edit="${project.id}">Edit</button>
          <button class="danger-btn" data-project-delete="${project.id}">Delete</button>
        </div>
      </article>
    `).join('');

    projectList.innerHTML = `
      <article class="list-row list-row-header">
        <strong>Project</strong>
        <strong>Description</strong>
        <strong>Actions</strong>
      </article>
      ${rows}
    `;

    projectList.querySelectorAll('[data-project-edit]').forEach((button) => {
      button.addEventListener('click', () => editProject(button.dataset.projectEdit));
    });

    projectList.querySelectorAll('[data-project-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteProject(button.dataset.projectDelete));
    });

    renderNotebookPages();
  }

  return { render, renderNotebookPages };
}
