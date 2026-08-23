import { getAssayElements } from './dom.js';
import { createAssayLayoutManager } from './layout-manager.js';
import { createAssayResultsManager } from './results-manager.js';
import { createAssayAnalysisView } from './analysis-view.js';
import { createAssayArtifactStorage } from './artifact-storage.js';
import {
  ensureAssayNumbers,
  nextAssayNumber,
  previewNextAssayNumber
} from './numbering.js';
import {
  getPlateDefinition,
  normalizeLayout,
  normalizeManualWellOverrideMap,
  normalizeResults
} from './plate-model.js';
import { oppositeAxis } from './shared.js';
import { createAssayAgentContext } from './agent/context.js';
import { bindAssayEvents } from './ui/event-bindings.js';
import { createAssayBrowserView } from './ui/browser-view.js';
import { serializeDraftSnapshot, snapshotFormControls } from '../../lib/unsaved-draft.js';
import { showTransientNotice } from '../../lib/notify.js';

export function initAssay({ state, persist, createId, safeText, onAssaysChanged, onActiveAssayChanged }) {
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

  function arraysEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
  }

  function syncNotebookAssayLinks() {
    if (!Array.isArray(state.notebookEntries)) {
      return;
    }

    const linkedIdsByEntry = new Map();
    (state.assays || []).forEach((assay) => {
      const entryId = String(assay?.notebookEntryId || '').trim();
      const assayId = String(assay?.id || '').trim();
      if (!entryId || !assayId) {
        return;
      }
      if (!linkedIdsByEntry.has(entryId)) {
        linkedIdsByEntry.set(entryId, []);
      }
      linkedIdsByEntry.get(entryId).push(assayId);
    });

    state.notebookEntries = state.notebookEntries.map((entry) => {
      const nextIds = linkedIdsByEntry.get(String(entry?.id || '').trim()) || [];
      const currentIds = Array.isArray(entry?.assayIds)
        ? entry.assayIds.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      if (arraysEqual(currentIds, nextIds)) {
        return entry;
      }
      return {
        ...entry,
        assayIds: nextIds
      };
    });
  }

  function assayDefinitionChanged(existing, nextRecord) {
    if (!existing) {
      return false;
    }
    const fieldsToCompare = [
      'plateType',
      'sampleAxis',
      'projectId',
      'notebookEntryId'
    ];
    if (fieldsToCompare.some((field) => String(existing?.[field] || '') !== String(nextRecord?.[field] || ''))) {
      return true;
    }
    return JSON.stringify(existing?.sampleAxisValues || []) !== JSON.stringify(nextRecord?.sampleAxisValues || [])
      || JSON.stringify(existing?.concentrationAxisValues || []) !== JSON.stringify(nextRecord?.concentrationAxisValues || [])
      || JSON.stringify(existing?.manualWellOverrides || {}) !== JSON.stringify(nextRecord?.manualWellOverrides || {})
      || JSON.stringify(existing?.suppressedWells || []) !== JSON.stringify(nextRecord?.suppressedWells || [])
      || JSON.stringify(existing?.wellLayout || []) !== JSON.stringify(nextRecord?.wellLayout || [])
      || JSON.stringify(existing?.resultValues || {}) !== JSON.stringify(nextRecord?.resultValues || {});
  }

  function saveAssayAnalysisPreview(preview) {
    const assayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    if (!assayId) {
      return;
    }
    const assay = getAssayById(assayId);
    if (!assay) {
      return;
    }
    assay.latestAnalysis = preview && typeof preview === 'object'
      ? { ...preview }
      : null;
    assay.updatedAt = new Date().toISOString();
    syncNotebookAssayLinks();
    persist();
    renderResultsAssayOptions(assay.id);
    clearActiveAssayInfo();
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
    void artifactStorage.persistAssayArtifacts(assay.id);
    notifyActiveAssayChanged();
  }

  function setCsvStatus(message) {
    if (elements.assayCsvStatus) {
      elements.assayCsvStatus.textContent = message || '';
    }
  }

  function setLayoutStatus(message) {
    if (elements.assayLayoutStatus) {
      elements.assayLayoutStatus.textContent = message || '';
    }
  }

  function setResultStatus(message) {
    if (elements.assayResultStatus) {
      elements.assayResultStatus.textContent = message || '';
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

  function clearActiveAssayInfo() {
    if (!elements.assayActiveAssayInfo) {
      return;
    }
    elements.assayActiveAssayInfo.textContent = '';
  }

  function getActiveResultsAssay() {
    const assayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    return assayId ? getAssayById(assayId) : null;
  }

  function notifyActiveAssayChanged() {
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
    clearActiveAssayInfo();
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
      clearActiveAssayInfo();
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
    clearActiveAssayInfo();
    analysisView.loadChartStyle(assay.chartStyle);
    analysisView.loadTransformSpec(assay.transformSpec);
    analysisView.clearOutput();
    markLoadedAssayDraftsSaved();
    renderList();
    notifyActiveAssayChanged();
  }

  function setAssayMode(mode) {
    runtime.assayMode = mode === 'results' ? 'results' : 'create';
    const isCreate = runtime.assayMode === 'create';
    if (elements.assayCreateLayout) {
      elements.assayCreateLayout.hidden = !isCreate;
    }
    if (elements.assayResultsLayout) {
      elements.assayResultsLayout.hidden = isCreate;
    }
    elements.assayModeCreateBtn?.classList.toggle('calendar-view-active', isCreate);
    elements.assayModeResultsBtn?.classList.toggle('calendar-view-active', !isCreate);
    if (elements.assayModeNote) {
      elements.assayModeNote.textContent = '';
    }
    if (isCreate) {
      layoutManager.renderPlateDefinition();
      layoutManager.renderPlatePreview();
      notifyActiveAssayChanged();
      return;
    }

    if (!isCreate) {
      renderResultsAssayOptions(runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '');
      const selected = elements.assayResultsAssaySelect?.value || runtime.activeResultsAssayId;
      if (selected) {
        loadAssayForResults(selected);
      } else {
        clearActiveAssayInfo();
      }
    }
    notifyActiveAssayChanged();
  }

  function onResultsAssaySelected() {
    const assayId = elements.assayResultsAssaySelect?.value || '';
    if (!assayId) {
      runtime.activeResultsAssayId = '';
      clearActiveAssayInfo();
      setResultStatus('No assay plate selected.');
      notifyActiveAssayChanged();
      return;
    }
    loadAssayForResults(assayId);
  }

  function onSaveResults() {
    ensureState();
    const assayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    if (!assayId) {
      setResultStatus('Select an assay plate first.');
      return null;
    }
    const assay = getAssayById(assayId);
    if (!assay) {
      setResultStatus('Selected assay plate was not found.');
      showTransientNotice('Selected assay plate was not found.', { type: 'error' });
      return null;
    }
    const def = getPlateDefinition(assay.plateType || elements.assayPlateTypeInput?.value || '96');
    resultsManager.syncCurrentResultsFromGrid();
    assay.resultValues = layoutManager.filterMappedResults(normalizeResults(runtime.currentResults, def));
    assay.transformSpec = analysisView.getTransformSpec();
    assay.latestAnalysis = null;
    assay.updatedAt = new Date().toISOString();
    syncNotebookAssayLinks();
    persist();
    renderResultsAssayOptions(assay.id);
    clearActiveAssayInfo();
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
    setResultStatus(`Saved ${Object.keys(assay.resultValues || {}).length} result value(s) for ${assay.assayNumber || assay.id}.`);
    void artifactStorage.persistAssayArtifacts(assay.id);
    markResultsDraftSaved();
    notifyActiveAssayChanged();
    return assay;
  }

  function onSubmit(event) {
    event.preventDefault();
    ensureState();

    const name = elements.assayNameInput?.value.trim() || '';
    if (!name) {
      return null;
    }

    const plateDef = getPlateDefinition(elements.assayPlateTypeInput?.value);
    const sampleAxis = elements.assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const selectedConcentrationAxis = elements.assayConcentrationAxisInput?.value === 'row' ? 'row' : 'column';
    const concentrationAxis = selectedConcentrationAxis === oppositeAxis(sampleAxis)
      ? selectedConcentrationAxis
      : oppositeAxis(sampleAxis);
    const project = (state.projects || []).find((item) => item.id === elements.assayProjectInput?.value);
    const notebookEntry = (state.notebookEntries || []).find((entry) => entry.id === elements.assayNotebookEntryInput?.value);
    const editingId = elements.assayIdInput?.value || '';
    const existing = (state.assays || []).find((item) => item.id === editingId);
    const axisValues = layoutManager.getAxisTemplateValues();
    layoutManager.syncAxisTemplateValues(axisValues);
    layoutManager.setLayoutFromAxisAndOverrides();

    const record = {
      id: existing?.id || createId(),
      assayNumber: existing?.assayNumber || nextAssayNumber(state),
      name,
      projectId: project?.id || '',
      projectName: project?.name || '',
      plateType: plateDef.value,
      plateLabel: plateDef.label,
      plateRows: plateDef.rows,
      plateColumns: plateDef.columns,
      wellCount: plateDef.rows * plateDef.columns,
      sampleAxis,
      concentrationAxis,
      concentrationUnit: layoutManager.getConcentrationUnit(),
      sampleAxisValues: axisValues.sampleValues,
      concentrationAxisValues: axisValues.concentrationValues,
      manualWellOverrides: normalizeManualWellOverrideMap(runtime.manualWellOverrides, plateDef),
      suppressedWells: Array.from(runtime.suppressedWells),
      notebookEntryId: elements.assayNotebookEntryInput?.value || '',
      notebookEntryProtocolName: notebookEntry?.protocolName || '',
      notebookEntryType: notebookEntry?.notebookType || '',
      serialDilution: layoutManager.getSerialDilutionSnapshot(),
      serialDilutionSummary: layoutManager.getSerialDilutionSummaryData(),
      wellLayout: normalizeLayout(runtime.currentLayout, plateDef),
      resultValues: layoutManager.filterMappedResults(normalizeResults(runtime.currentResults, plateDef)),
      resultAttachments: Array.isArray(existing?.resultAttachments) ? existing.resultAttachments : [],
      // Analysis-side settings live on the assay but are edited in the Analyze view, so
      // a save from Setup has to carry them forward instead of rebuilding them away.
      chartStyle: existing?.chartStyle || null,
      transformSpec: existing?.transformSpec || null,
      updatedAt: new Date().toISOString()
    };
    record.latestAnalysis = assayDefinitionChanged(existing, record)
      ? null
      : (existing?.latestAnalysis && typeof existing.latestAnalysis === 'object'
          ? { ...existing.latestAnalysis }
          : null);

    const index = state.assays.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      state.assays[index] = record;
    } else {
      state.assays.push(record);
    }

    syncNotebookAssayLinks();
    persist();
    renderResultsAssayOptions(record.id);
    resetForm();
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
    void artifactStorage.persistAssayArtifacts(record.id);
    return record;
  }

  function resetForm() {
    elements.assayIdInput.value = '';
    elements.assayForm?.reset();
    runtime.activeResultsAssayId = '';
    runtime.activeWellEditorId = '';
    runtime.plateEditField = 'sampleId';
    runtime.manualWellOverrides = {};
    runtime.suppressedWells = new Set();
    runtime.currentLayout = [];
    runtime.currentResults = {};
    runtime.resultPasteAnchor = { rowIndex: 0, columnIndex: 0 };
    runtime.axisTemplateValues = { sampleValues: [], concentrationValues: [] };
    layoutManager.setConcentrationUnit('');
    layoutManager.resetSerialDilutionState();
    if (elements.assayAnalysisKindInput) {
      elements.assayAnalysisKindInput.value = 'summary';
    }
    if (elements.assayAnalysisGroupByInput) {
      elements.assayAnalysisGroupByInput.value = 'auto';
    }
    if (elements.assayAnalysisXAxisInput) {
      elements.assayAnalysisXAxisInput.value = 'auto';
    }
    if (elements.assayAnalysisXTransformInput) {
      elements.assayAnalysisXTransformInput.value = 'none';
    }
    if (elements.assayAnalysisAsymmetricInput) {
      elements.assayAnalysisAsymmetricInput.checked = false;
    }
    if (elements.assayAnalysisPolyOrderInput) {
      elements.assayAnalysisPolyOrderInput.value = '2';
    }
    if (elements.assayAnalysisSubtotalsInput) {
      elements.assayAnalysisSubtotalsInput.checked = false;
    }
    analysisView?.syncAnalysisControls();
    analysisView?.clearTransform();
    if (elements.assayAnalysisRowGroupsInput) {
      elements.assayAnalysisRowGroupsInput.value = '';
    }
    if (elements.assayAnalysisColumnGroupsInput) {
      elements.assayAnalysisColumnGroupsInput.value = '';
    }
    if (elements.assayAnalysisErrorBarsInput) {
      elements.assayAnalysisErrorBarsInput.checked = true;
    }
    if (elements.assayAnalysisGroupNameInput) {
      elements.assayAnalysisGroupNameInput.value = '';
    }
    resultsManager.setAnalysisSelectionStatus('');
    resultsManager.refreshAnalysisGroupDisplay();
    setCsvStatus('');
    setLayoutStatus('');
    if (elements.assaySampleAxisInput) {
      elements.assaySampleAxisInput.value = 'row';
    }
    if (elements.assayPlateTypeInput) {
      elements.assayPlateTypeInput.value = '96';
    }
    renderProjectOptions();
    renderNotebookOptions();
    layoutManager.syncAxisDisplay();
    layoutManager.renderPlateEditFieldButtons();
    layoutManager.syncAxisTemplateValues();
    layoutManager.renderPlateDefinition();
    layoutManager.renderPlatePreview();
    renderAssayNumberDisplay();
    renderResultsAssayOptions();
    clearActiveAssayInfo();
    resultsManager.renderResultTable();
    analysisView.clearOutput();
    layoutManager.updateActiveWellPreviewState();
    setAssayMode('create');
    markCreateDraftSaved();
    markResultsDraftSaved();
    notifyActiveAssayChanged();
  }

  function startNewAssay() {
    resetForm();
    elements.assayNameInput?.focus();
  }

  function editAssay(assayId) {
    const assay = getAssayById(assayId);
    if (!assay) {
      return;
    }
    elements.assayBrowserPanel?.setAttribute('open', '');
    elements.assayIdInput.value = assay.id;
    elements.assayNameInput.value = assay.name || '';
    elements.assayProjectInput.value = assay.projectId || '';
    renderProjectOptions();
    elements.assayProjectInput.value = assay.projectId || '';
    renderNotebookOptions();
    elements.assayPlateTypeInput.value = String(assay.plateType || '96');
    elements.assaySampleAxisInput.value = assay.sampleAxis === 'column' ? 'column' : 'row';
    const def = layoutManager.getCurrentDefinition();
    const axisValues = layoutManager.restoreAssayLayoutState(assay, def);
    layoutManager.restoreSerialDilutionSnapshot(assay.serialDilution || null);
    runtime.activeResultsAssayId = assay.id;
    layoutManager.syncAxisDisplay();
    layoutManager.renderPlateDefinition();
    layoutManager.renderPlatePreview(axisValues);
    renderAssayNumberDisplay();
    renderResultsAssayOptions(assay.id);
    clearActiveAssayInfo();
    resultsManager.renderResultTable();
    elements.assayNotebookEntryInput.value = assay.notebookEntryId || '';
    if (assay.notebookEntryId && !Array.from(elements.assayNotebookEntryInput.options).some((option) => option.value === assay.notebookEntryId)) {
      const option = document.createElement('option');
      option.value = assay.notebookEntryId;
      option.textContent = `${assay.notebookEntryId} (missing notebook page)`;
      elements.assayNotebookEntryInput.append(option);
      elements.assayNotebookEntryInput.value = assay.notebookEntryId;
    }
    setCsvStatus('');
    setResultStatus(`Loaded ${Object.keys(runtime.currentResults).length} result value(s) from saved assay.`);
    setLayoutStatus('');
    analysisView.clearOutput();
    markLoadedAssayDraftsSaved();
    notifyActiveAssayChanged();
  }

  function deleteAssay(assayId) {
    state.assays = (state.assays || []).filter((item) => item.id !== assayId);
    if (runtime.activeResultsAssayId === assayId) {
      runtime.activeResultsAssayId = '';
      runtime.currentResults = {};
      runtime.currentLayout = [];
      resultsManager.renderResultTable();
      clearActiveAssayInfo();
      analysisView.clearOutput();
    }
    syncNotebookAssayLinks();
    persist();
    renderResultsAssayOptions();
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
  }

  function onListClick(event) {
    const resultsSelectBtn = event.target.closest('[data-assay-results-select]');
    if (resultsSelectBtn) {
      const assayId = resultsSelectBtn.dataset.assayResultsSelect || '';
      if (elements.assayResultsAssaySelect) {
        elements.assayResultsAssaySelect.value = assayId;
      }
      loadAssayForResults(assayId);
      return;
    }

    const editBtn = event.target.closest('[data-assay-edit]');
    if (editBtn) {
      setAssayMode('create');
      editAssay(editBtn.dataset.assayEdit);
      return;
    }

    const deleteBtn = event.target.closest('[data-assay-delete]');
    if (deleteBtn) {
      deleteAssay(deleteBtn.dataset.assayDelete);
    }
  }

  function render() {
    ensureState();
    const addedNumbers = ensureAssayNumbers(state);
    if (addedNumbers) {
      persist();
    }
    renderProjectOptions();
    renderNotebookOptions();
    layoutManager.syncAxisDisplay();
    layoutManager.renderPlateEditFieldButtons();
    layoutManager.syncAxisTemplateValues();
    layoutManager.renderPlateDefinition();
    renderAssayNumberDisplay();
    renderResultsAssayOptions(runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '');
    clearActiveAssayInfo();
    layoutManager.renderPlatePreview();
    resultsManager.renderResultTable();
    renderList();
    setAssayMode(runtime.assayMode);
    if (!savedCreateDraftSnapshot) {
      markCreateDraftSaved();
    }
    if (!savedResultsDraftSnapshot) {
      markResultsDraftSaved();
    }
  }

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
