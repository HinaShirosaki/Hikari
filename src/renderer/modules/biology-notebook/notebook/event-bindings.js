import { showTransientNotice } from '../../../lib/notify.js';
import { bindFileDropTarget } from '../../../lib/file-drop.js';

// Every DOM listener the notebook viewer installs, plus the small handlers that
// exist only to be bound here.
function bindNotebookEvents({
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
  setEditingEntryId,
  setSampleLinkDrafts,
  updateSaveButtonLabel,
  onProtocolChange,
  onProjectChange,
  isExperimentDialogOpen,
  openExperimentDialog,
  closeExperimentDialog,
  startExperiment,
  onExperimentProjectChange,
  onExperimentProtocolSearch,
  renderExperimentProtocolResults,
  syncExperimentDialogControls,
  beginProtocolEdit,
  applyProtocolEdit,
  cancelProtocolEdit,
  saveEntry,
  clarifyAndSaveEntry,
  beginNotebookTitleRename,
  finishNotebookTitleRename,
  renderResultFileAttachments,
  queueNotebookResultFiles,
  onNotebookPlaceholderInput,
  onEntryListClick,
  onProjectDashboardDescriptionInput,
  onExportButtonClick,
  onPrintButtonClick,
  markEntryExecuted
} = {}) {
  function cancelEdit() {
    setEditingEntryId(null);
    setSampleLinkDrafts(new Map());
    sampleLinkMenu.close();
    protocolEditor.clearDraft();
    updateSaveButtonLabel();
    onProtocolChange();
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
    if (event?.target === elements.notebookExperimentDialogOverlay) {
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
    elements.notebookProtocolSelect.value = protocolId;
    dropdownRenderer.renderProtocolOptions(protocolId, { triggerChange: false });
    renderExperimentProtocolResults();
    syncExperimentDialogControls();
  }

  elements.notebookProjectSelect.addEventListener('change', () => {
    if (isExperimentDialogOpen()) {
      onExperimentProjectChange();
      return;
    }
    onProjectChange();
  });
  elements.notebookProtocolSearchInput?.addEventListener('input', () => {
    if (isExperimentDialogOpen()) {
      onExperimentProtocolSearch();
      return;
    }
    dropdownRenderer.renderProtocolOptions();
  });
  elements.notebookProtocolSelect.addEventListener('change', () => {
    if (isExperimentDialogOpen()) {
      renderExperimentProtocolResults();
      syncExperimentDialogControls();
      return;
    }
    onProtocolChange();
  });
  elements.notebookNewExperimentBtn?.addEventListener('click', openExperimentDialog);
  elements.notebookExperimentForm?.addEventListener('submit', startExperiment);
  elements.notebookExperimentDialogCloseBtn?.addEventListener('click', () => closeExperimentDialog());
  elements.notebookExperimentCancelBtn?.addEventListener('click', () => closeExperimentDialog());
  elements.notebookExperimentDialogOverlay?.addEventListener('click', onExperimentDialogOverlayClick);
  elements.notebookExperimentProtocolResults?.addEventListener('click', onExperimentProtocolResultClick);
  elements.notebookEditProtocolBtn?.addEventListener('click', beginProtocolEdit);
  elements.notebookApplyProtocolEditBtn?.addEventListener('click', applyProtocolEdit);
  elements.notebookCancelProtocolEditBtn?.addEventListener('click', cancelProtocolEdit);
  elements.saveNotebookBtn.addEventListener('click', () => { void saveEntry(); });
  elements.clarifySaveNotebookBtn?.addEventListener('click', () => { void clarifyAndSaveEntry(); });
  elements.notebookProtocolTitle?.addEventListener('dblclick', beginNotebookTitleRename);
  elements.notebookExperimentName?.addEventListener('blur', () => finishNotebookTitleRename());
  elements.notebookExperimentName?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault?.();
      finishNotebookTitleRename();
    } else if (event.key === 'Escape') {
      event.preventDefault?.();
      finishNotebookTitleRename({ cancel: true });
    }
  });
  // Adding a table asks for its size first; the counts are clamped in the model, so a
  // stray digit cannot build a grid big enough to hang the renderer.
  function setTableSizeDialog(open) {
    if (elements.notebookTableSizeOverlay) {
      elements.notebookTableSizeOverlay.hidden = !open;
    }
    if (open) {
      elements.notebookTableSizeColumns?.focus?.();
      elements.notebookTableSizeColumns?.select?.();
    }
  }
  elements.notebookTableSizeCloseBtn?.addEventListener('click', () => setTableSizeDialog(false));
  elements.notebookTableSizeCancelBtn?.addEventListener('click', () => setTableSizeDialog(false));
  elements.notebookTableSizeOverlay?.addEventListener('click', (event) => {
    if (event.target === elements.notebookTableSizeOverlay) {
      setTableSizeDialog(false);
    }
  });
  elements.notebookTableSizeForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    resultTableController.onAdd({
      columnCount: Number(elements.notebookTableSizeColumns?.value),
      rowCount: Number(elements.notebookTableSizeRows?.value)
    });
    setTableSizeDialog(false);
  });
  elements.notebookAddTableBtn?.addEventListener('click', () => {
    toolSidebarController.clearSelection();
    setTableSizeDialog(true);
  });
  elements.notebookAddMolarityBtn?.addEventListener('click', () => {
    toolSidebarController.clearSelection();
    resultTableController.onAddMolarity();
  });
  elements.notebookAddTableRowBtn?.addEventListener('click', resultTableController.onAddRow);
  elements.notebookAddTableColumnBtn?.addEventListener('click', resultTableController.onAddColumn);
  elements.notebookRemoveTableBtn?.addEventListener('click', resultTableController.onRemove);
  elements.notebookResultFile?.addEventListener('change', () => renderResultFileAttachments());
  elements.notebookAddAssayBtn?.addEventListener('click', () => {
    toolSidebarController.clearSelection();
    void linkedWorkActions.onAddAssayClick();
  });
  elements.notebookAddSamplesBtn?.addEventListener('click', () => {
    toolSidebarController.clearSelection();
    quickSampleController.open();
  });
  elements.cancelEditBtn?.addEventListener('click', cancelEdit);
  elements.notebookEntryList?.addEventListener('click', onEntryListClick);
  elements.notebookProjectDashboard?.addEventListener('input', onProjectDashboardDescriptionInput);
  elements.notebookProjectDashboard?.addEventListener('change', onProjectDashboardDescriptionInput);
  elements.notebookExportBtn?.addEventListener('click', onExportButtonClick);
  elements.notebookPrintBtn?.addEventListener('click', onPrintButtonClick);
  elements.notebookMarkExecutedBtn?.addEventListener('click', markEntryExecuted);
  bindFileDropTarget({
    target: elements.notebookViewerColumn || elements.notebookProtocolArea || elements.notebookResultFile,
    multiple: true,
    disabled: () => Boolean(elements.notebookProtocolArea?.hidden),
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
  elements.notebookSteps?.addEventListener('input', onNotebookPlaceholderInput);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', onDocumentClickForSampleLinkMenu);
    document.addEventListener('keydown', onDocumentKeydownForSampleLinkMenu);
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('resize', sampleLinkMenu.close);
  }

  return { cancelEdit };
}

export { bindNotebookEvents };
