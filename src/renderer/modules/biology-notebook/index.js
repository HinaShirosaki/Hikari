// Biology notebook controller.
//
// Responsibilities:
// - render protocol selection for notebook entry creation
// - populate inline placeholder editors from protocol step definitions
// - save notebook entries plus imported result files into app state
// - support editing existing entries and exporting them to PDF
import { findLatestLinkedRecord } from '../notebook-linked-previews.js';
import { buildClarifiedNotebookNote, clarifyNotebookNote, showTransientNotice } from '../notebook-note-tools.js';
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
} from './entry-helpers.js';
import {
  buildSamplePlaceholderTypeAliases,
  normalizeNotebookSampleLink,
  normalizeNotebookSampleLinks
} from './sample-helpers.js';
import {
  ensureStorageFolderExists,
  persistImportedNotebookFiles
} from './file-import.js';
import {
  buildLinkedAssayPreviewHtml,
  buildLinkedGelPreviewHtml,
  createLinkedPreviewImageLoader
} from './linked-previews-renderer.js';
import { createResultTableController } from './result-table-controller.js';
import { createSampleLinkMenuController } from './sample-link-menu.js';
import { createInlinePlaceholderController } from './inline-placeholder-controller.js';
import { createEntryListRenderer } from './entry-list-renderer.js';
import { createDropdownRenderer } from './dropdown-renderer.js';
import { createProtocolSnapshotEditor } from './protocol-snapshot-editor.js';
import { createLinkedWorkActions } from './linked-work-actions.js';
import { createProjectDashboardRenderer } from '../project-management/dashboard-renderer.js';
import { createNotebookToolSidebarController } from './tool-sidebar.js';
import {
  buildProtocolStepsHtml,
  buildViewerMeta
} from './viewer-renderer.js';
import {
  buildSaveableNotebookEntry,
  mergeImportedResultFiles
} from './entry-record-builder.js';
import { registerNotebookSelectionInsightsHost } from './selection-insights-host.js';
import { isPathInsideRoot } from '../storage-path-normalizer.js';
import {
  changedFieldList,
  describeNotebookEntryChanges,
  logNotebookPageEvent
} from './page-log.js';
import { bindFileDropTarget, mergeFilesIntoInput } from '../file-drop.js';
import { printElement } from '../print/index.js';
import { serializeDraftSnapshot } from '../unsaved-draft.js';

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
  onOpenProjects,
  selectionInsightsController = null,
  notebookType = 'biology'
}) {
  const SAMPLE_PLACEHOLDER_TYPE_ALIASES = buildSamplePlaceholderTypeAliases(state.settings);
  const TabulatorLib = window.Tabulator || null;

  const notebookProjectSelect = document.getElementById('biology-notebook-project-select');
  const notebookProtocolSearchInput = document.getElementById('biology-notebook-protocol-search');
  const notebookProtocolSelect = document.getElementById('biology-notebook-protocol-select');
  const notebookPageStarter = document.getElementById('biology-notebook-page-starter');
  const notebookPageStarterProject = document.getElementById('biology-notebook-page-starter-project');
  const notebookOpenProjectsBtn = document.getElementById('biology-notebook-open-projects-btn');
  const notebookEmptyState = document.getElementById('biology-notebook-empty-state');
  const notebookProjectDashboard = document.getElementById('biology-notebook-project-dashboard');
  const notebookProtocolArea = document.getElementById('biology-notebook-protocol-area');
  const notebookExperimentName = document.getElementById('biology-notebook-experiment-name');
  const notebookProtocolTitle = document.getElementById('biology-notebook-protocol-title');
  const notebookProtocolMeta = document.getElementById('biology-notebook-protocol-meta');
  const notebookEditProtocolBtn = document.getElementById('biology-notebook-edit-protocol-btn');
  const notebookApplyProtocolEditBtn = document.getElementById('biology-notebook-apply-protocol-edit-btn');
  const notebookCancelProtocolEditBtn = document.getElementById('biology-notebook-cancel-protocol-edit-btn');
  const notebookExportBtn = document.getElementById('biology-notebook-export-btn');
  const notebookPrintBtn = document.getElementById('biology-notebook-print-btn');
  const notebookMarkExecutedBtn = document.getElementById('biology-notebook-mark-executed-btn');
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
  const notebookToolCalculations = document.getElementById('biology-notebook-tool-calculations');
  const saveNotebookBtn = document.getElementById('save-biology-notebook-btn');
  const clarifySaveNotebookBtn = document.getElementById('clarify-save-biology-notebook-btn');
  const cancelEditBtn = document.getElementById('cancel-biology-notebook-edit-btn');
  const notebookEntryList = document.getElementById('biology-notebook-entry-list');

  let editingEntryId = null;
  let activeProjectDashboardId = '';
  let linkedPreviewRenderToken = 0;
  let sampleLinkDrafts = new Map();
  let pendingDroppedResultFiles = [];
  let savedDraftSnapshot = '';

  notebookOpenProjectsBtn?.addEventListener('click', () => onOpenProjects?.());

  if (notebookProjectDashboard) {
    notebookProjectDashboard.hidden = true;
  }

  const previewImageLoader = createLinkedPreviewImageLoader({
    readFileBase64: window.hikariApi?.readFileBase64?.bind(window.hikariApi)
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
    printBtn: notebookPrintBtn,
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
    getSettings: () => state.settings || {},
    safeText,
    onSelect: (sample, menuState) => inlinePlaceholders.linkSample({ menuState, sample })
  });

  const inlinePlaceholders = createInlinePlaceholderController({
    stepsHost: notebookSteps,
    getSampleLink: (key) => sampleLinkDrafts.get(key),
    setSampleLink: (key, link) => sampleLinkDrafts.set(key, link),
    deleteSampleLink: (key) => sampleLinkDrafts.delete(key),
    getInventory: () => state.inventory || {},
    getSettings: () => state.settings || {},
    onOpenSampleLinkMenu: (params) => sampleLinkMenu.open(params),
    onCloseSampleLinkMenu: () => sampleLinkMenu.close(),
    onAppendResultLine: appendNotebookResultLine,
    onPersistSampleLinks: persistActiveEntrySampleLinks
  });

  const entryListRenderer = createEntryListRenderer({
    listEl: notebookEntryList,
    notebookType,
    safeText,
    getNotebookEntries: () => state.notebookEntries,
    getProjects: () => state.projects,
    getEditingEntryId: () => editingEntryId,
    getActiveProjectDashboardId: () => activeProjectDashboardId
  });

  const projectDashboardRenderer = createProjectDashboardRenderer({
    state,
    safeText
  });

  const dropdownRenderer = createDropdownRenderer({
    projectSelect: notebookProjectSelect,
    protocolSelect: notebookProtocolSelect,
    protocolSearchInput: notebookProtocolSearchInput,
    safeText,
    getProjects: () => state.projects,
    getProtocols: () => state.protocols,
    onAfterRender: () => syncPageStarterProject(),
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

  const toolSidebarController = createNotebookToolSidebarController({
    doc: typeof document !== 'undefined' ? document : null,
    win: typeof window !== 'undefined' ? window : null,
    safeText,
    createId,
    notesInput: notebookResult,
    stepsHost: notebookSteps,
    calculationsHost: notebookToolCalculations,
    onAppendNote: appendNotebookResultLine
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

  function syncPageStarterProject() {
    const project = findSelectedProject();
    if (notebookPageStarterProject) {
      notebookPageStarterProject.textContent = project?.name || 'Choose a project folder';
    }
    if (notebookPageStarter) {
      notebookPageStarter.dataset.projectId = project?.id || '';
    }
    if (notebookOpenProjectsBtn) {
      notebookOpenProjectsBtn.textContent = project ? 'Manage Projects' : 'Create Project';
    }
    if (notebookProtocolSearchInput) {
      notebookProtocolSearchInput.disabled = !project;
    }
  }

  function setPageStarterVisible(isVisible) {
    if (notebookPageStarter) {
      notebookPageStarter.hidden = !isVisible;
    }
  }

  function findDashboardProject(projectId, projectName = '') {
    const cleanProjectId = String(projectId || '').trim();
    if (cleanProjectId) {
      const project = state.projects.find((item) => String(item?.id || '') === cleanProjectId);
      if (project) {
        return project;
      }
    }
    const cleanProjectName = String(projectName || '').trim().toLowerCase();
    if (!cleanProjectName) {
      return null;
    }
    return state.projects.find((item) => String(item?.name || '').trim().toLowerCase() === cleanProjectName) || null;
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

  function mergeUniqueFiles(files = []) {
    const seen = new Set();
    return (Array.isArray(files) ? files : [])
      .filter(Boolean)
      .filter((file) => {
        const key = [
          String(file?.name || ''),
          Number(file?.size) || 0,
          Number(file?.lastModified) || 0
        ].join('|');
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function getSelectedNotebookResultFiles() {
    return mergeUniqueFiles([
      ...Array.from(notebookResultFile?.files || []),
      ...pendingDroppedResultFiles
    ]);
  }

  function clearPendingNotebookResultFiles() {
    pendingDroppedResultFiles = [];
    if (notebookResultFile) {
      notebookResultFile.value = '';
    }
  }

  function queueNotebookResultFiles(files = []) {
    const incomingFiles = mergeUniqueFiles(Array.isArray(files) ? files : [files]);
    if (!incomingFiles.length) {
      return;
    }
    const mergedFiles = mergeUniqueFiles([
      ...getSelectedNotebookResultFiles(),
      ...incomingFiles
    ]);
    const mergedIntoInput = mergeFilesIntoInput(notebookResultFile, mergedFiles, { append: false });
    pendingDroppedResultFiles = mergedIntoInput ? [] : mergedFiles;
    showTransientNotice(
      `${incomingFiles.length} file${incomingFiles.length === 1 ? '' : 's'} ready to attach on save.`
    );
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

  function syncNotebookTitle(protocol = null) {
    if (!notebookProtocolTitle) {
      return;
    }
    const fallbackName = String(protocol?.name || '').trim() || 'Notebook Page';
    const experimentName = String(notebookExperimentName?.value || '').trim();
    notebookProtocolTitle.textContent = experimentName || fallbackName;
  }

  function beginNotebookTitleRename() {
    if (!notebookExperimentName || !notebookProtocolTitle || notebookProtocolArea?.hidden) {
      return;
    }
    notebookProtocolTitle.hidden = true;
    notebookExperimentName.hidden = false;
    notebookExperimentName.focus?.();
    const valueLength = String(notebookExperimentName.value || '').length;
    notebookExperimentName.setSelectionRange?.(0, valueLength);
  }

  function finishNotebookTitleRename({ cancel = false } = {}) {
    if (!notebookExperimentName || !notebookProtocolTitle) {
      return;
    }
    const activeProtocol = resolveViewerProtocol(getActiveEntry());
    if (!cancel) {
      const cleanName = String(notebookExperimentName.value || '').trim();
      notebookExperimentName.value = cleanName || String(activeProtocol?.name || '').trim();
    }
    syncNotebookTitle(activeProtocol);
    notebookExperimentName.hidden = true;
    notebookProtocolTitle.hidden = false;
  }

  function collectNotebookValues() {
    const values = {};
    notebookSteps.querySelectorAll('[data-nb-key]').forEach((input) => {
      values[input.dataset.nbKey] = input.value.trim();
    });
    return values;
  }

  function getCurrentDraftSnapshot() {
    if (!notebookProtocolArea || notebookProtocolArea.hidden) {
      return '';
    }
    return serializeDraftSnapshot({
      editingEntryId: editingEntryId || '',
      projectId: notebookProjectSelect?.value || '',
      protocolId: notebookProtocolSelect?.value || '',
      experimentName: notebookExperimentName?.value || '',
      protocolEditing: protocolEditor.isEditing(),
      protocolDraft: protocolEditor.getDraft(),
      protocolDraftName: notebookProtocolDraftName?.value || '',
      protocolDraftSteps: notebookProtocolDraftSteps?.value || '',
      values: collectNotebookValues(),
      result: notebookResult?.value || '',
      resultTables: resultTableController.getCurrentTables(),
      toolCalculations: toolSidebarController.getCalculations(),
      sampleLinks: sampleLinkDrafts,
      resultFiles: getSelectedNotebookResultFiles().map((file) => ({
        name: String(file?.name || ''),
        size: Number(file?.size) || 0,
        lastModified: Number(file?.lastModified) || 0
      }))
    });
  }

  function markDraftSaved() {
    savedDraftSnapshot = getCurrentDraftSnapshot();
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
    editingEntryId = null;
    sampleLinkDrafts = new Map();
    sampleLinkMenu.close();
    protocolEditor.clearDraft();
    updateSaveButtonLabel();
    dropdownRenderer.renderProtocolOptions();
    entryListRenderer.renderEntries();
  }

  function onProtocolChange() {
    hideProjectDashboard();
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
      window.alert(String(error?.message || error || 'Failed to store notebook files.'));
      return null;
    }

    const { resultFiles, resultFileRecords } = mergeImportedResultFiles({
      existingResultFiles,
      existingResultFileRecords,
      importedResultFileRecords,
      selectedResultFiles
    });
    const resultTables = resultTableController.getCurrentTables();

    const entry = buildSaveableNotebookEntry({
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

    editingEntryId = entry.id;
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
    if (!editingEntryId) {
      return;
    }
    void linkedWorkActions.exportEntryPdf(editingEntryId);
  }

  function onPrintButtonClick() {
    if (!editingEntryId || !notebookProtocolArea) {
      return;
    }
    const title = String(notebookProtocolTitle?.textContent || '').trim() || 'Notebook Page';
    printElement(notebookProtocolArea, {
      title: `Notebook - ${title}`,
      omitSelectors: [
        '.biology-notebook-viewer-actions',
        '.biology-notebook-linked-toolbar',
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

    editingEntryId = entry.id;
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

  function renderProtocolViewer({
    project,
    protocol,
    entry,
    isSavedEntry,
    experimentNameOverride = '',
    resultTableOverride = null,
    resultTablesOverride = null,
    preserveSelectedFiles = false,
    preserveToolCalculations = false,
    markSavedBaseline = true
  }) {
    hideProjectDashboard();
    setPageStarterVisible(!entry && !isSavedEntry);
    notebookProtocolArea.hidden = false;
    if (notebookEmptyState) {
      notebookEmptyState.hidden = true;
    }

    if (notebookExperimentName) {
      notebookExperimentName.value = String(experimentNameOverride || '').trim() || resolveEntryExperimentName(entry, protocol);
      notebookExperimentName.hidden = true;
    }
    if (notebookProtocolTitle) {
      notebookProtocolTitle.hidden = false;
    }
    syncNotebookTitle(protocol);
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
      settings: state.settings || {},
      samplePlaceholderTypeAliases: SAMPLE_PLACEHOLDER_TYPE_ALIASES,
      getSampleLink: (key) => sampleLinkDrafts.get(key)
    });

    notebookResult.value = entry?.result || '';
    resultTableController.renderEditor(resultTablesOverride ?? resultTableOverride ?? entry?.resultTables ?? entry?.resultTable ?? null);
    if (entry) {
      toolSidebarController.setCalculations(entry.toolCalculations || []);
    } else if (!preserveToolCalculations) {
      toolSidebarController.setCalculations([]);
    } else {
      toolSidebarController.renderCalculations();
    }
    if (!preserveSelectedFiles) {
      clearPendingNotebookResultFiles();
    }
    renderLinkedPreviews(entry);
    updateSaveButtonLabel();
    protocolEditor.syncControls(protocol, entry);
    syncViewerVisibility();
    selectionInsightsController?.refreshHost?.('biology-notebook-protocol');
    if (markSavedBaseline) {
      markDraftSaved();
    }
  }

  function hideProjectDashboard() {
    activeProjectDashboardId = '';
    if (!notebookProjectDashboard) {
      return;
    }
    notebookProjectDashboard.hidden = true;
    notebookProjectDashboard.innerHTML = '';
  }

  function showProjectDashboard(projectId, projectName = '') {
    const project = findDashboardProject(projectId, projectName);
    if (!project || !notebookProjectDashboard) {
      return;
    }

    clearViewer({ preserveProjectDashboard: true });
    activeProjectDashboardId = project.id;
    notebookProjectSelect.value = project.id;
    dropdownRenderer.renderProtocolOptions('', { triggerChange: false });
    syncPageStarterProject();
    projectDashboardRenderer.renderDashboardInto(notebookProjectDashboard, project.id, {
      includeEditAction: false,
      contributionHeadingId: 'biology-notebook-project-contribution-heading'
    });
    renderProjectDashboardActions(project);
    notebookProjectDashboard.hidden = false;
    syncViewerVisibility();
    entryListRenderer.renderEntries();
  }

  function renderProjectDashboardActions(project) {
    if (!notebookProjectDashboard || !project) {
      return;
    }
    const heroSection = notebookProjectDashboard.querySelector('.project-dashboard-hero');
    if (!heroSection) {
      return;
    }
    let actionsContainer = heroSection.querySelector('.project-dashboard-actions');
    if (!actionsContainer) {
      actionsContainer = document.createElement('div');
      actionsContainer.className = 'project-dashboard-actions';
      heroSection.appendChild(actionsContainer);
    }

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'ghost-btn';
    exportBtn.id = 'biology-notebook-project-export-pdf-btn';
    exportBtn.textContent = 'Export All Pages as PDF';
    exportBtn.addEventListener('click', () => {
      const entries = projectDashboardRenderer.getProjectNotebookEntries(project) || [];
      exportBtn.disabled = true;
      const originalLabel = exportBtn.textContent;
      exportBtn.textContent = 'Exporting...';
      Promise.resolve(linkedWorkActions.exportProjectPagesPdf({ project, entries }))
        .catch((error) => {
          console.error('Failed to export project notebook PDF:', error);
        })
        .finally(() => {
          exportBtn.disabled = false;
          exportBtn.textContent = originalLabel;
        });
    });
    actionsContainer.appendChild(exportBtn);
  }

  function clearViewer({ preserveProjectDashboard = false } = {}) {
    if (!preserveProjectDashboard) {
      hideProjectDashboard();
    }
    setPageStarterVisible(true);
    notebookProtocolArea.hidden = true;
    protocolEditor.clearDraft();
    sampleLinkDrafts = new Map();
    sampleLinkMenu.close();
    notebookSteps.innerHTML = '';
    notebookSteps.hidden = false;
    notebookResult.value = '';
    clearPendingNotebookResultFiles();
    resultTableController.renderEditor(null);
    toolSidebarController.setCalculations([]);
    if (notebookExperimentName) {
      notebookExperimentName.value = '';
      notebookExperimentName.hidden = true;
    }
    if (notebookProtocolTitle) {
      notebookProtocolTitle.textContent = '';
      notebookProtocolTitle.hidden = false;
    }
    notebookProtocolMeta.textContent = 'Select a notebook page or start a new one.';
    editingEntryId = null;
    protocolEditor.syncControls(null, null);
    renderLinkedPreviews(null);
    updateSaveButtonLabel();
    syncViewerVisibility();
    savedDraftSnapshot = '';
  }

  function syncViewerVisibility() {
    const hasViewer = !notebookProtocolArea.hidden || Boolean(notebookProjectDashboard && !notebookProjectDashboard.hidden);
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
  notebookProtocolTitle?.addEventListener('dblclick', beginNotebookTitleRename);
  notebookExperimentName?.addEventListener('blur', () => finishNotebookTitleRename());
  notebookExperimentName?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault?.();
      finishNotebookTitleRename();
    } else if (event.key === 'Escape') {
      event.preventDefault?.();
      finishNotebookTitleRename({ cancel: true });
    }
  });
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
  notebookPrintBtn?.addEventListener('click', onPrintButtonClick);
  notebookMarkExecutedBtn?.addEventListener('click', markEntryExecuted);
  bindFileDropTarget({
    target: notebookProtocolArea || notebookResultFile,
    multiple: true,
    disabled: () => Boolean(notebookProtocolArea?.hidden),
    onFiles: (files) => {
      queueNotebookResultFiles(files);
    },
    onError: (error) => {
      showTransientNotice(String(error?.message || error || 'Failed to queue dropped notebook files.'), {
        type: 'error'
      });
    }
  });
  inlinePlaceholders.bindEvents();
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', onDocumentClickForSampleLinkMenu);
    document.addEventListener('keydown', onDocumentKeydownForSampleLinkMenu);
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('resize', sampleLinkMenu.close);
  }
  updateSaveButtonLabel();
  syncPageStarterProject();
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
    hasUnsavedChanges: () => Boolean(
      savedDraftSnapshot
      && getCurrentDraftSnapshot() !== savedDraftSnapshot
    ),
    openEntry: editEntry,
    openProjectDashboard: showProjectDashboard,
    renderProjectOptions: dropdownRenderer.renderProjectOptions,
    renderProtocolOptions: dropdownRenderer.renderProtocolOptions,
    renderEntries: entryListRenderer.renderEntries,
    renderLinkedPreviews,
    onProtocolChange,
    saveUnsavedChanges: async () => {
      const entry = await saveEntry();
      return Boolean(entry) && getCurrentDraftSnapshot() === savedDraftSnapshot;
    }
  };
}
