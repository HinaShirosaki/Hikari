import { exportProtocolPdf } from '../pdf-export/index.js';
import { printElement } from '../print/index.js';
import { requestLlmText } from '../direct-llm.js';
import { parseJsonFromText } from '../papers/normalizers.js';
import { DEFAULT_PROTOCOL_JSON_IMPORT_STATUS, DEFAULT_SHARE_STATUS, PLACEHOLDER_TOKEN_REGEX } from './constants.js';
import { getProtocolDom } from './dom.js';
import { createProtocolDraftHelpers } from './draft-utils.js';
import { createProtocolImportController } from './import-controller.js';
import { createProtocolPreviewHelpers } from './preview.js';
import { createProtocolSharingController } from './sharing.js';
import { createProtocolListController } from './list.js';
import { createProtocolPolishController } from './polish.js';
import { createProtocolGenerationController } from './generation.js';
import { createProtocolEditorHelpers } from './editor-utils.js';
import { serializeDraftSnapshot, snapshotFormControls } from '../unsaved-draft.js';

export function initProtocolManagement({
  state,
  persist,
  createId,
  safeText,
  onProtocolsChanged,
  trackGrowthEvent,
  selectionInsightsController = null,
  __globals = {}
}) {
  const documentRef = __globals.document || globalThis.document;
  const windowObject = __globals.windowObject || globalThis.window || null;
  const api = __globals.hikariApi || windowObject?.hikariApi || globalThis.hikariApi || null;
  const navigatorRef = __globals.navigator || globalThis.navigator || null;
  const FileReaderClass = __globals.FileReader || globalThis.FileReader || null;
  const TextEncoderClass = __globals.TextEncoder || globalThis.TextEncoder || null;
  const btoaFn = __globals.btoa || globalThis.btoa || null;
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
    activeShareProtocolId: '',
    activeShareTargetEmail: '',
    protocolSortField: 'time',
    protocolSortOrder: 'asc',
    activeProtocolId: '',
    protocolDetailMode: 'empty',
    isCreateEditorMode: true,
    polishedProtocolDraft: null,
    protocolPolishSourceDraft: null,
    protocolPolishRequestToken: 0,
    isProtocolPolishPending: false,
    generatedProtocolDraft: null,
    protocolGenerationRequestToken: 0,
    isProtocolGenerationPending: false
  };
  const editorHelpers = createProtocolEditorHelpers({ ui, localState, draftHelpers });

  let listController = null;
  let sharingController = null;
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
    polishController?.closeProtocolPolishOverlay();
    generationController?.closeAllProtocolGenerationOverlays({ resetComposer: true });
    localState.currentProtocolDraft = draftHelpers.createEmptyDraft();
    ui.protocolForm?.reset();
    importController?.resetProtocolJsonImportUi();
  }

  function showEmptyPanel({ resetEditor = false } = {}) {
    if (resetEditor) {
      resetEditorDraft();
    }
    applyDetailMode('empty');
  }

  function showEditorPanel() {
    applyDetailMode('edit');
    importController?.syncProtocolImportPanelVisibility();
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

  function onCancelEditor() {
    const selectedProtocol = getSelectedProtocol();
    if (selectedProtocol) {
      renderProtocolView(selectedProtocol);
      showViewPanel();
      return;
    }
    showEmptyPanel({ resetEditor: true });
  }

  function openEditorWithDraft(protocol, headingText, options = {}) {
    localState.isCreateEditorMode = options.isCreateMode !== false;
    localState.currentProtocolDraft = draftHelpers.cloneDraftFromProtocol(protocol);

    if (localState.isCreateEditorMode) {
      importController?.resetProtocolJsonImportUi();
    }
    if (ui.protocolEditorHeading) {
      ui.protocolEditorHeading.textContent = headingText;
    }

    previewHelpers.populateEditorFormFromDraft(ui, localState.currentProtocolDraft);
    generationController?.syncProtocolGenerateButtonVisibility();
    showEditorPanel();
    markDraftSaved();
    draftRequiresSave = options.requiresSave === true;
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
    listController?.renderList?.();
    openEditorWithDraft(protocol, 'Edit Protocol', { isCreateMode: false });
  }

  function viewProtocol(protocolId) {
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!protocol) {
      return;
    }
    setSelectedProtocol(protocol.id);
    listController?.renderList?.();
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

  function onPrintViewedProtocol() {
    const protocol = getSelectedProtocol();
    if (!protocol || !ui.protocolViewContent) {
      return;
    }
    const name = String(protocol.name || 'Protocol').trim() || 'Protocol';
    const header = `<h1>${safeText(name)}</h1>`;
    const body = `${header}${ui.protocolViewContent.innerHTML}`;
    printElement(
      (() => {
        const wrapper = documentRef.createElement('div');
        wrapper.innerHTML = body;
        return wrapper;
      })(),
      { title: `Protocol - ${name}` }
    );
  }

  function deleteProtocol(protocolId) {
    const now = new Date().toISOString();
    const deletedEntryIds = new Set(
      state.notebookEntries
        .filter((entry) => entry.protocolId === protocolId)
        .map((entry) => entry.id)
    );

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
    listController.renderList();
    sharingController.setShareLinkOutput('');
    if (localState.activeProtocolId === protocolId) {
      setSelectedProtocol('');
    }
    syncSelectionAfterMutation();
    onProtocolsChanged?.();
  }

  function addInteractivePlaceholderToken(placeholderName = '') {
    const placeholder = String(placeholderName || ui.placeholderNameInput?.value || '').trim();
    if (!placeholder || !ui.protocolStepsInput) {
      return;
    }
    editorHelpers.insertTokenAtCursor(ui.protocolStepsInput, `[${placeholder}]`);
    if (ui.placeholderNameInput) {
      ui.placeholderNameInput.value = '';
    }
  }

  function onProtocolSubmit(event) {
    event.preventDefault();

    const editorDraft = editorHelpers.buildDraftFromEditorInputs();
    if (!editorDraft.name || !editorDraft.steps.length) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const createdAt = draftHelpers.normalizeIsoTimestamp(localState.currentProtocolDraft.createdAt, nowIso);
    const existingProtocol = state.protocols.find((item) => item.id === localState.currentProtocolDraft.id) || null;
    const protocol = {
      id: localState.currentProtocolDraft.id || createId(),
      name: editorDraft.name,
      purpose: editorDraft.purpose,
      materials: editorDraft.materials,
      steps: editorDraft.steps,
      troubleshooting: editorDraft.troubleshooting,
      createdAt,
      updatedAt: nowIso,
      selectionInsights: cloneSelectionInsights(existingProtocol?.selectionInsights)
    };

    const index = state.protocols.findIndex((item) => item.id === protocol.id);
    if (index >= 0) {
      state.protocols[index] = protocol;
    } else {
      state.protocols.push(protocol);
    }

    persist();
    setSelectedProtocol(protocol.id);
    renderProtocolView(protocol);
    listController.renderList();
    onProtocolsChanged?.();
    resetEditorDraft();
    showViewPanel();
    markDraftSaved();
    return protocol;
  }

  function addDraftFromExtractedMethod(method, source) {
    const protocolShapeCandidate = Array.isArray(method) ? method.find((item) => item && typeof item === 'object') : method;
    const methodTitle = String(protocolShapeCandidate?.title || protocolShapeCandidate?.name || 'Extracted Method').trim();
    const sourceTitle = String(source?.title || 'Paper').trim();
    const steps = Array.isArray(protocolShapeCandidate?.steps) ? protocolShapeCandidate.steps : [];
    const citations = Array.isArray(protocolShapeCandidate?.citations) ? protocolShapeCandidate.citations.filter(Boolean) : [];
    const purpose = String(protocolShapeCandidate?.purpose || '').trim();
    const materials = draftHelpers.normalizeMaterials(protocolShapeCandidate?.materials);
    const troubleshooting = draftHelpers.normalizeTroubleshooting(protocolShapeCandidate?.troubleshooting);
    const convertedSteps = draftHelpers.normalizeMethodStepEntries(steps);

    if (citations.length) {
      convertedSteps.unshift({ id: createId(), text: `Source citation(s): ${citations.join('; ')}`, placeholders: [] });
    }
    if (!convertedSteps.length) {
      return false;
    }

    openEditorWithDraft({
      id: null,
      name: `${sourceTitle} - ${methodTitle}`.trim(),
      purpose,
      materials,
      steps: convertedSteps,
      troubleshooting
    }, 'Create Protocol', { isCreateMode: true, requiresSave: true });
    return true;
  }

  sharingController = createProtocolSharingController({
    state,
    persist,
    createId,
    trackGrowthEvent,
    ui,
    localState,
    defaultShareStatus: DEFAULT_SHARE_STATUS,
    navigatorRef,
    TextEncoderClass,
    btoaFn,
    normalizeMaterials: draftHelpers.normalizeMaterials,
    getStepText: draftHelpers.getStepText,
    normalizeIsoTimestamp: draftHelpers.normalizeIsoTimestamp,
    renderList: () => listController?.renderList?.()
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
    renderList: () => listController?.renderList?.(),
    defaultProtocolJsonImportStatus: DEFAULT_PROTOCOL_JSON_IMPORT_STATUS
  });

  listController = createProtocolListController({
    state,
    persist,
    ui,
    localState,
    safeText,
    getShareTargetEmails: sharingController.getShareTargetEmails,
    defaultShareStatus: DEFAULT_SHARE_STATUS,
    normalizeIsoTimestamp: draftHelpers.normalizeIsoTimestamp,
    parseTimestamp: draftHelpers.parseTimestamp,
    onViewProtocol: viewProtocol,
    onEditProtocol: editProtocol,
    onDeleteProtocol: deleteProtocol,
    onExportProtocol,
    onShareProtocolConfirm: sharingController.shareProtocol,
    onCopyProtocolLink: sharingController.copyProtocolShareLink,
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
  ui.protocolCancelBtn?.addEventListener('click', onCancelEditor);
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
  ui.addPlaceholderBtn?.addEventListener('click', addInteractivePlaceholderToken);
  ui.placeholderPresetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const placeholder = String(button.dataset.protocolPlaceholderPreset || '').trim();
      if (placeholder) addInteractivePlaceholderToken(placeholder);
    });
  });
  ui.protocolSortFieldBtn?.addEventListener('click', () => {
    localState.protocolSortField = localState.protocolSortField === 'time' ? 'name' : 'time';
    listController.updateSortButtonLabels();
    listController.renderList();
  });
  ui.protocolSortOrderBtn?.addEventListener('click', () => {
    localState.protocolSortOrder = localState.protocolSortOrder === 'asc' ? 'desc' : 'asc';
    listController.updateSortButtonLabels();
    listController.renderList();
  });
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

  sharingController.setShareStatus(DEFAULT_SHARE_STATUS);
  if (ui.protocolJsonImportStatus && !String(ui.protocolJsonImportStatus.textContent || '').trim()) ui.protocolJsonImportStatus.textContent = DEFAULT_PROTOCOL_JSON_IMPORT_STATUS;
  listController.updateSortButtonLabels();
  generationController.syncProtocolGenerateButtonVisibility();
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
    renderShareTargets: sharingController.renderShareTargets,
    saveUnsavedChanges: async () => {
      const protocol = onProtocolSubmit({ preventDefault() {} });
      return Boolean(protocol) && localState.protocolDetailMode !== 'edit';
    }
  };
}
