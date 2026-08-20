// Biology notebook controller.
//
// Responsibilities:
// - render protocol selection for notebook entry creation
// - populate inline placeholder editors from protocol step definitions
// - save notebook entries plus imported result files into app state
// - support editing existing entries and exporting them to PDF
import { getGelAnalyses } from '../../lib/gel-records.js';
import { findLatestLinkedRecord } from '../../services/notebook-linked-previews.js';
import { buildClarifiedNotebookNote, clarifyNotebookNote } from '../../services/notebook-note-tools.js';
import { showTransientNotice } from '../../lib/notify.js';
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
} from './entry/entry-helpers.js';
import {
  buildSamplePlaceholderTypeAliases,
  formatSampleLinkValue,
  normalizeNotebookSampleLink,
  normalizeNotebookSampleLinks
} from './samples/sample-helpers.js';
import {
  ensureStorageFolderExists,
  persistImportedNotebookFiles
} from './storage/file-import.js';
import {
  buildLinkedAssayPreviewHtml,
  buildLinkedGelPreviewHtml,
  createLinkedPreviewImageLoader
} from './results/linked-previews-renderer.js';
import { createResultTableController } from './results/result-table-controller.js';
import { createSampleLinkMenuController } from './samples/sample-link-menu.js';
import { createNotebookQuickSampleController } from './samples/quick-sample-controller.js';
import { createInlinePlaceholderController } from './protocol/inline-placeholder-controller.js';
import { createEntryListRenderer } from './entry/entry-list-renderer.js';
import { createDropdownRenderer } from './entry/dropdown-renderer.js';
import { createProtocolSnapshotEditor } from './protocol/protocol-snapshot-editor.js';
import { createLinkedWorkActions } from './results/linked-work-actions.js';
import { createProjectDashboardRenderer } from './project/project-dashboard-renderer.js';
import { createNotebookProjectController } from './project/project-controller.js';
import { createProjectPaperFinderController } from './project/paper-finder-controller.js';
import { createNotebookToolSidebarController } from './tools/tool-sidebar.js';
import {
  buildProtocolStepsHtml,
  buildViewerMeta
} from './entry/viewer-renderer.js';
import {
  buildSaveableNotebookEntry,
  mergeImportedResultFiles
} from './entry/entry-record-builder.js';
import { registerNotebookSelectionInsightsHost } from './results/selection-insights-host.js';
import {
  createResultFileAttachmentController,
  createResultFileAttachmentLoader
} from './results/result-file-attachments.js';
import { isPathInsideRoot } from '../../lib/storage-paths.js';
import {
  changedFieldList,
  describeNotebookEntryChanges,
  logNotebookPageEvent
} from './storage/page-log.js';
import { bindFileDropTarget, mergeFilesIntoInput } from '../../lib/file-drop.js';
import { printElement } from '../print/index.js';
import { serializeDraftSnapshot } from '../../lib/unsaved-draft.js';
import { flattenNotebookResultTablesText } from '../../lib/notebook-result-tables.js';
import { resolveNotebookResultTablesValues } from '../../lib/notebook-table-formulas.js';
import {
  areAllNotebookPlaceholdersFilled,
  generateNotebookPageName,
  normalizeNotebookExperimentNameSource,
  resolveNotebookExperimentNameSource
} from './entry/page-name-generator.js';

