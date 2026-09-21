import {
  matchesNotebookType,
  normalizeNotebookState,
  notebookStateLabel,
  resolveEntryCollectionName,
  resolveEntryExperimentName
} from './entry-helpers.js';
import {
  createFolderTreeState,
  renderFolderTreeLeaf,
  renderFolderTreeNode
} from '../../../lib/folder-tree.js';

export function createEntryListRenderer({
  listEl,
  notebookType,
  safeText,
  getNotebookEntries,
  getProjects,
  getEditingEntryId,
  getActiveProjectDashboardId = () => ''
} = {}) {
  const folderTree = createFolderTreeState({ defaultExpanded: true });
  let reasonBox, hideTimer;
  function hideReason() { clearTimeout(hideTimer); if (reasonBox) reasonBox.hidden = true; }
  function showReason(event) {
    const row = event.target?.closest?.('[data-notebook-entry-id]');
    if (!row || !listEl.contains(row)) return;
    const name = row.querySelector('.biology-notebook-page-name');
    const clippedName = name && name.scrollWidth > name.clientWidth ? name.textContent : '';
    const text = [clippedName, row.dataset.suggestionReason].filter(Boolean).join('\n\n');
    if (!text) return;
    clearTimeout(hideTimer);
    const doc = listEl.ownerDocument;
    if (!reasonBox) {
      reasonBox = doc.createElement('div');
      reasonBox.className = 'biology-notebook-suggestion-reason';
      reasonBox.setAttribute('role', 'tooltip');
      reasonBox.addEventListener('mouseleave', hideReason);
      reasonBox.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      doc.body.append(reasonBox);
    }
    reasonBox.textContent = text;
    reasonBox.hidden = false;
    const bounds = row.getBoundingClientRect();
    const view = doc.defaultView;
    const gap = 8;
    const box = reasonBox.getBoundingClientRect();
    reasonBox.style.left = `${Math.max(gap, Math.min(bounds.right + gap, view.innerWidth - box.width - gap))}px`;
    reasonBox.style.top = `${Math.max(gap, Math.min(bounds.top, view.innerHeight - box.height - gap))}px`;
  }
  listEl?.addEventListener?.('mouseover', showReason);
  listEl?.addEventListener?.('focusin', showReason);
  listEl?.addEventListener?.('mouseout', event => {
    if (!reasonBox?.contains(event.relatedTarget) && !event.target?.closest?.('[data-notebook-entry-id]')?.contains(event.relatedTarget)) hideTimer = setTimeout(hideReason, 150);
  });
  listEl?.addEventListener?.('focusout', hideReason);
  listEl?.addEventListener?.('scroll', hideReason);
  listEl?.ownerDocument?.addEventListener('keydown', event => { if (event.key === 'Escape') hideReason(); });

  function matchesType(entry) {
    return matchesNotebookType(entry, notebookType);
  }

  function buildEntryButtonHtml(entry) {
    const isActive = entry.id === getEditingEntryId();
    const stateLabel = notebookStateLabel(entry);
    const stateClass = ` is-${normalizeNotebookState(entry?.notebookState)}`;
    const reason = normalizeNotebookState(entry?.notebookState) === 'suggested'
      ? String(entry.agentDraftMeta?.rationale || '').trim() : '';
    return renderFolderTreeLeaf({
      active: isActive,
      wrapperClass: 'biology-notebook-page-leaf',
      controlClass: `biology-notebook-page-row folder-tree-template__rail-leaf${stateClass}`,
      controlAttributes: { 'data-notebook-entry-id': entry.id, ...(reason ? { 'data-suggestion-reason': reason, 'aria-description': reason } : {}) },
      contentHtml: `
        <span class="biology-notebook-page-name folder-tree-template__leaf-label">${safeText(resolveEntryExperimentName(entry))}</span>
        <span class="biology-notebook-page-badge folder-tree-template__leaf-meta">${safeText(stateLabel)}</span>
      `
    });
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
    hideReason();
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
        const suggestionOrder = Number(normalizeNotebookState(right.notebookState) === 'suggested')
          - Number(normalizeNotebookState(left.notebookState) === 'suggested');
        if (suggestionOrder) return suggestionOrder;
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });

    if (!entries.length && !projects.length) {
      listEl.innerHTML = '';
      return;
    }

    const groups = groupEntries(entries);
    const activeProjectDashboardId = String(getActiveProjectDashboardId() || '');
    listEl.innerHTML = Array.from(groups.values()).map((group) => {
      const entryButtons = group.entries.length
        ? group.entries.map((entry) => buildEntryButtonHtml(entry)).join('')
        : '<p class="biology-notebook-page-list-empty biology-notebook-page-list-empty--folder">No pages yet.</p>';
      const isActiveProject = group.projectId && group.projectId === activeProjectDashboardId;
      const isExpanded = folderTree.isExpanded(group.groupKey, true);
      const mainHtml = group.projectId ? '' : `
        <div class="biology-notebook-folder-static folder-tree-template__main">
          <span class="biology-notebook-folder-glyph left-rail-folder-glyph" aria-hidden="true"></span>
          <span class="biology-notebook-folder-name folder-tree-template__label">${safeText(group.groupName)}</span>
        </div>
      `;
      return renderFolderTreeNode({
        key: group.groupKey,
        expanded: isExpanded,
        active: Boolean(isActiveProject),
        label: group.groupName,
        childrenHtml: entryButtons,
        nodeClass: `biology-notebook-folder ${group.groupClass}${isExpanded ? '' : ' is-collapsed'}`,
        rowClass: `biology-notebook-folder-item ${group.itemClass}`,
        disclosureClass: 'biology-notebook-folder-toggle',
        mainClass: 'biology-notebook-folder-name-btn',
        labelClass: 'biology-notebook-folder-name',
        glyphClass: 'biology-notebook-folder-glyph',
        childrenClass: 'biology-notebook-folder-children biology-notebook-folder-children--pages folder-tree-template__children--full-width-leaves',
        disclosureAttributes: { 'data-notebook-folder-toggle': group.groupKey },
        mainAttributes: group.projectId ? {
          'data-notebook-project-id': group.projectId,
          'data-notebook-project-name': group.groupName
        } : {},
        mainHtml
      });
    }).join('');
  }

  function toggleFolder(folderKey) {
    const key = String(folderKey || '');
    if (!key) {
      return;
    }
    folderTree.toggle(key, true);
    renderEntries();
  }

  return {
    renderEntries,
    toggleFolder
  };
}
