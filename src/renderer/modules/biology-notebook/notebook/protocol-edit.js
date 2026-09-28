import {
  cloneProtocolSnapshot,
  mergeNotebookValues,
  pruneNotebookValuesForProtocol,
  resolveEntryExperimentName,
  shouldSyncExperimentNameWithProtocol
} from '../entry/entry-helpers.js';
import { logNotebookPageEvent } from '../../../services/notebook-page-log.js';

// Editing the protocol snapshot attached to a saved page, and re-syncing the
// page when its project or protocol selection changes.
function createNotebookProtocolEdit({
  state,
  persist,
  elements,
  dropdownRenderer,
  entryListRenderer,
  protocolEditor,
  resultTableController,
  toolSidebarController,
  sampleLinkMenu,
  onNotebookEntriesChanged,
  getActiveEntry,
  matchesType,
  getEntryProtocol,
  collectNotebookValues,
  collectNotebookSampleLinks,
  syncNotebookTitle,
  renderProtocolViewer,
  markDraftSaved,
  hideProjectDashboard,
  clearViewer,
  setPageStarterVisible,
  updateSaveButtonLabel,
  resolveViewerProject,
  resolveViewerProtocol,
  getEditingEntryId,
  setEditingEntryId,
  setSampleLinkDrafts
} = {}) {
  const {
    notebookProjectSelect,
    notebookProtocolSelect,
    notebookExperimentName,
    notebookResult
  } = elements;

  function beginProtocolEdit() {
    const entry = getActiveEntry();
    const protocol = cloneProtocolSnapshot(resolveViewerProtocol(entry));
    if (!protocolEditor.beginEdit(protocol)) {
      return;
    }
    protocolEditor.syncControls(protocol, entry);
  }

  function cancelProtocolEdit() {
    protocolEditor.cancelEdit();
    const entry = getActiveEntry();
    protocolEditor.syncControls(resolveViewerProtocol(entry), entry);
  }

  function applyProtocolEdit() {
    const entry = getActiveEntry();
    const project = resolveViewerProject(entry);
    const currentProtocol = resolveViewerProtocol(entry);
    if (!project || !currentProtocol) {
      return;
    }

    const nextProtocol = protocolEditor.buildSnapshot(currentProtocol);
    const shouldSyncExperimentName = shouldSyncExperimentNameWithProtocol(
      notebookExperimentName?.value,
      currentProtocol.name
    );
    const nextExperimentName = shouldSyncExperimentName
      ? nextProtocol.name
      : String(notebookExperimentName?.value || '').trim();

    if (notebookExperimentName && shouldSyncExperimentName) {
      notebookExperimentName.value = nextProtocol.name;
      syncNotebookTitle(nextProtocol);
    }

    protocolEditor.setEditing(false);

    if (!entry) {
      const resultTables = resultTableController.getCurrentTables();
      protocolEditor.setDraft(cloneProtocolSnapshot(nextProtocol));
      renderProtocolViewer({
        project,
        protocol: nextProtocol,
        entry: null,
        isSavedEntry: false,
        experimentNameOverride: nextExperimentName,
        resultTablesOverride: resultTables,
        preserveSelectedFiles: true,
        preserveToolCalculations: true,
        markSavedBaseline: false
      });
      return;
    }

    const resultTables = resultTableController.getCurrentTables();
    const nextEntry = {
      ...entry,
      protocolId: String(nextProtocol.id || entry.protocolId || '').trim(),
      protocolName: nextProtocol.name,
      experimentName: nextExperimentName || resolveEntryExperimentName(entry, nextProtocol),
      protocolSnapshot: cloneProtocolSnapshot(nextProtocol),
      values: pruneNotebookValuesForProtocol(
        mergeNotebookValues(entry?.values, collectNotebookValues()),
        nextProtocol
      ),
      result: String(notebookResult.value || '').trim(),
      resultTable: resultTables[0] || null,
      resultTables,
      toolCalculations: toolSidebarController.getCalculations(),
      sampleLinks: collectNotebookSampleLinks(entry, nextProtocol),
      updatedAt: new Date().toISOString()
    };
    const index = state.notebookEntries.findIndex((item) => item.id === entry.id && matchesType(item));
    if (index < 0) {
      return;
    }

    const previousProtocolName = entry.protocolName || '';
    state.notebookEntries[index] = nextEntry;
    protocolEditor.setDraft(null);
    persist();
    logNotebookPageEvent({
      entry: nextEntry,
      storagePath: state.settings?.storagePath,
      action: 'protocol-edit',
      summary: `Edited protocol snapshot${nextEntry.protocolName ? ` (${nextEntry.protocolName})` : ''}`,
      details: {
        previousProtocolName,
        protocolName: nextEntry.protocolName || '',
        protocolId: nextEntry.protocolId || ''
      }
    });
    entryListRenderer.renderEntries();
    renderProtocolViewer({
      project,
      protocol: nextProtocol,
      entry: nextEntry,
      isSavedEntry: true,
      preserveSelectedFiles: true
    });
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
    markDraftSaved();
  }

  function onProjectChange() {
    hideProjectDashboard();
    setPageStarterVisible(true);
    setEditingEntryId(null);
    setSampleLinkDrafts(new Map());
    sampleLinkMenu.close();
    protocolEditor.clearDraft();
    updateSaveButtonLabel();
    dropdownRenderer.renderProtocolOptions();
    entryListRenderer.renderEntries();
  }

  function onProtocolChange() {
    hideProjectDashboard();
    protocolEditor.clearDraft();
    setSampleLinkDrafts(new Map());
    sampleLinkMenu.close();
    const projectId = notebookProjectSelect.value;
    const protocolId = notebookProtocolSelect.value;
    const project = state.projects.find((item) => item.id === projectId);
    const protocol = state.protocols.find((item) => item.id === protocolId);

    if (!project || !protocol) {
      clearViewer();
      entryListRenderer.renderEntries();
      return;
    }

    const editingEntry = getEditingEntryId()
      ? state.notebookEntries.find((entry) => entry.id === getEditingEntryId() && matchesType(entry))
      : null;
    const selectedEntry = editingEntry && editingEntry.protocolId === protocol.id && editingEntry.projectId === project.id
      ? editingEntry
      : null;

    if (!selectedEntry) {
      setEditingEntryId(null);
    }

    renderProtocolViewer({
      project,
      protocol: selectedEntry ? (getEntryProtocol(selectedEntry) || protocol) : protocol,
      entry: selectedEntry,
      isSavedEntry: Boolean(selectedEntry)
    });
    entryListRenderer.renderEntries();
  }



  return {
    beginProtocolEdit,
    cancelProtocolEdit,
    applyProtocolEdit,
    onProjectChange,
    onProtocolChange
  };
}

export { createNotebookProtocolEdit };
