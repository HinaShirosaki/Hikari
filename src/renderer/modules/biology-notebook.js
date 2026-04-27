// Biology notebook controller.
//
// Responsibilities:
// - render project/protocol selections for notebook entry creation
// - populate inline placeholder editors from protocol step definitions
// - save notebook entries plus imported result files into app state
// - support editing existing entries and exporting them to PDF
import { findLatestLinkedRecord } from './notebook-linked-previews.js';
import { buildClarifiedNotebookNote, clarifyNotebookNote, showTransientNotice } from './notebook-note-tools.js';
import {
  buildNotebookFolderPath,
  cloneProtocolSnapshot,
  collectProtocolPlaceholderKeys,
  matchesNotebookType,
  mergeNotebookValues,
  normalizeNotebookState,
  pruneNotebookValuesForProtocol,
  resolveEntryExperimentName,
  resolveEntryProject,
  resolveEntryProtocol,
  shouldSyncExperimentNameWithProtocol
} from './biology-notebook/entry-helpers.js';
import {
  buildSamplePlaceholderTypeAliases,
  normalizeNotebookSampleLink,
  normalizeNotebookSampleLinks
} from './biology-notebook/sample-helpers.js';
import {
  ensureStorageFolderExists,
  persistImportedNotebookFiles
} from './biology-notebook/file-import.js';
import {
  buildLinkedAssayPreviewHtml,
  buildLinkedGelPreviewHtml,
  createLinkedPreviewImageLoader
} from './biology-notebook/linked-previews-renderer.js';
import { createResultTableController } from './biology-notebook/result-table-controller.js';
import { createSampleLinkMenuController } from './biology-notebook/sample-link-menu.js';
import { createInlinePlaceholderController } from './biology-notebook/inline-placeholder-controller.js';
import { createEntryListRenderer } from './biology-notebook/entry-list-renderer.js';
import { createDropdownRenderer } from './biology-notebook/dropdown-renderer.js';
import { createProtocolSnapshotEditor } from './biology-notebook/protocol-snapshot-editor.js';
import { createLinkedWorkActions } from './biology-notebook/linked-work-actions.js';
import {
  buildProtocolStepsHtml,
  buildViewerMeta
} from './biology-notebook/viewer-renderer.js';
import {
  buildSaveableNotebookEntry,
  mergeImportedResultFiles
} from './biology-notebook/entry-record-builder.js';
import { registerNotebookSelectionInsightsHost } from './biology-notebook/selection-insights-host.js';
import { isPathInsideRoot } from './storage-path-normalizer.js';

