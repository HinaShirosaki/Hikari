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
    if (event.key === 'Escape' && isTableSizeDialogOpen()) {
      setTableSizeDialog(false);
      elements.notebookAddTableBtn?.focus?.();
      return;
    }
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
  // The toolbox floats and can be dragged anywhere, so the ask is placed against
  // the button's own rect rather than a fixed spot on the page.
  const TABLE_SIZE_POPOVER_GAP = 8;

  function positionTableSizePopover() {
    const popover = elements.notebookTableSizeOverlay;
    const anchorRect = elements.notebookAddTableBtn?.getBoundingClientRect?.();
    if (!popover?.style || !anchorRect) {
      return;
    }
    // Anchored popovers live on the body so no scroll container can clip them.
    if (typeof document.body?.appendChild === 'function' && popover.parentElement !== document.body) {
      document.body.appendChild(popover);
    }
    const viewportWidth = Number(document.documentElement?.clientWidth || window.innerWidth || 0);
    const viewportHeight = Number(document.documentElement?.clientHeight || window.innerHeight || 0);
    const size = popover.getBoundingClientRect?.() || {};
    const width = Number(size.width) || 0;
    const height = Number(size.height) || 0;
    let left = Number(anchorRect.right) + TABLE_SIZE_POPOVER_GAP;
    if (viewportWidth && left + width + TABLE_SIZE_POPOVER_GAP > viewportWidth) {
      left = Number(anchorRect.left) - width - TABLE_SIZE_POPOVER_GAP;
    }
    if (viewportWidth) {
      left = Math.min(
        Math.max(TABLE_SIZE_POPOVER_GAP, left),
        Math.max(TABLE_SIZE_POPOVER_GAP, viewportWidth - width - TABLE_SIZE_POPOVER_GAP)
      );
    }
    let top = Number(anchorRect.top);
    if (viewportHeight && height) {
      top = Math.min(top, Math.max(TABLE_SIZE_POPOVER_GAP, viewportHeight - height - TABLE_SIZE_POPOVER_GAP));
    }
    popover.style.left = `${Math.round(Math.max(TABLE_SIZE_POPOVER_GAP, left))}px`;
    popover.style.top = `${Math.round(Math.max(TABLE_SIZE_POPOVER_GAP, top))}px`;
  }

  function isTableSizeDialogOpen() {
    return Boolean(elements.notebookTableSizeOverlay) && !elements.notebookTableSizeOverlay.hidden;
  }

  function setTableSizeDialog(open) {
    if (elements.notebookTableSizeOverlay) {
      elements.notebookTableSizeOverlay.hidden = !open;
    }
    if (open) {
      positionTableSizePopover();
      elements.notebookTableSizeColumns?.focus?.();
      elements.notebookTableSizeColumns?.select?.();
    }
  }

  function onDocumentClickForTableSizeDialog(event) {
    if (!isTableSizeDialogOpen()) {
      return;
    }
    const target = event?.target;
    const insidePopover = typeof elements.notebookTableSizeOverlay?.contains === 'function'
      && elements.notebookTableSizeOverlay.contains(target);
    const onAnchor = typeof elements.notebookAddTableBtn?.contains === 'function'
      && (target === elements.notebookAddTableBtn || elements.notebookAddTableBtn.contains(target));
    if (!insidePopover && !onAnchor) {
      setTableSizeDialog(false);
    }
  }
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
  elements.notebookAddGelBtn?.addEventListener('click', () => {
    toolSidebarController.clearSelection();
    void linkedWorkActions.onAddGelClick();
  });
  elements.notebookAddSamplesBtn?.addEventListener('click', () => {
    toolSidebarController.clearSelection();
    quickSampleController.open();
  });
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
    document.addEventListener('click', onDocumentClickForTableSizeDialog);
    document.addEventListener('click', onDocumentClickForSampleLinkMenu);
    document.addEventListener('keydown', onDocumentKeydownForSampleLinkMenu);
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('resize', sampleLinkMenu.close);
    window.addEventListener('resize', () => setTableSizeDialog(false));
  }

  return { cancelEdit };
}

export { bindNotebookEvents };
