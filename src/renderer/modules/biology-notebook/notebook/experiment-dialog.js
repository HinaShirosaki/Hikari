import { showTransientNotice } from '../../../lib/notify.js';

// The New Experiment dialog: picking a project and protocol, searching the
// protocol list, and starting the page once both are chosen.
function createExperimentDialog({
  state,
  safeText,
  dropdownRenderer,
  elements,
  findSelectedProject,
  syncPageStarterProject,
  onProtocolChange,
  setEditingEntryId,
  getActiveProjectDashboardId
} = {}) {
  const {
    notebookProjectSelect,
    notebookProtocolSelect,
    notebookProtocolSearchInput,
    notebookExperimentDialogOverlay,
    notebookExperimentDialogStatus,
    notebookExperimentProtocolResults,
    notebookExperimentStartBtn,
    notebookNewExperimentBtn
  } = elements;
  let experimentDialogPreviousSelection = null;
  let experimentDialogWorkspaceProjectId = '';

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
    experimentDialogWorkspaceProjectId = String(getActiveProjectDashboardId() || notebookProjectSelect.value || '');

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
    setEditingEntryId(null);
    onProtocolChange();
  }

  return {
    findSelectedProtocol,
    isExperimentDialogOpen,
    setExperimentDialogStatus,
    syncExperimentDialogControls,
    renderExperimentProtocolResults,
    restoreExperimentDialogSelection,
    closeExperimentDialog,
    openExperimentDialog,
    onExperimentProjectChange,
    onExperimentProtocolSearch,
    startExperiment
  };
}

export { createExperimentDialog };