// Initialize the biology notebook module and wire it to app state plus DOM controls.
export function initLabNotebook({
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged,
  onCreateLinkedAssay,
  onCreateLinkedGel,
  onOpenSampleRecorder,
  selectionInsightsController = null,
  notebookType = 'biology'
}) {
  const SAMPLE_PLACEHOLDER_TYPE_ALIASES = buildSamplePlaceholderTypeAliases();
  const TabulatorLib = window.Tabulator || null;

  const notebookProjectSelect = document.getElementById('biology-notebook-project-select');
  const notebookProtocolSearchInput = document.getElementById('biology-notebook-protocol-search');
  const notebookProtocolSelect = document.getElementById('biology-notebook-protocol-select');
  const notebookEmptyState = document.getElementById('biology-notebook-empty-state');
  const notebookProtocolArea = document.getElementById('biology-notebook-protocol-area');
  const notebookExperimentName = document.getElementById('biology-notebook-experiment-name');
  const notebookProtocolTitle = document.getElementById('biology-notebook-protocol-title');
  const notebookProtocolMeta = document.getElementById('biology-notebook-protocol-meta');
  const notebookEditProtocolBtn = document.getElementById('biology-notebook-edit-protocol-btn');
  const notebookApplyProtocolEditBtn = document.getElementById('biology-notebook-apply-protocol-edit-btn');
  const notebookCancelProtocolEditBtn = document.getElementById('biology-notebook-cancel-protocol-edit-btn');
  const notebookExportBtn = document.getElementById('biology-notebook-export-btn');
  const notebookMarkExecutedBtn = document.getElementById('biology-notebook-mark-executed-btn');
  const notebookPageListStatus = document.getElementById('biology-notebook-page-list-status');
  const notebookProtocolEditor = document.getElementById('biology-notebook-protocol-editor');
  const notebookProtocolDraftName = document.getElementById('biology-notebook-page-protocol-name');
  const notebookProtocolDraftSteps = document.getElementById('biology-notebook-page-protocol-steps');
  const notebookSteps = document.getElementById('biology-notebook-steps');
  const notebookResult = document.getElementById('biology-notebook-result');
  const notebookResultFile = document.getElementById('biology-notebook-result-file');
  const notebookAddTableBtn = document.getElementById('biology-notebook-add-table-btn');
  const notebookAddTableRowBtn = document.getElementById('biology-notebook-add-table-row-btn');
  const notebookAddTableColumnBtn = document.getElementById('biology-notebook-add-table-column-btn');
  const notebookRemoveTableBtn = document.getElementById('biology-notebook-remove-table-btn');
  const notebookResultTableWrap = document.getElementById('biology-notebook-result-table-wrap');
  const notebookResultTableHost = document.getElementById('biology-notebook-result-table');
  const notebookResultTableStatus = document.getElementById('biology-notebook-result-table-status');
  const notebookAddGelBtn = document.getElementById('biology-notebook-add-gel-btn');
  const notebookAddAssayBtn = document.getElementById('biology-notebook-add-assay-btn');
  const notebookAddSamplesBtn = document.getElementById('biology-notebook-add-samples-btn');
  const notebookLinkedResults = document.getElementById('biology-notebook-linked-results');
  const saveNotebookBtn = document.getElementById('save-biology-notebook-btn');
  const clarifySaveNotebookBtn = document.getElementById('clarify-save-biology-notebook-btn');
  const cancelEditBtn = document.getElementById('cancel-biology-notebook-edit-btn');
  const notebookEntryList = document.getElementById('biology-notebook-entry-list');

  let editingEntryId = null;
  let linkedPreviewRenderToken = 0;
  let sampleLinkDrafts = new Map();

  const previewImageLoader = createLinkedPreviewImageLoader({
    readFileBase64: window.enanaApi?.readFileBase64?.bind(window.enanaApi)
  });

  const resultTableController = createResultTableController({
    host: notebookResultTableHost,
    statusEl: notebookResultTableStatus,
    wrapEl: notebookResultTableWrap,
    addBtn: notebookAddTableBtn,
    addRowBtn: notebookAddTableRowBtn,
    addColBtn: notebookAddTableColumnBtn,
    removeBtn: notebookRemoveTableBtn,
    createId,
    TabulatorLib
  });

  const protocolEditor = createProtocolSnapshotEditor({
    protocolArea: notebookProtocolArea,
    editorEl: notebookProtocolEditor,
    stepsHost: notebookSteps,
    editBtn: notebookEditProtocolBtn,
    applyBtn: notebookApplyProtocolEditBtn,
    cancelBtn: notebookCancelProtocolEditBtn,
    exportBtn: notebookExportBtn,
    markExecutedBtn: notebookMarkExecutedBtn,
    draftNameInput: notebookProtocolDraftName,
    draftStepsInput: notebookProtocolDraftSteps,
    createId
  });

  const sampleLinkMenu = createSampleLinkMenuController({
    doc: typeof document !== 'undefined' ? document : null,
    win: typeof window !== 'undefined' ? window : null,
    getSamples: () => (Array.isArray(state.samples) ? state.samples : []),
    getInventory: () => (state.inventory || {}),
    safeText,
    onSelect: (sample, menuState) => inlinePlaceholders.linkSample({ menuState, sample })
  });

  const inlinePlaceholders = createInlinePlaceholderController({
    stepsHost: notebookSteps,
    getSampleLink: (key) => sampleLinkDrafts.get(key),
    setSampleLink: (key, link) => sampleLinkDrafts.set(key, link),
    deleteSampleLink: (key) => sampleLinkDrafts.delete(key),
    getInventory: () => state.inventory || {},
    onOpenSampleLinkMenu: (params) => sampleLinkMenu.open(params),
    onCloseSampleLinkMenu: () => sampleLinkMenu.close(),
    onAppendResultLine: appendNotebookResultLine,
    onPersistSampleLinks: persistActiveEntrySampleLinks
  });

  const entryListRenderer = createEntryListRenderer({
    listEl: notebookEntryList,
    statusEl: notebookPageListStatus,
    notebookType,
    safeText,
    getNotebookEntries: () => state.notebookEntries,
    getProjects: () => state.projects,
    getProtocols: () => state.protocols,
    getEditingEntryId: () => editingEntryId,
    getViewerProtocolDraft: () => protocolEditor.getDraft(),
    getSelectedProjectId: () => notebookProjectSelect.value,
    getSelectedProtocolId: () => notebookProtocolSelect.value,
    getActiveEntry: () => getActiveEntry()
  });

  const dropdownRenderer = createDropdownRenderer({
    projectSelect: notebookProjectSelect,
    protocolSelect: notebookProtocolSelect,
    protocolSearchInput: notebookProtocolSearchInput,
    safeText,
    getProjects: () => state.projects,
    getProtocols: () => state.protocols,
    onAfterRender: () => entryListRenderer.updatePageListStatus(),
    onProtocolChange: () => onProtocolChange()
  });

  const linkedWorkActions = createLinkedWorkActions({
    notebookType,
    experimentNameInput: notebookExperimentName,
    ensureEntry: () => ensureNotebookEntryForLinkedWork(),
    getNotebookEntries: () => state.notebookEntries,
    getProtocols: () => state.protocols,
    getGelAnalyses: () => state.gelAnalyses,
    getAssays: () => state.assays,
    getSettings: () => state.settings,
    setSettings: (next) => { state.settings = next; },
    persist,
    previewImageLoader,
    onCreateLinkedGel,
    onCreateLinkedAssay,
    onOpenSampleRecorder
  });

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

  function findSelectedProtocol() {
    return state.protocols.find((item) => item.id === notebookProtocolSelect.value) || null;
  }

  function resolveViewerProject(entry = null) {
    return entry ? getEntryProject(entry) : findSelectedProject();
  }

  function resolveViewerProtocol(entry = null) {
    const draft = protocolEditor.getDraft();
    if (draft) {
      return draft;
    }
    return entry ? getEntryProtocol(entry) : findSelectedProtocol();
  }

  function getActiveEntry() {
    if (!editingEntryId) {
      return null;
    }
    return state.notebookEntries.find((entry) => entry.id === editingEntryId && matchesType(entry)) || null;
  }

  function updateNotebookEntryRecord(entryId, updater) {
    const index = state.notebookEntries.findIndex((item) => item.id === entryId && matchesType(item));
    if (index < 0 || typeof updater !== 'function') {
      return null;
    }
    const nextEntry = updater(state.notebookEntries[index]);
    if (!nextEntry || typeof nextEntry !== 'object') {
      return null;
    }
    state.notebookEntries[index] = nextEntry;
    persist();
    return nextEntry;
  }

  function seedSampleLinkDrafts(entry) {
    sampleLinkDrafts = new Map();
    normalizeNotebookSampleLinks(entry?.sampleLinks).forEach((link) => {
      if (link.placeholderKey) {
        sampleLinkDrafts.set(link.placeholderKey, link);
      }
    });
  }

  function collectNotebookSampleLinks(existingEntry, protocol) {
    const allowedKeys = collectProtocolPlaceholderKeys(protocol);
    const nonPlaceholderLinks = normalizeNotebookSampleLinks(existingEntry?.sampleLinks)
      .filter((link) => !link.placeholderKey);
    const placeholderLinks = Array.from(sampleLinkDrafts.values())
      .map((link) => normalizeNotebookSampleLink(link))
      .filter((link) => link?.placeholderKey && allowedKeys.has(link.placeholderKey));
    return nonPlaceholderLinks.concat(placeholderLinks);
  }

  function appendNotebookResultLine(line) {
    if (!notebookResult) {
      return;
    }
    const cleanLine = String(line || '').trim();
    if (!cleanLine) {
      return;
    }
    const current = String(notebookResult.value || '').trim();
    notebookResult.value = current ? `${current}\n${cleanLine}` : cleanLine;
  }

  function collectNotebookValues() {
    const values = {};
    notebookSteps.querySelectorAll('[data-nb-key]').forEach((input) => {
      values[input.dataset.nbKey] = input.value.trim();
    });
    return values;
  }

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
    }

    protocolEditor.setEditing(false);

    if (!entry) {
      const resultTable = resultTableController.getCurrent();
      protocolEditor.setDraft(cloneProtocolSnapshot(nextProtocol));
      renderProtocolViewer({
        project,
        protocol: nextProtocol,
        entry: null,
        isSavedEntry: false,
        experimentNameOverride: nextExperimentName,
        resultTableOverride: resultTable,
        preserveSelectedFiles: true
      });
      entryListRenderer.updatePageListStatus();
      return;
    }

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
      resultTable: resultTableController.getCurrent(),
      sampleLinks: collectNotebookSampleLinks(entry, nextProtocol),
      updatedAt: new Date().toISOString()
    };
    const index = state.notebookEntries.findIndex((item) => item.id === entry.id && matchesType(item));
    if (index < 0) {
      return;
    }

    state.notebookEntries[index] = nextEntry;
    protocolEditor.setDraft(null);
    persist();
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
  }

  function onProjectChange() {
    editingEntryId = null;
    sampleLinkDrafts = new Map();
    sampleLinkMenu.close();
    protocolEditor.clearDraft();
    updateSaveButtonLabel();
    dropdownRenderer.renderProtocolOptions();
    entryListRenderer.renderEntries();
  }

  function onProtocolChange() {
    protocolEditor.clearDraft();
    sampleLinkDrafts = new Map();
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

    const editingEntry = editingEntryId
      ? state.notebookEntries.find((entry) => entry.id === editingEntryId && matchesType(entry))
      : null;
    const selectedEntry = editingEntry && editingEntry.protocolId === protocol.id && editingEntry.projectId === project.id
      ? editingEntry
      : null;

    if (!selectedEntry) {
      editingEntryId = null;
    }

    renderProtocolViewer({
      project,
      protocol: selectedEntry ? (getEntryProtocol(selectedEntry) || protocol) : protocol,
      entry: selectedEntry,
      isSavedEntry: Boolean(selectedEntry)
    });
    entryListRenderer.renderEntries();
  }

  async function saveEntry(options = {}) {
    const editingEntry = editingEntryId
      ? state.notebookEntries.find((item) => item.id === editingEntryId && matchesType(item))
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
    const entryId = editingEntry?.id || createId();
    const selectedResultFiles = Array.from(notebookResultFile.files || []);
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
      await ensureStorageFolderExists(storageFolder, window.enanaApi?.ensureStorageDirectory?.bind(window.enanaApi));
      importedResultFileRecords = await persistImportedNotebookFiles({
        files: selectedResultFiles,
        storageFolder,
        storagePath: state.settings.storagePath,
        storeImportedFile: window.enanaApi?.storeImportedFile?.bind(window.enanaApi)
      });
    } catch (error) {
      window.alert(String(error?.message || error || 'Failed to store notebook files.'));
      return null;
    }

    const { resultFiles, resultFileRecords } = mergeImportedResultFiles({
      existingResultFiles,
      existingResultFileRecords,
      importedResultFileRecords,
      selectedResultFiles
    });

    const entry = buildSaveableNotebookEntry({
      editingEntry,
      project,
      protocol,
      baseProtocol,
      notebookType,
      entryId,
      values,
      resultText: String(options.resultText ?? notebookResult.value).trim(),
      resultTable: resultTableController.getCurrent(),
      sampleLinks: collectNotebookSampleLinks(editingEntry, protocol),
      resultFiles,
      resultFileRecords,
      storageFolder,
      currentExperimentName: String(notebookExperimentName?.value || '').trim(),
      nowIso: new Date().toISOString()
    });

    const index = editingEntry
      ? state.notebookEntries.findIndex((item) => item.id === editingEntry.id)
      : -1;
    if (index >= 0) {
      state.notebookEntries[index] = { ...state.notebookEntries[index], ...entry };
    } else {
      state.notebookEntries.push(entry);
    }

    editingEntryId = entry.id;
    protocolEditor.setDraft(null);
    protocolEditor.setEditing(false);
    updateSaveButtonLabel();

    persist();
    notebookResultFile.value = '';
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
      showTransientNotice('Clarified note saved.');
    } catch (error) {
      showTransientNotice(String(error?.message || error || 'Failed to clarify the notebook entry.'), {
        type: 'error'
      });
    } finally {
      setNotebookSaveBusy(false);
    }
  }

  async function renderLinkedPreviews(entry = null) {
    if (!notebookLinkedResults) {
      return;
    }

    const renderToken = ++linkedPreviewRenderToken;

    const activeEntry = entry || getActiveEntry();
    if (!activeEntry?.id) {
      notebookLinkedResults.innerHTML = '<p class="small-note biology-notebook-linked-empty">Save this notebook page to attach gel and assay records.</p>';
      return;
    }

    const linkedGel = findLatestLinkedRecord(state.gelAnalyses, activeEntry.id);
    const linkedAssay = findLatestLinkedRecord(state.assays, activeEntry.id);
    const parts = [];

    if (linkedGel) {
      parts.push(buildLinkedGelPreviewHtml(linkedGel, await previewImageLoader.resolveGelPreviewImage(linkedGel), safeText));
    }
    if (linkedAssay) {
      parts.push(buildLinkedAssayPreviewHtml(linkedAssay, safeText));
    }

    if (renderToken !== linkedPreviewRenderToken) {
      return;
    }

    notebookLinkedResults.innerHTML = parts.length
      ? parts.join('')
      : '<p class="small-note biology-notebook-linked-empty">Linked gel, assay, and plot previews will appear here after you save them to this page.</p>';
  }

  async function ensureNotebookEntryForLinkedWork() {
    const existingEntry = getActiveEntry();
    if (existingEntry) {
      return existingEntry;
    }
    return saveEntry();
  }

  function onEntryListClick(event) {
    const entryButton = event?.target?.closest?.('[data-notebook-entry-id]')
      || (event?.target?.dataset?.notebookEntryId ? event.target : null);
    if (!entryButton) {
      return;
    }
    editEntry(entryButton.dataset.notebookEntryId);
  }

  function onExportButtonClick() {
    if (!editingEntryId) {
      return;
    }
    void linkedWorkActions.exportEntryPdf(editingEntryId);
  }

  function editEntry(entryId) {
    const entry = state.notebookEntries.find((item) => item.id === entryId && matchesType(item));
    if (!entry) {
      return;
    }

    editingEntryId = entry.id;
    protocolEditor.clearDraft();
    const project = getEntryProject(entry);
    const protocol = getEntryProtocol(entry);
    const hasLiveProject = Boolean(project?.id && state.projects.some((item) => item.id === project.id));
    const hasLiveProtocol = Boolean(protocol?.id && state.protocols.some((item) => item.id === protocol.id));

    notebookProjectSelect.value = hasLiveProject ? project.id : '';
    dropdownRenderer.renderProtocolOptions(hasLiveProtocol ? protocol.id : '', { triggerChange: false });

    if (!project || !protocol) {
      clearViewer();
      entryListRenderer.renderEntries();
      entryListRenderer.updatePageListStatus();
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
    entryListRenderer.updatePageListStatus();
  }

  function renderProtocolViewer({
    project,
    protocol,
    entry,
    isSavedEntry,
    experimentNameOverride = '',
    resultTableOverride = null,
    preserveSelectedFiles = false
  }) {
    notebookProtocolArea.hidden = false;
    if (notebookEmptyState) {
      notebookEmptyState.hidden = true;
    }

    if (notebookExperimentName) {
      notebookExperimentName.value = String(experimentNameOverride || '').trim() || resolveEntryExperimentName(entry, protocol);
    }
    notebookProtocolTitle.textContent = protocol.name;
    notebookProtocolMeta.textContent = buildViewerMeta({
      project,
      entry,
      isSavedEntry,
      projects: state.projects
    });

    if (entry) {
      seedSampleLinkDrafts(entry);
    }
    notebookSteps.innerHTML = buildProtocolStepsHtml({
      protocol,
      values: entry?.values || {},
      safeText,
      samplePlaceholderTypeAliases: SAMPLE_PLACEHOLDER_TYPE_ALIASES,
      getSampleLink: (key) => sampleLinkDrafts.get(key)
    });

    notebookResult.value = entry?.result || '';
    resultTableController.renderEditor(resultTableOverride ?? entry?.resultTable ?? null);
    if (!preserveSelectedFiles) {
      notebookResultFile.value = '';
    }
    renderLinkedPreviews(entry);
    updateSaveButtonLabel();
    protocolEditor.syncControls(protocol, entry);
    syncViewerVisibility();
    selectionInsightsController?.refreshHost?.('biology-notebook-protocol');
  }

  function clearViewer() {
    notebookProtocolArea.hidden = true;
    protocolEditor.clearDraft();
    sampleLinkDrafts = new Map();
    sampleLinkMenu.close();
    notebookSteps.innerHTML = '';
    notebookSteps.hidden = false;
    notebookResult.value = '';
    notebookResultFile.value = '';
    resultTableController.renderEditor(null);
    if (notebookExperimentName) {
      notebookExperimentName.value = '';
    }
    notebookProtocolTitle.textContent = '';
    notebookProtocolMeta.textContent = 'Select a notebook page or start a new one.';
    editingEntryId = null;
    protocolEditor.syncControls(null, null);
    renderLinkedPreviews(null);
    updateSaveButtonLabel();
    syncViewerVisibility();
  }

  function syncViewerVisibility() {
    const hasViewer = !notebookProtocolArea.hidden;
    if (notebookEmptyState) {
      notebookEmptyState.hidden = hasViewer;
    }
  }

  function updateSaveButtonLabel() {
    if (!saveNotebookBtn) {
      return;
    }
    saveNotebookBtn.textContent = 'Save';
    if (clarifySaveNotebookBtn) {
      clarifySaveNotebookBtn.textContent = 'Clarify and Save';
    }
    if (cancelEditBtn) {
      cancelEditBtn.hidden = !editingEntryId;
    }
    protocolEditor.syncControls(resolveViewerProtocol(getActiveEntry()), getActiveEntry());
  }

  function setNotebookSaveBusy(isBusy, { clarify = false } = {}) {
    if (saveNotebookBtn) {
      saveNotebookBtn.disabled = isBusy;
      saveNotebookBtn.textContent = isBusy && !clarify ? 'Saving...' : 'Save';
    }
    if (clarifySaveNotebookBtn) {
      clarifySaveNotebookBtn.disabled = isBusy;
      clarifySaveNotebookBtn.textContent = isBusy && clarify ? 'Clarifying...' : 'Clarify and Save';
    }
  }

  function cancelEdit() {
    editingEntryId = null;
    sampleLinkDrafts = new Map();
    sampleLinkMenu.close();
    protocolEditor.clearDraft();
    updateSaveButtonLabel();
    onProtocolChange();
  }

  function markEntryExecuted() {
    if (!editingEntryId) {
      return;
    }
    const index = state.notebookEntries.findIndex((item) => item.id === editingEntryId && matchesType(item));
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
    const nextEntry = {
      ...state.notebookEntries[index],
      values: pruneNotebookValuesForProtocol(
        mergeNotebookValues(state.notebookEntries[index]?.values, collectNotebookValues()),
        protocol
      ),
      result: String(notebookResult.value || '').trim(),
      resultTable: resultTableController.getCurrent(),
      sampleLinks: collectNotebookSampleLinks(state.notebookEntries[index], protocol),
      updatedAt: timestamp
    };
    state.notebookEntries[index] = nextEntry;
    persist();
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
  }

  function onDocumentClickForSampleLinkMenu(event) {
    if (!sampleLinkMenu.isOpen()) {
      return;
    }
    if (sampleLinkMenu.isOpenAt(event.target)) {
      return;
    }
    sampleLinkMenu.close();
  }

  function onDocumentKeydownForSampleLinkMenu(event) {
    if (event.key === 'Escape' && sampleLinkMenu.isOpen()) {
      sampleLinkMenu.close();
    }
  }

  notebookProjectSelect.addEventListener('change', onProjectChange);
  notebookProtocolSearchInput?.addEventListener('input', () => dropdownRenderer.renderProtocolOptions());
  notebookProtocolSelect.addEventListener('change', onProtocolChange);
  notebookEditProtocolBtn?.addEventListener('click', beginProtocolEdit);
  notebookApplyProtocolEditBtn?.addEventListener('click', applyProtocolEdit);
  notebookCancelProtocolEditBtn?.addEventListener('click', cancelProtocolEdit);
  saveNotebookBtn.addEventListener('click', () => { void saveEntry(); });
  clarifySaveNotebookBtn?.addEventListener('click', () => { void clarifyAndSaveEntry(); });
  notebookAddTableBtn?.addEventListener('click', resultTableController.onAdd);
  notebookAddTableRowBtn?.addEventListener('click', resultTableController.onAddRow);
  notebookAddTableColumnBtn?.addEventListener('click', resultTableController.onAddColumn);
  notebookRemoveTableBtn?.addEventListener('click', resultTableController.onRemove);
  notebookAddGelBtn?.addEventListener('click', () => { void linkedWorkActions.onAddGelClick(); });
  notebookAddAssayBtn?.addEventListener('click', () => { void linkedWorkActions.onAddAssayClick(); });
  notebookAddSamplesBtn?.addEventListener('click', () => { void linkedWorkActions.onAddSamplesClick(); });
  cancelEditBtn?.addEventListener('click', cancelEdit);
  notebookEntryList?.addEventListener('click', onEntryListClick);
  notebookExportBtn?.addEventListener('click', onExportButtonClick);
  notebookMarkExecutedBtn?.addEventListener('click', markEntryExecuted);
  inlinePlaceholders.bindEvents();
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', onDocumentClickForSampleLinkMenu);
    document.addEventListener('keydown', onDocumentKeydownForSampleLinkMenu);
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('resize', sampleLinkMenu.close);
  }
  updateSaveButtonLabel();
  syncViewerVisibility();
  renderLinkedPreviews(null);
  resultTableController.renderEditor(null);

  registerNotebookSelectionInsightsHost({
    controller: selectionInsightsController,
    hostEl: notebookSteps,
    isViewerHidden: () => notebookProtocolArea.hidden,
    getActiveEntry,
    resolveProject: resolveViewerProject,
    resolveProtocol: resolveViewerProtocol,
    getStoragePath: () => state.settings?.storagePath,
    saveEntry,
    updateRecord: updateNotebookEntryRecord
  });

  return {
    openEntry: editEntry,
    renderProjectOptions: dropdownRenderer.renderProjectOptions,
    renderProtocolOptions: dropdownRenderer.renderProtocolOptions,
    renderEntries: entryListRenderer.renderEntries,
    renderLinkedPreviews,
    onProtocolChange
  };
}
