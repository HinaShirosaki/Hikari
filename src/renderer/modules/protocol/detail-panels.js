import { exportProtocolPdf } from '../pdf-export/index.js';
import { logNotebookPageEvent } from '../biology-notebook/storage/page-log.js';

// Switching the protocol detail column between empty / editor / view, plus the
// create, edit, view, export, print, and delete actions those panels drive.
function createProtocolDetailPanels({
  ui,
  localState,
  draftHelpers,
  previewHelpers,
  getSelectedProtocol,
  setSelectedProtocol,
  markDraftSaved,
  setDraftRequiresSave,
  getListController,
  getImportController,
  getPolishController,
  getGenerationController,
  renderPlaceholderPresets,
  state,
  persist,
  onProtocolsChanged,
  selectionInsightsController
} = {}) {
  function applyDetailMode(nextMode) {
    localState.protocolDetailMode = nextMode;
    if (ui.protocolDetailPanel) {
      ui.protocolDetailPanel.dataset.mode = nextMode;
    }
    if (ui.protocolEmptyPanel) {
      ui.protocolEmptyPanel.hidden = nextMode !== 'empty';
    }
    if (ui.protocolEditorPanel) {
      ui.protocolEditorPanel.hidden = nextMode !== 'edit';
    }
    if (ui.protocolViewPanel) {
      ui.protocolViewPanel.hidden = nextMode !== 'view';
    }
  }

  function resetEditorDraft() {
    getPolishController()?.closeProtocolPolishOverlay();
    getGenerationController()?.closeAllProtocolGenerationOverlays({ resetComposer: true });
    localState.currentProtocolDraft = draftHelpers.createEmptyDraft();
    ui.protocolForm?.reset();
    getImportController()?.resetProtocolJsonImportUi();
  }

  function showEmptyPanel({ resetEditor = false } = {}) {
    if (resetEditor) {
      resetEditorDraft();
    }
    applyDetailMode('empty');
  }

  function showEditorPanel() {
    renderPlaceholderPresets?.();
    applyDetailMode('edit');
    getImportController()?.syncProtocolImportPanelVisibility();
  }

  function showViewPanel() {
    applyDetailMode('view');
  }

  function renderProtocolView(protocol) {
    if (!ui.protocolViewTitle || !ui.protocolViewContent) {
      return;
    }
    ui.protocolViewTitle.textContent = protocol.name || 'Protocol';
    ui.protocolViewContent.innerHTML = previewHelpers.buildProtocolPreviewMarkup(protocol);
    selectionInsightsController?.refreshHost?.('protocol-view');
  }

  function syncSelectionAfterMutation() {
    if (localState.protocolDetailMode === 'edit' && !localState.currentProtocolDraft.id) {
      return;
    }

    const selectedProtocol = getSelectedProtocol();
    if (selectedProtocol) {
      if (localState.protocolDetailMode === 'view') {
        renderProtocolView(selectedProtocol);
      }
      return;
    }

    if (!state.protocols.length) {
      setSelectedProtocol('');
      showEmptyPanel({ resetEditor: localState.protocolDetailMode === 'edit' });
      return;
    }

    setSelectedProtocol('');
    showEmptyPanel({ resetEditor: localState.protocolDetailMode === 'edit' });
  }

  function openEditorWithDraft(protocol, headingText, options = {}) {
    localState.isCreateEditorMode = options.isCreateMode !== false;
    localState.currentProtocolDraft = draftHelpers.cloneDraftFromProtocol(protocol);

    if (localState.isCreateEditorMode) {
      getImportController()?.resetProtocolJsonImportUi();
    }
    if (ui.protocolEditorHeading) {
      ui.protocolEditorHeading.textContent = headingText;
    }

    previewHelpers.populateEditorFormFromDraft(ui, localState.currentProtocolDraft);
    getGenerationController()?.syncProtocolGenerateButtonVisibility();
    showEditorPanel();
    markDraftSaved();
    setDraftRequiresSave(options.requiresSave === true);
    ui.protocolNameInput?.focus();
  }

  function onCreateProtocol() {
    setSelectedProtocol('');
    openEditorWithDraft(draftHelpers.createEmptyDraft(), 'Create Protocol', { isCreateMode: true });
  }

  function editProtocol(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }
    setSelectedProtocol(protocol.id);
    getListController()?.renderList?.();
    openEditorWithDraft(protocol, 'Edit Protocol', { isCreateMode: false });
  }

  function viewProtocol(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }
    setSelectedProtocol(protocol.id);
    getListController()?.renderList?.();
    renderProtocolView(protocol);
    showViewPanel();
  }

  function onExportProtocol(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (protocol) {
      exportProtocolPdf(protocol);
    }
  }

  function onExportViewedProtocolPdf() {
    const protocol = getSelectedProtocol();
    if (protocol) {
      exportProtocolPdf(protocol);
    }
  }

  function onEditViewedProtocol() {
    const protocol = getSelectedProtocol();
    if (protocol) {
      editProtocol(protocol.id);
    }
  }

  function onPrintViewedProtocol() {
    const protocol = getSelectedProtocol();
    if (protocol) {
      exportProtocolPdf(protocol, { print: true });
    }
  }

  function deleteProtocol(protocolId) {
    const now = new Date().toISOString();
    const deletedEntries = state.notebookEntries.filter((entry) => entry.protocolId === protocolId);
    const deletedEntryIds = new Set(deletedEntries.map((entry) => entry.id));

    state.protocols = state.protocols.filter((item) => item.id !== protocolId);
    state.notebookEntries = state.notebookEntries.filter((entry) => entry.protocolId !== protocolId);
    state.workflows = (state.workflows || []).map((workflow) => {
      const blocks = (workflow.blocks || []).filter((block) => block.protocolId !== protocolId);
      if (blocks.length === (workflow.blocks || []).length) {
        return workflow;
      }
      const validBlockIds = new Set(blocks.map((block) => block.id));
      const links = (workflow.links || []).filter((link) => (
        validBlockIds.has(link.fromBlockId)
        && validBlockIds.has(link.toBlockId)
        && link.fromBlockId !== link.toBlockId
      ));
      return { ...workflow, blocks, links, updatedAt: now };
    });
    state.workflowTemplates = (state.workflowTemplates || []).map((template) => {
      const blocks = (template.blocks || []).filter((block) => block.protocolId !== protocolId);
      if (blocks.length === (template.blocks || []).length) {
        return template;
      }
      const validBlockIds = new Set(blocks.map((block) => block.id));
      const links = (template.links || []).filter((link) => (
        validBlockIds.has(link.fromBlockId)
        && validBlockIds.has(link.toBlockId)
        && link.fromBlockId !== link.toBlockId
      ));
      return { ...template, blocks, links, updatedAt: now };
    });

    if (deletedEntryIds.size) {
      state.assays = (state.assays || []).map((assay) => (
        deletedEntryIds.has(assay.notebookEntryId)
          ? { ...assay, notebookEntryId: '', notebookEntryProtocolName: '', notebookEntryType: '', updatedAt: new Date().toISOString() }
          : assay
      ));
      state.gelAnalyses = (state.gelAnalyses || []).map((analysis) => (
        deletedEntryIds.has(analysis.notebookEntryId)
          ? { ...analysis, notebookEntryId: '', notebookEntryProtocolName: '', notebookEntryType: '', updatedAt: new Date().toISOString() }
          : analysis
      ));
    }

    persist();
    // The page folder and its page.log outlive the entry, so without this the
    // trail just stops mid-story and a deleted page looks like a crash.
    deletedEntries.forEach((entry) => {
      logNotebookPageEvent({
        entry,
        storagePath: state.settings?.storagePath,
        action: 'delete',
        summary: `Deleted notebook page${entry.experimentName ? ` "${entry.experimentName}"` : ''} with its protocol`,
        details: {
          reason: 'protocol-deleted',
          protocolId,
          protocolName: entry.protocolName || '',
          experimentName: entry.experimentName || '',
          notebookState: entry.notebookState || '',
          executedAt: entry.executedAt || ''
        }
      });
    });
    getListController().renderList();
    if (localState.activeProtocolId === protocolId) {
      setSelectedProtocol('');
    }
    syncSelectionAfterMutation();
    onProtocolsChanged?.();
  }

  return {
    applyDetailMode,
    resetEditorDraft,
    showEmptyPanel,
    showEditorPanel,
    showViewPanel,
    renderProtocolView,
    syncSelectionAfterMutation,
    openEditorWithDraft,
    onCreateProtocol,
    editProtocol,
    viewProtocol,
    onExportProtocol,
    onExportViewedProtocolPdf,
    onEditViewedProtocol,
    onPrintViewedProtocol,
    deleteProtocol
  };
}

export { createProtocolDetailPanels };
