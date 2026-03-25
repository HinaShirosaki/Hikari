import { exportAssayDefinitionPdf } from '../pdf-export.js';
import { getAssayElements } from './dom.js';
import { createAssayLayoutManager } from './layout-manager.js';
import { createAssayResultsManager } from './results-manager.js';
import { createAssayAnalysisView } from './analysis-view.js';
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
import {
  axisLabel,
  formatTimestamp,
  notebookLabel,
  oppositeAxis
} from './shared.js';

export function initAssay({ state, persist, createId, safeText, onAssaysChanged }) {
  const TabulatorLib = window.Tabulator || null;
  const ReactLib = window.React || null;
  const ReactDOMLib = window.ReactDOM || null;
  const ReactVisLib = window.reactVis || null;
  const elements = getAssayElements(document);
  const runtime = {
    currentLayout: [],
    currentResults: {},
    assayMode: 'create',
    activeResultsAssayId: '',
    activeWellEditorId: '',
    axisTemplateValues: { sampleValues: [], concentrationValues: [] },
    plateEditField: 'sampleId',
    manualWellOverrides: {},
    suppressedWells: new Set(),
    resultPasteAnchor: { rowIndex: 0, columnIndex: 0 }
  };

  let analysisView = null;

  function ensureState() {
    if (!Array.isArray(state.assays)) {
      state.assays = [];
    }
  }

  function getAssayById(assayId) {
    return (state.assays || []).find((item) => item.id === assayId);
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
      elements.assayNumberDisplay.textContent = `Assay Number: ${editingAssay.assayNumber || '-'}`;
      return;
    }
    elements.assayNumberDisplay.textContent = `Assay Number (auto): ${previewNextAssayNumber(state)}`;
  }

  function renderActiveAssayInfo(assay) {
    if (!elements.assayActiveAssayInfo) {
      return;
    }
    if (!assay) {
      elements.assayActiveAssayInfo.textContent = 'No assay plate loaded.';
      return;
    }
    elements.assayActiveAssayInfo.textContent = `Loaded ${assay.assayNumber || assay.id} | ${assay.name || '-'} | ${assay.plateLabel || `${assay.wellCount || '-'} well`}`;
  }

  function renderProjectOptions() {
    if (!elements.assayProjectInput) {
      return;
    }
    const selected = elements.assayProjectInput.value;
    const options = ['<option value="">Select project</option>'];
    (state.projects || []).forEach((project) => {
      const isSelected = selected === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });
    elements.assayProjectInput.innerHTML = options.join('');
    if (selected && (state.projects || []).some((project) => project.id === selected)) {
      elements.assayProjectInput.value = selected;
    }
  }

  function renderNotebookOptions() {
    if (!elements.assayNotebookEntryInput) {
      return;
    }
    const selected = elements.assayNotebookEntryInput.value;
    const projectId = elements.assayProjectInput?.value || '';
    const entries = (state.notebookEntries || [])
      .filter((entry) => !projectId || entry.projectId === projectId)
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
    const options = ['<option value="">Not linked</option>'];
    entries.forEach((entry) => {
      options.push(`<option value="${entry.id}">${safeText(notebookLabel(entry))}</option>`);
    });
    elements.assayNotebookEntryInput.innerHTML = options.join('');

    if (selected && entries.some((entry) => entry.id === selected)) {
      elements.assayNotebookEntryInput.value = selected;
      return;
    }

    if (selected && !entries.some((entry) => entry.id === selected)) {
      elements.assayNotebookEntryInput.innerHTML += `<option value="${safeText(selected)}">${safeText(`${selected} (missing notebook page)`)}</option>`;
      elements.assayNotebookEntryInput.value = selected;
    }
  }

  const layoutManager = createAssayLayoutManager({
    runtime,
    elements,
    safeText,
    setCsvStatus,
    setLayoutStatus,
    setResultStatus,
    renderResultTable: () => resultsManager.renderResultTable(),
    clearAnalysisOutput: () => analysisView?.clearOutput()
  });

  const resultsManager = createAssayResultsManager({
    runtime,
    elements,
    TabulatorLib,
    isMappedWell: layoutManager.isMappedWell,
    getCurrentDefinition: layoutManager.getCurrentDefinition,
    filterAndNormalizeResults: (results) => layoutManager.filterMappedResults(
      normalizeResults(results, layoutManager.getCurrentDefinition())
    ),
    setResultStatus,
    clearAnalysisOutput: () => analysisView?.clearOutput(),
    onAnalysisConfigChange: () => analysisView?.onAnalysisConfigChange()
  });

  analysisView = createAssayAnalysisView({
    runtime,
    elements,
    ReactLib,
    ReactDOMLib,
    ReactVisLib,
    safeText,
    getCurrentDefinition: layoutManager.getCurrentDefinition,
    syncCurrentResultsFromGrid: resultsManager.syncCurrentResultsFromGrid,
    getResultValueCount: resultsManager.getResultValueCount
  });

  function sortedAssaysByUpdated() {
    return (state.assays || [])
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
  }

  function renderResultsAssayOptions(preferredId = '') {
    if (!elements.assayResultsAssaySelect) {
      return;
    }
    const rows = sortedAssaysByUpdated();
    const options = ['<option value="">Select assay plate</option>'];
    rows.forEach((assay) => {
      const label = `${assay.assayNumber || '-'} | ${assay.name || assay.id}`;
      options.push(`<option value="${assay.id}">${safeText(label)}</option>`);
    });
    elements.assayResultsAssaySelect.innerHTML = options.join('');
    const candidate = preferredId || runtime.activeResultsAssayId;
    if (candidate && rows.some((assay) => assay.id === candidate)) {
      elements.assayResultsAssaySelect.value = candidate;
      return;
    }
    if (rows.length) {
      elements.assayResultsAssaySelect.value = rows[0].id;
    }
  }

  function linkedNotebookLabel(assay) {
    if (!assay.notebookEntryId) {
      return '-';
    }
    const linked = (state.notebookEntries || []).find((entry) => entry.id === assay.notebookEntryId);
    if (!linked) {
      return `${assay.notebookEntryId} (missing)`;
    }
    const type = linked.notebookType === 'biology' ? 'Biology' : 'Synthesis';
    return `${type}: ${linked.protocolName || linked.id}`;
  }

  function matchesSearch(assay, term) {
    if (!term) {
      return true;
    }
    const haystack = [
      assay.assayNumber,
      assay.name,
      assay.projectName,
      assay.plateLabel,
      assay.wellCount,
      axisLabel(assay.sampleAxis),
      axisLabel(assay.concentrationAxis),
      assay.notebookEntryProtocolName,
      linkedNotebookLabel(assay),
      assay.notes
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  }

  function renderList() {
    ensureState();
    const term = String(elements.assaySearchInput?.value || '').trim().toLowerCase();
    const rows = sortedAssaysByUpdated().filter((item) => matchesSearch(item, term));

    if (!rows.length) {
      elements.assayList.innerHTML = '<p class="small-note">No assays found.</p>';
      return;
    }

    elements.assayList.innerHTML = rows.map((assay) => `
      <article class="card">
        <h3>${safeText(assay.name)}</h3>
        <p><strong>Assay Number:</strong> ${safeText(assay.assayNumber || '-')}</p>
        <p><strong>Project:</strong> ${safeText(assay.projectName || '-')}</p>
        <p><strong>Plate:</strong> ${safeText(assay.plateLabel || `${assay.wellCount || '-'} well`)} (${safeText(`${assay.plateRows || '-'} x ${assay.plateColumns || '-'}`)})</p>
        <p><strong>Axis Mapping:</strong> Sample ID by ${safeText(axisLabel(assay.sampleAxis))}, concentration by ${safeText(axisLabel(assay.concentrationAxis))}</p>
        <p><strong>Mapped Wells:</strong> ${safeText(String((assay.wellLayout || []).length || 0))}</p>
        <p><strong>Result Wells:</strong> ${safeText(String(Object.keys(assay.resultValues || {}).length || 0))}</p>
        <p><strong>Notebook Page:</strong> ${safeText(linkedNotebookLabel(assay))}</p>
        <p><strong>Updated:</strong> ${safeText(formatTimestamp(assay.updatedAt))}</p>
        <p><strong>Notes:</strong> ${safeText(assay.notes || '-')}</p>
        <div class="card-actions">
          <button type="button" class="primary-btn" data-assay-open-results="${assay.id}">Open Results</button>
          <button type="button" class="ghost-btn" data-assay-export-pdf="${assay.id}">Export PDF</button>
          <button type="button" class="ghost-btn" data-assay-edit="${assay.id}">Edit</button>
          <button type="button" class="danger-btn" data-assay-delete="${assay.id}">Delete</button>
        </div>
      </article>
    `).join('');
  }

  function loadAssayForResults(assayId) {
    const assay = getAssayById(assayId);
    if (!assay) {
      runtime.activeResultsAssayId = '';
      renderActiveAssayInfo(null);
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
    layoutManager.renderLayoutList();
    layoutManager.renderPlateDefinition();
    resultsManager.renderResultTable();
    renderActiveAssayInfo(assay);
    analysisView.clearOutput();
    setResultStatus(`Loaded ${resultsManager.getResultValueCount()} result value(s) for ${assay.assayNumber || assay.id}.`);
  }

  function setAssayMode(mode) {
    runtime.assayMode = mode === 'results' ? 'results' : 'create';
    const isCreate = runtime.assayMode === 'create';
    elements.assayCreatePanels.forEach((panel) => {
      panel.hidden = !isCreate;
    });
    elements.assayResultsPanels.forEach((panel) => {
      panel.hidden = isCreate;
    });
    elements.assayModeCreateBtn?.classList.toggle('calendar-view-active', isCreate);
    elements.assayModeResultsBtn?.classList.toggle('calendar-view-active', !isCreate);
    if (elements.assayModeNote) {
      elements.assayModeNote.textContent = '';
    }
    if (!isCreate) {
      renderResultsAssayOptions(runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '');
      const selected = elements.assayResultsAssaySelect?.value || runtime.activeResultsAssayId;
      if (selected) {
        loadAssayForResults(selected);
      } else {
        renderActiveAssayInfo(null);
      }
    }
  }

  function onResultsAssaySelected() {
    const assayId = elements.assayResultsAssaySelect?.value || '';
    if (!assayId) {
      runtime.activeResultsAssayId = '';
      renderActiveAssayInfo(null);
      setResultStatus('No assay plate selected.');
      return;
    }
    loadAssayForResults(assayId);
  }

  function onResultsAssayLoad() {
    const assayId = elements.assayResultsAssaySelect?.value || '';
    if (!assayId) {
      setResultStatus('Select an assay plate first.');
      return;
    }
    loadAssayForResults(assayId);
  }

  function onSaveResults() {
    ensureState();
    const assayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    if (!assayId) {
      setResultStatus('Select an assay plate first.');
      return;
    }
    const assay = getAssayById(assayId);
    if (!assay) {
      setResultStatus('Selected assay plate was not found.');
      return;
    }
    const def = getPlateDefinition(assay.plateType || elements.assayPlateTypeInput?.value || '96');
    resultsManager.syncCurrentResultsFromGrid();
    assay.resultValues = layoutManager.filterMappedResults(normalizeResults(runtime.currentResults, def));
    assay.updatedAt = new Date().toISOString();
    persist();
    renderResultsAssayOptions(assay.id);
    renderActiveAssayInfo(assay);
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
    setResultStatus(`Saved ${Object.keys(assay.resultValues || {}).length} result value(s) for ${assay.assayNumber || assay.id}.`);
  }

  function onSubmit(event) {
    event.preventDefault();
    ensureState();

    const name = elements.assayNameInput?.value.trim() || '';
    if (!name) {
      return;
    }

    const plateDef = getPlateDefinition(elements.assayPlateTypeInput?.value);
    const sampleAxis = elements.assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const concentrationAxis = oppositeAxis(sampleAxis);
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
      sampleAxisValues: axisValues.sampleValues,
      concentrationAxisValues: axisValues.concentrationValues,
      manualWellOverrides: normalizeManualWellOverrideMap(runtime.manualWellOverrides, plateDef),
      suppressedWells: Array.from(runtime.suppressedWells),
      notebookEntryId: elements.assayNotebookEntryInput?.value || '',
      notebookEntryProtocolName: notebookEntry?.protocolName || '',
      notebookEntryType: notebookEntry?.notebookType || '',
      wellLayout: normalizeLayout(runtime.currentLayout, plateDef),
      resultValues: layoutManager.filterMappedResults(normalizeResults(runtime.currentResults, plateDef)),
      notes: elements.assayNotesInput?.value.trim() || '',
      updatedAt: new Date().toISOString()
    };

    const index = state.assays.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      state.assays[index] = record;
    } else {
      state.assays.push(record);
    }

    persist();
    renderResultsAssayOptions(record.id);
    resetForm();
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
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
    if (elements.assayAnalysisMethodInput) {
      elements.assayAnalysisMethodInput.value = 'grouped_summary';
    }
    if (elements.assayAnalysisRowGroupsInput) {
      elements.assayAnalysisRowGroupsInput.value = '';
    }
    if (elements.assayAnalysisColumnGroupsInput) {
      elements.assayAnalysisColumnGroupsInput.value = '';
    }
    if (elements.assayAnalysisErrorBarsInput) {
      elements.assayAnalysisErrorBarsInput.checked = false;
    }
    if (elements.assayAnalysisGroupNameInput) {
      elements.assayAnalysisGroupNameInput.value = '';
    }
    resultsManager.setAnalysisSelectionStatus('');
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
    renderActiveAssayInfo(null);
    resultsManager.renderResultTable();
    layoutManager.renderLayoutList();
    analysisView.clearOutput();
    layoutManager.updateActiveWellPreviewState();
    setAssayMode('create');
  }

  function editAssay(assayId) {
    const assay = getAssayById(assayId);
    if (!assay) {
      return;
    }
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
    runtime.activeResultsAssayId = assay.id;
    layoutManager.syncAxisDisplay();
    layoutManager.renderPlateDefinition();
    layoutManager.renderPlatePreview(axisValues);
    renderAssayNumberDisplay();
    renderResultsAssayOptions(assay.id);
    renderActiveAssayInfo(assay);
    resultsManager.renderResultTable();
    layoutManager.renderLayoutList();
    elements.assayNotebookEntryInput.value = assay.notebookEntryId || '';
    if (assay.notebookEntryId && !Array.from(elements.assayNotebookEntryInput.options).some((option) => option.value === assay.notebookEntryId)) {
      const option = document.createElement('option');
      option.value = assay.notebookEntryId;
      option.textContent = `${assay.notebookEntryId} (missing notebook page)`;
      elements.assayNotebookEntryInput.append(option);
      elements.assayNotebookEntryInput.value = assay.notebookEntryId;
    }
    if (elements.assayNotesInput) {
      elements.assayNotesInput.value = assay.notes || '';
    }
    setCsvStatus(assay.wellLayout?.length ? `Loaded ${assay.wellLayout.length} mapped wells from saved assay.` : '');
    setResultStatus(`Loaded ${Object.keys(runtime.currentResults).length} result value(s) from saved assay.`);
    setLayoutStatus('');
    analysisView.clearOutput();
  }

  function deleteAssay(assayId) {
    state.assays = (state.assays || []).filter((item) => item.id !== assayId);
    if (runtime.activeResultsAssayId === assayId) {
      runtime.activeResultsAssayId = '';
      runtime.currentResults = {};
      runtime.currentLayout = [];
      resultsManager.renderResultTable();
      renderActiveAssayInfo(null);
      analysisView.clearOutput();
    }
    persist();
    renderResultsAssayOptions();
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
  }

  function exportAssayPdf(assayId) {
    const assay = getAssayById(assayId);
    if (!assay) {
      return;
    }
    exportAssayDefinitionPdf(assay);
  }

  function onListClick(event) {
    const openResultsBtn = event.target.closest('[data-assay-open-results]');
    if (openResultsBtn) {
      setAssayMode('results');
      loadAssayForResults(openResultsBtn.dataset.assayOpenResults);
      return;
    }

    const exportBtn = event.target.closest('[data-assay-export-pdf]');
    if (exportBtn) {
      exportAssayPdf(exportBtn.dataset.assayExportPdf);
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
    renderActiveAssayInfo(getAssayById(runtime.activeResultsAssayId));
    layoutManager.renderPlatePreview();
    resultsManager.renderResultTable();
    layoutManager.renderLayoutList();
    renderList();
    setAssayMode(runtime.assayMode);
  }

  elements.assayForm?.addEventListener('submit', onSubmit);
  elements.assayCancelBtn?.addEventListener('click', resetForm);
  elements.assayModeCreateBtn?.addEventListener('click', () => setAssayMode('create'));
  elements.assayModeResultsBtn?.addEventListener('click', () => setAssayMode('results'));
  elements.assayProjectInput?.addEventListener('change', renderNotebookOptions);
  elements.assayPlateTypeInput?.addEventListener('change', () => {
    layoutManager.onPlateTypeChange();
    renderAssayNumberDisplay();
  });
  elements.assaySampleAxisInput?.addEventListener('change', () => {
    layoutManager.syncAxisDisplay();
    layoutManager.setLayoutFromAxisAndOverrides();
    layoutManager.renderLayoutList();
    layoutManager.renderPlatePreview();
    resultsManager.renderResultTable();
  });
  elements.assaySampleAxisRowBtn?.addEventListener('click', () => layoutManager.setSampleAxis('row'));
  elements.assaySampleAxisColumnBtn?.addEventListener('click', () => layoutManager.setSampleAxis('column'));
  elements.assaySwapAxisBtn?.addEventListener('click', layoutManager.onSwapAxes);
  elements.assayPlateFieldSampleBtn?.addEventListener('click', () => layoutManager.setPlateEditField('sampleId'));
  elements.assayPlateFieldConcentrationBtn?.addEventListener('click', () => layoutManager.setPlateEditField('concentration'));
  elements.assayClearMappingsBtn?.addEventListener('click', layoutManager.onClearWellMappings);
  elements.assaySearchInput?.addEventListener('input', renderList);
  elements.assayExportTemplateBtn?.addEventListener('click', layoutManager.exportCsvTemplate);
  elements.assayImportTemplateBtn?.addEventListener('click', () => elements.assayImportFile?.click());
  elements.assayImportFile?.addEventListener('change', layoutManager.onImportCsv);
  elements.assayResultsAssaySelect?.addEventListener('change', onResultsAssaySelected);
  elements.assayAnalysisMethodInput?.addEventListener('change', analysisView.onAnalysisMethodChange);
  elements.assayAnalysisRowGroupsInput?.addEventListener('input', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisColumnGroupsInput?.addEventListener('input', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisErrorBarsInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisAddRowGroupBtn?.addEventListener('click', resultsManager.onAddSelectedRowGroup);
  elements.assayAnalysisAddColumnGroupBtn?.addEventListener('click', resultsManager.onAddSelectedColumnGroup);
  elements.assayAnalysisClearGroupsBtn?.addEventListener('click', resultsManager.onClearAnalysisGroups);
  elements.assayResultsLoadBtn?.addEventListener('click', onResultsAssayLoad);
  elements.assaySaveResultsBtn?.addEventListener('click', onSaveResults);
  elements.assayClearResultsBtn?.addEventListener('click', resultsManager.onClearResults);
  elements.assayAnalyzeResultsBtn?.addEventListener('click', analysisView.onAnalyzeResults);
  elements.assayResultTable?.addEventListener('paste', resultsManager.onResultTablePaste);
  elements.assayPlatePreview?.addEventListener('input', layoutManager.onPlatePreviewInput);
  elements.assayPlatePreview?.addEventListener('change', layoutManager.onPlatePreviewChange);
  elements.assayPlatePreview?.addEventListener('focusin', layoutManager.onPlatePreviewFocusIn);
  elements.assayPlatePreview?.addEventListener('click', layoutManager.onPlatePreviewClick);
  elements.assayLayoutList?.addEventListener('click', layoutManager.onLayoutListClick);
  elements.assayList?.addEventListener('click', onListClick);

  return {
    render,
    renderProjectOptions,
    renderNotebookOptions,
    renderList
  };
}
