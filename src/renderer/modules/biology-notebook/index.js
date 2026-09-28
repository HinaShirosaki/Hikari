// Biology notebook controller.
//
// Responsibilities:
// - render protocol selection for notebook entry creation
// - populate inline placeholder editors from protocol step definitions
// - save notebook entries plus imported result files into app state
// - support editing existing entries and exporting them to PDF
import {
  buildSamplePlaceholderTypeAliases
} from './samples/sample-helpers.js';
import { registerNotebookSelectionInsightsHost } from './results/selection-insights-host.js';
import { createNotebookProjectDashboard } from './notebook/project-dashboard.js';
import { createExperimentDialog } from './notebook/experiment-dialog.js';
import { createNotebookAgentContext } from './notebook/agent-context.js';
import { createNotebookResultFiles } from './notebook/result-files.js';
import { createNotebookPageNaming } from './notebook/page-naming.js';
import { createNotebookViewerRender } from './notebook/viewer-render.js';
import { createNotebookSaveEntry } from './notebook/save-entry.js';
import { createNotebookSampleLinks } from './notebook/sample-links.js';
import { createNotebookProtocolEdit } from './notebook/protocol-edit.js';
import { createNotebookEntryActions } from './notebook/entry-actions.js';
import { queryNotebookElements } from './notebook/elements.js';
import { createNotebookControllers } from './notebook/controllers.js';
import { createNotebookDraftState } from './notebook/draft-state.js';
import { createNotebookAgentAppend } from './notebook/agent-append.js';
import { createExperimentSuggestions } from './project/experiment-suggestions.js';
import { bindNotebookEvents } from './notebook/event-bindings.js';

