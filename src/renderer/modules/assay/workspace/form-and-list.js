import { ensureAssayNumbers, nextAssayNumber } from '../numbering.js';
import {
  getPlateDefinition,
  normalizeLayout,
  normalizeManualWellOverrideMap,
  normalizeResults
} from '../plate-model.js';
import { oppositeAxis } from '../shared.js';

// The create/edit form and the saved-assay list: switching between create and
// results mode, submitting a definition, and the list's edit/delete actions.
function createAssayFormAndList({
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
  hasSavedCreateDraftSnapshot,
  hasSavedResultsDraftSnapshot
} = {}) {
  function setAssayMode(mode) {
    runtime.assayMode = mode === 'results' ? 'results' : 'create';
    const isCreate = runtime.assayMode === 'create';
    onAssayModeChanged?.(runtime.assayMode);
    if (elements.assayCreateLayout) {
      elements.assayCreateLayout.hidden = !isCreate;
    }
    if (elements.assayResultsLayout) {
      elements.assayResultsLayout.hidden = isCreate;
    }
    elements.assayModeCreateBtn?.classList.toggle('calendar-view-active', isCreate);
    elements.assayModeResultsBtn?.classList.toggle('calendar-view-active', !isCreate);
    // One switch element, pinned at the top of whichever rail is showing.
    if (elements.assayModeSwitch) {
      (isCreate ? elements.assayCreateRail : elements.assayResultsRail)?.prepend(elements.assayModeSwitch);
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
      }
    }
    notifyActiveAssayChanged();
  }

  function onResultsAssaySelected() {
    const assayId = elements.assayResultsAssaySelect?.value || '';
    if (!assayId) {
      runtime.activeResultsAssayId = '';
      setResultStatus('No assay plate selected.', true);
      notifyActiveAssayChanged();
      return;
    }
    loadAssayForResults(assayId);
  }

  function onSaveResults() {
    ensureState();
    const assayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    if (!assayId) {
      setResultStatus('Select an assay plate first.', true);
      return null;
    }
    const assay = getAssayById(assayId);
    if (!assay) {
      setResultStatus('Selected assay plate was not found.', true);
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
      plotToolReceipts: existing?.plotToolReceipts || [],
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
    if (elements.assayAnalysisAsymmetricInput) {
      elements.assayAnalysisAsymmetricInput.checked = false;
    }
    if (elements.assayAnalysisPolyOrderInput) {
      elements.assayAnalysisPolyOrderInput.value = '2';
    }
    if (elements.assayAnalysisSubtotalsInput) {
      elements.assayAnalysisSubtotalsInput.checked = false;
    }
    if (elements.assayAnalysisHighControlInput) {
      elements.assayAnalysisHighControlInput.value = '';
    }
    if (elements.assayAnalysisLowControlInput) {
      elements.assayAnalysisLowControlInput.value = '';
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
    layoutManager.renderPlatePreview();
    resultsManager.renderResultTable();
    renderList();
    setAssayMode(runtime.assayMode);
    if (!hasSavedCreateDraftSnapshot()) {
      markCreateDraftSaved();
    }
    if (!hasSavedResultsDraftSnapshot()) {
      markResultsDraftSaved();
    }
  }

  return {
    setAssayMode,
    onResultsAssaySelected,
    onSaveResults,
    onSubmit,
    resetForm,
    startNewAssay,
    editAssay,
    deleteAssay,
    onListClick,
    render
  };
}

export { createAssayFormAndList };
