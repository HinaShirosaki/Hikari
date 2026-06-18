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
import {
  axisLabel,
  notebookLabel,
  oppositeAxis
} from './shared.js';
import { serializeDraftSnapshot, snapshotFormControls } from '../unsaved-draft.js';

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
    concentrationUnit: '',
    manualWellOverrides: {},
    suppressedWells: new Set(),
    resultPasteAnchor: { rowIndex: 0, columnIndex: 0 }
  };

  let analysisView = null;
  let savedCreateDraftSnapshot = '';
  let savedResultsDraftSnapshot = '';

  function ensureState() {
    if (!Array.isArray(state.assays)) {
      state.assays = [];
    }
  }

  function getAssayById(assayId) {
    return (state.assays || []).find((item) => item.id === assayId);
  }

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
      currentResults: runtime.currentResults
    });
  }

  function markCreateDraftSaved() {
    savedCreateDraftSnapshot = getCreateDraftSnapshot();
  }

  function markResultsDraftSaved() {
    savedResultsDraftSnapshot = getResultsDraftSnapshot();
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

  function selectNotebookOption(value) {
    if (!elements.assayNotebookEntryInput) {
      return;
    }
    const targetValue = String(value || '').trim();
    if (!targetValue) {
      elements.assayNotebookEntryInput.value = '';
      return;
    }
    if (!Array.from(elements.assayNotebookEntryInput.options).some((option) => option.value === targetValue)) {
      const option = document.createElement('option');
      option.value = targetValue;
      option.textContent = `${targetValue} (missing notebook page)`;
      elements.assayNotebookEntryInput.append(option);
    }
    elements.assayNotebookEntryInput.value = targetValue;
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
    renderActiveAssayInfo(assay);
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
    void artifactStorage.persistAssayArtifacts(assay.id);
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

  function renderActiveAssayInfo(assay) {
    if (!elements.assayActiveAssayInfo) {
      return;
    }
    elements.assayActiveAssayInfo.textContent = '';
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

  function getActiveResultsAssay() {
    const assayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    return assayId ? getAssayById(assayId) : null;
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
    renderActiveAssayInfo(assay);
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
    await artifactStorage.persistAssayArtifacts(assay.id);
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
    onResultImportApplied: onAssayResultImportApplied
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
    getResultValueCount: resultsManager.getResultValueCount,
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
    }
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
      const label = assay.name || assay.id;
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
    if (!elements.assayList) {
      return;
    }
    ensureState();
    const term = String(elements.assaySearchInput?.value || '').trim().toLowerCase();
    const assays = sortedAssaysByUpdated();
    const rows = assays.filter((item) => matchesSearch(item, term));
    if (elements.assayBrowserCount) {
      elements.assayBrowserCount.textContent = term ? `${rows.length}/${assays.length}` : String(assays.length);
    }

    if (!rows.length) {
      elements.assayList.innerHTML = '<p class="small-note assay-browser-empty">No assays found.</p>';
      return;
    }

    elements.assayList.innerHTML = rows.map((assay) => {
      const title = assay.name || assay.assayNumber || assay.id || 'Untitled assay';
      return `
        <article class="assay-browser-item">
          <div class="assay-browser-item-copy">
            <p class="assay-browser-item-title">${safeText(title)}</p>
          </div>
          <div class="card-actions assay-browser-item-actions">
            <button type="button" class="ghost-btn" data-assay-edit="${assay.id}">Edit</button>
            <button type="button" class="danger-btn" data-assay-delete="${assay.id}">Delete</button>
          </div>
        </article>
      `;
    }).join('');
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
    layoutManager.renderPlateDefinition();
    resultsManager.renderResultTable();
    renderActiveAssayInfo(assay);
    analysisView.loadChartStyle(assay.chartStyle);
    analysisView.clearOutput();
    markResultsDraftSaved();
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
      return;
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
      return null;
    }
    const def = getPlateDefinition(assay.plateType || elements.assayPlateTypeInput?.value || '96');
    resultsManager.syncCurrentResultsFromGrid();
    assay.resultValues = layoutManager.filterMappedResults(normalizeResults(runtime.currentResults, def));
    assay.latestAnalysis = null;
    assay.updatedAt = new Date().toISOString();
    syncNotebookAssayLinks();
    persist();
    renderResultsAssayOptions(assay.id);
    renderActiveAssayInfo(assay);
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
    setResultStatus(`Saved ${Object.keys(assay.resultValues || {}).length} result value(s) for ${assay.assayNumber || assay.id}.`);
    void artifactStorage.persistAssayArtifacts(assay.id);
    markResultsDraftSaved();
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
    analysisView.clearOutput();
    layoutManager.updateActiveWellPreviewState();
    setAssayMode('create');
    markCreateDraftSaved();
    markResultsDraftSaved();
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
    renderActiveAssayInfo(assay);
    resultsManager.renderResultTable();
    elements.assayNotebookEntryInput.value = assay.notebookEntryId || '';
    if (assay.notebookEntryId && !Array.from(elements.assayNotebookEntryInput.options).some((option) => option.value === assay.notebookEntryId)) {
      const option = document.createElement('option');
      option.value = assay.notebookEntryId;
      option.textContent = `${assay.notebookEntryId} (missing notebook page)`;
      elements.assayNotebookEntryInput.append(option);
      elements.assayNotebookEntryInput.value = assay.notebookEntryId;
    }
    setCsvStatus(assay.wellLayout?.length ? `Loaded ${assay.wellLayout.length} mapped wells from saved assay.` : '');
    setResultStatus(`Loaded ${Object.keys(runtime.currentResults).length} result value(s) from saved assay.`);
    setLayoutStatus('');
    analysisView.clearOutput();
    markCreateDraftSaved();
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
    syncNotebookAssayLinks();
    persist();
    renderResultsAssayOptions();
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
  }

  function onListClick(event) {
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
    layoutManager.renderPlatePreview();
    resultsManager.renderResultTable();
  });
  elements.assaySampleAxisRowBtn?.addEventListener('click', () => layoutManager.setSampleAxis('row'));
  elements.assaySampleAxisColumnBtn?.addEventListener('click', () => layoutManager.setSampleAxis('column'));
  elements.assayConcentrationAxisInput?.addEventListener('change', () => {
    layoutManager.setConcentrationAxis(elements.assayConcentrationAxisInput?.value);
  });
  elements.assayConcentrationAxisRowBtn?.addEventListener('click', () => layoutManager.setConcentrationAxis('row'));
  elements.assayConcentrationAxisColumnBtn?.addEventListener('click', () => layoutManager.setConcentrationAxis('column'));
  elements.assayPlateFieldSampleBtn?.addEventListener('click', () => layoutManager.setPlateEditField('sampleId'));
  elements.assayPlateFieldConcentrationBtn?.addEventListener('click', () => layoutManager.setPlateEditField('concentration'));
  elements.assayConcentrationUnitInput?.addEventListener('input', layoutManager.onConcentrationUnitInput);
  elements.assayFillModeInput?.addEventListener('change', layoutManager.syncFillModeInputs);
  elements.assayDilutionFillBtn?.addEventListener('click', layoutManager.onFillConcentrations);
  layoutManager.syncFillModeInputs();
  elements.assayClearMappingsBtn?.addEventListener('click', layoutManager.onClearWellMappings);
  elements.assaySerialDilutionBtn?.addEventListener('click', layoutManager.openSerialDilutionDialog);
  elements.assaySerialDilutionCloseBtn?.addEventListener('click', layoutManager.closeSerialDilutionDialog);
  elements.assaySerialDilutionOverlay?.addEventListener('click', layoutManager.onSerialDilutionOverlayClick);
  elements.assaySerialDilutionOverlay?.addEventListener('input', layoutManager.onSerialDilutionDialogInput);
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
  elements.assayAttachResultFileBtn?.addEventListener('click', resultsManager.onAttachResultFileClick);
  elements.assayResultFileInput?.addEventListener('change', resultsManager.onResultFileChange);
  elements.assayResultImportOverlay?.addEventListener('click', resultsManager.onResultImportOverlayClick);
  elements.assayResultImportCandidates?.addEventListener('click', resultsManager.onResultImportCandidateClick);
  elements.assayResultImportCloseBtn?.addEventListener('click', resultsManager.closeResultImportDialog);
  elements.assayResultImportCancelBtn?.addEventListener('click', resultsManager.closeResultImportDialog);
  elements.assayResultImportApplyBtn?.addEventListener('click', resultsManager.applySelectedResultImportCandidate);
  elements.assaySaveResultsBtn?.addEventListener('click', onSaveResults);
  elements.assayClearResultsBtn?.addEventListener('click', resultsManager.onClearResults);
  elements.assayAnalyzeResultsBtn?.addEventListener('click', analysisView.onAnalyzeResults);
  elements.assayResultTable?.addEventListener('paste', resultsManager.onResultTablePaste);
  elements.assayPlatePreview?.addEventListener('input', layoutManager.onPlatePreviewInput);
  elements.assayPlatePreview?.addEventListener('change', layoutManager.onPlatePreviewChange);
  elements.assayPlatePreview?.addEventListener('focusin', layoutManager.onPlatePreviewFocusIn);
  elements.assayPlatePreview?.addEventListener('click', layoutManager.onPlatePreviewClick);
  elements.assayPlatePreview?.addEventListener('keydown', layoutManager.onPlatePreviewKeyDown);
  elements.assayPlatePreview?.addEventListener('contextmenu', layoutManager.onPlatePreviewContextMenu);
  elements.assayPlatePreview?.addEventListener('scroll', layoutManager.onPlatePreviewScroll, true);
  elements.assayList?.addEventListener('click', onListClick);
  globalThis.addEventListener?.('pointerdown', layoutManager.onGlobalPointerDown);
  globalThis.addEventListener?.('keydown', layoutManager.onGlobalKeyDown);

  return {
    hasUnsavedChanges: () => (
      Boolean(savedCreateDraftSnapshot && getCreateDraftSnapshot() !== savedCreateDraftSnapshot)
      || Boolean(savedResultsDraftSnapshot && getResultsDraftSnapshot() !== savedResultsDraftSnapshot)
    ),
    render,
    renderProjectOptions,
    renderNotebookOptions,
    renderList,
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
    startLinkedAssay
  };
}