// Initialize the biology notebook module and wire it to app state plus DOM controls.
export function initLabNotebook({
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged,
  onCreateLinkedAssay,
  onProjectsChanged,
  onCreateWorkflowProcess = () => null,
  onOpenWorkflowProcess = () => {},
  onOpenPaper = null,
  selectionInsightsController = null,
  onActiveNotebookPageChanged = () => {},
  notebookType = 'biology'
}) {
  const SAMPLE_PLACEHOLDER_TYPE_ALIASES = buildSamplePlaceholderTypeAliases(state.settings);

  const elements = queryNotebookElements();

  const drafts = createNotebookDraftState();
  const appliedAgentAppendProposalIds = new Set();

  if (elements.notebookProjectDashboard) {
    elements.notebookProjectDashboard.hidden = true;
  }
  if (elements.notebookExperimentDialogOverlay) {
    elements.notebookExperimentDialogOverlay.hidden = true;
  }

  const {
    previewImageLoader,
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
  } = createNotebookControllers({
    elements,
    state,
    persist,
    createId,
    safeText,
    notebookType,
    onProjectsChanged,
    onCreateLinkedAssay,
    onOpenPaper,
    ...drafts,
    persistActiveEntrySampleLinks: (...args) => persistActiveEntrySampleLinks(...args),
    maybeGenerateNotebookPageName: (...args) => maybeGenerateNotebookPageName(...args),
    syncPageStarterProject: (...args) => syncPageStarterProject(...args),
    onProtocolChange: (...args) => onProtocolChange(...args),
    showProjectDashboard: (...args) => showProjectDashboard(...args),
    onExperimentProjectCreated: () => {
      renderExperimentProtocolResults();
      syncExperimentDialogControls();
      elements.notebookProtocolSearchInput?.focus?.();
    },
    ensureNotebookEntryForLinkedWork: (...args) => ensureNotebookEntryForLinkedWork(...args),
    applyQuickSampleCapture: (...args) => applyQuickSampleCapture(...args)
  });

  const {
    matchesType,
    getEntryProject,
    getEntryProtocol,
    findSelectedProject,
    syncPageStarterProject,
    setPageStarterVisible,
    findDashboardProject,
    onProjectDashboardDescriptionInput
  } = createNotebookProjectDashboard({
    state,
    persist,
    onProjectsChanged,
    notebookType,
    notebookPageStarter: elements.notebookPageStarter,
    notebookPageStarterProject: elements.notebookPageStarterProject,
    notebookProjectSelect: elements.notebookProjectSelect,
    notebookProtocolSearchInput: elements.notebookProtocolSearchInput
  });

  const {
    findSelectedProtocol,
    isExperimentDialogOpen,
    syncExperimentDialogControls,
    renderExperimentProtocolResults,
    closeExperimentDialog,
    openExperimentDialog,
    onExperimentProjectChange,
    onExperimentProtocolSearch,
    startExperiment
  } = createExperimentDialog({
    onCreateWorkflowProcess,
    onOpenWorkflowProcess,
    syncPageStarterProject: (...args) => syncPageStarterProject(...args),
    state,
    safeText,
    dropdownRenderer,
    elements,
    findSelectedProject,
    onProtocolChange: () => onProtocolChange(),
    ...drafts
  });

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
    if (!drafts.getEditingEntryId()) {
      return null;
    }
    return state.notebookEntries.find((entry) => entry.id === drafts.getEditingEntryId() && matchesType(entry)) || null;
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

  const {
    seedSampleLinkDrafts,
    renderResultFileAttachments,
    clearPendingNotebookResultFiles,
    getSelectedNotebookResultFiles,
    queueNotebookResultFiles,
    collectNotebookSampleLinks,
    appendNotebookResultLine,
    normalizeNotebookTargetText,
    buildAgentAppendText,
    appendAgentNotebookContent
  } = createNotebookResultFiles({
    resultFileAttachmentController,
    ...drafts,
    elements,
    getActiveEntry: () => getActiveEntry(),
    runAgentNotebookAppend: (proposal) => runAgentNotebookAppend(proposal)
  });

  const { runAgentNotebookAppend } = createNotebookAgentAppend({
    elements,
    appliedAgentAppendProposalIds,
    getActiveEntry: () => getActiveEntry(),
    resolveViewerProject: (...args) => resolveViewerProject(...args),
    resolveViewerProtocol: (...args) => resolveViewerProtocol(...args),
    normalizeNotebookTargetText: (...args) => normalizeNotebookTargetText(...args),
    buildAgentAppendText: (...args) => buildAgentAppendText(...args),
    notifyActiveNotebookPageChanged: (...args) => notifyActiveNotebookPageChanged(...args),
    saveEntry: (...args) => saveEntry(...args)
  });

  const {
    collectNotebookValues,
    collectCarriedOverKeys,
    getAgentChatContext,
    notifyActiveNotebookPageChanged,
    getCurrentDraftSnapshot,
    markDraftSaved
  } = createNotebookAgentContext({
    resultTableController,
    toolSidebarController,
    resolveViewerProtocol: (...args) => resolveViewerProtocol(...args),
    ...drafts,
    state,
    elements,
    protocolEditor,
    getActiveEntry: () => getActiveEntry(),
    getSelectedNotebookResultFiles: () => getSelectedNotebookResultFiles(),
    collectNotebookSampleLinks: (...args) => collectNotebookSampleLinks(...args),
    resolveViewerProject: (...args) => resolveViewerProject(...args),
    findDashboardProject,
    findSelectedProject,
    onActiveNotebookPageChanged
  });

  const {
    syncNotebookTitle,
    resetNotebookNameGenerationState,
    maybeGenerateNotebookPageName,
    onNotebookPlaceholderInput,
    beginNotebookTitleRename,
    finishNotebookTitleRename
  } = createNotebookPageNaming({
    resolveViewerProtocol: (...args) => resolveViewerProtocol(...args),
    markDraftSaved: (...args) => markDraftSaved(...args),
    notifyActiveNotebookPageChanged: (...args) => notifyActiveNotebookPageChanged(...args),
    elements,
    entryListRenderer,
    getActiveEntry: () => getActiveEntry(),
    updateNotebookEntryRecord: (...args) => updateNotebookEntryRecord(...args),
    collectNotebookValues: () => collectNotebookValues(),
    getCurrentDraftSnapshot: () => getCurrentDraftSnapshot(),
    state,
    onNotebookEntriesChanged,
    ...drafts
  });

  const {
    beginProtocolEdit,
    cancelProtocolEdit,
    applyProtocolEdit,
    onProjectChange,
    onProtocolChange
  } = createNotebookProtocolEdit({
    hideProjectDashboard: (...args) => hideProjectDashboard(...args),
    resultTableController,
    toolSidebarController,
    sampleLinkMenu,
    syncNotebookTitle: (...args) => syncNotebookTitle(...args),
    markDraftSaved: (...args) => markDraftSaved(...args),
    updateSaveButtonLabel: (...args) => updateSaveButtonLabel(...args),
    resolveViewerProtocol: (...args) => resolveViewerProtocol(...args),
    ...drafts,
    state,
    persist,
    createId,
    notebookType,
    elements,
    dropdownRenderer,
    entryListRenderer,
    protocolEditor,
    onNotebookEntriesChanged,
    getActiveEntry: () => getActiveEntry(),
    matchesType,
    getEntryProtocol,
    collectNotebookValues: (...args) => collectNotebookValues(...args),
    collectNotebookSampleLinks: (...args) => collectNotebookSampleLinks(...args),
    renderProtocolViewer: (...args) => renderProtocolViewer(...args),
    clearViewer: (...args) => clearViewer(...args),
    setPageStarterVisible: (...args) => setPageStarterVisible(...args),
    updateNotebookEntryRecord: (...args) => updateNotebookEntryRecord(...args),
    resolveViewerProject: (...args) => resolveViewerProject(...args),
    cancelEdit: () => cancelEdit(),
  });

  const { saveEntry, clarifyAndSaveEntry } = createNotebookSaveEntry({
    onEntryExecuted: (entry) => { void experimentSuggestions.suggest(entry.projectId, { automatic: true, completedEntry: entry }); },
    resultTableController,
    toolSidebarController,
    clearPendingNotebookResultFiles: (...args) => clearPendingNotebookResultFiles(...args),
    resolveViewerProtocol: (...args) => resolveViewerProtocol(...args),
    updateSaveButtonLabel: (...args) => updateSaveButtonLabel(...args),
    state,
    persist,
    createId,
    notebookType,
    matchesType,
    findSelectedProtocol,
    elements,
    entryListRenderer,
    protocolEditor,
    onNotebookEntriesChanged,
    collectNotebookValues: () => collectNotebookValues(),
    collectCarriedOverKeys: () => collectCarriedOverKeys(),
    collectNotebookSampleLinks: (...args) => collectNotebookSampleLinks(...args),
    getSelectedNotebookResultFiles: () => getSelectedNotebookResultFiles(),
    resolveViewerProject: (...args) => resolveViewerProject(...args),
    maybeGenerateNotebookPageName: (...args) => maybeGenerateNotebookPageName(...args),
    renderProtocolViewer: (...args) => renderProtocolViewer(...args),
    setNotebookSaveBusy: (...args) => setNotebookSaveBusy(...args),
    ...drafts
  });

  const {
    markEntryExecuted,
    persistActiveEntrySampleLinks,
    applyQuickSampleCapture
  } = createNotebookSampleLinks({
    onEntryExecuted: (entry) => { void experimentSuggestions.suggest(entry.projectId, { automatic: true, completedEntry: entry }); },
    resultTableController,
    toolSidebarController,
    getActiveEntry: (...args) => getActiveEntry(...args),
    resolveViewerProtocol: (...args) => resolveViewerProtocol(...args),
    markDraftSaved: (...args) => markDraftSaved(...args),
    state,
    persist,
    elements,
    entryListRenderer,
    onNotebookEntriesChanged,
    collectNotebookValues: () => collectNotebookValues(),
    collectNotebookSampleLinks: (...args) => collectNotebookSampleLinks(...args),
    appendNotebookResultLine: (line) => appendNotebookResultLine(line),
    updateNotebookEntryRecord: (...args) => updateNotebookEntryRecord(...args),
    ...drafts,
    matchesType,
    getEntryProject,
    getEntryProtocol,
    renderProtocolViewer: (...args) => renderProtocolViewer(...args)
  });

  const {
    hideProjectDashboard,
    updateSaveButtonLabel,
    renderProtocolViewer,
    showProjectDashboard,
    clearViewer,
    syncViewerVisibility,
    setNotebookSaveBusy
  } = createNotebookViewerRender({
    onProjectDashboardRendered: () => experimentSuggestions.render(),
    elements,
    state,
    safeText,
    selectionInsightsController,
    findDashboardProject,
    setPageStarterVisible,
    SAMPLE_PLACEHOLDER_TYPE_ALIASES,
    dropdownRenderer,
    entryListRenderer,
    projectDashboardRenderer,
    projectPaperFinderController,
    protocolEditor,
    resultTableController,
    resultFileAttachmentController,
    toolSidebarController,
    linkedWorkActions,
    sampleLinkMenu,
    clearPendingNotebookResultFiles: (...args) => clearPendingNotebookResultFiles(...args),
    getActiveEntry: (...args) => getActiveEntry(...args),
    markDraftSaved: (...args) => markDraftSaved(...args),
    maybeGenerateNotebookPageName: (...args) => maybeGenerateNotebookPageName(...args),
    notifyActiveNotebookPageChanged: (...args) => notifyActiveNotebookPageChanged(...args),
    renderLinkedPreviews: (...args) => renderLinkedPreviews(...args),
    renderResultFileAttachments: (...args) => renderResultFileAttachments(...args),
    resetNotebookNameGenerationState: (...args) => resetNotebookNameGenerationState(...args),
    resolveViewerProtocol: (...args) => resolveViewerProtocol(...args),
    seedSampleLinkDrafts: (...args) => seedSampleLinkDrafts(...args),
    syncNotebookTitle: (...args) => syncNotebookTitle(...args),
    syncPageStarterProject: (...args) => syncPageStarterProject(...args),
    ...drafts
  });

  const {
    renderLinkedPreviews,
    ensureNotebookEntryForLinkedWork,
    onEntryListClick,
    onExportButtonClick,
    onPrintButtonClick,
    editEntry
  } = createNotebookEntryActions({
    state,
    safeText,
    elements,
    dropdownRenderer,
    entryListRenderer,
    protocolEditor,
    linkedWorkActions,
    previewImageLoader,
    getActiveEntry: () => getActiveEntry(),
    showProjectDashboard: (...args) => showProjectDashboard(...args),
    onOpenWorkflowProcess,
    clearViewer: (...args) => clearViewer(...args),
    renderProtocolViewer: (...args) => renderProtocolViewer(...args),
    ...drafts,
    saveEntry: (...args) => saveEntry(...args),
    matchesType: (...args) => matchesType(...args),
    getEntryProject: (...args) => getEntryProject(...args),
    getEntryProtocol: (...args) => getEntryProtocol(...args),
    syncPageStarterProject: (...args) => syncPageStarterProject(...args),
    onProtocolChange: (...args) => onProtocolChange(...args)
  });

  const experimentSuggestions = createExperimentSuggestions({
    state, persist, createId, host: elements.notebookProjectDashboard,
    acceptButton: elements.notebookTakeIntoPlanBtn, api: window.hikariApi,
    getActiveEntry, saveEntry, editEntry,
    onEntriesChanged: () => { entryListRenderer.renderEntries(); onNotebookEntriesChanged?.(); }
  });

  const { cancelEdit } = bindNotebookEvents({
    elements,
    state,
    sampleLinkMenu,
    protocolEditor,
    dropdownRenderer,
    resultTableController,
    toolSidebarController,
    linkedWorkActions,
    quickSampleController,
    inlinePlaceholders,
    ...drafts,
    updateSaveButtonLabel: (...args) => updateSaveButtonLabel(...args),
    onProtocolChange: (...args) => onProtocolChange(...args),
    onProjectChange: (...args) => onProjectChange(...args),
    isExperimentDialogOpen: (...args) => isExperimentDialogOpen(...args),
    openExperimentDialog: (...args) => openExperimentDialog(...args),
    closeExperimentDialog: (...args) => closeExperimentDialog(...args),
    startExperiment: (...args) => startExperiment(...args),
    onExperimentProjectChange: (...args) => onExperimentProjectChange(...args),
    onExperimentProtocolSearch: (...args) => onExperimentProtocolSearch(...args),
    renderExperimentProtocolResults: (...args) => renderExperimentProtocolResults(...args),
    syncExperimentDialogControls: (...args) => syncExperimentDialogControls(...args),
    beginProtocolEdit: (...args) => beginProtocolEdit(...args),
    applyProtocolEdit: (...args) => applyProtocolEdit(...args),
    cancelProtocolEdit: (...args) => cancelProtocolEdit(...args),
    saveEntry: (...args) => saveEntry(...args),
    clarifyAndSaveEntry: (...args) => clarifyAndSaveEntry(...args),
    beginNotebookTitleRename: (...args) => beginNotebookTitleRename(...args),
    finishNotebookTitleRename: (...args) => finishNotebookTitleRename(...args),
    renderResultFileAttachments: (...args) => renderResultFileAttachments(...args),
    queueNotebookResultFiles: (...args) => queueNotebookResultFiles(...args),
    onNotebookPlaceholderInput: (...args) => onNotebookPlaceholderInput(...args),
    onEntryListClick: (...args) => onEntryListClick(...args),
    onProjectDashboardDescriptionInput: (...args) => onProjectDashboardDescriptionInput(...args),
    onExportButtonClick: (...args) => onExportButtonClick(...args),
    onPrintButtonClick: (...args) => onPrintButtonClick(...args),
    markEntryExecuted: (...args) => markEntryExecuted(...args)
  });

  updateSaveButtonLabel();
  syncPageStarterProject();
  syncViewerVisibility();
  renderLinkedPreviews(null);
  resultTableController.renderEditor(null);

  registerNotebookSelectionInsightsHost({
    controller: selectionInsightsController,
    hostEl: elements.notebookSteps,
    isViewerHidden: () => elements.notebookProtocolArea.hidden,
    getActiveEntry,
    getStoragePath: () => state.settings?.storagePath,
    resolveProject: resolveViewerProject,
    resolveProtocol: resolveViewerProtocol,
    saveEntry,
    updateRecord: updateNotebookEntryRecord
  });

  elements.notebookProjectDashboard?.addEventListener('click', (event) => {
    const add = event.target.closest('[data-project-workflow-add]');
    if (add) {
      openExperimentDialog({ kind: 'workflow', projectId: add.dataset.projectWorkflowAdd, templateId: add.dataset.processTemplate || '' });
      return;
    }
    const open = event.target.closest('[data-project-process-open]');
    if (open) onOpenWorkflowProcess(open.dataset.projectProcessOpen);
  });

  return {
    hasUnsavedChanges: () => Boolean(
      drafts.getSavedDraftSnapshot()
      && getCurrentDraftSnapshot() !== drafts.getSavedDraftSnapshot()
    ),
    openEntry: editEntry,
    appendAgentNotebookContent,
    openExperimentDialog,
    openProjectDashboard: showProjectDashboard,
    refreshProjectDashboard: () => {
      const id = drafts.getActiveProjectDashboardId();
      if (id) showProjectDashboard(id);
    },
    getAgentChatContext,
    renderProjectOptions: dropdownRenderer.renderProjectOptions,
    renderProtocolOptions: dropdownRenderer.renderProtocolOptions,
    renderEntries: entryListRenderer.renderEntries,
    onProtocolChange,
    saveUnsavedChanges: async () => {
      const entry = await saveEntry();
      return Boolean(entry) && getCurrentDraftSnapshot() === drafts.getSavedDraftSnapshot();
    }
  };
}
