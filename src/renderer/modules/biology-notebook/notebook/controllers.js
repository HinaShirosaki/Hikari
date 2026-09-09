import { getGelAnalyses } from '../../../lib/gel-records.js';
import { createLinkedPreviewImageLoader } from '../results/linked-previews-renderer.js';
import { createSpreadsheetTables } from '../../../lib/spreadsheet-tables.js';
import { createSampleLinkMenuController } from '../samples/sample-link-menu.js';
import { createNotebookQuickSampleController } from '../samples/quick-sample-controller.js';
import { createInlinePlaceholderController } from '../protocol/inline-placeholder-controller.js';
import { createEntryListRenderer } from '../entry/entry-list-renderer.js';
import { createDropdownRenderer } from '../entry/dropdown-renderer.js';
import { createProtocolSnapshotEditor } from '../protocol/protocol-snapshot-editor.js';
import { createLinkedWorkActions } from '../results/linked-work-actions.js';
import { createProjectDashboardRenderer } from '../project/project-dashboard-renderer.js';
import { createNotebookProjectController } from '../project/project-controller.js';
import { createProjectPaperFinderController } from '../project/paper-finder-controller.js';
import { createNotebookToolSidebarController } from '../tools/tool-sidebar.js';
import {
  createResultFileAttachmentController,
  createResultFileAttachmentLoader
} from '../results/result-file-attachments.js';

