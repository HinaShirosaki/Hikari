import {
  buildClarifiedNotebookNote,
  clarifyNotebookNote
} from '../../../services/notebook-note-tools.js';
import { showTransientNotice } from '../../../lib/notify.js';
import {
  buildNotebookFolderPath,
  cloneProtocolSnapshot,
  mergeNotebookValues,
  pruneNotebookValuesForProtocol
} from '../entry/entry-helpers.js';
import {
  ensureStorageFolderExists,
  persistImportedNotebookFiles
} from '../storage/file-import.js';
import {
  buildSaveableNotebookEntry,
  mergeImportedResultFiles
} from '../entry/entry-record-builder.js';
import { isPathInsideRoot } from '../../../lib/storage-paths.js';
import {
  changedFieldList,
  describeNotebookEntryChanges,
  logNotebookPageEvent
} from '../storage/page-log.js';
import { normalizeNotebookExperimentNameSource } from '../entry/page-name-generator.js';

// Writing the open notebook page back to state: builds the record, copies any
// imported result files into storage, logs the change, and offers the
// clarify-then-save variant.
function createNotebookSaveEntry({
  state,
  persist,
  createId,
  notebookType,
  matchesType,
  findSelectedProtocol,
  elements,
  entryListRenderer,
  protocolEditor,
  resultTableController,
  toolSidebarController,
  onNotebookEntriesChanged,
  onEntryExecuted = () => {},
  collectNotebookValues,
  collectCarriedOverKeys = () => [],
  collectNotebookSampleLinks,
  getSelectedNotebookResultFiles,
  clearPendingNotebookResultFiles,
  resolveViewerProject,
  resolveViewerProtocol,
  maybeGenerateNotebookPageName,
  renderProtocolViewer,
  updateSaveButtonLabel,
  setNotebookSaveBusy,
  getEditingEntryId,
  setEditingEntryId,
  getExperimentNameSourceDraft,
  getExperimentNameGeneratedAtDraft,
  getExperimentNameGeneratedModelDraft
} = {}) {
  const { notebookExperimentName, notebookResult } = elements;

  async function saveEntry(options = {}) {
    const editingEntry = getEditingEntryId()
      ? state.notebookEntries.find((item) => item.id === getEditingEntryId() && matchesType(item))
      : null;
    const project = resolveViewerProject(editingEntry);
    const selectedProtocol = findSelectedProtocol();
    const baseProtocol = resolveViewerProtocol(editingEntry) || selectedProtocol;
    const protocol = protocolEditor.isEditing()
      ? protocolEditor.buildSnapshot(baseProtocol)
      : (cloneProtocolSnapshot(baseProtocol) || cloneProtocolSnapshot(editingEntry?.protocolSnapshot) || null);

    if (!project || !protocol) {
      return null;
    }

    const values = pruneNotebookValuesForProtocol(
      mergeNotebookValues(editingEntry?.values, collectNotebookValues()),
      protocol
    );
    // Values accepted from a previous run (Tab on ghost text), kept as provenance.
    const carriedOver = collectCarriedOverKeys().filter((key) => values[key]);
    await maybeGenerateNotebookPageName({ protocol, values });
    const entryId = editingEntry?.id || createId();
    const selectedResultFiles = getSelectedNotebookResultFiles();
    const existingResultFiles = Array.isArray(editingEntry?.resultFiles)
      ? editingEntry.resultFiles.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    const existingResultFileRecords = Array.isArray(editingEntry?.resultFileRecords)
      ? editingEntry.resultFileRecords
        .filter((record) => record && typeof record === 'object')
        .map((record) => ({ ...record }))
      : [];
    const existingStorageFolder = String(editingEntry?.storageFolder || '').trim();
    const storageFolder = existingStorageFolder && isPathInsideRoot(state.settings.storagePath, existingStorageFolder)
      ? existingStorageFolder
      : buildNotebookFolderPath({
        storagePath: state.settings.storagePath,
        projectName: project.name,
        protocolName: protocol.name,
        entryId
      });

    let importedResultFileRecords = [];
    try {
      await ensureStorageFolderExists(storageFolder, window.hikariApi?.ensureStorageDirectory?.bind(window.hikariApi));
      importedResultFileRecords = await persistImportedNotebookFiles({
        files: selectedResultFiles,
        storageFolder,
        storagePath: state.settings.storagePath,
        storeImportedFile: window.hikariApi?.storeImportedFile?.bind(window.hikariApi)
      });
    } catch (error) {
      showTransientNotice(String(error?.message || error || 'Failed to store notebook files.'), { type: 'error' });
      return null;
    }

    const { resultFiles, resultFileRecords } = mergeImportedResultFiles({
      existingResultFiles,
      existingResultFileRecords,
      importedResultFileRecords,
      selectedResultFiles
    });
    const resultTables = resultTableController.getCurrentTables();

    const baseEntry = buildSaveableNotebookEntry({
      editingEntry,
      project,
      protocol,
      baseProtocol,
      notebookType,
      entryId,
      values,
      resultText: String(options.resultText ?? notebookResult.value).trim(),
      resultTables,
      toolCalculations: toolSidebarController.getCalculations(),
      sampleLinks: collectNotebookSampleLinks(editingEntry, protocol),
      resultFiles,
      resultFileRecords,
      storageFolder,
      currentExperimentName: String(notebookExperimentName?.value || '').trim(),
      nowIso: new Date().toISOString()
    });
    const experimentNameSource = normalizeNotebookExperimentNameSource(getExperimentNameSourceDraft()) || 'protocol';
    const entry = {
      ...baseEntry,
      ...(carriedOver.length ? { carriedOver } : {}),
      experimentNameSource,
      experimentNameGeneratedAt: experimentNameSource === 'generated' ? getExperimentNameGeneratedAtDraft() : '',
      experimentNameGeneratedModel: experimentNameSource === 'generated' ? getExperimentNameGeneratedModelDraft() : '',
      agentAppendProposalIds: Array.from(new Set([
        ...(Array.isArray(editingEntry?.agentAppendProposalIds) ? editingEntry.agentAppendProposalIds : []),
        String(options.agentAppendProposalId || '').trim()
      ].filter(Boolean)))
    };

    const index = editingEntry
      ? state.notebookEntries.findIndex((item) => item.id === editingEntry.id)
      : -1;
    const previousEntrySnapshot = index >= 0 ? { ...state.notebookEntries[index] } : null;
    if (index >= 0) {
      state.notebookEntries[index] = { ...state.notebookEntries[index], ...entry };
    } else {
      state.notebookEntries.push(entry);
    }
    const persistedEntry = index >= 0 ? state.notebookEntries[index] : entry;

    setEditingEntryId(entry.id);
    protocolEditor.setDraft(null);
    protocolEditor.setEditing(false);
    updateSaveButtonLabel();

    persist();
    if (previousEntrySnapshot) {
      const changes = describeNotebookEntryChanges(previousEntrySnapshot, persistedEntry);
      const changedFields = changedFieldList(changes);
      if (changedFields.length) {
        logNotebookPageEvent({
          entry: persistedEntry,
          storagePath: state.settings?.storagePath,
          action: 'update',
          summary: `Updated notebook page (${changedFields.join(', ')})`,
          details: {
            changedFields,
            changes,
            experimentName: persistedEntry.experimentName || '',
            importedFileCount: importedResultFileRecords.length
          }
        });
      }
    } else {
      logNotebookPageEvent({
        entry: persistedEntry,
        storagePath: state.settings?.storagePath,
        action: 'create',
        summary: `Created notebook page${persistedEntry.experimentName ? ` "${persistedEntry.experimentName}"` : ''}`,
        details: {
          notebookType,
          carriedOver,
          projectName: persistedEntry.projectName || '',
          protocolName: persistedEntry.protocolName || '',
          experimentName: persistedEntry.experimentName || '',
          importedFileCount: importedResultFileRecords.length
        }
      });
    }
    clearPendingNotebookResultFiles();
    entryListRenderer.renderEntries();
    renderProtocolViewer({
      project,
      protocol: cloneProtocolSnapshot(protocol) || protocol,
      entry,
      isSavedEntry: true
    });
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
    if (!previousEntrySnapshot && entry.notebookState === 'executed') onEntryExecuted(entry);
    return entry;
  }

  async function clarifyAndSaveEntry() {
    const source = String(notebookResult.value || '').trim();
    if (!source) {
      showTransientNotice('Add notebook notes before clarifying them.', { type: 'error' });
      return;
    }
    setNotebookSaveBusy(true, { clarify: true });
    try {
      const clarified = await clarifyNotebookNote({
        llm: state.settings?.llm,
        text: source
      });
      const combinedNote = buildClarifiedNotebookNote(source, clarified);
      notebookResult.value = combinedNote;
      const savedEntry = await saveEntry({
        resultText: combinedNote
      });
      if (!savedEntry) {
        throw new Error('Unable to save the clarified notebook entry.');
      }
      logNotebookPageEvent({
        entry: savedEntry,
        storagePath: state.settings?.storagePath,
        action: 'clarify',
        summary: 'Clarified notebook note via LLM',
        details: {
          sourceCharacters: source.length,
          combinedCharacters: combinedNote.length
        }
      });
      showTransientNotice('Clarified note saved.');
    } catch (error) {
      showTransientNotice(String(error?.message || error || 'Failed to clarify the notebook entry.'), {
        type: 'error'
      });
    } finally {
      setNotebookSaveBusy(false);
    }
  }

  return { saveEntry, clarifyAndSaveEntry };
}

export { createNotebookSaveEntry };