// Initialize the biology notebook module and wire it to app state plus DOM controls.
export function initLabNotebook({
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged,
  onCreateLinkedAssay,
  onProjectsChanged,
  selectionInsightsController = null,
  onActiveNotebookPageChanged = () => {},
  notebookType = 'biology'
}) {
  const SAMPLE_PLACEHOLDER_TYPE_ALIASES = buildSamplePlaceholderTypeAliases(state.settings);
  const TabulatorLib = window.Tabulator || null;

  const notebookProjectSelect = document.getElementById('biology-notebook-project-select');
  const notebookProtocolSearchInput = document.getElementById('biology-notebook-protocol-search');
  const notebookProtocolSelect = document.getElementById('biology-notebook-protocol-select');
  const notebookNewExperimentBtn = document.getElementById('biology-notebook-new-experiment-btn');
  const notebookExperimentDialogOverlay = document.getElementById('biology-notebook-experiment-dialog-overlay');
  const notebookExperimentForm = document.getElementById('biology-notebook-experiment-form');
  const notebookExperimentDialogCloseBtn = document.getElementById('biology-notebook-experiment-dialog-close-btn');
  const notebookExperimentCancelBtn = document.getElementById('biology-notebook-experiment-cancel-btn');
  const notebookExperimentStartBtn = document.getElementById('biology-notebook-experiment-start-btn');
  const notebookExperimentDialogStatus = document.getElementById('biology-notebook-experiment-dialog-status');
  const notebookExperimentProtocolResults = document.getElementById('biology-notebook-protocol-search-results');
  const notebookPageStarter = document.getElementById('biology-notebook-page-starter');
  const notebookPageStarterProject = document.getElementById('biology-notebook-page-starter-project');
  const notebookRail = document.getElementById('biology-notebook-rail');
  const notebookViewerColumn = document.getElementById('biology-notebook-viewer-column');
  const notebookProjectContextMenu = document.getElementById('biology-notebook-project-context-menu');
  const notebookAddProjectBtn = document.getElementById('biology-notebook-add-project-btn');
  const notebookHeaderAddProjectBtn = document.getElementById('biology-notebook-header-add-project-btn');
  const notebookProjectDialogOverlay = document.getElementById('biology-notebook-project-dialog-overlay');
  const notebookProjectForm = document.getElementById('biology-notebook-project-form');
  const notebookProjectNameInput = document.getElementById('biology-notebook-project-name');
  const notebookProjectDescriptionInput = document.getElementById('biology-notebook-project-description');
  const notebookProjectDialogCloseBtn = document.getElementById('biology-notebook-project-dialog-close-btn');
  const notebookProjectCancelBtn = document.getElementById('biology-notebook-project-cancel-btn');
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
  const notebookResultAttachments = document.getElementById('biology-notebook-result-attachments');
  const notebookAddTableBtn = document.getElementById('biology-notebook-add-table-btn');
  const notebookAddTableRowBtn = document.getElementById('biology-notebook-add-table-row-btn');
  const notebookAddTableColumnBtn = document.getElementById('biology-notebook-add-table-column-btn');
  const notebookRemoveTableBtn = document.getElementById('biology-notebook-remove-table-btn');
  const notebookResultTableWrap = document.getElementById('biology-notebook-result-table-wrap');
  const notebookResultTableHost = document.getElementById('biology-notebook-result-table');
  const notebookResultTableStatus = document.getElementById('biology-notebook-result-table-status');
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
  let agentAppendQueue = Promise.resolve();
  const appliedAgentAppendProposalIds = new Set();
  let savedDraftSnapshot = '';
  let experimentDialogPreviousSelection = null;
  let experimentDialogWorkspaceProjectId = '';
  let experimentNameSourceDraft = 'protocol';
  let experimentNameGeneratedAtDraft = '';
  let experimentNameGeneratedModelDraft = '';
  let pageNameGenerationRevision = 0;
  let pageNameGenerationPendingRevision = -1;
  let pageNameGenerationPromise = null;
  let notebookTitleRenameStartValue = '';

  if (notebookProjectDashboard) {
    notebookProjectDashboard.hidden = true;
  }
  if (notebookExperimentDialogOverlay) {
    notebookExperimentDialogOverlay.hidden = true;
  }

  const previewImageLoader = createLinkedPreviewImageLoader({
    readFileBase64: window.hikariApi?.readFileBase64?.bind(window.hikariApi)
  });
  const resultFileAttachmentLoader = createResultFileAttachmentLoader({
    readFileBase64: window.hikariApi?.readFileBase64?.bind(window.hikariApi),
    getStoragePath: () => state.settings?.storagePath || ''
  });
  const resultFileAttachmentController = createResultFileAttachmentController({
    host: notebookResultAttachments,
    loader: resultFileAttachmentLoader
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
    onAddTable: (menuState) => resultTableController.onAddFromPlaceholder({
      name: menuState?.placeholderName,
      value: menuState?.value
    })
  });

  const inlinePlaceholders = createInlinePlaceholderController({
    stepsHost: notebookSteps,
    getSampleLink: (key) => sampleLinkDrafts.get(key),
    deleteSampleLink: (key) => sampleLinkDrafts.delete(key),
    getSettings: () => state.settings || {},
    onOpenSampleLinkMenu: (params) => sampleLinkMenu.open(params),
    onCloseSampleLinkMenu: () => sampleLinkMenu.close(),
    onPersistSampleLinks: persistActiveEntrySampleLinks,
    onValueCommitted: () => { void maybeGenerateNotebookPageName(); }
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
  const projectPaperFinderController = createProjectPaperFinderController({
    host: notebookProjectDashboard,
    state,
    api: window.hikariApi
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

  createNotebookProjectController({
    state,
    persist,
    createId,
    onProjectsChanged,
    railEl: notebookRail,
    contextMenuEl: notebookProjectContextMenu,
    addProjectBtn: notebookAddProjectBtn,
    headerAddProjectBtn: notebookHeaderAddProjectBtn,
    dialogOverlay: notebookProjectDialogOverlay,
    dialogForm: notebookProjectForm,
    projectNameInput: notebookProjectNameInput,
    projectDescriptionInput: notebookProjectDescriptionInput,
    dialogCloseBtn: notebookProjectDialogCloseBtn,
    dialogCancelBtn: notebookProjectCancelBtn,
    onProjectCreated: (project) => {
      dropdownRenderer.renderProjectOptions();
      notebookProjectSelect.value = project.id;
      dropdownRenderer.renderProtocolOptions('', { triggerChange: false });
      syncPageStarterProject();
      entryListRenderer.renderEntries();
      showProjectDashboard(project.id, project.name);
    }
  });

  const linkedWorkActions = createLinkedWorkActions({
    notebookType,
    ensureEntry: () => ensureNotebookEntryForLinkedWork(),
    getNotebookEntries: () => state.notebookEntries,
    getProtocols: () => state.protocols,
    getGelAnalyses: () => getGelAnalyses(state),
    getAssays: () => state.assays,
    previewImageLoader,
    resultFileAttachmentLoader,
    onCreateLinkedAssay
  });

  const quickSampleController = createNotebookQuickSampleController({
    doc: typeof document !== 'undefined' ? document : null,
    state,
    safeText,
    createId,
    ensureEntry: ensureNotebookEntryForLinkedWork,
    onCreated: applyQuickSampleCapture
  });

  const toolSidebarController = createNotebookToolSidebarController({
    doc: typeof document !== 'undefined' ? document : null,
    win: typeof window !== 'undefined' ? window : null,
    safeText,
    createId,
    notesInput: notebookResult,
    calculationsHost: notebookToolCalculations,
    getStoredCompounds: () => (Array.isArray(state.labInventory?.chemicals) ? state.labInventory.chemicals : []),
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
    if (notebookProtocolSearchInput) {
      notebookProtocolSearchInput.disabled = !project;
    }
  }

  function setPageStarterVisible() {
    if (notebookPageStarter) {
      notebookPageStarter.hidden = true;
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

  function findProjectDescriptionInputTarget(event) {
    const target = event?.target;
    if (!target) {
      return null;
    }
    return target?.closest?.('[data-project-description]')
      || (target?.dataset?.projectDescription ? target : null);
  }

  function updateProjectDescription(projectId, description) {
    const project = findDashboardProject(projectId);
    if (!project) {
      return;
    }
    const nextDescription = String(description || '').trim();
    if (String(project.description || '') === nextDescription) {
      return;
    }
    project.description = nextDescription;
    project.updatedAt = new Date().toISOString();
    persist();
    if (typeof onProjectsChanged === 'function') {
      onProjectsChanged();
    }
  }

  function onProjectDashboardDescriptionInput(event) {
    const input = findProjectDescriptionInputTarget(event);
    if (!input) {
      return;
    }
    updateProjectDescription(input.dataset.projectDescription, input.value);
  }

  function findSelectedProtocol() {
    return state.protocols.find((item) => item.id === notebookProtocolSelect.value) || null;
  }

  function isExperimentDialogOpen() {
    return Boolean(notebookExperimentDialogOverlay && !notebookExperimentDialogOverlay.hidden);
  }

  function setExperimentDialogStatus(message = '', { error = false } = {}) {
    if (error && message) {
      showTransientNotice(message, { type: 'error' });
    }
    if (!notebookExperimentDialogStatus) {
      return;
    }
    notebookExperimentDialogStatus.textContent = String(message || '');
    notebookExperimentDialogStatus.classList.toggle('is-error', Boolean(error));
  }

  function syncExperimentDialogControls() {
    const project = findSelectedProject();
    const protocol = findSelectedProtocol();
    if (notebookExperimentStartBtn) {
      notebookExperimentStartBtn.disabled = !project || !protocol;
    }
    if (!isExperimentDialogOpen()) {
      return;
    }
    if (!project) {
      setExperimentDialogStatus('Choose a project to see available protocols.');
      return;
    }
    if (!protocol) {
      const fromWorkspace = project.id === experimentDialogWorkspaceProjectId;
      setExperimentDialogStatus(
        fromWorkspace
          ? ''
          : 'Choose a protocol to start the experiment.'
      );
      return;
    }
    setExperimentDialogStatus('');
  }

  function renderExperimentProtocolResults() {
    if (!notebookExperimentProtocolResults) {
      return;
    }
    const project = findSelectedProject();
    if (!project) {
      notebookExperimentProtocolResults.innerHTML = '';
      return;
    }
    const searchTerm = String(notebookProtocolSearchInput?.value || '').trim().toLowerCase();
    const selectedProtocolId = String(notebookProtocolSelect?.value || '');
    const matches = state.protocols
      .filter((protocol) => String(protocol?.name || '').toLowerCase().includes(searchTerm))
      .slice(0, 60);
    if (!matches.length) {
      notebookExperimentProtocolResults.innerHTML = '<p class="biology-notebook-protocol-search-empty">No matching protocols.</p>';
      return;
    }
    notebookExperimentProtocolResults.innerHTML = matches.map((protocol) => {
      const id = String(protocol?.id || '').trim();
      const selected = id === selectedProtocolId ? ' is-selected' : '';
      return `<button type="button" class="biology-notebook-protocol-search-result${selected}" data-notebook-experiment-protocol-id="${safeText(id)}" role="option" aria-selected="${id === selectedProtocolId ? 'true' : 'false'}">${safeText(protocol?.name || 'Untitled protocol')}</button>`;
    }).join('');
  }

  function restoreExperimentDialogSelection() {
    const previous = experimentDialogPreviousSelection;
    if (!previous || !notebookProjectSelect || !notebookProtocolSelect) {
      return;
    }
    notebookProjectSelect.value = previous.projectId;
    if (notebookProtocolSearchInput) {
      notebookProtocolSearchInput.value = previous.protocolSearch;
    }
    dropdownRenderer.renderProtocolOptions(previous.protocolId, { triggerChange: false });
    renderExperimentProtocolResults();
    syncPageStarterProject();
  }

  function closeExperimentDialog({ restoreSelection = true, returnFocus = true } = {}) {
    if (!isExperimentDialogOpen()) {
      return;
    }
    if (restoreSelection) {
      restoreExperimentDialogSelection();
    }
    notebookExperimentDialogOverlay.hidden = true;
    if (notebookExperimentProtocolResults) {
      notebookExperimentProtocolResults.innerHTML = '';
    }
    setExperimentDialogStatus('');
    experimentDialogPreviousSelection = null;
    experimentDialogWorkspaceProjectId = '';
    if (returnFocus) {
      notebookNewExperimentBtn?.focus?.();
    }
  }

  function openExperimentDialog() {
    if (!notebookExperimentDialogOverlay || !notebookProjectSelect || !notebookProtocolSelect) {
      return;
    }
    experimentDialogPreviousSelection = {
      projectId: String(notebookProjectSelect.value || ''),
      protocolId: String(notebookProtocolSelect.value || ''),
      protocolSearch: String(notebookProtocolSearchInput?.value || '')
    };
    experimentDialogWorkspaceProjectId = String(activeProjectDashboardId || notebookProjectSelect.value || '');

    dropdownRenderer.renderProjectOptions();
    const hasWorkspaceProject = state.projects.some((project) => project.id === experimentDialogWorkspaceProjectId);
    notebookProjectSelect.value = hasWorkspaceProject ? experimentDialogWorkspaceProjectId : '';
    notebookProtocolSelect.value = '';
    if (notebookProtocolSearchInput) {
      notebookProtocolSearchInput.value = '';
    }
    dropdownRenderer.renderProtocolOptions('', { triggerChange: false });
    notebookExperimentDialogOverlay.hidden = false;
    renderExperimentProtocolResults();
    syncExperimentDialogControls();

    const focusProject = () => notebookProjectSelect.focus?.();
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusProject);
    } else {
      focusProject();
    }
  }

  function onExperimentProjectChange() {
    if (notebookProtocolSelect) {
      notebookProtocolSelect.value = '';
    }
    dropdownRenderer.renderProtocolOptions('', { triggerChange: false });
    renderExperimentProtocolResults();
    syncExperimentDialogControls();
  }

  function onExperimentProtocolSearch() {
    dropdownRenderer.renderProtocolOptions('', { triggerChange: false });
    renderExperimentProtocolResults();
    syncExperimentDialogControls();
  }

  function startExperiment(event) {
    event?.preventDefault?.();
    const project = findSelectedProject();
    const protocol = findSelectedProtocol();
    if (!project || !protocol) {
      setExperimentDialogStatus('Choose both a project and a protocol before starting.', { error: true });
      if (!project) {
        notebookProjectSelect?.focus?.();
      } else {
        notebookProtocolSelect?.focus?.();
      }
      return;
    }

    closeExperimentDialog({ restoreSelection: false, returnFocus: false });
    editingEntryId = null;
    onProtocolChange();
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

  function renderResultFileAttachments(entry = getActiveEntry()) {
    void resultFileAttachmentController.render({
      entry,
      pendingFiles: getSelectedNotebookResultFiles()
    });
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
    renderResultFileAttachments();
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

  function normalizeNotebookTargetText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function buildAgentAppendText(proposal = {}) {
    const sectionTitle = String(proposal.section_title || proposal.sectionTitle || '').trim();
    const content = String(proposal.content_markdown || proposal.contentMarkdown || '').trim();
    if (!content) {
      return '';
    }
    const sourceLines = (Array.isArray(proposal.sources) ? proposal.sources : [])
      .map((source) => {
        const payload = source && typeof source === 'object' ? source : {};
        const label = String(payload.label || payload.record_id || payload.recordId || payload.url || '').trim();
        const recordId = String(payload.record_id || payload.recordId || '').trim();
        const detail = String(payload.detail || '').trim();
        const url = String(payload.url || '').trim();
        const identity = [label, recordId && recordId !== label ? `record ${recordId}` : ''].filter(Boolean).join(' — ');
        return [identity, detail, url].filter(Boolean).join(' — ');
      })
      .filter(Boolean);
    return [
      sectionTitle ? `## ${sectionTitle}` : '',
      content,
      sourceLines.length ? '### Sources' : '',
      ...sourceLines.map((line) => `- ${line}`)
    ].filter(Boolean).join('\n');
  }

  // Overlapping appends both read notebookResult.value before either writes it,
  // so a double-click duplicates the text and two proposals lose one of the two.
  // Queued, the second run sees the saved agentAppendProposalIds and no-ops.
  function appendAgentNotebookContent(proposal = {}) {
    const result = agentAppendQueue.then(() => runAgentNotebookAppend(proposal));
    agentAppendQueue = result.catch(() => {});
    return result;
  }

  async function runAgentNotebookAppend(proposal = {}) {
    if (!notebookProtocolArea || notebookProtocolArea.hidden || !notebookResult) {
      return { ok: false, error: 'Open the target Notebook page before approving this append.' };
    }
    const activeEntry = getActiveEntry();
    const project = resolveViewerProject(activeEntry);
    const protocol = resolveViewerProtocol(activeEntry);
    if (!project || !protocol) {
      return { ok: false, error: 'The active notebook page no longer has a project and protocol binding.' };
    }

    const proposedEntryId = String(proposal.notebook_entry_id || proposal.notebookEntryId || '').trim();
    const targetsUnsavedDraft = normalizeNotebookTargetText(proposedEntryId) === 'unsaved draft';
    if (proposedEntryId && !targetsUnsavedDraft && proposedEntryId !== String(activeEntry?.id || '').trim()) {
      return { ok: false, error: 'The active notebook page changed after the proposal was prepared. Reopen the target page and ask the agent to enrich it again.' };
    }
    if (targetsUnsavedDraft && activeEntry) {
      return { ok: false, error: 'The proposal targeted an unsaved draft, but a different saved page is now active.' };
    }

    const expectedTitle = normalizeNotebookTargetText(proposal.page_title || proposal.pageTitle);
    const activeTitle = normalizeNotebookTargetText(
      notebookExperimentName?.value || resolveEntryExperimentName(activeEntry, protocol) || protocol.name
    );
    const expectedProject = normalizeNotebookTargetText(proposal.project_name || proposal.projectName);
    const expectedProtocol = normalizeNotebookTargetText(proposal.protocol_name || proposal.protocolName);
    if (
      (expectedTitle && expectedTitle !== activeTitle)
      || (expectedProject && expectedProject !== normalizeNotebookTargetText(project.name))
      || (expectedProtocol && expectedProtocol !== normalizeNotebookTargetText(protocol.name))
    ) {
      return { ok: false, error: 'The active notebook page identity no longer matches this proposal. Ask the agent to re-read the current page.' };
    }

    const expectedUpdatedAt = String(proposal.expected_updated_at || proposal.expectedUpdatedAt || '').trim();
    if (activeEntry && expectedUpdatedAt && expectedUpdatedAt !== String(activeEntry.updatedAt || '').trim()) {
      return { ok: false, error: 'This notebook page was saved again after the proposal was prepared. Ask the agent to refresh and re-propose the append.' };
    }

    const appendText = buildAgentAppendText(proposal);
    if (!appendText) {
      return { ok: false, error: 'The proposal does not contain any notebook content to append.' };
    }
    const proposalId = String(proposal.proposal_id || proposal.proposalId || '').trim();
    const appliedIds = Array.isArray(activeEntry?.agentAppendProposalIds)
      ? activeEntry.agentAppendProposalIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    // An unsaved draft has no entry to record the id on, and a proposal can
    // arrive without one, so keep a local key as well.
    const appendKey = proposalId || appendText;
    if ((proposalId && appliedIds.includes(proposalId)) || appliedAgentAppendProposalIds.has(appendKey)) {
      return { ok: true, summary: 'This notebook enrichment was already appended.' };
    }

    const currentResult = String(notebookResult.value || '').trim();
    const combinedResult = currentResult ? `${currentResult}\n\n${appendText}` : appendText;
    notebookResult.value = combinedResult;

    if (!activeEntry) {
      appliedAgentAppendProposalIds.add(appendKey);
      notifyActiveNotebookPageChanged();
      return {
        ok: true,
        saved: false,
        summary: 'Content appended to the current notebook draft. Save the page to persist it.'
      };
    }

    const savedEntry = await saveEntry({
      resultText: combinedResult,
      agentAppendProposalId: proposalId
    });
    if (!savedEntry) {
      notebookResult.value = currentResult;
      return { ok: false, error: 'Hikari could not save the notebook append.' };
    }
    appliedAgentAppendProposalIds.add(appendKey);
    return {
      ok: true,
      saved: true,
      entryId: savedEntry.id,
      summary: 'Content appended and saved to the notebook page.'
    };
  }

  function syncNotebookTitle(protocol = null) {
    if (!notebookProtocolTitle) {
      return;
    }
    const fallbackName = String(protocol?.name || '').trim() || 'Notebook Page';
    const experimentName = String(notebookExperimentName?.value || '').trim();
    notebookProtocolTitle.textContent = experimentName || fallbackName;
  }

  function resetNotebookNameGenerationState(entry = null, protocol = null) {
    experimentNameSourceDraft = resolveNotebookExperimentNameSource(entry, protocol);
    experimentNameGeneratedAtDraft = experimentNameSourceDraft === 'generated'
      ? String(entry?.experimentNameGeneratedAt || '').trim()
      : '';
    experimentNameGeneratedModelDraft = experimentNameSourceDraft === 'generated'
      ? String(entry?.experimentNameGeneratedModel || '').trim()
      : '';
    pageNameGenerationRevision += 1;
    pageNameGenerationPendingRevision = -1;
    pageNameGenerationPromise = null;
  }

  function markNotebookNameAsUserRenamed() {
    experimentNameSourceDraft = 'user';
    experimentNameGeneratedAtDraft = '';
    experimentNameGeneratedModelDraft = '';
    pageNameGenerationRevision += 1;
    pageNameGenerationPendingRevision = -1;
    pageNameGenerationPromise = null;
  }

  function applyGeneratedNotebookPageName(generated, protocol) {
    const name = String(generated?.name || '').trim();
    if (!name || experimentNameSourceDraft !== 'protocol') {
      return null;
    }
    const hadUnsavedChanges = Boolean(
      savedDraftSnapshot
      && getCurrentDraftSnapshot() !== savedDraftSnapshot
    );
    const generatedAt = new Date().toISOString();
    experimentNameSourceDraft = 'generated';
    experimentNameGeneratedAtDraft = generatedAt;
    experimentNameGeneratedModelDraft = String(generated?.model || '').trim();
    if (notebookExperimentName) {
      notebookExperimentName.value = name;
    }
    syncNotebookTitle(protocol);

    const activeEntry = getActiveEntry();
    if (!activeEntry) {
      return null;
    }
    const nextEntry = updateNotebookEntryRecord(activeEntry.id, (currentEntry) => ({
      ...currentEntry,
      experimentName: name,
      experimentNameSource: 'generated',
      experimentNameGeneratedAt: generatedAt,
      experimentNameGeneratedModel: experimentNameGeneratedModelDraft,
      updatedAt: generatedAt
    }));
    if (!nextEntry) {
      return null;
    }
    logNotebookPageEvent({
      entry: nextEntry,
      storagePath: state.settings?.storagePath,
      action: 'name-generate',
      summary: `Generated notebook page name "${name}"`,
      details: {
        model: experimentNameGeneratedModelDraft,
        provider: String(generated?.provider || '').trim()
      }
    });
    entryListRenderer.renderEntries();
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
    notifyActiveNotebookPageChanged();
    if (!hadUnsavedChanges) {
      markDraftSaved();
    }
    return nextEntry;
  }

  function maybeGenerateNotebookPageName({ protocol: protocolOverride = null, values: valuesOverride = null } = {}) {
    if (!window.hikariApi?.runDirectLlmPrompt || experimentNameSourceDraft !== 'protocol') {
      return Promise.resolve(null);
    }
    const entry = getActiveEntry();
    const protocol = protocolOverride || resolveViewerProtocol(entry);
    if (!protocol) {
      return Promise.resolve(null);
    }
    const values = valuesOverride || pruneNotebookValuesForProtocol(
      mergeNotebookValues(entry?.values, collectNotebookValues()),
      protocol
    );
    if (!areAllNotebookPlaceholdersFilled(protocol, values)) {
      return Promise.resolve(null);
    }

    const revision = pageNameGenerationRevision;
    if (pageNameGenerationPendingRevision === revision && pageNameGenerationPromise) {
      return pageNameGenerationPromise;
    }
    const expectedEntryId = String(entry?.id || '').trim();
    const expectedProtocolId = String(protocol?.id || '').trim();
    pageNameGenerationPendingRevision = revision;
    const request = (async () => {
      try {
        const generated = await generateNotebookPageName({
          llm: state.settings?.llm || {},
          protocol,
          values
        });
        const currentEntry = getActiveEntry();
        const currentProtocol = resolveViewerProtocol(currentEntry);
        if (
          revision !== pageNameGenerationRevision
          || experimentNameSourceDraft !== 'protocol'
          || String(currentEntry?.id || '').trim() !== expectedEntryId
          || String(currentProtocol?.id || '').trim() !== expectedProtocolId
        ) {
          return null;
        }
        applyGeneratedNotebookPageName(generated, currentProtocol || protocol);
        return generated;
      } catch (error) {
        console.warn('Failed to generate notebook page name:', error);
        showTransientNotice('Could not generate a page name automatically.', { type: 'error' });
        return null;
      } finally {
        if (pageNameGenerationPendingRevision === revision) {
          pageNameGenerationPendingRevision = -1;
          pageNameGenerationPromise = null;
        }
      }
    })();
    pageNameGenerationPromise = request;
    return request;
  }

  function onNotebookPlaceholderInput(event) {
    if (!event?.target?.dataset?.nbKey) {
      return;
    }
    void maybeGenerateNotebookPageName();
  }

  function beginNotebookTitleRename() {
    if (!notebookExperimentName || !notebookProtocolTitle || notebookProtocolArea?.hidden) {
      return;
    }
    notebookTitleRenameStartValue = String(notebookExperimentName.value || '').trim();
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
      if (notebookExperimentName.value !== notebookTitleRenameStartValue) {
        markNotebookNameAsUserRenamed();
      }
    } else {
      notebookExperimentName.value = notebookTitleRenameStartValue;
    }
    syncNotebookTitle(activeProtocol);
    notebookExperimentName.hidden = true;
    notebookProtocolTitle.hidden = false;
    notebookTitleRenameStartValue = '';
  }

  function collectNotebookValues() {
    const values = {};
    notebookSteps.querySelectorAll('[data-nb-key]').forEach((input) => {
      values[input.dataset.nbKey] = input.value.trim();
    });
    return values;
  }

  function compactContextLine(value, maxLength = 900) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      return '';
    }
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
  }

  function compactContextBlock(value, maxLength = 12000) {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}\n...` : text;
  }

  function getProtocolStepText(step) {
    return compactContextLine(step?.text || step?.instruction || step?.action || step?.description, 1200);
  }

  function buildStepContextLines(protocol, values = {}) {
    const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];
    return steps.slice(0, 80).map((step, index) => {
      const stepId = String(step?.id || `step_${index + 1}`).trim();
      const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
      const filledValues = placeholders.map((placeholder) => {
        const placeholderId = String(placeholder?.id || '').trim();
        const placeholderName = String(placeholder?.name || placeholderId || 'value').trim();
        const value = compactContextLine(values[`${stepId}:${placeholderId}`] || values[placeholderId] || '', 180);
        return value ? `${placeholderName}=${value}` : '';
      }).filter(Boolean);
      const suffix = filledValues.length ? ` Filled values: ${filledValues.join('; ')}.` : '';
      return `Step ${index + 1}: ${getProtocolStepText(step)}${suffix}`;
    }).filter(Boolean);
  }

  function buildSampleLinkContextLines(entry = null, protocol = null) {
    const links = collectNotebookSampleLinks(entry, protocol);
    return normalizeNotebookSampleLinks(links)
      .slice(0, 24)
      .map((link) => {
        const placeholder = compactContextLine(link.placeholderName || link.placeholderKey, 120);
        const details = [
          `sample=${compactContextLine(formatSampleLinkValue(link), 180)}`,
          link.sampleId ? `id=${compactContextLine(link.sampleId, 120)}` : '',
          link.sampleType ? `type=${compactContextLine(link.sampleType, 80)}` : '',
          link.sampleLot ? `lot=${compactContextLine(link.sampleLot, 120)}` : '',
          link.sampleConcentration ? `recorded concentration=${compactContextLine(link.sampleConcentration, 120)}` : '',
          link.storageLabel ? `storage=${compactContextLine(link.storageLabel, 220)}` : ''
        ].filter(Boolean).join('; ');
        return `${placeholder ? `${placeholder}: ` : ''}${details}`;
      })
      .filter(Boolean);
  }

  function getActiveNotebookPageAgentContext() {
    if (!notebookProtocolArea || notebookProtocolArea.hidden) {
      return null;
    }
    const entry = getActiveEntry();
    const project = resolveViewerProject(entry);
    const protocol = resolveViewerProtocol(entry);
    if (!project || !protocol) {
      return null;
    }
    const values = pruneNotebookValuesForProtocol(
      mergeNotebookValues(entry?.values, collectNotebookValues()),
      protocol
    );
    const resultText = compactContextBlock(notebookResult?.value || entry?.result || '', 12000);
    const resultTables = resultTableController.getCurrentTables();
    const tableText = compactContextBlock(
      // The model reads what the table shows, not the formulas behind it.
      flattenNotebookResultTablesText(resolveNotebookResultTablesValues(resultTables, entry?.resultTable)),
      12000
    );
    const toolCalculations = toolSidebarController.getCalculations();
    const toolCalculationText = compactContextBlock(JSON.stringify(toolCalculations, null, 2), 8000);
    const linkedGel = entry?.id ? findLatestLinkedRecord(getGelAnalyses(state), entry.id) : null;
    const linkedAssay = entry?.id ? findLatestLinkedRecord(state.assays, entry.id) : null;
    const sampleLinks = buildSampleLinkContextLines(entry, protocol);
    const pageTitle = compactContextLine(
      notebookExperimentName?.value || resolveEntryExperimentName(entry, protocol) || protocol.name,
      320
    );
    const pageState = entry ? normalizeNotebookState(entry.notebookState) : 'draft';
    const lines = [
      'Active biology notebook page:',
      `Title: ${pageTitle || 'Untitled notebook page'}`,
      `Entry ID: ${entry?.id || 'unsaved draft'}`,
      entry?.updatedAt ? `Updated at: ${entry.updatedAt}` : '',
      `Notebook state: ${pageState}`,
      `Project: ${compactContextLine(project.name, 220)}${project.id ? ` (${project.id})` : ''}`,
      `Protocol: ${compactContextLine(protocol.name, 220)}${protocol.id ? ` (${protocol.id})` : ''}`,
      'Protocol steps:',
      ...buildStepContextLines(protocol, values),
      resultText ? 'Page notes/results:' : '',
      resultText,
      tableText ? 'Result tables:' : '',
      tableText,
      sampleLinks.length ? 'Linked samples:' : '',
      ...sampleLinks,
      toolCalculationText ? 'Recorded bench calculations:' : '',
      toolCalculationText,
      linkedGel ? 'Latest linked gel analysis:' : '',
      linkedGel ? compactContextBlock(JSON.stringify(linkedGel, null, 2), 6000) : '',
      linkedAssay ? 'Latest linked assay:' : '',
      linkedAssay ? compactContextBlock(JSON.stringify(linkedAssay, null, 2), 6000) : '',
      Array.isArray(entry?.resultFiles) && entry.resultFiles.length ? `Result files: ${entry.resultFiles.join(', ')}` : ''
    ].filter((line) => line !== '');

    return {
      scopeType: 'notebook',
      notebookEntryId: entry?.id || '',
      notebookUpdatedAt: String(entry?.updatedAt || '').trim(),
      pageTitle,
      projectId: String(project.id || '').trim(),
      projectName: String(project.name || '').trim(),
      protocolId: String(protocol.id || '').trim(),
      protocolName: String(protocol.name || '').trim(),
      hiddenContext: {
        kind: 'notebook-page',
        label: pageTitle ? `Active notebook page: ${pageTitle}` : 'Active notebook page',
        text: lines.join('\n'),
        notebookEntryId: entry?.id || '',
        notebookUpdatedAt: String(entry?.updatedAt || '').trim(),
        projectName: String(project.name || '').trim(),
        protocolName: String(protocol.name || '').trim()
      }
    };
  }

  function getAgentChatContext() {
    const pageContext = getActiveNotebookPageAgentContext();
    if (pageContext) {
      return pageContext;
    }
    const dashboardProject = activeProjectDashboardId
      ? findDashboardProject(activeProjectDashboardId)
      : findSelectedProject();
    return {
      scopeType: 'notebook',
      projectId: String(dashboardProject?.id || '').trim(),
      projectName: String(dashboardProject?.name || '').trim()
    };
  }

  function notifyActiveNotebookPageChanged() {
    if (typeof onActiveNotebookPageChanged === 'function') {
      onActiveNotebookPageChanged(getAgentChatContext());
    }
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
    const experimentNameSource = normalizeNotebookExperimentNameSource(experimentNameSourceDraft) || 'protocol';
    const entry = {
      ...baseEntry,
      experimentNameSource,
      experimentNameGeneratedAt: experimentNameSource === 'generated' ? experimentNameGeneratedAtDraft : '',
      experimentNameGeneratedModel: experimentNameSource === 'generated' ? experimentNameGeneratedModelDraft : '',
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

    const linkedGel = findLatestLinkedRecord(getGelAnalyses(state), activeEntry.id);
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
      : '';
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
    resetNotebookNameGenerationState(entry, protocol);
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
    renderResultFileAttachments(entry);
    renderLinkedPreviews(entry);
    updateSaveButtonLabel();
    protocolEditor.syncControls(protocol, entry);
    syncViewerVisibility();
    selectionInsightsController?.refreshHost?.('biology-notebook-protocol');
    if (markSavedBaseline) {
      markDraftSaved();
    }
    notifyActiveNotebookPageChanged();
    void maybeGenerateNotebookPageName();
  }

  function hideProjectDashboard() {
    activeProjectDashboardId = '';
    loadPaperFinderForProject(null);
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
    loadPaperFinderForProject(project);
    syncViewerVisibility();
    entryListRenderer.renderEntries();
    notifyActiveNotebookPageChanged();
  }

  function loadPaperFinderForProject(project) {
    void projectPaperFinderController.load(project);
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
    resultFileAttachmentController.clear();
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
    resetNotebookNameGenerationState(null, null);
    notebookProtocolMeta.textContent = 'Select a notebook page or start a new one.';
    editingEntryId = null;
    protocolEditor.syncControls(null, null);
    renderLinkedPreviews(null);
    updateSaveButtonLabel();
    syncViewerVisibility();
    savedDraftSnapshot = '';
    notifyActiveNotebookPageChanged();
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
    setNotebookSaveButtonLabel('Save notebook page');
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
      setNotebookSaveButtonLabel(isBusy && !clarify ? 'Saving notebook page…' : 'Save notebook page');
    }
    if (clarifySaveNotebookBtn) {
      clarifySaveNotebookBtn.disabled = isBusy;
      clarifySaveNotebookBtn.textContent = isBusy && clarify ? 'Clarifying...' : 'Clarify and Save';
    }
  }

  function setNotebookSaveButtonLabel(label) {
    if (!saveNotebookBtn) {
      return;
    }
    saveNotebookBtn.setAttribute('aria-label', label);
    saveNotebookBtn.setAttribute('data-hover-caption', label);
    saveNotebookBtn.removeAttribute('title');
    const accessibleLabel = saveNotebookBtn.querySelector('.sr-only');
    if (accessibleLabel) {
      accessibleLabel.textContent = label;
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
    if (event.key === 'Escape' && isExperimentDialogOpen()) {
      closeExperimentDialog();
      return;
    }
    if (event.key === 'Escape' && sampleLinkMenu.isOpen()) {
      sampleLinkMenu.close();
    }
  }

  function onExperimentDialogOverlayClick(event) {
    if (event?.target === notebookExperimentDialogOverlay) {
      closeExperimentDialog();
    }
  }

  function onExperimentProtocolResultClick(event) {
    const option = event?.target?.closest?.('[data-notebook-experiment-protocol-id]')
      || (event?.target?.dataset?.notebookExperimentProtocolId ? event.target : null);
    const protocolId = String(option?.dataset?.notebookExperimentProtocolId || '').trim();
    if (!protocolId || !state.protocols.some((protocol) => protocol.id === protocolId)) {
      return;
    }
    notebookProtocolSelect.value = protocolId;
    dropdownRenderer.renderProtocolOptions(protocolId, { triggerChange: false });
    renderExperimentProtocolResults();
    syncExperimentDialogControls();
  }

  notebookProjectSelect.addEventListener('change', () => {
    if (isExperimentDialogOpen()) {
      onExperimentProjectChange();
      return;
    }
    onProjectChange();
  });
  notebookProtocolSearchInput?.addEventListener('input', () => {
    if (isExperimentDialogOpen()) {
      onExperimentProtocolSearch();
      return;
    }
    dropdownRenderer.renderProtocolOptions();
  });
  notebookProtocolSelect.addEventListener('change', () => {
    if (isExperimentDialogOpen()) {
      renderExperimentProtocolResults();
      syncExperimentDialogControls();
      return;
    }
    onProtocolChange();
  });
  notebookNewExperimentBtn?.addEventListener('click', openExperimentDialog);
  notebookExperimentForm?.addEventListener('submit', startExperiment);
  notebookExperimentDialogCloseBtn?.addEventListener('click', () => closeExperimentDialog());
  notebookExperimentCancelBtn?.addEventListener('click', () => closeExperimentDialog());
  notebookExperimentDialogOverlay?.addEventListener('click', onExperimentDialogOverlayClick);
  notebookExperimentProtocolResults?.addEventListener('click', onExperimentProtocolResultClick);
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
  notebookAddTableBtn?.addEventListener('click', () => {
    toolSidebarController.clearSelection();
    resultTableController.onAdd();
  });
  notebookAddTableRowBtn?.addEventListener('click', resultTableController.onAddRow);
  notebookAddTableColumnBtn?.addEventListener('click', resultTableController.onAddColumn);
  notebookRemoveTableBtn?.addEventListener('click', resultTableController.onRemove);
  notebookResultFile?.addEventListener('change', () => renderResultFileAttachments());
  notebookAddAssayBtn?.addEventListener('click', () => {
    toolSidebarController.clearSelection();
    void linkedWorkActions.onAddAssayClick();
  });
  notebookAddSamplesBtn?.addEventListener('click', () => {
    toolSidebarController.clearSelection();
    quickSampleController.open();
  });
  cancelEditBtn?.addEventListener('click', cancelEdit);
  notebookEntryList?.addEventListener('click', onEntryListClick);
  notebookProjectDashboard?.addEventListener('input', onProjectDashboardDescriptionInput);
  notebookProjectDashboard?.addEventListener('change', onProjectDashboardDescriptionInput);
  notebookExportBtn?.addEventListener('click', onExportButtonClick);
  notebookPrintBtn?.addEventListener('click', onPrintButtonClick);
  notebookMarkExecutedBtn?.addEventListener('click', markEntryExecuted);
  bindFileDropTarget({
    target: notebookViewerColumn || notebookProtocolArea || notebookResultFile,
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
  notebookSteps?.addEventListener('input', onNotebookPlaceholderInput);
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
    appendAgentNotebookContent,
    openExperimentDialog,
    openProjectDashboard: showProjectDashboard,
    getAgentChatContext,
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
