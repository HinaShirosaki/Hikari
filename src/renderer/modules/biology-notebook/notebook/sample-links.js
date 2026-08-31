import { showTransientNotice } from '../../../lib/notify.js';
import { buildViewerMeta } from '../entry/viewer-renderer.js';
import { normalizeNotebookSampleLinks } from '../samples/sample-helpers.js';
import {
  mergeNotebookValues,
  normalizeNotebookState,
  pruneNotebookValuesForProtocol
} from '../entry/entry-helpers.js';
import {
  changedFieldList,
  describeNotebookEntryChanges,
  logNotebookPageEvent
} from '../storage/page-log.js';

// Marking a page executed and keeping its sample links in step with the
// placeholders the page actually uses.
function createNotebookSampleLinks({
  state,
  persist,
  elements,
  entryListRenderer,
  resultTableController,
  toolSidebarController,
  onNotebookEntriesChanged,
  getActiveEntry,
  collectNotebookValues,
  collectNotebookSampleLinks,
  resolveViewerProtocol,
  appendNotebookResultLine,
  markDraftSaved,
  getEditingEntryId,
  matchesType,
  getEntryProject,
  getEntryProtocol,
  renderProtocolViewer
} = {}) {
  const { notebookProtocolMeta, notebookResult } = elements;

  function markEntryExecuted() {
    if (!getEditingEntryId()) {
      return;
    }
    const index = state.notebookEntries.findIndex((item) => item.id === getEditingEntryId() && matchesType(item));
    if (index < 0) {
      return;
    }
    const currentEntry = state.notebookEntries[index];
    if (normalizeNotebookState(currentEntry?.notebookState) !== 'planned') {
      return;
    }

    const timestamp = new Date().toISOString();
    const nextEntry = {
      ...currentEntry,
      notebookState: 'executed',
      executedAt: timestamp,
      updatedAt: timestamp
    };
    state.notebookEntries[index] = nextEntry;
    persist();
    logNotebookPageEvent({
      entry: nextEntry,
      storagePath: state.settings?.storagePath,
      action: 'execute',
      summary: 'Marked notebook page as executed',
      details: { executedAt: timestamp }
    });
    entryListRenderer.renderEntries();

    const project = getEntryProject(nextEntry);
    const protocol = getEntryProtocol(nextEntry);
    if (project && protocol) {
      renderProtocolViewer({
        project,
        protocol,
        entry: nextEntry,
        isSavedEntry: true
      });
    }
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
    markDraftSaved();
  }

  function persistActiveEntrySampleLinks() {
    const activeEntry = getActiveEntry();
    if (!activeEntry) {
      return;
    }
    const protocol = resolveViewerProtocol(activeEntry);
    if (!protocol) {
      return;
    }
    const index = state.notebookEntries.findIndex((item) => item.id === activeEntry.id && matchesType(item));
    if (index < 0) {
      return;
    }
    const timestamp = new Date().toISOString();
    const resultTables = resultTableController.getCurrentTables();
    const nextEntry = {
      ...state.notebookEntries[index],
      values: pruneNotebookValuesForProtocol(
        mergeNotebookValues(state.notebookEntries[index]?.values, collectNotebookValues()),
        protocol
      ),
      result: String(notebookResult.value || '').trim(),
      resultTable: resultTables[0] || null,
      resultTables,
      toolCalculations: toolSidebarController.getCalculations(),
      sampleLinks: collectNotebookSampleLinks(state.notebookEntries[index], protocol),
      updatedAt: timestamp
    };
    const previousEntrySnapshot = { ...state.notebookEntries[index] };
    state.notebookEntries[index] = nextEntry;
    persist();
    const changes = describeNotebookEntryChanges(previousEntrySnapshot, nextEntry, [
      'values',
      'result',
      'resultTable',
      'resultTables',
      'sampleLinks'
    ]);
    const changedFields = changedFieldList(changes);
    if (changedFields.length) {
      const sampleLinkCount = Array.isArray(nextEntry.sampleLinks) ? nextEntry.sampleLinks.length : 0;
      logNotebookPageEvent({
        entry: nextEntry,
        storagePath: state.settings?.storagePath,
        action: 'sample-link-update',
        summary: `Updated linked samples (${changedFields.join(', ')})`,
        details: { changedFields, changes, sampleLinkCount }
      });
    }
    entryListRenderer.renderEntries();
    const project = getEntryProject(nextEntry);
    if (project && notebookProtocolMeta) {
      notebookProtocolMeta.textContent = buildViewerMeta({
        project,
        entry: nextEntry,
        isSavedEntry: true,
        projects: state.projects
      });
    }
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
    markDraftSaved();
  }

  function applyQuickSampleCapture({ entry, record, sampleLink, note }) {
    const index = state.notebookEntries.findIndex((item) => item.id === entry?.id && matchesType(item));
    if (index < 0) {
      throw new Error('The notebook page is no longer available.');
    }
    state.notebookEntries[index] = {
      ...state.notebookEntries[index],
      sampleLinks: normalizeNotebookSampleLinks(state.notebookEntries[index]?.sampleLinks).concat(sampleLink)
    };
    appendNotebookResultLine(note);
    persistActiveEntrySampleLinks();
    showTransientNotice(`Added sample ${record?.code || record?.name || ''} to this notebook page.`);
  }

  return {
    markEntryExecuted,
    persistActiveEntrySampleLinks,
    applyQuickSampleCapture
  };
}

export { createNotebookSampleLinks };
