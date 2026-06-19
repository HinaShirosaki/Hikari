import {
  matchesNotebookType,
  normalizeNotebookState,
  notebookStateLabel,
  resolveEntryCollectionName,
  resolveEntryExperimentName
} from './entry-helpers.js';

export function createEntryListRenderer({
  listEl,
  notebookType,
  safeText,
  getNotebookEntries,
  getProjects,
  getEditingEntryId,
  getActiveProjectDashboardId = () => ''
} = {}) {
  const collapsedFolderKeys = new Set();

  function matchesType(entry) {
    return matchesNotebookType(entry, notebookType);
  }

  function buildEntryButtonHtml(entry) {
    const isActive = entry.id === getEditingEntryId() ? ' is-active' : '';
    const stateLabel = notebookStateLabel(entry);
    const stateClass = normalizeNotebookState(entry?.notebookState) === 'planned'
      ? ' is-planned'
      : ' is-executed';
    return `
          <button
            type="button"
            class="biology-notebook-page-row${isActive}${stateClass}"
            data-notebook-entry-id="${safeText(entry.id)}"
          >
            <span class="biology-notebook-page-name">${safeText(resolveEntryExperimentName(entry))}</span>
            <span class="biology-notebook-page-badge">${safeText(stateLabel)}</span>
          </button>
        `;
  }

  function groupEntries(entries) {
    const projects = getProjects();
    const groups = new Map();
    projects
      .slice()
      .sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || '')))
      .forEach((project) => {
        groups.set(project.id, {
          groupKey: project.id,
          groupName: project.name || 'Untitled Project',
          projectId: project.id,
          groupClass: 'biology-notebook-folder--project',
          itemClass: 'biology-notebook-folder-item--project',
          entries: []
        });
      });
    entries.forEach((entry) => {
      const workflowEntryId = String(entry?.workflowContext?.workflowEntryId || '').trim();
      const workflowName = String(entry?.workflowContext?.workflowName || '').trim();
      const isWorkflowEntry = Boolean(workflowEntryId || workflowName);
      const groupName = resolveEntryCollectionName(entry, projects);
      const project = isWorkflowEntry
        ? null
        : (projects.find((item) => String(item?.id || '') === String(entry?.projectId || ''))
          || projects.find((item) => String(item?.name || '').trim().toLowerCase() === String(groupName || '').trim().toLowerCase())
          || null);
      const projectId = project?.id || '';
      const groupKey = isWorkflowEntry
        ? `__workflow__:${workflowEntryId || workflowName || entry.id}`
        : (projectId || entry.projectId || `__project__:${groupName}`);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey,
          groupName,
          projectId,
          groupClass: isWorkflowEntry
            ? 'biology-notebook-folder--workflow'
            : 'biology-notebook-folder--project',
          itemClass: isWorkflowEntry
            ? 'biology-notebook-folder-item--workflow'
            : 'biology-notebook-folder-item--project',
          entries: []
        });
      }
      groups.get(groupKey).entries.push(entry);
    });
    return groups;
  }

  function renderEntries() {
    if (!listEl) {
      return;
    }
    const projects = getProjects();
    const entries = (getNotebookEntries() || [])
      .filter((entry) => matchesType(entry))
      .slice()
      .sort((left, right) => {
        const collectionCompare = resolveEntryCollectionName(left, projects)
          .localeCompare(resolveEntryCollectionName(right, projects));
        if (collectionCompare !== 0) {
          return collectionCompare;
        }
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });

    if (!entries.length && !projects.length) {
      listEl.innerHTML = '<p class="biology-notebook-page-list-empty">No notebook pages saved yet.</p>';
      return;
    }

    const groups = groupEntries(entries);
    const activeProjectDashboardId = String(getActiveProjectDashboardId() || '');
    listEl.innerHTML = Array.from(groups.values()).map((group) => {
      const entryButtons = group.entries.length
        ? group.entries.map((entry) => buildEntryButtonHtml(entry)).join('')
        : '<p class="biology-notebook-page-list-empty biology-notebook-page-list-empty--folder">No pages yet.</p>';
      const projectDataAttrs = group.projectId
        ? ` data-notebook-project-id="${safeText(group.projectId)}" data-notebook-project-name="${safeText(group.groupName)}"`
        : '';
      const isActiveProject = group.projectId && group.projectId === activeProjectDashboardId;
      const isCollapsed = collapsedFolderKeys.has(group.groupKey);
      const folderNameTag = group.projectId ? 'button' : 'span';
      const folderNameAttrs = group.projectId
        ? ` type="button" class="biology-notebook-folder-name biology-notebook-folder-name-btn"${projectDataAttrs}`
        : ' class="biology-notebook-folder-name"';
      return `
        <div class="biology-notebook-folder ${group.groupClass}${isActiveProject ? ' is-active' : ''}${isCollapsed ? ' is-collapsed' : ''}">
          <div class="biology-notebook-folder-item ${group.itemClass}">
            <button
              type="button"
              class="biology-notebook-folder-toggle"
              data-notebook-folder-toggle="${safeText(group.groupKey)}"
              aria-expanded="${isCollapsed ? 'false' : 'true'}"
              aria-label="Toggle ${safeText(group.groupName)}"
            >
              <span class="biology-notebook-folder-glyph" aria-hidden="true"></span>
            </button>
            <${folderNameTag}${folderNameAttrs}>${safeText(group.groupName)}</${folderNameTag}>
          </div>
          <div class="biology-notebook-folder-children biology-notebook-folder-children--pages"${isCollapsed ? ' hidden' : ''}>
            ${entryButtons}
          </div>
        </div>
      `;
    }).join('');
  }

  function toggleFolder(folderKey) {
    const key = String(folderKey || '');
    if (!key) {
      return;
    }
    if (collapsedFolderKeys.has(key)) {
      collapsedFolderKeys.delete(key);
    } else {
      collapsedFolderKeys.add(key);
    }
    renderEntries();
  }

  return {
    renderEntries,
    toggleFolder
  };
}
