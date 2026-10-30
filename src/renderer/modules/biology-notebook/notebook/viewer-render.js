import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("notebook");
import { setNotebookText, setNotebookAttribute } from '../localization.js';
import { resolveEntryExperimentName } from '../entry/entry-helpers.js';
import { buildProtocolStepsHtml, buildViewerMetaHtml } from '../entry/viewer-renderer.js';
import { buildPlaceholderPrefill } from '../protocol/placeholder-prefill.js';
import { resolveSampleTypeForPlaceholder } from '../samples/sample-helpers.js';

// Rendering the notebook page viewer and the project dashboard that replaces it,
// plus the save-button states those two views drive.
function createNotebookViewerRender({
  elements,
  onProjectDashboardRendered = () => {},
  state,
  safeText,
  selectionInsightsController,
  findDashboardProject,
  setPageStarterVisible,
  syncPageStarterProject,
  syncNotebookTitle,
  resetNotebookNameGenerationState,
  maybeGenerateNotebookPageName,
  markDraftSaved,
  notifyActiveNotebookPageChanged,
  seedSampleLinkDrafts,
  clearPendingNotebookResultFiles,
  renderResultFileAttachments,

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
  getActiveEntry,
  resolveViewerProtocol,
  renderLinkedPreviews,
  setEditingEntryId,
  setActiveProjectDashboardId,
  setSavedDraftSnapshot,
  getSampleLinkDrafts,
  setSampleLinkDrafts
} = {}) {
  const {
    notebookEmptyState,
    notebookProjectDashboard,
    notebookProjectSelect,
    notebookProtocolArea,
    notebookProtocolTitle,
    notebookProtocolMeta,
    notebookExperimentName,
    notebookResult,
    notebookSteps,
    saveNotebookBtn,
    clarifySaveNotebookBtn
  } = elements;

  function renderProtocolViewer({
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
    notebookProtocolMeta.removeAttribute?.('data-i18n');
    notebookProtocolMeta.removeAttribute?.('data-i18n-params');
    i18nUi.setHtml(notebookProtocolMeta, buildViewerMetaHtml({ entry }));

    if (entry) {
      seedSampleLinkDrafts(entry);
    }
    i18nUi.setHtml(notebookSteps, buildProtocolStepsHtml({
      protocol,
      values: entry?.values || {},
      // Only a fresh page gets suggestions; an existing page shows what was recorded.
      prefill: entry ? {} : buildPlaceholderPrefill({
        protocol,
        entries: state.notebookEntries,
        resolveType: (name) => resolveSampleTypeForPlaceholder(name, SAMPLE_PLACEHOLDER_TYPE_ALIASES)
      }),
      safeText,
      settings: state.settings || {},
      samplePlaceholderTypeAliases: SAMPLE_PLACEHOLDER_TYPE_ALIASES,
      getSampleLink: (key) => getSampleLinkDrafts().get(key)
    }));

    notebookResult.value = entry?.result || '';
    resultTableController.renderEditor(resultTablesOverride ?? resultTableOverride ?? entry?.resultTables ?? entry?.resultTable ?? null);
    if (entry) {
      toolSidebarController.setCalculations(entry.toolCalculations || [], entry.id);
    } else if (!preserveToolCalculations) {
      // One unsaved draft at a time, so every draft shares a page identity: the
      // first save of a draft is the same page, not a new one.
      toolSidebarController.setCalculations([], 'draft');
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
    setActiveProjectDashboardId('');
    loadPaperFinderForProject(null);
    if (!notebookProjectDashboard) {
      return;
    }
    notebookProjectDashboard.hidden = true;
    i18nUi.setHtml(notebookProjectDashboard, '');
  }

  function showProjectDashboard(projectId, projectName = '') {
    const project = findDashboardProject(projectId, projectName);
    if (!project || !notebookProjectDashboard) {
      return;
    }

    clearViewer({ preserveProjectDashboard: true });
    setActiveProjectDashboardId(project.id);
    notebookProjectSelect.value = project.id;
    dropdownRenderer.renderProtocolOptions('', { triggerChange: false });
    syncPageStarterProject();
    projectDashboardRenderer.renderDashboardInto(notebookProjectDashboard, project.id, {
      includeEditAction: false,
      contributionHeadingId: 'biology-notebook-project-contribution-heading'
    });
    renderProjectDashboardActions(project);
    onProjectDashboardRendered();
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
    setNotebookText(exportBtn, 'project.export');
    exportBtn.addEventListener('click', () => {
      const entries = projectDashboardRenderer.getProjectNotebookEntries(project) || [];
      exportBtn.disabled = true;
      setNotebookText(exportBtn, 'project.exporting');
      Promise.resolve(linkedWorkActions.exportProjectPagesPdf({ project, entries }))
        .catch((error) => {
          console.error('Failed to export project notebook PDF:', error);
        })
        .finally(() => {
          exportBtn.disabled = false;
          setNotebookText(exportBtn, 'project.export');
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
    setSampleLinkDrafts(new Map());
    sampleLinkMenu.close();
    i18nUi.setHtml(notebookSteps, '');
    notebookSteps.hidden = false;
    notebookResult.value = '';
    clearPendingNotebookResultFiles();
    resultFileAttachmentController.clear();
    resultTableController.renderEditor(null);
    toolSidebarController.setCalculations([], '');
    if (notebookExperimentName) {
      notebookExperimentName.value = '';
      notebookExperimentName.hidden = true;
    }
    if (notebookProtocolTitle) {
      i18nUi.setText(notebookProtocolTitle, '');
      notebookProtocolTitle.hidden = false;
    }
    resetNotebookNameGenerationState(null, null);
    setNotebookText(notebookProtocolMeta, 'viewer.choose');
    setEditingEntryId(null);
    protocolEditor.syncControls(null, null);
    renderLinkedPreviews(null);
    updateSaveButtonLabel();
    syncViewerVisibility();
    setSavedDraftSnapshot('');
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
    setNotebookSaveButtonLabel('action.save');
    if (clarifySaveNotebookBtn) {
      setNotebookText(clarifySaveNotebookBtn, 'action.clarify');
    }
    protocolEditor.syncControls(resolveViewerProtocol(getActiveEntry()), getActiveEntry());
  }

  function setNotebookSaveBusy(isBusy, { clarify = false } = {}) {
    if (saveNotebookBtn) {
      saveNotebookBtn.disabled = isBusy;
      setNotebookSaveButtonLabel(isBusy && !clarify ? 'action.saving' : 'action.save');
    }
    if (clarifySaveNotebookBtn) {
      clarifySaveNotebookBtn.disabled = isBusy;
      setNotebookText(clarifySaveNotebookBtn, isBusy && clarify ? 'action.clarifying' : 'action.clarify');
    }
  }

  function setNotebookSaveButtonLabel(label) {
    if (!saveNotebookBtn) {
      return;
    }
    setNotebookAttribute(saveNotebookBtn, 'aria-label', label);
    setNotebookAttribute(saveNotebookBtn, 'data-hover-caption', label);
    saveNotebookBtn.removeAttribute('title');
    const accessibleLabel = saveNotebookBtn.querySelector('.sr-only');
    if (accessibleLabel) {
      setNotebookText(accessibleLabel, label);
    }
  }

  return {
    renderProtocolViewer,
    hideProjectDashboard,
    showProjectDashboard,
    loadPaperFinderForProject,
    renderProjectDashboardActions,
    clearViewer,
    syncViewerVisibility,
    updateSaveButtonLabel,
    setNotebookSaveBusy,
    setNotebookSaveButtonLabel
  };
}

export { createNotebookViewerRender };
