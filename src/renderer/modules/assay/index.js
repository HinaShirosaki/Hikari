import { createAnalyzeWorkspace } from './workspace/analyze-workspace.js';
import { createPlotAgentController } from './plotly/plot-agent-controller.js';
import { showTransientNotice } from '../../lib/notify.js';
import { getAssayElements } from './dom.js';
import { createAssayLayoutManager } from './layout-manager.js';
import { createAssayResultsManager } from './results-manager.js';
import { createAssayAnalysisView } from './analysis-view.js';
import { createAssayArtifactStorage } from './artifact-storage.js';
import {
  previewNextAssayNumber
} from './numbering.js';
import {
  getPlateDefinition,
  normalizeResults
} from './plate-model.js';
import { createAssayAgentContext } from './agent/context.js';
import { bindAssayEvents } from './ui/event-bindings.js';
import { createAssayBrowserView } from './ui/browser-view.js';
import { serializeDraftSnapshot, snapshotFormControls } from '../../lib/unsaved-draft.js';
import { createAssayFormAndList } from './workspace/form-and-list.js';
import { createAssayNotebookLinks } from './workspace/notebook-links.js';

export function initAssay({
  state,
  persist,
  createId,
  safeText,
  onAssaysChanged,
  onActiveAssayChanged,
  onAssayModeChanged
}) {
  const TabulatorLib = window.Tabulator || null;
  const elements = getAssayElements(document);
  const runtime = {
    currentLayout: [],
    currentResults: {},
    assayMode: 'create',
    activeResultsAssayId: '',
    activeWellEditorId: '',
    axisTemplateValues: { sampleValues: [], concentrationValues: [] },
    plateEditField: 'sampleId',
    concentrationUnit: '',
    manualWellOverrides: {},
    suppressedWells: new Set(),
    resultPasteAnchor: { rowIndex: 0, columnIndex: 0 }
  };

  let analysisView = null;
  let analyzeWorkspace = null;
  let savedCreateDraftSnapshot = '';
  let savedResultsDraftSnapshot = '';
  let lastAgentContextSignature = '';

  function ensureState() {
    if (!Array.isArray(state.assays)) {
      state.assays = [];
    }
  }

  function getAssayById(assayId) {
    return (state.assays || []).find((item) => item.id === assayId);
  }

  const {
    selectNotebookOption,
    renderProjectOptions,
    renderNotebookOptions,
    renderResultsAssayOptions,
    renderList
  } = createAssayBrowserView({ elements, state, safeText, runtime, ensureState });

  function getCreateDraftSnapshot() {
    return serializeDraftSnapshot({
      controls: snapshotFormControls(elements.assayForm),
      concentrationUnit: runtime.concentrationUnit,
      axisTemplateValues: runtime.axisTemplateValues,
      manualWellOverrides: runtime.manualWellOverrides,
      suppressedWells: runtime.suppressedWells,
      currentLayout: runtime.currentLayout,
      serialDilution: layoutManager?.getSerialDilutionSnapshot?.() || null
    });
  }

  function getResultsDraftSnapshot() {
    resultsManager?.syncCurrentResultsFromGrid?.();
    return serializeDraftSnapshot({
      assayId: runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '',
      currentResults: runtime.currentResults,
      transformSpec: analysisView?.getTransformSpec?.() || null
    });
  }

  function markCreateDraftSaved() {
    savedCreateDraftSnapshot = getCreateDraftSnapshot();
  }

  function markResultsDraftSaved() {
    savedResultsDraftSnapshot = getResultsDraftSnapshot();
  }

  function markLoadedAssayDraftsSaved() {
    markCreateDraftSaved();
    markResultsDraftSaved();
  }

  function hasUnsavedResultsDraft() {
    return Boolean(savedResultsDraftSnapshot && getResultsDraftSnapshot() !== savedResultsDraftSnapshot);
  }


  const {
    syncNotebookAssayLinks,
    assayDefinitionChanged,
    saveAssayAnalysisPreview
  } = createAssayNotebookLinks({
    state,
    persist,
    runtime,
    elements,
    renderList,
    renderResultsAssayOptions,
    onAssaysChanged,
    getAssayById,
    artifactStorage: { persistAssayArtifacts: (id) => artifactStorage.persistAssayArtifacts(id) },
    notifyActiveAssayChanged: () => notifyActiveAssayChanged()
  });

  // These three lines double as running context ("Mapped wells: 24."), so only
  // the failures are raised as app notices — the rest would be constant noise.
  function setCsvStatus(message, isError = false) {
    if (isError && message) {
      showTransientNotice(String(message), { type: 'error' });
    }
    if (elements.assayCsvStatus) {
      elements.assayCsvStatus.textContent = message || '';
      elements.assayCsvStatus.classList.toggle('is-error', Boolean(isError && message));
    }
  }

  function setLayoutStatus(message, isError = false) {
    if (isError && message) {
      showTransientNotice(String(message), { type: 'error' });
    }
    if (elements.assayLayoutStatus) {
      elements.assayLayoutStatus.textContent = message || '';
      elements.assayLayoutStatus.classList.toggle('is-error', Boolean(isError && message));
    }
  }

  // The results rail carries no status copy of its own; every confirmation and
  // recoverable failure goes to the shared transient notice.
  function setResultStatus(message, isError = false) {
    if (message) {
      showTransientNotice(String(message), { type: isError ? 'error' : 'success' });
    }
  }

  function renderAssayNumberDisplay() {
    const editingAssay = getAssayById(elements.assayIdInput?.value || '');
    if (editingAssay) {
      elements.assayNumberDisplay.textContent = editingAssay.assayNumber || '-';
      return;
    }
    elements.assayNumberDisplay.textContent = previewNextAssayNumber(state);
  }

  function getActiveResultsAssay() {
    const assayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    return assayId ? getAssayById(assayId) : null;
  }

  function notifyActiveAssayChanged() {
    analyzeWorkspace?.refresh();
    if (typeof onActiveAssayChanged !== 'function') {
      return;
    }
    const context = getAgentChatContext();
    const signature = JSON.stringify({
      assayId: context.assayId,
      assayName: context.assayName,
      assayMode: context.assayMode,
      projectId: context.projectId,
      text: context.hiddenContext?.text || ''
    });
    if (signature === lastAgentContextSignature) {
      return;
    }
    lastAgentContextSignature = signature;
    onActiveAssayChanged(context);
  }

  const artifactStorage = createAssayArtifactStorage({
    state,
    createId,
    getAssayById,
    getActiveResultsAssay,
    persist
  });

  async function parseAssayResultImport(payload) {
    if (!window.hikariApi?.parseAssayResultImportFile) {
      throw new Error('Assay result file parser is unavailable.');
    }
    const result = await window.hikariApi.parseAssayResultImportFile(payload);
    if (!result?.ok) {
      throw new Error(result?.error || 'Unable to parse assay result file.');
    }
    return result;
  }

  async function onAssayResultImportApplied({ attachment } = {}) {
    const assay = getActiveResultsAssay();
    if (!assay) {
      throw new Error('Selected assay plate was not found.');
    }
    const def = getPlateDefinition(assay.plateType || elements.assayPlateTypeInput?.value || '96');
    assay.resultValues = layoutManager.filterMappedResults(normalizeResults(runtime.currentResults, def));
    if (attachment && typeof attachment === 'object') {
      const existing = Array.isArray(assay.resultAttachments) ? assay.resultAttachments : [];
      assay.resultAttachments = [...existing, attachment];
    }
    assay.latestAnalysis = null;
    assay.updatedAt = new Date().toISOString();
    syncNotebookAssayLinks();
    persist();
    renderResultsAssayOptions(assay.id);
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
    await artifactStorage.persistAssayArtifacts(assay.id);
    markResultsDraftSaved();
    notifyActiveAssayChanged();
  }

  const layoutManager = createAssayLayoutManager({
    runtime,
    elements,
    safeText,
    getInventorySamples: () => (Array.isArray(state.samples) ? state.samples : []),
    setCsvStatus,
    setLayoutStatus,
    renderResultTable: () => resultsManager.renderResultTable(),
    clearAnalysisOutput: () => analysisView?.clearOutput()
  });

  const resultsManager = createAssayResultsManager({
    runtime,
    elements,
    TabulatorLib,
    isMappedWell: layoutManager.isMappedWell,
    getCurrentDefinition: layoutManager.getCurrentDefinition,
    getSampleAxis: layoutManager.getSampleAxis,
    filterAndNormalizeResults: (results) => layoutManager.filterMappedResults(
      normalizeResults(results, layoutManager.getCurrentDefinition())
    ),
    setResultStatus,
    clearAnalysisOutput: () => analysisView?.clearOutput(),
    onAnalysisConfigChange: () => analysisView?.onAnalysisConfigChange(),
    parseResultImportFile: parseAssayResultImport,
    persistResultAttachment: artifactStorage.persistAssayResultAttachment,
    onResultImportApplied: onAssayResultImportApplied,
    onResultsChanged: () => {
      analysisView?.onSourceResultsChanged();
      notifyActiveAssayChanged();
    }
  });

  analysisView = createAssayAnalysisView({
    runtime,
    elements,
    safeText,
    TabulatorLib,
    getCurrentDefinition: layoutManager.getCurrentDefinition,
    syncCurrentResultsFromGrid: resultsManager.syncCurrentResultsFromGrid,
    getResultValueCount: resultsManager.getResultValueCount,
    buildResultGridSignature: resultsManager.buildResultGridSignature,
    buildResultGridColumns: resultsManager.buildResultGridColumns,
    buildResultGridData: resultsManager.buildResultGridData,
    getResultGridHeight: resultsManager.getResultGridHeight,
    resultRowVisible: resultsManager.resultRowVisible,
    onWorkspaceChanged: (options) => analyzeWorkspace?.refresh(options),
    onAnalysisRendered: (info) => {
      saveAssayAnalysisPreview(info);
    },
    onChartStyleChanged: (style) => {
      const activeAssay = getAssayById(runtime.activeResultsAssayId);
      if (activeAssay) {
        activeAssay.chartStyle = style;
        activeAssay.updatedAt = new Date().toISOString();
        persist();
      }
    },
    onTransformChanged: (spec) => {
      const activeAssay = getAssayById(runtime.activeResultsAssayId);
      if (activeAssay) {
        activeAssay.transformSpec = spec;
        activeAssay.updatedAt = new Date().toISOString();
        persist();
      }
    }
  });

  analyzeWorkspace = createAnalyzeWorkspace({
    elements, runtime, resultsManager, analysisView,
    getAssay: getActiveResultsAssay,
    getDefinition: layoutManager.getCurrentDefinition
  });

  const plotAgent = createPlotAgentController({
    getAssay: getActiveResultsAssay,
    isActive: () => runtime.assayMode === 'results'
      && (!document.body.dataset.activeView || document.body.dataset.activeView === 'assay-view'),
    analysisView, persist, onChanged: notifyActiveAssayChanged
  });
  window.hikariApi?.onAssayPlotRequest?.(async (request) => {
    let result;
    try { result = await plotAgent.execute(request.args, { deadline: request.deadline }); }
    catch (error) { result = { ok: false, status: 'failed', error: error.message }; }
    window.hikariApi?.respondToAssayPlotRequest?.({ id: request.id, result });
  });

  const { getAgentChatContext } = createAssayAgentContext({
    runtime,
    elements,
    state,
    getAssayById,
    getLayoutManager: () => layoutManager,
    getResultsManager: () => resultsManager,
    hasUnsavedResultsDraft
  });

  function loadAssayForResults(assayId) {
    const assay = getAssayById(assayId);
    if (!assay) {
      runtime.activeResultsAssayId = '';
      return;
    }
    runtime.activeResultsAssayId = assay.id;
    if (elements.assayResultsAssaySelect) {
      elements.assayResultsAssaySelect.value = assay.id;
    }
    elements.assayIdInput.value = assay.id;
    elements.assayPlateTypeInput.value = String(assay.plateType || '96');
    elements.assaySampleAxisInput.value = assay.sampleAxis === 'column' ? 'column' : 'row';
    layoutManager.syncAxisDisplay();
    const def = layoutManager.getCurrentDefinition();
    const axisValues = layoutManager.restoreAssayLayoutState(assay, def);
    layoutManager.renderPlatePreview(axisValues);
    layoutManager.renderPlateDefinition();
    resultsManager.renderResultTable();
    analysisView.loadChartStyle(assay.chartStyle);
    analysisView.loadTransformSpec(assay.transformSpec);
    analysisView.clearOutput();
    markLoadedAssayDraftsSaved();
    renderList();
    notifyActiveAssayChanged();
  }


  const {
    setAssayMode,
    onResultsAssaySelected,
    onSaveResults,
    onSubmit,
    resetForm,
    startNewAssay,
    onListClick,
    render
  } = createAssayFormAndList({
    state,
    persist,
    createId,
    runtime,
    elements,
    layoutManager,
    resultsManager,
    analysisView,
    artifactStorage,
    ensureState,
    getAssayById,
    onAssaysChanged,
    renderList,
    renderProjectOptions,
    renderNotebookOptions,
    renderResultsAssayOptions,
    onAssayModeChanged,
    notifyActiveAssayChanged,
    renderAssayNumberDisplay,
    setCsvStatus,
    setLayoutStatus,
    setResultStatus,
    syncNotebookAssayLinks,
    assayDefinitionChanged,
    loadAssayForResults,
    markCreateDraftSaved,
    markResultsDraftSaved,
    markLoadedAssayDraftsSaved,
    hasSavedCreateDraftSnapshot: () => Boolean(savedCreateDraftSnapshot),
    hasSavedResultsDraftSnapshot: () => Boolean(savedResultsDraftSnapshot)
  });

  function startLinkedAssay({ notebookEntryId = '', projectId = '' } = {}) {
    resetForm();
    setAssayMode('create');

    const linkedEntry = (state.notebookEntries || []).find((entry) => entry.id === notebookEntryId);
    const resolvedProjectId = String(projectId || linkedEntry?.projectId || '').trim();
    if (resolvedProjectId && elements.assayProjectInput) {
      elements.assayProjectInput.value = resolvedProjectId;
      renderProjectOptions();
      elements.assayProjectInput.value = resolvedProjectId;
    }

    renderNotebookOptions();
    selectNotebookOption(notebookEntryId);
    renderAssayNumberDisplay();
    if (elements.assayNameInput) {
      elements.assayNameInput.focus();
    }
    setResultStatus(notebookEntryId
      ? `New assay will be linked to notebook page ${notebookEntryId}.`
      : 'Create a new linked assay.');
  }

  bindAssayEvents({
    elements,
    layoutManager,
    resultsManager,
    analysisView,
    handlers: {
      onSubmit,
      startNewAssay,
      resetForm,
      setAssayMode,
      renderNotebookOptions,
      renderAssayNumberDisplay,
      onResultsAssaySelected,
      onSaveResults,
      renderList,
      onListClick
    }
  });

  return {
    hasUnsavedChanges: () => (
      Boolean(savedCreateDraftSnapshot && getCreateDraftSnapshot() !== savedCreateDraftSnapshot)
      || Boolean(savedResultsDraftSnapshot && getResultsDraftSnapshot() !== savedResultsDraftSnapshot)
    ),
    render,
    renderProjectOptions,
    renderNotebookOptions,
    renderList,
    renderAgentPlotlyGraph: (artifact) => analysisView?.renderAgentPlotlyGraph?.(artifact) === true,
    executePlotRequest: (input, options) => plotAgent.execute(input, options),
    saveUnsavedChanges: async () => {
      if (savedResultsDraftSnapshot && getResultsDraftSnapshot() !== savedResultsDraftSnapshot) {
        if (!onSaveResults()) {
          return false;
        }
      }
      if (savedCreateDraftSnapshot && getCreateDraftSnapshot() !== savedCreateDraftSnapshot) {
        if (!onSubmit({ preventDefault() {} })) {
          return false;
        }
      }
      return !(
        getCreateDraftSnapshot() !== savedCreateDraftSnapshot
        || getResultsDraftSnapshot() !== savedResultsDraftSnapshot
      );
    },
    startLinkedAssay,
    getAgentChatContext
  };
}
