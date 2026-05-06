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
  getEditingEntryId
} = {}) {
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
    entries.forEach((entry) => {
      const workflowEntryId = String(entry?.workflowContext?.workflowEntryId || '').trim();
      const workflowName = String(entry?.workflowContext?.workflowName || '').trim();
      const isWorkflowEntry = Boolean(workflowEntryId || workflowName);
      const groupName = resolveEntryCollectionName(entry, projects);
      const groupKey = isWorkflowEntry
        ? `__workflow__:${workflowEntryId || workflowName || entry.id}`
        : (entry.projectId || `__project__:${groupName}`);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupName,
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

    if (!entries.length) {
      listEl.innerHTML = '<p class="biology-notebook-page-list-empty">No notebook pages saved yet.</p>';
      return;
    }

    const groups = groupEntries(entries);
    listEl.innerHTML = Array.from(groups.values()).map((group) => {
      const entryButtons = group.entries.map((entry) => buildEntryButtonHtml(entry)).join('');
      return `
        <details class="biology-notebook-folder ${group.groupClass}" open>
          <summary class="biology-notebook-folder-item ${group.itemClass}">
            <span class="biology-notebook-folder-glyph" aria-hidden="true"></span>
            <span class="biology-notebook-folder-name">${safeText(group.groupName)}</span>
          </summary>
          <div class="biology-notebook-folder-children biology-notebook-folder-children--pages">
            ${entryButtons}
          </div>
        </details>
      `;
    }).join('');
  }

  return {
    renderEntries
  };
}
