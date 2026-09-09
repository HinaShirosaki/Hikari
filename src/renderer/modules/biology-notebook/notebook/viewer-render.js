import { resolveEntryExperimentName } from '../entry/entry-helpers.js';
import { buildProtocolStepsHtml, buildViewerMeta } from '../entry/viewer-renderer.js';

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
  getEditingEntryId,
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
      getSampleLink: (key) => getSampleLinkDrafts().get(key)
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
    setActiveProjectDashboardId('');
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
    setSampleLinkDrafts(new Map());
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
    setNotebookSaveButtonLabel('Save notebook page');
    if (clarifySaveNotebookBtn) {
      clarifySaveNotebookBtn.textContent = 'Clarify and Save';
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