// Every sub-controller the notebook viewer owns, built once against the shared
// DOM elements and app state.
function createNotebookControllers({
  elements,
  state,
  persist,
  createId,
  safeText,
  notebookType,
  onProjectsChanged,
  onCreateLinkedAssay,
  getEditingEntryId,
  getActiveProjectDashboardId,
  getSampleLinkDrafts,
  persistActiveEntrySampleLinks,
  maybeGenerateNotebookPageName,
  syncPageStarterProject,
  onProtocolChange,
  showProjectDashboard,
  ensureNotebookEntryForLinkedWork,
  applyQuickSampleCapture,
  appendNotebookResultLine
} = {}) {
  const TabulatorLib = window.Tabulator || null;

  const previewImageLoader = createLinkedPreviewImageLoader({
    readFileBase64: window.hikariApi?.readFileBase64?.bind(window.hikariApi)
  });
  const resultFileAttachmentLoader = createResultFileAttachmentLoader({
    readFileBase64: window.hikariApi?.readFileBase64?.bind(window.hikariApi),
    getStoragePath: () => state.settings?.storagePath || ''
  });
  const resultFileAttachmentController = createResultFileAttachmentController({
    host: elements.notebookResultAttachments,
    loader: resultFileAttachmentLoader
  });

  const resultTableController = createSpreadsheetTables({
    host: elements.notebookResultTableHost,
    statusEl: elements.notebookResultTableStatus,
    wrapEl: elements.notebookResultTableWrap,
    addBtn: elements.notebookAddTableBtn,
    addRowBtn: elements.notebookAddTableRowBtn,
    addColBtn: elements.notebookAddTableColumnBtn,
    removeBtn: elements.notebookRemoveTableBtn,
    contextMenuEl: elements.notebookTableContextMenu,
    createId,
    TabulatorLib,
    label: 'Notebook result table',
    emptyMessage: 'Add a table to capture structured notebook results.',
    placeholder: 'Use Add row / Add column to shape this notebook table.'
  });

  const protocolEditor = createProtocolSnapshotEditor({
    protocolArea: elements.notebookProtocolArea,
    editorEl: elements.notebookProtocolEditor,
    stepsHost: elements.notebookSteps,
    editBtn: elements.notebookEditProtocolBtn,
    applyBtn: elements.notebookApplyProtocolEditBtn,
    cancelBtn: elements.notebookCancelProtocolEditBtn,
    exportBtn: elements.notebookExportBtn,
    printBtn: elements.notebookPrintBtn,
    markExecutedBtn: elements.notebookMarkExecutedBtn,
    takeIntoPlanBtn: elements.notebookTakeIntoPlanBtn,
    draftNameInput: elements.notebookProtocolDraftName,
    draftStepsInput: elements.notebookProtocolDraftSteps,
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
    stepsHost: elements.notebookSteps,
    getSampleLink: (key) => getSampleLinkDrafts().get(key),
    deleteSampleLink: (key) => getSampleLinkDrafts().delete(key),
    setSampleLink: (key, link) => getSampleLinkDrafts().set(key, link),
    getSamples: () => state.samples || [],
    getInventory: () => state.inventory || {},
    getSettings: () => state.settings || {},
    onOpenSampleLinkMenu: (params) => sampleLinkMenu.open(params),
    onCloseSampleLinkMenu: () => sampleLinkMenu.close(),
    onPersistSampleLinks: (...args) => persistActiveEntrySampleLinks(...args),
    onValueCommitted: () => { void maybeGenerateNotebookPageName(); }
  });

  const entryListRenderer = createEntryListRenderer({
    listEl: elements.notebookEntryList,
    notebookType,
    safeText,
    getNotebookEntries: () => state.notebookEntries,
    getProjects: () => state.projects,
    getEditingEntryId,
    getActiveProjectDashboardId
  });

  const projectDashboardRenderer = createProjectDashboardRenderer({
    state,
    safeText
  });
  const projectPaperFinderController = createProjectPaperFinderController({
    host: elements.notebookProjectDashboard,
    state,
    api: window.hikariApi
  });

  const dropdownRenderer = createDropdownRenderer({
    projectSelect: elements.notebookProjectSelect,
    protocolSelect: elements.notebookProtocolSelect,
    protocolSearchInput: elements.notebookProtocolSearchInput,
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
    railEl: elements.notebookRail,
    contextMenuEl: elements.notebookProjectContextMenu,
    addProjectBtn: elements.notebookAddProjectBtn,
    headerAddProjectBtn: elements.notebookHeaderAddProjectBtn,
    dialogOverlay: elements.notebookProjectDialogOverlay,
    dialogForm: elements.notebookProjectForm,
    projectNameInput: elements.notebookProjectNameInput,
    projectDescriptionInput: elements.notebookProjectDescriptionInput,
    dialogCloseBtn: elements.notebookProjectDialogCloseBtn,
    dialogCancelBtn: elements.notebookProjectCancelBtn,
    onProjectCreated: (project) => {
      dropdownRenderer.renderProjectOptions();
      elements.notebookProjectSelect.value = project.id;
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
    getPdfSettings: () => state.settings?.notebookPdf || {},
    previewImageLoader,
    resultFileAttachmentLoader,
    onCreateLinkedAssay
  });

  const quickSampleController = createNotebookQuickSampleController({
    doc: typeof document !== 'undefined' ? document : null,
    state,
    safeText,
    createId,
    ensureEntry: () => ensureNotebookEntryForLinkedWork(),
    onCreated: (...args) => applyQuickSampleCapture(...args)
  });

  const toolSidebarController = createNotebookToolSidebarController({
    doc: typeof document !== 'undefined' ? document : null,
    win: typeof window !== 'undefined' ? window : null,
    safeText,
    createId,
    notesInput: elements.notebookResult,
    calculationsHost: elements.notebookToolCalculations,
    getStoredCompounds: () => (Array.isArray(state.labInventory?.chemicals) ? state.labInventory.chemicals : []),
    onAppendNote: (line) => appendNotebookResultLine(line)
  });

  return {
    previewImageLoader,
    resultFileAttachmentLoader,
    resultFileAttachmentController,
    resultTableController,
    protocolEditor,
    sampleLinkMenu,
    inlinePlaceholders,
    entryListRenderer,
    projectDashboardRenderer,
    projectPaperFinderController,
    dropdownRenderer,
    linkedWorkActions,
    quickSampleController,
    toolSidebarController
  };
}

export { createNotebookControllers };
