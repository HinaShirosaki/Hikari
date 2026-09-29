import { requestLlmText } from '../../services/direct-llm.js';
import { parseJsonFromText } from '../../lib/json.js';
import { PLACEHOLDER_TOKEN_REGEX } from './constants.js';
import { getProtocolDom } from './dom.js';
import { createProtocolDraftHelpers } from './draft-utils.js';
import { createProtocolImportController } from './import-controller.js';
import { createProtocolPreviewHelpers } from './preview.js';
import { createProtocolListController } from './list.js';
import { createProtocolPolishController } from './polish.js';
import { createProtocolGenerationController } from './generation.js';
import { createProtocolEditorHelpers } from './editor-utils.js';
import { serializeDraftSnapshot, snapshotFormControls } from '../../lib/unsaved-draft.js';
import { createProtocolDetailPanels } from './detail-panels.js';
import { createProtocolEditorActions } from './editor-actions.js';
import { renderProtocolPlaceholderPresetButtons } from './placeholder-presets.js';

// Protocol list + editor. The right panel is in one mode at a time
// (localState.protocolDetailMode: 'empty' | 'view' | 'edit'). Polish (one-shot
// LLM rewrite) and Generate (agent run with web/literature research) only fill
// the editor form; nothing is saved until the user submits it.
export function initProtocolManagement({
  state,
  persist,
  createId,
  safeText,
  onProtocolsChanged,
  logNotebookPageEvent,
  selectionInsightsController = null,
  __globals = {}
}) {
  const documentRef = __globals.document || globalThis.document;
  const windowObject = __globals.windowObject || globalThis.window || null;
  const api = __globals.hikariApi || windowObject?.hikariApi || globalThis.hikariApi || null;
  const FileReaderClass = __globals.FileReader || globalThis.FileReader || null;
  const ui = getProtocolDom(documentRef);
  const draftHelpers = createProtocolDraftHelpers({ createId, placeholderTokenRegex: PLACEHOLDER_TOKEN_REGEX });
  const previewHelpers = createProtocolPreviewHelpers({
    safeText,
    getStepText: draftHelpers.getStepText,
    normalizeMaterials: draftHelpers.normalizeMaterials,
    formatBulletLines: draftHelpers.formatBulletLines,
    formatStepLines: draftHelpers.formatStepLines
  });

  const localState = {
    currentProtocolDraft: draftHelpers.createEmptyDraft(),
    activeMenuProtocolId: '',
    protocolSortField: 'time',
    protocolSortOrder: 'asc',
    activeProtocolId: '',
    protocolDetailMode: 'empty',
    isCreateEditorMode: true,
    polishedProtocolDraft: null,
    protocolPolishSourceDraft: null,
    // Bumped per request and on close; a reply whose token no longer matches
    // is stale and dropped (see polish.js / generation.js).
    protocolPolishRequestToken: 0,
    isProtocolPolishPending: false,
    generatedProtocolDraft: null,
    protocolGenerationRequestToken: 0,
    isProtocolGenerationPending: false
  };
  const editorHelpers = createProtocolEditorHelpers({ ui, localState, draftHelpers });

  let listController = null;
  let importController = null;
  let polishController = null;
  let generationController = null;
  let savedDraftSnapshot = '';
  let draftRequiresSave = false;

  function getCurrentDraftSnapshot() {
    if (localState.protocolDetailMode !== 'edit') {
      return '';
    }
    return serializeDraftSnapshot({
      draftId: localState.currentProtocolDraft.id || '',
      isCreateMode: localState.isCreateEditorMode,
      controls: snapshotFormControls(ui.protocolForm)
    });
  }

  function markDraftSaved() {
    savedDraftSnapshot = getCurrentDraftSnapshot();
    draftRequiresSave = false;
  }

  function cloneSelectionInsights(insights) {
    try {
      return Array.isArray(insights)
        ? JSON.parse(JSON.stringify(
          insights.filter((item) => item && typeof item === 'object')
        ))
        : [];
    } catch {
      return [];
    }
  }

  function updateProtocolRecord(protocolId, updater) {
    const index = state.protocols.findIndex((item) => String(item?.id || '') === String(protocolId || '').trim());
    if (index < 0 || typeof updater !== 'function') {
      return null;
    }
    const nextProtocol = updater(state.protocols[index]);
    if (!nextProtocol || typeof nextProtocol !== 'object') {
      return null;
    }
    state.protocols[index] = nextProtocol;
    persist();
    return nextProtocol;
  }

  function setSelectedProtocol(protocolId = '') {
    localState.activeProtocolId = String(protocolId || '').trim();
  }

  function getSelectedProtocol() {
    if (!localState.activeProtocolId) {
      return null;
    }
    return state.protocols.find((item) => String(item?.id || '') === localState.activeProtocolId) || null;
  }

  function renderPlaceholderPresets() {
    return renderProtocolPlaceholderPresetButtons(
      ui.protocolPlaceholderPresets,
      state.settings,
      safeText
    );
  }

  const {
    applyDetailMode,
    resetEditorDraft,
    showEmptyPanel,
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
  } = createProtocolDetailPanels({
    ui,
    localState,
    draftHelpers,
    previewHelpers,
    getSelectedProtocol,
    setSelectedProtocol,
    markDraftSaved,
    setDraftRequiresSave: (value) => { draftRequiresSave = value; },
    getListController: () => listController,
    getImportController: () => importController,
    getPolishController: () => polishController,
    getGenerationController: () => generationController,
    renderPlaceholderPresets,
    state,
    persist,
    onProtocolsChanged,
    logNotebookPageEvent,
    selectionInsightsController
  });


  const {
    addInteractivePlaceholderToken,
    onProtocolSubmit,
    addDraftFromExtractedMethod
  } = createProtocolEditorActions({
    ui,
    state,
    persist,
    createId,
    localState,
    draftHelpers,
    editorHelpers,
    markDraftSaved,
    setSelectedProtocol,
    cloneSelectionInsights,
    onProtocolsChanged,
    openEditorWithDraft,
    showViewPanel,
    renderProtocolView,
    resetEditorDraft,
    getListController: () => listController
  });

  importController = createProtocolImportController({
    state,
    persist,
    createId,
    ui,
    localState,
    FileReaderClass,
    parseProtocolsFromJson: draftHelpers.parseProtocolsFromJson,
    onProtocolsChanged,
    renderList: () => listController?.renderList?.()
  });

  listController = createProtocolListController({
    state,
    persist,
    ui,
    localState,
    safeText,
    normalizeIsoTimestamp: draftHelpers.normalizeIsoTimestamp,
    parseTimestamp: draftHelpers.parseTimestamp,
    onViewProtocol: viewProtocol,
    onEditProtocol: editProtocol,
    onDeleteProtocol: deleteProtocol,
    onExportProtocol,
    syncSelectionAfterMutation
  });

  polishController = createProtocolPolishController({
    state,
    ui,
    localState,
    requestLlmText,
    parseJsonFromText,
    cloneDraftFromProtocol: draftHelpers.cloneDraftFromProtocol,
    sanitizeIncomingProtocol: draftHelpers.sanitizeIncomingProtocol,
    normalizeMaterials: draftHelpers.normalizeMaterials,
    stepToEditableLine: draftHelpers.stepToEditableLine,
    renderProtocolPreviewInto: previewHelpers.renderProtocolPreviewInto,
    renderProtocolPolishEmptyState: previewHelpers.renderProtocolPolishEmptyState,
    renderProtocolPolishLoadingState: previewHelpers.renderProtocolPolishLoadingState,
    populateEditorFormFromDraft: (draft) => previewHelpers.populateEditorFormFromDraft(ui, draft),
    buildDraftFromEditorInputs: editorHelpers.buildDraftFromEditorInputs
  });

  generationController = createProtocolGenerationController({
    state,
    ui,
    localState,
    safeText,
    api,
    FileReaderClass,
    cloneDraftFromProtocol: draftHelpers.cloneDraftFromProtocol,
    sanitizeIncomingProtocol: draftHelpers.sanitizeIncomingProtocol,
    normalizeMaterials: draftHelpers.normalizeMaterials,
    stepToEditableLine: draftHelpers.stepToEditableLine,
    renderProtocolPreviewInto: previewHelpers.renderProtocolPreviewInto,
    renderProtocolPolishEmptyState: previewHelpers.renderProtocolPolishEmptyState,
    renderProtocolPolishLoadingState: previewHelpers.renderProtocolPolishLoadingState,
    populateEditorFormFromDraft: (draft) => previewHelpers.populateEditorFormFromDraft(ui, draft),
    buildDraftFromEditorInputs: editorHelpers.buildDraftFromEditorInputs
  });

  ui.createProtocolBtn?.addEventListener('click', onCreateProtocol);
  ui.emptyCreateProtocolBtn?.addEventListener('click', onCreateProtocol);
  ui.protocolEditorBackBtn?.addEventListener('click', () => showEmptyPanel({ resetEditor: true }));
  ui.protocolViewBackBtn?.addEventListener('click', () => showEmptyPanel({ resetEditor: false }));
  ui.protocolGenerateBtn?.addEventListener('click', generationController.openProtocolGenerateInputOverlay);
  ui.protocolGenerateCloseBtn?.addEventListener('click', () => generationController.closeProtocolGenerateInputOverlay({ resetComposer: false }));
  ui.protocolGenerateAttachBtn?.addEventListener('click', () => {
    ui.protocolGenerateAttachmentInput?.click();
  });
  ui.protocolGenerateAttachmentInput?.addEventListener('change', (event) => {
    void generationController.handleAttachmentSelection(event?.target?.files || []);
  });
  ui.protocolGenerateSendBtn?.addEventListener('click', () => {
    void generationController.onGenerateProtocol();
  });
  ui.protocolGeneratePromptInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void generationController.onGenerateProtocol();
  });
  ui.protocolGenerateAttachmentList?.addEventListener('click', (event) => {
    const target = event?.target;
    const removeButton = target && typeof target.closest === 'function'
      ? target.closest('[data-protocol-generate-remove-attachment]')
      : target;
    const attachmentId = String(
      removeButton?.getAttribute?.('data-protocol-generate-remove-attachment')
        || removeButton?.dataset?.protocolGenerateRemoveAttachment
        || ''
    ).trim();
    if (!attachmentId) {
      return;
    }
    generationController.removeComposerAttachment(attachmentId);
  });
  ui.protocolGenerateResultCloseBtn?.addEventListener('click', () => generationController.closeProtocolGenerateResultOverlay({ preserveComposer: true }));
  ui.protocolGenerateBackBtn?.addEventListener('click', () => generationController.closeProtocolGenerateResultOverlay({ preserveComposer: true }));
  ui.protocolGenerateApplyBtn?.addEventListener('click', generationController.applyGeneratedProtocolToEditor);
  ui.protocolGenerateInputOverlay?.addEventListener('click', (event) => {
    if (event.target === ui.protocolGenerateInputOverlay) {
      generationController.closeProtocolGenerateInputOverlay({ resetComposer: false });
    }
  });
  ui.protocolGenerateResultOverlay?.addEventListener('click', (event) => {
    if (event.target === ui.protocolGenerateResultOverlay) {
      generationController.closeProtocolGenerateResultOverlay({ preserveComposer: true });
    }
  });
  ui.protocolPolishBtn?.addEventListener('click', () => { void polishController.onPolishProtocol(); });
  ui.protocolPolishCloseBtn?.addEventListener('click', polishController.closeProtocolPolishOverlay);
  ui.protocolPolishKeepEditingBtn?.addEventListener('click', polishController.closeProtocolPolishOverlay);
  ui.protocolPolishApplyBtn?.addEventListener('click', polishController.applyPolishedProtocolToEditor);
  ui.protocolPolishOverlay?.addEventListener('click', (event) => {
    if (event.target === ui.protocolPolishOverlay) {
      polishController.closeProtocolPolishOverlay();
    }
  });

  ui.protocolForm?.addEventListener('submit', onProtocolSubmit);
  ui.protocolMaterialsInput?.addEventListener('focus', () => editorHelpers.ensureLeadingBullet(ui.protocolMaterialsInput));
  ui.protocolMaterialsInput?.addEventListener('keydown', editorHelpers.onBulletTextareaKeydown);
  ui.protocolMaterialsInput?.addEventListener('blur', () => editorHelpers.normalizeBulletTextarea(ui.protocolMaterialsInput));
  ui.protocolStepsInput?.addEventListener('focus', () => editorHelpers.ensureLeadingBullet(ui.protocolStepsInput));
  ui.protocolStepsInput?.addEventListener('keydown', editorHelpers.onBulletTextareaKeydown);
  ui.protocolStepsInput?.addEventListener('blur', () => editorHelpers.normalizeBulletTextarea(ui.protocolStepsInput));
  ui.addPlaceholderBtn?.addEventListener('click', () => addInteractivePlaceholderToken());
  ui.protocolPlaceholderPresets?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-protocol-placeholder-preset]') || event.target;
    const placeholder = String(button?.dataset?.protocolPlaceholderPreset || '').trim();
    if (placeholder) {
      addInteractivePlaceholderToken(placeholder);
    }
  });
  ui.protocolSearch?.addEventListener('input', () => {
    localState.activeMenuProtocolId = '';
    listController.renderList();
  });
  ui.protocolSearch?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      ui.protocolSearch.value = '';
      listController.renderList();
    }
  });
  ui.protocolViewEditBtn?.addEventListener('click', onEditViewedProtocol);
  ui.protocolExportPdfBtn?.addEventListener('click', onExportViewedProtocolPdf);
  ui.protocolPrintBtn?.addEventListener('click', onPrintViewedProtocol);
  ui.openProtocolJsonImportBtn?.addEventListener('click', importController.openProtocolJsonImportOverlay);
  ui.protocolJsonImportCloseBtn?.addEventListener('click', importController.closeProtocolJsonImportOverlay);
  ui.importProtocolJsonBtn?.addEventListener('click', importController.onImportProtocolJson);
  ui.protocolJsonImportOverlay?.addEventListener('click', (event) => {
    if (event.target === ui.protocolJsonImportOverlay) {
      importController.closeProtocolJsonImportOverlay();
    }
  });

  generationController.syncProtocolGenerateButtonVisibility();
  renderPlaceholderPresets();
  applyDetailMode('empty');
  selectionInsightsController?.registerHost?.({
    key: 'protocol-view',
    host: ui.protocolViewContent,
    getContext: () => {
      const protocol = getSelectedProtocol();
      if (!protocol || localState.protocolDetailMode !== 'view') {
        return null;
      }
      return {
        kind: 'protocol',
        record: protocol,
        storagePath: String(state.settings?.storagePath || '').trim(),
        insights: cloneSelectionInsights(protocol.selectionInsights),
        updateRecord: (updater) => updateProtocolRecord(protocol.id, (currentProtocol) => {
          const nextProtocol = updater(currentProtocol);
          return nextProtocol && typeof nextProtocol === 'object' ? nextProtocol : currentProtocol;
        })
      };
    }
  });

  documentRef?.addEventListener?.('click', (event) => {
    if (!localState.activeMenuProtocolId) {
      return;
    }
    const target = event.target;
    const hasNode = typeof Node !== 'undefined';
    const hasElement = typeof Element !== 'undefined';
    if (hasNode && target instanceof Node && ui.protocolList?.contains?.(target)) {
      const trigger = hasElement && target instanceof Element
        ? target.closest('[data-protocol-menu-trigger], .protocol-action-menu')
        : null;
      if (trigger) {
        return;
      }
    }
    localState.activeMenuProtocolId = '';
    listController.renderList();
  });

  documentRef?.addEventListener?.('keydown', (event) => {
    if (event.key === 'Escape' && ui.protocolJsonImportOverlay && !ui.protocolJsonImportOverlay.hidden) {
      importController.closeProtocolJsonImportOverlay();
      return;
    }
    if (event.key === 'Escape' && ui.protocolGenerateInputOverlay && !ui.protocolGenerateInputOverlay.hidden) {
      generationController.closeProtocolGenerateInputOverlay({ resetComposer: false });
      return;
    }
    if (event.key === 'Escape' && ui.protocolGenerateResultOverlay && !ui.protocolGenerateResultOverlay.hidden) {
      generationController.closeProtocolGenerateResultOverlay({ preserveComposer: true });
      return;
    }
    if (event.key === 'Escape' && ui.protocolPolishOverlay && !ui.protocolPolishOverlay.hidden) {
      polishController.closeProtocolPolishOverlay();
      return;
    }
    if (event.key === 'Escape' && localState.activeMenuProtocolId) {
      localState.activeMenuProtocolId = '';
      listController.renderList();
    }
  });

  return {
    addDraftFromExtractedMethod,
    editProtocol,
    hasUnsavedChanges: () => Boolean(
      localState.protocolDetailMode === 'edit'
      && savedDraftSnapshot
      && (draftRequiresSave || getCurrentDraftSnapshot() !== savedDraftSnapshot)
    ),
    importProtocolsFromJson: importController.importProtocolsFromJson,
    renderList: listController.renderList,
    renderPlaceholderPresets,
    saveUnsavedChanges: async () => {
      const protocol = onProtocolSubmit({ preventDefault() {} });
      return Boolean(protocol) && localState.protocolDetailMode !== 'edit';
    }
  };
}
