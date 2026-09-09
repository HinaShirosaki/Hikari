import { getGelAnalyses } from '../../../lib/gel-records.js';
import { findLatestLinkedRecord } from '../../../services/notebook-linked-previews.js';
import {
  buildLinkedAssayPreviewHtml,
  buildLinkedGelPreviewHtml
} from '../results/linked-previews-renderer.js';
import { printElement } from '../../print/index.js';

// Linked assay/gel previews under Results, the entry-list click routing, and
// opening a saved page back into the editor (plus export and print).
function createNotebookEntryActions({
  state,
  safeText,
  elements,
  dropdownRenderer,
  entryListRenderer,
  protocolEditor,
  linkedWorkActions,
  previewImageLoader,
  getActiveEntry,
  showProjectDashboard,
  clearViewer,
  renderProtocolViewer,
  getEditingEntryId,
  setEditingEntryId,
  getLinkedPreviewRenderToken,
  setLinkedPreviewRenderToken,
  saveEntry,
  matchesType,
  getEntryProject,
  getEntryProtocol,
  syncPageStarterProject,
  onProtocolChange
} = {}) {
  const {
    notebookProjectSelect,
    notebookProtocolArea,
    notebookProtocolTitle,
    notebookLinkedResults
  } = elements;

  async function renderLinkedPreviews(entry = null) {
    if (!notebookLinkedResults) {
      return;
    }

    const renderToken = getLinkedPreviewRenderToken() + 1;
    setLinkedPreviewRenderToken(renderToken);

    const activeEntry = entry || getActiveEntry();
    if (!activeEntry?.id) {
      notebookLinkedResults.innerHTML = '<p class="small-note biology-notebook-linked-empty">Save this notebook page to attach gel and assay records.</p>';
      return;
    }

    const linkedGel = findLatestLinkedRecord(getGelAnalyses(state), activeEntry.id);
    const linkedAssay = findLatestLinkedRecord(state.assays, activeEntry.id);
    const parts = [];

    if (linkedGel) {
      parts.push(buildLinkedGelPreviewHtml(linkedGel, await previewImageLoader.resolveGelPreviewImage(linkedGel), safeText));
    }
    if (linkedAssay) {
      parts.push(buildLinkedAssayPreviewHtml(linkedAssay, safeText));
    }

    if (renderToken !== getLinkedPreviewRenderToken()) {
      return;
    }

    notebookLinkedResults.innerHTML = parts.length
      ? parts.join('')
      : '';
  }

  async function ensureNotebookEntryForLinkedWork() {
    const existingEntry = getActiveEntry();
    if (existingEntry) {
      return existingEntry;
    }
    // No page in the viewer (project dashboard or empty state): the dropdowns
    // still hold the last protocol, so saving here would mint a stray page.
    if (notebookProtocolArea?.hidden) {
      return null;
    }
    return saveEntry();
  }

  function onEntryListClick(event) {
    const entryButton = event?.target?.closest?.('[data-notebook-entry-id]')
      || (event?.target?.dataset?.notebookEntryId ? event.target : null);
    if (entryButton) {
      editEntry(entryButton.dataset.notebookEntryId);
      return;
    }

    const folderToggle = event?.target?.closest?.('[data-notebook-folder-toggle]')
      || (event?.target?.dataset?.notebookFolderToggle ? event.target : null);
    if (folderToggle) {
      entryListRenderer.toggleFolder(folderToggle.dataset.notebookFolderToggle);
      return;
    }

    const projectFolder = event?.target?.closest?.('[data-notebook-project-id]')
      || (event?.target?.dataset?.notebookProjectId ? event.target : null);
    if (!projectFolder) {
      return;
    }
    event?.preventDefault?.();
    showProjectDashboard(projectFolder.dataset.notebookProjectId, projectFolder.dataset.notebookProjectName);
  }

  function onExportButtonClick() {
    if (!getEditingEntryId()) {
      return;
    }
    void linkedWorkActions.exportEntryPdf(getEditingEntryId());
  }

  function onPrintButtonClick() {
    if (!getEditingEntryId() || !notebookProtocolArea) {
      return;
    }
    const title = String(notebookProtocolTitle?.textContent || '').trim() || 'Notebook Page';
    printElement(notebookProtocolArea, {
      title: `Notebook - ${title}`,
      omitSelectors: [
        '.biology-notebook-viewer-actions',
        '.form-actions',
        '#biology-notebook-protocol-editor'
      ]
    });
  }

  function editEntry(entryId) {
    const entry = state.notebookEntries.find((item) => item.id === entryId && matchesType(item));
    if (!entry) {
      return;
    }

    setEditingEntryId(entry.id);
    protocolEditor.clearDraft();
    const project = getEntryProject(entry);
    const protocol = getEntryProtocol(entry);
    const hasLiveProject = Boolean(project?.id && state.projects.some((item) => item.id === project.id));
    const hasLiveProtocol = Boolean(protocol?.id && state.protocols.some((item) => item.id === protocol.id));

    notebookProjectSelect.value = hasLiveProject ? project.id : '';
    dropdownRenderer.renderProtocolOptions(hasLiveProtocol ? protocol.id : '', { triggerChange: false });
    syncPageStarterProject();

    if (!project || !protocol) {
      clearViewer();
      entryListRenderer.renderEntries();
      return;
    }

    if (hasLiveProject && hasLiveProtocol) {
      onProtocolChange();
      return;
    }

    renderProtocolViewer({
      project,
      protocol,
      entry,
      isSavedEntry: true
    });
    entryListRenderer.renderEntries();
  }

  return {
    renderLinkedPreviews,
    ensureNotebookEntryForLinkedWork,
    onEntryListClick,
    onExportButtonClick,
    onPrintButtonClick,
    editEntry
  };
}

export { createNotebookEntryActions };
