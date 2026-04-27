import {
  matchesNotebookType,
  normalizeNotebookState,
  notebookStateLabel,
  resolveEntryCollectionName,
  resolveEntryExperimentName,
  resolveEntryProtocol
} from './entry-helpers.js';

export function createEntryListRenderer({
  listEl,
  statusEl,
  notebookType,
  safeText,
  getNotebookEntries,
  getProjects,
  getProtocols,
  getEditingEntryId,
  getViewerProtocolDraft,
  getSelectedProjectId,
  getSelectedProtocolId,
  getActiveEntry
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

    updatePageListStatus(entries);

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

  function updatePageListStatus(entries = null) {
    if (!statusEl) {
      return;
    }

    const projects = getProjects();
    const protocols = getProtocols();
    const savedEntries = Array.isArray(entries)
      ? entries
      : (getNotebookEntries() || []).filter((entry) => matchesType(entry));
    const project = projects.find((item) => item.id === getSelectedProjectId());
    const viewerDraft = getViewerProtocolDraft();
    const protocol = viewerDraft || protocols.find((item) => item.id === getSelectedProtocolId());

    if (project && protocol) {
      statusEl.textContent = `Working in ${project.name} / ${protocol.name}`;
      return;
    }
    if (project) {
      statusEl.textContent = `Viewing pages for ${project.name}`;
      return;
    }
    const activeEntry = getActiveEntry();
    if (activeEntry) {
      const activeCollectionName = resolveEntryCollectionName(activeEntry, projects);
      const activeProtocol = resolveEntryProtocol(activeEntry, protocols);
      if (activeCollectionName && activeProtocol?.name) {
        statusEl.textContent = `Viewing page for ${activeCollectionName} / ${activeProtocol.name}`;
        return;
      }
      if (activeProtocol?.name) {
        statusEl.textContent = `Viewing ${activeProtocol.name}`;
        return;
      }
    }
    statusEl.textContent = savedEntries.length
      ? 'Select a notebook page or choose a project and protocol to start a new one.'
      : 'Select a project and protocol to start a page.';
  }

  return {
    renderEntries,
    updatePageListStatus
  };
}
