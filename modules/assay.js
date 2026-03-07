import { exportAssayDefinitionPdf } from './pdf-export.js';

const PLATE_DEFINITIONS = [
  { value: '6', label: '6 well', rows: 2, columns: 3 },
  { value: '12', label: '12 well', rows: 3, columns: 4 },
  { value: '24', label: '24 well', rows: 4, columns: 6 },
  { value: '48', label: '48 well', rows: 6, columns: 8 },
  { value: '96', label: '96 well', rows: 8, columns: 12 },
  { value: '384', label: '384 well', rows: 16, columns: 24 },
  { value: '1536', label: '1536 well', rows: 32, columns: 48 }
];
const ASSAY_NUMBER_PREFIX = 'ASY';
const ASSAY_NUMBER_PADDING = 6;

export function initAssay({ state, persist, createId, safeText, onAssaysChanged }) {
  const TabulatorLib = window.Tabulator || null;
  const ReactLib = window.React || null;
  const ReactDOMLib = window.ReactDOM || null;
  const ReactVisLib = window.reactVis || null;
  const hasReactVis = Boolean(ReactLib && ReactDOMLib && ReactVisLib);
  const assayForm = document.getElementById('assay-form');
  const assayIdInput = document.getElementById('assay-id');
  const assayNumberDisplay = document.getElementById('assay-number-display');
  const assayModeCreateBtn = document.getElementById('assay-mode-create-btn');
  const assayModeResultsBtn = document.getElementById('assay-mode-results-btn');
  const assayModeNote = document.getElementById('assay-mode-note');
  const assayCreatePanels = [...document.querySelectorAll('#assay-view .assay-mode-create-panel')];
  const assayResultsPanels = [...document.querySelectorAll('#assay-view .assay-mode-results-panel')];
  const assayNameInput = document.getElementById('assay-name');
  const assayProjectInput = document.getElementById('assay-project');
  const assayPlateTypeInput = document.getElementById('assay-plate-type');
  const assaySampleAxisInput = document.getElementById('assay-sample-axis');
  const assaySampleAxisRowBtn = document.getElementById('assay-sample-axis-row-btn');
  const assaySampleAxisColumnBtn = document.getElementById('assay-sample-axis-column-btn');
  const assayConcentrationAxisDisplay = document.getElementById('assay-concentration-axis-display');
  const assayNotebookEntryInput = document.getElementById('assay-notebook-entry');
  const assayNotesInput = document.getElementById('assay-notes');
  const assayCancelBtn = document.getElementById('assay-cancel-btn');
  const assaySearchInput = document.getElementById('assay-search');
  const assayPlateDefinition = document.getElementById('assay-plate-definition');
  const assayCsvStatus = document.getElementById('assay-csv-status');
  const assayExportTemplateBtn = document.getElementById('assay-export-template-btn');
  const assayImportTemplateBtn = document.getElementById('assay-import-template-btn');
  const assayImportFile = document.getElementById('assay-import-file');
  const assayPlatePreview = document.getElementById('assay-plate-preview');
  const assayResultStatus = document.getElementById('assay-result-status');
  const assayResultTable = document.getElementById('assay-result-table');
  const assayResultsAssaySelect = document.getElementById('assay-results-assay-select');
  const assayAnalysisMethodInput = document.getElementById('assay-analysis-method');
  const assayResultsLoadBtn = document.getElementById('assay-results-load-btn');
  const assaySaveResultsBtn = document.getElementById('assay-save-results-btn');
  const assayActiveAssayInfo = document.getElementById('assay-active-assay-info');
  const assayClearResultsBtn = document.getElementById('assay-clear-results-btn');
  const assayAnalyzeResultsBtn = document.getElementById('assay-analyze-results-btn');
  const assayAnalysisSummary = document.getElementById('assay-analysis-summary');
  const assayAnalysisTable = document.getElementById('assay-analysis-table');
  const assaySwapAxisBtn = document.getElementById('assay-swap-axis-btn');
  const assayPlateFieldSampleBtn = document.getElementById('assay-plate-field-sample-btn');
  const assayPlateFieldConcentrationBtn = document.getElementById('assay-plate-field-concentration-btn');
  const assayClearMappingsBtn = document.getElementById('assay-clear-mappings-btn');
  const assayLayoutStatus = document.getElementById('assay-layout-status');
  const assayLayoutList = document.getElementById('assay-layout-list');
  const assayList = document.getElementById('assay-list');
  let currentLayout = [];
  let currentResults = {};
  let assayMode = 'create';
  let activeResultsAssayId = '';
  let activeWellEditorId = '';
  let axisTemplateValues = { sampleValues: [], concentrationValues: [] };
  let plateEditField = 'sampleId';
  let manualWellOverrides = {};
  let suppressedWells = new Set();
  let resultGrid = null;
  let resultGridSignature = '';
  let resultPasteAnchor = { rowIndex: 0, columnIndex: 0 };
  let analysisChartHost = null;

  assayForm?.addEventListener('submit', onSubmit);
  assayCancelBtn?.addEventListener('click', resetForm);
  assayModeCreateBtn?.addEventListener('click', () => setAssayMode('create'));
  assayModeResultsBtn?.addEventListener('click', () => setAssayMode('results'));
  assayProjectInput?.addEventListener('change', renderNotebookOptions);
  assayPlateTypeInput?.addEventListener('change', onPlateTypeChange);
  assaySampleAxisInput?.addEventListener('change', () => {
    syncAxisDisplay();
    renderAxisSwitchButtons();
    setLayoutFromAxisAndOverrides();
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
  });
  assaySampleAxisRowBtn?.addEventListener('click', () => setSampleAxis('row'));
  assaySampleAxisColumnBtn?.addEventListener('click', () => setSampleAxis('column'));
  assaySwapAxisBtn?.addEventListener('click', onSwapAxes);
  assayPlateFieldSampleBtn?.addEventListener('click', () => setPlateEditField('sampleId'));
  assayPlateFieldConcentrationBtn?.addEventListener('click', () => setPlateEditField('concentration'));
  assayClearMappingsBtn?.addEventListener('click', onClearWellMappings);
  assaySearchInput?.addEventListener('input', renderList);
  assayExportTemplateBtn?.addEventListener('click', exportCsvTemplate);
  assayImportTemplateBtn?.addEventListener('click', () => assayImportFile?.click());
  assayImportFile?.addEventListener('change', onImportCsv);
  assayResultsAssaySelect?.addEventListener('change', onResultsAssaySelected);
  assayAnalysisMethodInput?.addEventListener('change', onAnalysisMethodChange);
  assayResultsLoadBtn?.addEventListener('click', onResultsAssayLoad);
  assaySaveResultsBtn?.addEventListener('click', onSaveResults);
  assayClearResultsBtn?.addEventListener('click', onClearResults);
  assayAnalyzeResultsBtn?.addEventListener('click', onAnalyzeResults);
  assayResultTable?.addEventListener('paste', onResultTablePaste);
  assayPlatePreview?.addEventListener('input', onPlatePreviewInput);
  assayPlatePreview?.addEventListener('change', onPlatePreviewChange);
  assayPlatePreview?.addEventListener('focusin', onPlatePreviewFocusIn);
  assayPlatePreview?.addEventListener('click', onPlatePreviewClick);
  assayLayoutList?.addEventListener('click', onLayoutListClick);
  assayList?.addEventListener('click', onListClick);

  function ensureState() {
    if (!Array.isArray(state.assays)) {
      state.assays = [];
    }
  }

  function getPlateDefinition(value) {
    return PLATE_DEFINITIONS.find((item) => item.value === String(value || '')) || PLATE_DEFINITIONS[0];
  }

  function oppositeAxis(axis) {
    return axis === 'column' ? 'row' : 'column';
  }

  function axisLabel(axis) {
    return axis === 'column' ? 'Column' : 'Row';
  }

  function renderAxisSwitchButtons() {
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    assaySampleAxisRowBtn?.classList.toggle('calendar-view-active', sampleAxis === 'row');
    assaySampleAxisColumnBtn?.classList.toggle('calendar-view-active', sampleAxis === 'column');
  }

  function setSampleAxis(axis) {
    if (!assaySampleAxisInput) {
      return;
    }
    const next = axis === 'column' ? 'column' : 'row';
    if (assaySampleAxisInput.value === next) {
      return;
    }
    assaySampleAxisInput.value = next;
    syncAxisDisplay();
    renderAxisSwitchButtons();
    setLayoutFromAxisAndOverrides();
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
  }

  function renderPlateEditFieldButtons() {
    assayPlateFieldSampleBtn?.classList.toggle('calendar-view-active', plateEditField === 'sampleId');
    assayPlateFieldConcentrationBtn?.classList.toggle('calendar-view-active', plateEditField === 'concentration');
  }

  function setPlateEditField(field) {
    plateEditField = field === 'concentration' ? 'concentration' : 'sampleId';
    renderPlateEditFieldButtons();
    renderPlatePreview();
  }

  function formatTimestamp(raw) {
    const value = Date.parse(String(raw || ''));
    return Number.isFinite(value) ? new Date(value).toLocaleString() : '-';
  }

  function notebookLabel(entry) {
    const type = entry.notebookType === 'biology' ? 'Biology' : 'Synthesis';
    return `${type}: ${entry.protocolName || '-'} (${formatTimestamp(entry.updatedAt)})`;
  }

  function setCsvStatus(message) {
    if (assayCsvStatus) {
      assayCsvStatus.textContent = message || '';
    }
  }

  function setLayoutStatus(message) {
    if (assayLayoutStatus) {
      assayLayoutStatus.textContent = message || '';
    }
  }

  function setResultStatus(message) {
    if (assayResultStatus) {
      assayResultStatus.textContent = message || '';
    }
  }

  function parseAssayNumberValue(value) {
    const match = String(value || '').trim().match(/(\d+)$/);
    if (!match) {
      return 0;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatAssayNumber(sequence) {
    return `${ASSAY_NUMBER_PREFIX}-${String(sequence).padStart(ASSAY_NUMBER_PADDING, '0')}`;
  }

  function ensureAssaySequence() {
    const maxAssigned = (state.assays || []).reduce((max, assay) => {
      return Math.max(max, parseAssayNumberValue(assay.assayNumber));
    }, 0);
    const current = Number(state.assaySequence);
    if (!Number.isFinite(current) || current <= maxAssigned) {
      state.assaySequence = maxAssigned + 1;
    }
  }

  function nextAssayNumber() {
    ensureAssaySequence();
    const value = formatAssayNumber(state.assaySequence);
    state.assaySequence += 1;
    return value;
  }

  function previewNextAssayNumber() {
    ensureAssaySequence();
    return formatAssayNumber(state.assaySequence);
  }

  function ensureAssayNumbers() {
    ensureState();
    ensureAssaySequence();
    let changed = false;
    (state.assays || []).forEach((assay) => {
      if (String(assay.assayNumber || '').trim()) {
        return;
      }
      assay.assayNumber = nextAssayNumber();
      changed = true;
    });
    return changed;
  }

  function getAssayById(assayId) {
    return (state.assays || []).find((item) => item.id === assayId);
  }

  function renderAssayNumberDisplay() {
    if (!assayNumberDisplay) {
      return;
    }
    const editingAssay = getAssayById(assayIdInput?.value || '');
    if (editingAssay) {
      assayNumberDisplay.textContent = `Assay Number: ${editingAssay.assayNumber || '-'}`;
      return;
    }
    assayNumberDisplay.textContent = `Assay Number (auto): ${previewNextAssayNumber()}`;
  }

  function renderActiveAssayInfo(assay) {
    if (!assayActiveAssayInfo) {
      return;
    }
    if (!assay) {
      assayActiveAssayInfo.textContent = 'No assay plate loaded.';
      return;
    }
    assayActiveAssayInfo.textContent = `Loaded ${assay.assayNumber || assay.id} | ${assay.name || '-'} | ${assay.plateLabel || `${assay.wellCount || '-'} well`}`;
  }

  function setAssayMode(mode) {
    assayMode = mode === 'results' ? 'results' : 'create';
    const isCreate = assayMode === 'create';
    assayCreatePanels.forEach((panel) => {
      panel.hidden = !isCreate;
    });
    assayResultsPanels.forEach((panel) => {
      panel.hidden = isCreate;
    });
    assayModeCreateBtn?.classList.toggle('calendar-view-active', isCreate);
    assayModeResultsBtn?.classList.toggle('calendar-view-active', !isCreate);
    if (assayModeNote) {
      assayModeNote.textContent = '';
    }
    if (!isCreate) {
      renderResultsAssayOptions(activeResultsAssayId || assayResultsAssaySelect?.value || '');
      const selected = assayResultsAssaySelect?.value || activeResultsAssayId;
      if (selected) {
        loadAssayForResults(selected);
      } else {
        renderActiveAssayInfo(null);
      }
    }
  }

  function toRowLabel(rowIndex) {
    let value = Number(rowIndex) + 1;
    let label = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  }

  function wellIdFor(rowIndex, columnIndex) {
    return `${toRowLabel(rowIndex)}${columnIndex + 1}`;
  }

  function rowLabelToIndex(label) {
    const value = String(label || '').trim().toUpperCase();
    if (!/^[A-Z]+$/.test(value)) {
      return -1;
    }
    let total = 0;
    for (let index = 0; index < value.length; index += 1) {
      total = (total * 26) + (value.charCodeAt(index) - 64);
    }
    return total - 1;
  }

  function parseWellId(wellId) {
    const normalized = String(wellId || '').trim().toUpperCase();
    const match = normalized.match(/^([A-Z]+)(\d+)$/);
    if (!match) {
      return null;
    }
    const rowIndex = rowLabelToIndex(match[1]);
    const columnIndex = Number(match[2]) - 1;
    if (rowIndex < 0 || !Number.isFinite(columnIndex) || columnIndex < 0) {
      return null;
    }
    return {
      well: normalized,
      rowIndex,
      columnIndex
    };
  }

  function buildAllWells(def) {
    const wells = [];
    for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
        wells.push({
          well: wellIdFor(rowIndex, columnIndex),
          row: toRowLabel(rowIndex),
          column: columnIndex + 1
        });
      }
    }
    return wells;
  }

  function normalizeLayout(layout, def) {
    const validIds = new Set(buildAllWells(def).map((item) => item.well));
    return (Array.isArray(layout) ? layout : [])
      .map((item) => ({
        well: String(item?.well || '').trim().toUpperCase(),
        sampleId: String(item?.sampleId || '').trim(),
        concentration: String(item?.concentration || '').trim()
      }))
      .filter((item) => validIds.has(item.well) && (item.sampleId || item.concentration));
  }

  function layoutToMap(layout) {
    const map = {};
    (layout || []).forEach((item) => {
      if (!item?.well) {
        return;
      }
      map[item.well] = {
        sampleId: String(item.sampleId || ''),
        concentration: String(item.concentration || '')
      };
    });
    return map;
  }

  function getMappedWellSet() {
    return new Set((currentLayout || []).map((item) => String(item.well || '').trim().toUpperCase()).filter(Boolean));
  }

  function isMappedWell(wellId) {
    return getMappedWellSet().has(String(wellId || '').trim().toUpperCase());
  }

  function filterResultsToMappedWells(results) {
    const mapped = getMappedWellSet();
    if (!mapped.size) {
      return {};
    }
    const filtered = {};
    Object.entries(results || {}).forEach(([well, value]) => {
      const normalizedWell = String(well || '').trim().toUpperCase();
      if (!mapped.has(normalizedWell)) {
        return;
      }
      const normalizedValue = String(value ?? '').trim();
      if (!normalizedValue) {
        return;
      }
      filtered[normalizedWell] = normalizedValue;
    });
    return filtered;
  }

  function normalizeResults(results, def) {
    const validIds = new Set(buildAllWells(def).map((item) => item.well));
    const normalized = {};

    if (Array.isArray(results)) {
      results.forEach((item) => {
        const well = String(item?.well || '').trim().toUpperCase();
        const value = String(item?.value ?? '').trim();
        if (!value || !validIds.has(well)) {
          return;
        }
        normalized[well] = value;
      });
      return normalized;
    }

    if (!results || typeof results !== 'object') {
      return normalized;
    }

    Object.entries(results).forEach(([well, value]) => {
      const normalizedWell = String(well || '').trim().toUpperCase();
      const normalizedValue = String(value ?? '').trim();
      if (!normalizedValue || !validIds.has(normalizedWell)) {
        return;
      }
      normalized[normalizedWell] = normalizedValue;
    });

    return normalized;
  }

  function getCurrentDefinition() {
    return getPlateDefinition(assayPlateTypeInput?.value);
  }

  function isValidWellForDefinition(wellId, def) {
    const parsed = parseWellId(wellId);
    if (!parsed) {
      return false;
    }
    return parsed.rowIndex < def.rows && parsed.columnIndex < def.columns;
  }

  function sortLayout(layout) {
    return (layout || []).slice().sort((a, b) => {
      const pa = parseWellId(a.well);
      const pb = parseWellId(b.well);
      if (!pa && !pb) {
        return String(a.well).localeCompare(String(b.well));
      }
      if (!pa) {
        return 1;
      }
      if (!pb) {
        return -1;
      }
      if (pa.rowIndex !== pb.rowIndex) {
        return pa.rowIndex - pb.rowIndex;
      }
      return pa.columnIndex - pb.columnIndex;
    });
  }

  function sanitizeFilePart(text, fallback) {
    const cleaned = String(text || '')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return cleaned || fallback;
  }

  function escapeCsv(value) {
    const text = String(value || '');
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    values.push(current);
    return values;
  }

  function getAxisLength(axis, def) {
    return axis === 'column' ? def.columns : def.rows;
  }

  function normalizeAxisTemplateValues(values, maxLength) {
    return (Array.isArray(values) ? values : [])
      .map((item) => String(item || '').trim())
      .slice(0, maxLength);
  }

  function normalizeCurrentAxisTemplateValues(values, def = getCurrentDefinition(), sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row') {
    return {
      sampleValues: normalizeAxisTemplateValues(values?.sampleValues, getAxisLength(sampleAxis, def)),
      concentrationValues: normalizeAxisTemplateValues(values?.concentrationValues, getAxisLength(oppositeAxis(sampleAxis), def))
    };
  }

  function setAxisTemplateValues(values, def = getCurrentDefinition(), sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row') {
    axisTemplateValues = normalizeCurrentAxisTemplateValues(values, def, sampleAxis);
    return axisTemplateValues;
  }

  function hasAxisTemplateValues(values) {
    return (Array.isArray(values) ? values : []).some((item) => String(item || '').trim());
  }

  function readAxisValuesFromPlatePreview() {
    if (!assayPlatePreview) {
      return null;
    }
    const rowInputs = [...assayPlatePreview.querySelectorAll('[data-axis-dimension="row"]')];
    const columnInputs = [...assayPlatePreview.querySelectorAll('[data-axis-dimension="column"]')];
    if (!rowInputs.length && !columnInputs.length) {
      return null;
    }
    const def = getCurrentDefinition();
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const sampleLength = getAxisLength(sampleAxis, def);
    const concentrationLength = getAxisLength(oppositeAxis(sampleAxis), def);
    const sampleValues = new Array(sampleLength).fill('');
    const concentrationValues = new Array(concentrationLength).fill('');
    rowInputs.forEach((input) => {
      const index = Number(input.dataset.axisIndex);
      if (!Number.isFinite(index) || index < 0) {
        return;
      }
      const text = String(input.value || '').trim();
      if (sampleAxis === 'row') {
        if (index < sampleValues.length) {
          sampleValues[index] = text;
        }
      } else if (index < concentrationValues.length) {
        concentrationValues[index] = text;
      }
    });
    columnInputs.forEach((input) => {
      const index = Number(input.dataset.axisIndex);
      if (!Number.isFinite(index) || index < 0) {
        return;
      }
      const text = String(input.value || '').trim();
      if (sampleAxis === 'column') {
        if (index < sampleValues.length) {
          sampleValues[index] = text;
        }
      } else if (index < concentrationValues.length) {
        concentrationValues[index] = text;
      }
    });
    return {
      sampleValues,
      concentrationValues
    };
  }

  function mergeAxisTemplateValues(...sources) {
    const def = getCurrentDefinition();
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const sampleLength = getAxisLength(sampleAxis, def);
    const concentrationLength = getAxisLength(oppositeAxis(sampleAxis), def);
    const merged = {
      sampleValues: new Array(sampleLength).fill(''),
      concentrationValues: new Array(concentrationLength).fill('')
    };

    sources.filter(Boolean).forEach((source) => {
      if (Array.isArray(source.sampleValues)) {
        for (let index = 0; index < Math.min(source.sampleValues.length, sampleLength); index += 1) {
          merged.sampleValues[index] = String(source.sampleValues[index] || '').trim();
        }
      }
      if (Array.isArray(source.concentrationValues)) {
        for (let index = 0; index < Math.min(source.concentrationValues.length, concentrationLength); index += 1) {
          merged.concentrationValues[index] = String(source.concentrationValues[index] || '').trim();
        }
      }
    });

    return merged;
  }

  function getAxisTemplateValues({ includePreview = true } = {}) {
    const sources = [axisTemplateValues];
    if (includePreview) {
      sources.push(readAxisValuesFromPlatePreview());
    }
    return mergeAxisTemplateValues(...sources);
  }

  function normalizeManualWellOverrideMap(source, def) {
    const normalized = {};
    Object.entries(source || {}).forEach(([well, value]) => {
      const normalizedWell = String(well || '').trim().toUpperCase();
      if (!normalizedWell || !isValidWellForDefinition(normalizedWell, def)) {
        return;
      }
      const sampleId = String(value?.sampleId || '').trim();
      const concentration = String(value?.concentration || '').trim();
      if (!sampleId && !concentration) {
        return;
      }
      normalized[normalizedWell] = { sampleId, concentration };
    });
    return normalized;
  }

  function normalizeManualWellOverrides(def) {
    manualWellOverrides = normalizeManualWellOverrideMap(manualWellOverrides, def);
  }

  function normalizeSuppressedWells(def) {
    const validIds = new Set(buildAllWells(def).map((item) => item.well));
    suppressedWells = new Set(
      Array.from(suppressedWells || [])
        .map((well) => String(well || '').trim().toUpperCase())
        .filter((well) => validIds.has(well))
    );
  }

  function setLayoutFromAxisAndOverrides({ preserveActiveWell = true, axisValues = null } = {}) {
    const def = getCurrentDefinition();
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const normalizedAxisValues = axisValues
      ? normalizeCurrentAxisTemplateValues(axisValues, def, sampleAxis)
      : getAxisTemplateValues();
    const { sampleValues, concentrationValues } = normalizedAxisValues;
    syncAxisTemplateValues(normalizedAxisValues);
    normalizeManualWellOverrides(def);
    normalizeSuppressedWells(def);
    const baseLayout = applyAxisTemplate({
      def,
      sampleAxis,
      sampleValues,
      concentrationValues
    });
    const map = layoutToMap(baseLayout);
    Object.entries(manualWellOverrides).forEach(([well, value]) => {
      const sampleId = String(value?.sampleId || '').trim();
      const concentration = String(value?.concentration || '').trim();
      if (!sampleId && !concentration) {
        delete map[well];
        return;
      }
      map[well] = { sampleId, concentration };
    });
    suppressedWells.forEach((well) => {
      delete map[well];
    });
    currentLayout = normalizeLayout(Object.entries(map).map(([well, value]) => ({
      well,
      sampleId: value.sampleId,
      concentration: value.concentration
    })), def);
    currentResults = filterResultsToMappedWells(currentResults);
    if (preserveActiveWell && activeWellEditorId && !isValidWellForDefinition(activeWellEditorId, def)) {
      activeWellEditorId = '';
    }
  }

  function getEffectiveWellMapping(wellId) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell) {
      return { sampleId: '', concentration: '' };
    }
    const currentMap = layoutToMap(currentLayout);
    const current = currentMap[normalizedWell];
    if (current) {
      return {
        sampleId: String(current.sampleId || '').trim(),
        concentration: String(current.concentration || '').trim()
      };
    }
    return { sampleId: '', concentration: '' };
  }

  function updateActiveWellPreviewState() {
    if (!assayPlatePreview) {
      return;
    }
    [...assayPlatePreview.querySelectorAll('[data-well]')].forEach((cell) => {
      cell.classList.toggle('is-active', String(cell.dataset.well || '').trim().toUpperCase() === activeWellEditorId);
    });
  }

  function setActiveWellSelection(wellId) {
    activeWellEditorId = String(wellId || '').trim().toUpperCase();
    updateActiveWellPreviewState();
  }

  function updateInlineWellOverride(wellId, field, rawValue) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell) {
      return;
    }

    const def = getCurrentDefinition();
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const { sampleValues, concentrationValues } = getAxisTemplateValues();
    const baseMap = layoutToMap(applyAxisTemplate({
      def,
      sampleAxis,
      sampleValues,
      concentrationValues
    }));
    const current = getEffectiveWellMapping(normalizedWell);
    const base = baseMap[normalizedWell] || { sampleId: '', concentration: '' };
    const next = {
      sampleId: current.sampleId,
      concentration: current.concentration
    };

    next[field === 'concentration' ? 'concentration' : 'sampleId'] = String(rawValue || '').trim();

    const matchesBase = next.sampleId === String(base.sampleId || '').trim()
      && next.concentration === String(base.concentration || '').trim();

    if (!next.sampleId && !next.concentration) {
      delete manualWellOverrides[normalizedWell];
      if (base.sampleId || base.concentration) {
        suppressedWells.add(normalizedWell);
      } else {
        suppressedWells.delete(normalizedWell);
      }
    } else if (matchesBase) {
      delete manualWellOverrides[normalizedWell];
      suppressedWells.delete(normalizedWell);
    } else {
      suppressedWells.delete(normalizedWell);
      manualWellOverrides[normalizedWell] = next;
    }

    activeWellEditorId = normalizedWell;
    setLayoutFromAxisAndOverrides();
  }

  function deriveManualWellOverridesFromLayout(layout, def, axisValues = null) {
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const { sampleValues, concentrationValues } = axisValues
      ? normalizeCurrentAxisTemplateValues(axisValues, def, sampleAxis)
      : getAxisTemplateValues();
    const baseLayout = applyAxisTemplate({
      def,
      sampleAxis,
      sampleValues,
      concentrationValues
    });
    const baseMap = layoutToMap(baseLayout);
    const currentMap = layoutToMap(layout);
    const keys = new Set([
      ...Object.keys(baseMap),
      ...Object.keys(currentMap)
    ]);
    const overrides = {};
    keys.forEach((well) => {
      if (!isValidWellForDefinition(well, def)) {
        return;
      }
      const base = baseMap[well] || { sampleId: '', concentration: '' };
      const current = currentMap[well] || { sampleId: '', concentration: '' };
      if (!current.sampleId && !current.concentration) {
        return;
      }
      if (String(base.sampleId || '').trim() === String(current.sampleId || '').trim()
        && String(base.concentration || '').trim() === String(current.concentration || '').trim()) {
        return;
      }
      overrides[well] = {
        sampleId: String(current.sampleId || '').trim(),
        concentration: String(current.concentration || '').trim()
      };
    });
    manualWellOverrides = overrides;
  }

  function syncAxisTemplateValues(values = null) {
    setAxisTemplateValues(values || getAxisTemplateValues());
  }

  function onSwapAxes() {
    if (!assaySampleAxisInput) {
      return;
    }
    const { sampleValues, concentrationValues } = getAxisTemplateValues();
    assaySampleAxisInput.value = assaySampleAxisInput.value === 'column' ? 'row' : 'column';
    syncAxisDisplay();
    const swapped = {
      sampleValues: concentrationValues,
      concentrationValues: sampleValues
    };
    syncAxisTemplateValues(swapped);
    setLayoutFromAxisAndOverrides();
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(`Switched axes. Sample axis is now ${axisLabel(assaySampleAxisInput.value)}.`);
  }

  function applyAxisTemplate({
    def,
    sampleAxis,
    sampleValues,
    concentrationValues,
    mappingMode = 'auto'
  }) {
    const requireIntersection = mappingMode === 'union'
      ? false
      : hasAxisTemplateValues(sampleValues) && hasAxisTemplateValues(concentrationValues);
    const layout = [];
    for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
        const sampleId = sampleAxis === 'row'
          ? (sampleValues[rowIndex] || '')
          : (sampleValues[columnIndex] || '');
        const concentration = sampleAxis === 'row'
          ? (concentrationValues[columnIndex] || '')
          : (concentrationValues[rowIndex] || '');
        if (requireIntersection) {
          if (!sampleId || !concentration) {
            continue;
          }
        } else if (!sampleId && !concentration) {
          continue;
        }
        layout.push({
          well: wellIdFor(rowIndex, columnIndex),
          sampleId,
          concentration
        });
      }
    }
    return layout;
  }

  function layoutsEqual(left, right, def) {
    const leftMap = layoutToMap(normalizeLayout(left, def));
    const rightMap = layoutToMap(normalizeLayout(right, def));
    const keys = new Set([
      ...Object.keys(leftMap),
      ...Object.keys(rightMap)
    ]);

    for (const key of keys) {
      const leftValue = leftMap[key] || { sampleId: '', concentration: '' };
      const rightValue = rightMap[key] || { sampleId: '', concentration: '' };
      if (String(leftValue.sampleId || '').trim() !== String(rightValue.sampleId || '').trim()
        || String(leftValue.concentration || '').trim() !== String(rightValue.concentration || '').trim()) {
        return false;
      }
    }
    return true;
  }

  function removeSuppressedWellsFromLayout(layout, def, suppressed = suppressedWells) {
    const map = layoutToMap(normalizeLayout(layout, def));
    Array.from(suppressed || []).forEach((well) => {
      delete map[String(well || '').trim().toUpperCase()];
    });
    return normalizeLayout(Object.entries(map).map(([well, value]) => ({
      well,
      sampleId: value.sampleId,
      concentration: value.concentration
    })), def);
  }

  function getAssayAxisTemplateValues(assay, def) {
    const sampleAxis = assay?.sampleAxis === 'column' ? 'column' : 'row';
    return normalizeCurrentAxisTemplateValues({
      sampleValues: assay?.sampleAxisValues,
      concentrationValues: assay?.concentrationAxisValues
    }, def, sampleAxis);
  }

  function restoreAssayLayoutState(assay, def) {
    const sampleAxis = assay?.sampleAxis === 'column' ? 'column' : 'row';
    const axisValues = getAssayAxisTemplateValues(assay, def);
    setAxisTemplateValues(axisValues, def, sampleAxis);
    suppressedWells = new Set(Array.isArray(assay?.suppressedWells) ? assay.suppressedWells : []);
    activeWellEditorId = '';

    const savedLayout = normalizeLayout(assay?.wellLayout, def);
    const persistedOverrides = normalizeManualWellOverrideMap(assay?.manualWellOverrides, def);

    if (Object.keys(persistedOverrides).length) {
      manualWellOverrides = persistedOverrides;
    } else {
      manualWellOverrides = {};
      const expectedIntersectionLayout = removeSuppressedWellsFromLayout(applyAxisTemplate({
        def,
        sampleAxis,
        sampleValues: axisValues.sampleValues,
        concentrationValues: axisValues.concentrationValues
      }), def);
      const expectedLegacyUnionLayout = removeSuppressedWellsFromLayout(applyAxisTemplate({
        def,
        sampleAxis,
        sampleValues: axisValues.sampleValues,
        concentrationValues: axisValues.concentrationValues,
        mappingMode: 'union'
      }), def);

      if (!layoutsEqual(savedLayout, expectedIntersectionLayout, def)
        && !layoutsEqual(savedLayout, expectedLegacyUnionLayout, def)) {
        deriveManualWellOverridesFromLayout(savedLayout, def, axisValues);
      }
    }

    setLayoutFromAxisAndOverrides({ axisValues });
    currentResults = filterResultsToMappedWells(normalizeResults(assay?.resultValues, def));
    return axisValues;
  }

  function renderPlatePreview(sourceValues = null) {
    if (!assayPlatePreview) {
      return;
    }
    const def = getCurrentDefinition();
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const concentrationAxis = oppositeAxis(sampleAxis);
    const cellMap = layoutToMap(currentLayout);
    const totalWells = def.rows * def.columns;
    const maxRows = totalWells > 384 ? 16 : def.rows;
    const maxColumns = totalWells > 384 ? 24 : def.columns;

    const { sampleValues, concentrationValues } = sourceValues
      ? normalizeCurrentAxisTemplateValues(sourceValues, def, sampleAxis)
      : getAxisTemplateValues();
    const rowAxisRole = sampleAxis === 'row' ? 'sample' : 'concentration';
    const columnAxisRole = sampleAxis === 'row' ? 'concentration' : 'sample';
    const rowAxisLabel = rowAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
    const columnAxisLabel = columnAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
    const rowAxisValues = rowAxisRole === 'sample' ? sampleValues : concentrationValues;
    const columnAxisValues = columnAxisRole === 'sample' ? sampleValues : concentrationValues;

    const headers = ['<th></th>', `<th>${safeText(rowAxisLabel)}</th>`];
    for (let col = 0; col < maxColumns; col += 1) {
      headers.push(`<th>${col + 1}</th>`);
    }

    const axisRowCells = [`<th>${safeText(columnAxisLabel)}</th>`, '<td></td>'];
    for (let col = 0; col < maxColumns; col += 1) {
      const value = String(columnAxisValues[col] || '');
      axisRowCells.push(`
        <td>
          <input
            type="text"
            data-axis-dimension="column"
            data-axis-index="${col}"
            value="${safeText(value)}"
            placeholder="${columnAxisRole === 'sample' ? 'Sample' : 'Conc'}"
          />
        </td>
      `);
    }

    const rows = [];
    for (let row = 0; row < maxRows; row += 1) {
      const rowLabel = toRowLabel(row);
      const rowAxisValue = String(rowAxisValues[row] || '');
      const cells = [
        `<th>${rowLabel}</th>`,
        `
          <td>
            <input
              type="text"
              data-axis-dimension="row"
              data-axis-index="${row}"
              value="${safeText(rowAxisValue)}"
              placeholder="${rowAxisRole === 'sample' ? 'Sample' : 'Conc'}"
            />
          </td>
        `
      ];
      for (let col = 0; col < maxColumns; col += 1) {
        const well = wellIdFor(row, col);
        const layout = cellMap[well];
        const filled = layout && (layout.sampleId || layout.concentration) ? ' is-filled' : '';
        const active = activeWellEditorId === well ? ' is-active' : '';
        const sampleValue = String(layout?.sampleId || '').trim();
        const concentrationValue = String(layout?.concentration || '').trim();
        const sampleLabel = sampleValue || '-';
        const concentrationLabel = concentrationValue || '-';
        const editable = plateEditField === 'concentration' ? 'Concentration' : 'Sample ID';
        const editableValue = plateEditField === 'concentration' ? concentrationValue : sampleValue;
        const secondaryMeta = plateEditField === 'concentration'
          ? `S: ${safeText(sampleLabel)}`
          : `C: ${safeText(concentrationLabel)}`;
        const meta = layout
          ? `Sample ID: ${layout.sampleId || '-'} | Concentration: ${layout.concentration || '-'}`
          : 'Sample ID: - | Concentration: -';
        cells.push(`
          <td class="assay-well${filled}${active}" data-well="${well}" title="${safeText(`${well} • ${meta} • Click to edit ${editable}`)}">
            <div class="assay-well-id">${safeText(well)}</div>
            <input
              type="text"
              class="assay-well-inline-input"
              data-well-inline-field="${plateEditField}"
              data-well="${well}"
              value="${safeText(editableValue)}"
              placeholder="${plateEditField === 'concentration' ? 'Conc' : 'Sample'}"
            />
            <div class="assay-well-meta">${secondaryMeta}</div>
          </td>
        `);
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }

    const note = totalWells > 384
      ? `<p class="small-note">Previewing first ${maxRows} rows x ${maxColumns} columns for ${def.label} plate.</p>`
      : '';

    assayPlatePreview.innerHTML = `
      <p class="small-note">Sample ID axis: ${axisLabel(sampleAxis)}. Concentration axis: ${axisLabel(concentrationAxis)}. When both axes have values, mapped wells use the x by y intersection area only. Type directly in a well cell for a specific override.</p>
      ${note}
      <div class="assay-plate-table-wrap">
        <table class="assay-plate-table">
          <thead><tr>${headers.join('')}</tr></thead>
          <tbody><tr class="assay-plate-editor-row">${axisRowCells.join('')}</tr>${rows.join('')}</tbody>
        </table>
      </div>
    `;
  }

  function getResultValueCount() {
    return Object.keys(currentResults || {}).length;
  }

  function toResultField(columnIndex) {
    return `c${columnIndex + 1}`;
  }

  function resultFieldToColumnIndex(field) {
    const parsed = Number(String(field || '').replace(/^c/, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return -1;
    }
    return parsed - 1;
  }

  function buildResultGridColumns(def) {
    const columns = [
      {
        title: '',
        field: 'rowLabel',
        width: 62,
        minWidth: 62,
        headerSort: false,
        hozAlign: 'center',
        frozen: true,
        editable: false
      }
    ];
    for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
      columns.push({
        title: String(columnIndex + 1),
        field: toResultField(columnIndex),
        editor: 'input',
        editable: (cell) => {
          const rowIndex = Number(cell.getRow()?.getData()?.__rowIndex);
          if (!Number.isFinite(rowIndex) || rowIndex < 0) {
            return false;
          }
          return isMappedWell(wellIdFor(rowIndex, columnIndex));
        },
        formatter: (cell) => {
          const rowIndex = Number(cell.getRow()?.getData()?.__rowIndex);
          const value = String(cell.getValue() || '');
          if (!Number.isFinite(rowIndex) || rowIndex < 0) {
            return value;
          }
          const well = wellIdFor(rowIndex, columnIndex);
          const mapped = isMappedWell(well);
          const element = cell.getElement();
          element.classList.toggle('assay-result-disabled', !mapped);
          if (!mapped) {
            return value || '—';
          }
          return value;
        },
        headerSort: false,
        hozAlign: 'center',
        headerHozAlign: 'center',
        minWidth: 76
      });
    }
    return columns;
  }

  function buildResultGridData(def) {
    const rows = [];
    for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
      const row = {
        __rowIndex: rowIndex,
        rowLabel: toRowLabel(rowIndex)
      };
      for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
        const well = wellIdFor(rowIndex, columnIndex);
        row[toResultField(columnIndex)] = currentResults[well] || '';
      }
      rows.push(row);
    }
    return rows;
  }

  function setResultValue(rowIndex, columnIndex, rawValue) {
    const value = String(rawValue ?? '').trim();
    const well = wellIdFor(rowIndex, columnIndex);
    if (!isMappedWell(well)) {
      return false;
    }
    if (!value) {
      delete currentResults[well];
      return true;
    }
    currentResults[well] = value;
    return true;
  }

  function clearResultGrid() {
    if (!resultGrid) {
      return;
    }
    resultGrid.destroy();
    resultGrid = null;
    resultGridSignature = '';
  }

  function onResultGridCellEdited(cell) {
    const field = cell.getField();
    const columnIndex = resultFieldToColumnIndex(field);
    if (columnIndex < 0) {
      return;
    }
    const rowIndex = Number(cell.getRow()?.getData()?.__rowIndex);
    if (!Number.isFinite(rowIndex) || rowIndex < 0) {
      return;
    }
    const updated = setResultValue(rowIndex, columnIndex, cell.getValue());
    if (!updated) {
      renderResultTable();
      setResultStatus(`Only mapped wells accept result values. ${wellIdFor(rowIndex, columnIndex)} is not mapped.`);
      return;
    }
    resultPasteAnchor = { rowIndex, columnIndex };
    setResultStatus(`Result wells with values: ${getResultValueCount()}. Only mapped wells are editable.`);
  }

  function onResultGridCellClick(_event, cell) {
    const field = cell.getField();
    const columnIndex = resultFieldToColumnIndex(field);
    if (columnIndex < 0) {
      return;
    }
    const rowIndex = Number(cell.getRow()?.getData()?.__rowIndex);
    if (!Number.isFinite(rowIndex) || rowIndex < 0) {
      return;
    }
    resultPasteAnchor = { rowIndex, columnIndex };
    setResultStatus(`Active cell: ${wellIdFor(rowIndex, columnIndex)}.`);
  }

  function getResultGridHeight(def) {
    const visibleRows = Math.min(def.rows, 14);
    return `${Math.max(260, (visibleRows * 33) + 58)}px`;
  }

  function ensureResultGrid(def) {
    if (!assayResultTable) {
      return false;
    }
    if (!TabulatorLib) {
      assayResultTable.innerHTML = '<p class="small-note">Spreadsheet component failed to load (Tabulator).</p>';
      return false;
    }
    const signature = `${def.rows}x${def.columns}`;
    if (!resultGrid || resultGridSignature !== signature) {
      clearResultGrid();
      assayResultTable.innerHTML = '';
      const host = document.createElement('div');
      host.className = 'assay-tabulator assay-result-paste-target';
      host.dataset.resultPasteTarget = 'true';
      host.tabIndex = 0;
      host.setAttribute('role', 'grid');
      host.setAttribute('aria-label', 'Assay result spreadsheet');
      assayResultTable.append(host);
      resultGrid = new TabulatorLib(host, {
        data: buildResultGridData(def),
        columns: buildResultGridColumns(def),
        index: '__rowIndex',
        height: getResultGridHeight(def),
        layout: 'fitDataTable',
        reactiveData: false,
        cellEdited: onResultGridCellEdited,
        cellClick: onResultGridCellClick
      });
      host.addEventListener('focus', () => {
        setResultStatus('Table selected. Paste starts at A1 unless a result cell is selected.');
      });
      resultGridSignature = signature;
      return true;
    }
    resultGrid.replaceData(buildResultGridData(def));
    return true;
  }

  function renderResultTable() {
    const def = getCurrentDefinition();
    if (!ensureResultGrid(def)) {
      return;
    }
    setResultStatus(`Result wells with values: ${getResultValueCount()}. Only mapped wells are editable.`);
  }

  function syncCurrentResultsFromGrid() {
    const def = getCurrentDefinition();

    if (!resultGrid) {
      currentResults = filterResultsToMappedWells(normalizeResults(currentResults, def));
      return currentResults;
    }

    const editingCell = resultGrid.modules?.edit?.currentCell;
    if (editingCell?.getComponent) {
      const cellComponent = editingCell.getComponent();
      const editorElement = cellComponent.getElement?.()?.querySelector?.('input, textarea, select');
      if (editorElement) {
        cellComponent.setValue(String(editorElement.value ?? '').trim(), true);
      }
    }

    const nextResults = {};
    const rows = typeof resultGrid.getRows === 'function' ? resultGrid.getRows() : [];
    rows.forEach((row) => {
      const data = row?.getData?.();
      const rowIndex = Number(data?.__rowIndex);
      if (!Number.isFinite(rowIndex) || rowIndex < 0) {
        return;
      }

      for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
        const well = wellIdFor(rowIndex, columnIndex);
        if (!isMappedWell(well)) {
          continue;
        }
        const value = String(data?.[toResultField(columnIndex)] ?? '').trim();
        if (value) {
          nextResults[well] = value;
        }
      }
    });

    currentResults = filterResultsToMappedWells(normalizeResults(nextResults, def));
    return currentResults;
  }

  function parseClipboardGrid(text) {
    const rows = String(text || '')
      .replace(/\r/g, '')
      .split('\n');
    if (rows.length && rows[rows.length - 1] === '') {
      rows.pop();
    }
    return rows
      .map((row) => row.split('\t'))
      .filter((cells) => cells.length);
  }

  function getPasteStartCell(event) {
    if (!event.target.closest('#assay-result-table')) {
      return null;
    }
    const cellTarget = event.target.closest('.tabulator-cell');
    if (cellTarget) {
      return {
        rowIndex: resultPasteAnchor.rowIndex,
        columnIndex: resultPasteAnchor.columnIndex,
        fromTableSelection: false
      };
    }
    return {
      rowIndex: 0,
      columnIndex: 0,
      fromTableSelection: true
    };
  }

  function applyResultMatrix({ matrix, startRowIndex, startColumnIndex, replaceAll }) {
    const def = getCurrentDefinition();
    if (replaceAll) {
      currentResults = {};
    }
    let pastedCount = 0;
    let skippedCount = 0;
    for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) {
      const rowIndex = startRowIndex + rowOffset;
      if (rowIndex >= def.rows) {
        break;
      }
      const rowCells = matrix[rowOffset];
      for (let columnOffset = 0; columnOffset < rowCells.length; columnOffset += 1) {
        const columnIndex = startColumnIndex + columnOffset;
        if (columnIndex >= def.columns) {
          break;
        }
        const well = wellIdFor(rowIndex, columnIndex);
        if (!isMappedWell(well)) {
          skippedCount += 1;
          continue;
        }
        const value = String(rowCells[columnOffset] || '').trim();
        setResultValue(rowIndex, columnIndex, value);
        if (value) {
          pastedCount += 1;
        }
      }
    }
    resultPasteAnchor = { rowIndex: startRowIndex, columnIndex: startColumnIndex };
    return { pastedCount, skippedCount };
  }

  function onResultTablePaste(event) {
    const start = getPasteStartCell(event);
    if (!start) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') || '';
    const matrix = parseClipboardGrid(text);
    if (!matrix.length) {
      return;
    }
    if (matrix.length === 1 && matrix[0].length === 1 && !start.fromTableSelection) {
      return;
    }
    event.preventDefault();
    const { pastedCount, skippedCount } = applyResultMatrix({
      matrix,
      startRowIndex: start.rowIndex,
      startColumnIndex: start.columnIndex,
      replaceAll: start.fromTableSelection
    });
    renderResultTable();
    setResultStatus(`Pasted ${pastedCount} value(s). Skipped ${skippedCount} unmapped cell(s). Result wells with values: ${getResultValueCount()}.`);
  }

  function onClearResults() {
    currentResults = {};
    renderResultTable();
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
    unmountAnalysisChart();
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
    setResultStatus('Cleared all result values. Only mapped wells are editable.');
  }

  function parseNumericResult(value) {
    const normalized = String(value || '').trim().replace(/,/g, '');
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function parseFirstNumericToken(value) {
    const normalized = String(value || '').trim().replace(/,/g, '');
    const match = normalized.match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/);
    if (!match) {
      return null;
    }
    const numeric = Number(match[0]);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function formatNumber(value, digits = 4) {
    return Number.isFinite(value) ? Number(value).toFixed(digits) : '-';
  }

  function summarizeNumeric(values) {
    if (!values.length) {
      return null;
    }
    const n = values.length;
    const total = values.reduce((sum, item) => sum + item, 0);
    const meanValue = total / n;
    const variance = n > 1
      ? values.reduce((sum, item) => sum + ((item - meanValue) ** 2), 0) / (n - 1)
      : 0;
    const sd = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { n, mean: meanValue, sd, min, max };
  }

  function groupBy(items, keyFn) {
    const map = new Map();
    items.forEach((item) => {
      const key = keyFn(item);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(item);
    });
    return map;
  }

  function sortByConcentration(a, b) {
    const aNumeric = Number.isFinite(a.concentrationValue);
    const bNumeric = Number.isFinite(b.concentrationValue);
    if (aNumeric && bNumeric && a.concentrationValue !== b.concentrationValue) {
      return a.concentrationValue - b.concentrationValue;
    }
    if (aNumeric && !bNumeric) {
      return -1;
    }
    if (!aNumeric && bNumeric) {
      return 1;
    }
    return String(a.concentrationLabel).localeCompare(String(b.concentrationLabel));
  }

  function collectNumericObservations() {
    const layoutMap = layoutToMap(currentLayout);
    const observations = [];
    let nonNumericCount = 0;

    Object.entries(currentResults || {}).forEach(([well, raw]) => {
      const response = parseNumericResult(raw);
      if (!Number.isFinite(response)) {
        nonNumericCount += 1;
        return;
      }
      const parsedWell = parseWellId(well);
      if (!parsedWell) {
        return;
      }
      const mapping = layoutMap[well] || { sampleId: '', concentration: '' };
      const rawSampleId = String(mapping.sampleId || '').trim();
      const rawConcentration = String(mapping.concentration || '').trim();
      const concentrationLabel = rawConcentration || '-';
      observations.push({
        well,
        response,
        rowIndex: parsedWell.rowIndex,
        rowLabel: toRowLabel(parsedWell.rowIndex),
        columnIndex: parsedWell.columnIndex,
        columnNumber: parsedWell.columnIndex + 1,
        rawSampleId,
        sampleId: rawSampleId || '(unmapped)',
        sampleValue: parseFirstNumericToken(rawSampleId),
        rawConcentration,
        concentrationLabel,
        concentrationValue: parseFirstNumericToken(concentrationLabel)
      });
    });

    return { observations, nonNumericCount };
  }

  function describeObservationAxes(observations) {
    const sampleLabels = new Set();
    const concentrationLabels = new Set();
    const numericSampleValues = new Set();
    const numericConcentrationValues = new Set();

    observations.forEach((item) => {
      if (item.rawSampleId) {
        sampleLabels.add(item.rawSampleId);
      }
      if (item.rawConcentration) {
        concentrationLabels.add(item.rawConcentration);
      }
      if (Number.isFinite(item.sampleValue)) {
        numericSampleValues.add(item.sampleValue);
      }
      if (Number.isFinite(item.concentrationValue)) {
        numericConcentrationValues.add(item.concentrationValue);
      }
    });

    return {
      sampleCount: sampleLabels.size,
      concentrationCount: concentrationLabels.size,
      numericSampleCount: numericSampleValues.size,
      numericConcentrationCount: numericConcentrationValues.size,
      hasSampleFactor: sampleLabels.size > 1,
      hasConcentrationFactor: concentrationLabels.size > 1
    };
  }

  function buildAnalysisTable(headers, rows) {
    return `
      <table class="assay-plate-table">
        <thead>
          <tr>${headers.map((item) => `<th>${safeText(String(item))}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              ${row.map((cell) => `<td>${safeText(String(cell ?? '-'))}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function unmountAnalysisChart() {
    if (analysisChartHost && ReactDOMLib?.unmountComponentAtNode) {
      ReactDOMLib.unmountComponentAtNode(analysisChartHost);
    }
    analysisChartHost = null;
  }

  function parseAnalysisCellNumber(value) {
    return parseFirstNumericToken(value);
  }

  function pickChartMetricIndex(method, headers, numericIndexes) {
    const methodPriority = {
      grouped_summary: ['mean'],
      nested_summary: ['mean'],
      row_summary: ['mean'],
      column_summary: ['mean'],
      linear_regression: ['slope', 'r²', 'r2', 'intercept'],
      ec50: ['ec50'],
      ic50: ['ic50'],
      survival: ['survival', 'mean']
    };
    const priorities = methodPriority[method] || ['mean', 'value'];
    for (let keywordIndex = 0; keywordIndex < priorities.length; keywordIndex += 1) {
      const keyword = priorities[keywordIndex];
      const match = numericIndexes.find((index) => String(headers[index] || '').toLowerCase().includes(keyword));
      if (Number.isInteger(match)) {
        return match;
      }
    }
    return numericIndexes[0];
  }

  function buildAnalysisChartModel(result, method) {
    const headers = Array.isArray(result?.headers) ? result.headers : [];
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    if (!headers.length || !rows.length) {
      return null;
    }

    const numericIndexes = headers
      .map((_, index) => index)
      .filter((index) => rows.some((row) => Number.isFinite(parseAnalysisCellNumber(row[index]))));
    if (!numericIndexes.length) {
      return null;
    }

    const yIndex = pickChartMetricIndex(method, headers, numericIndexes);
    const otherNumeric = numericIndexes.filter((index) => index !== yIndex);
    const nonNumericIndexes = headers
      .map((_, index) => index)
      .filter((index) => !numericIndexes.includes(index));
    const xIndex = nonNumericIndexes[0] ?? otherNumeric[0] ?? null;
    const seriesIndex = nonNumericIndexes.find((index) => index !== xIndex) ?? null;
    const seriesMap = new Map();
    let numericXCount = 0;
    let totalCount = 0;

    rows.forEach((row, rowIndex) => {
      const y = parseAnalysisCellNumber(row[yIndex]);
      if (!Number.isFinite(y)) {
        return;
      }
      const rawX = xIndex === null ? rowIndex + 1 : row[xIndex];
      const xLabel = String(rawX ?? '').trim() || `Row ${rowIndex + 1}`;
      const xNumeric = parseAnalysisCellNumber(rawX);
      if (Number.isFinite(xNumeric)) {
        numericXCount += 1;
      }
      const seriesLabel = seriesIndex === null
        ? 'Series'
        : (String(row[seriesIndex] ?? '').trim() || 'Series');
      if (!seriesMap.has(seriesLabel)) {
        seriesMap.set(seriesLabel, []);
      }
      seriesMap.get(seriesLabel).push({ xLabel, xNumeric, y });
      totalCount += 1;
    });

    if (!totalCount || !seriesMap.size) {
      return null;
    }

    const numericXAxis = numericXCount / totalCount >= 0.75;
    const prefersLineMethod = method === 'linear_regression' || method === 'ec50' || method === 'ic50' || method === 'survival';
    const chartType = numericXAxis && prefersLineMethod ? 'line' : 'bar';

    if (chartType === 'line') {
      const series = Array.from(seriesMap.entries())
        .map(([label, points]) => {
          const xBuckets = new Map();
          points.forEach((point) => {
            if (!Number.isFinite(point.xNumeric)) {
              return;
            }
            if (!xBuckets.has(point.xNumeric)) {
              xBuckets.set(point.xNumeric, []);
            }
            xBuckets.get(point.xNumeric).push(point.y);
          });
          const data = Array.from(xBuckets.entries())
            .map(([x, values]) => {
              const stats = summarizeNumeric(values);
              return stats ? { x: Number(x), y: stats.mean } : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.x - b.x);
          return { label, data };
        })
        .filter((item) => item.data.length);

      if (!series.length) {
        return null;
      }

      return {
        chartType,
        xLabel: xIndex === null ? 'Row' : String(headers[xIndex] || 'X'),
        yLabel: String(headers[yIndex] || 'Y'),
        series
      };
    }

    const categories = [];
    const categorySet = new Set();
    seriesMap.forEach((points) => {
      points.forEach((point) => {
        if (!categorySet.has(point.xLabel)) {
          categorySet.add(point.xLabel);
          categories.push(point.xLabel);
        }
      });
    });

    const series = Array.from(seriesMap.entries())
      .map(([label, points]) => {
        const categoryValues = new Map();
        points.forEach((point) => {
          if (!categoryValues.has(point.xLabel)) {
            categoryValues.set(point.xLabel, []);
          }
          categoryValues.get(point.xLabel).push(point.y);
        });
        const data = categories
          .map((category) => {
            const values = categoryValues.get(category) || [];
            const stats = summarizeNumeric(values);
            return stats ? { x: category, y: stats.mean } : null;
          })
          .filter(Boolean);
        return { label, data };
      })
      .filter((item) => item.data.length);

    if (!series.length) {
      return null;
    }

    return {
      chartType,
      xLabel: xIndex === null ? 'Row' : String(headers[xIndex] || 'Group'),
      yLabel: String(headers[yIndex] || 'Value'),
      series
    };
  }

  function renderAnalysisChart(result, method) {
    unmountAnalysisChart();
    if (!hasReactVis || !assayAnalysisTable) {
      return;
    }

    const chartModel = buildAnalysisChartModel(result, method);
    const chartTarget = assayAnalysisTable.querySelector('[data-assay-analysis-chart]');
    if (!chartModel || !chartTarget) {
      return;
    }

    const {
      XYPlot,
      XAxis,
      YAxis,
      VerticalGridLines,
      HorizontalGridLines,
      VerticalBarSeries,
      LineSeries,
      MarkSeries,
      DiscreteColorLegend
    } = ReactVisLib;
    if (!XYPlot || !XAxis || !YAxis || !VerticalGridLines || !HorizontalGridLines) {
      return;
    }

    const palette = ['#1f77b4', '#ef6c3e', '#2ca25f', '#9467bd', '#d4a72c', '#8c564b'];
    const longestSeries = chartModel.series.reduce((max, item) => Math.max(max, item.data.length), 0);
    const plotWidth = Math.max(420, Math.min(1280, (longestSeries || 1) * (chartModel.chartType === 'line' ? 60 : 70)));
    const plotHeight = 280;
    const marginBottom = chartModel.chartType === 'bar' ? 108 : 72;
    const plotProps = {
      width: plotWidth,
      height: plotHeight,
      margin: { left: 72, right: 24, top: 20, bottom: marginBottom }
    };
    if (chartModel.chartType === 'bar') {
      plotProps.xType = 'ordinal';
    }

    const plotChildren = [
      ReactLib.createElement(VerticalGridLines, { key: 'v-grid' }),
      ReactLib.createElement(HorizontalGridLines, { key: 'h-grid' }),
      ReactLib.createElement(XAxis, {
        key: 'x-axis',
        title: chartModel.xLabel,
        tickLabelAngle: chartModel.chartType === 'bar' ? -35 : 0
      }),
      ReactLib.createElement(YAxis, {
        key: 'y-axis',
        title: chartModel.yLabel
      })
    ];

    chartModel.series.forEach((series, index) => {
      const color = palette[index % palette.length];
      if (chartModel.chartType === 'line') {
        if (LineSeries) {
          plotChildren.push(ReactLib.createElement(LineSeries, {
            key: `line-${series.label}-${index}`,
            data: series.data,
            color,
            curve: 'curveMonotoneX'
          }));
        }
        if (MarkSeries) {
          plotChildren.push(ReactLib.createElement(MarkSeries, {
            key: `mark-${series.label}-${index}`,
            data: series.data,
            color,
            size: 3
          }));
        }
      } else if (VerticalBarSeries) {
        plotChildren.push(ReactLib.createElement(VerticalBarSeries, {
          key: `bar-${series.label}-${index}`,
          data: series.data,
          color,
          cluster: 'assay-analysis'
        }));
      }
    });

    const legendItems = chartModel.series.map((series, index) => ({
      title: series.label,
      color: palette[index % palette.length]
    }));
    const legendElement = DiscreteColorLegend && legendItems.length > 1
      ? ReactLib.createElement(DiscreteColorLegend, {
        key: 'legend',
        orientation: 'horizontal',
        items: legendItems
      })
      : null;
    const titleText = `${chartModel.yLabel} by ${chartModel.xLabel}`;

    const chartElement = ReactLib.createElement('div', null, [
      ReactLib.createElement('div', { className: 'assay-analysis-chart-head', key: 'head' }, [
        ReactLib.createElement('div', { className: 'assay-analysis-chart-title', key: 'title' }, titleText),
        legendElement
      ]),
      ReactLib.createElement('div', { className: 'assay-analysis-chart-plot', key: 'plot' }, [
        ReactLib.createElement(XYPlot, { ...plotProps, key: 'xy-plot' }, plotChildren)
      ])
    ]);

    ReactDOMLib.render(chartElement, chartTarget);
    analysisChartHost = chartTarget;
  }

  function analyzeGroupedSummary(observations) {
    const axes = describeObservationAxes(observations);

    if (axes.hasSampleFactor && axes.hasConcentrationFactor) {
      const groups = new Map();
      observations.forEach((item) => {
        const key = `${item.sampleId}__${item.concentrationLabel}`;
        if (!groups.has(key)) {
          groups.set(key, {
            sampleId: item.sampleId,
            concentrationLabel: item.concentrationLabel,
            concentrationValue: item.concentrationValue,
            values: []
          });
        }
        groups.get(key).values.push(item.response);
      });

      const rows = Array.from(groups.values())
        .map((item) => ({ ...item, stats: summarizeNumeric(item.values) }))
        .filter((item) => item.stats)
        .sort((a, b) => {
          const sampleCmp = a.sampleId.localeCompare(b.sampleId);
          if (sampleCmp !== 0) {
            return sampleCmp;
          }
          return sortByConcentration(a, b);
        })
        .map((item) => [
          item.sampleId,
          item.concentrationLabel,
          item.stats.n,
          formatNumber(item.stats.mean),
          formatNumber(item.stats.sd),
          formatNumber(item.stats.min),
          formatNumber(item.stats.max)
        ]);

      return {
        summary: `Grouped summary for ${rows.length} sample/concentration group(s).`,
        headers: ['Sample ID', 'Concentration', 'N', 'Mean', 'SD', 'Min', 'Max'],
        rows
      };
    }

    if (axes.hasSampleFactor) {
      const groups = groupBy(observations, (item) => item.sampleId);
      const rows = Array.from(groups.entries())
        .map(([sampleId, items]) => {
          const stats = summarizeNumeric(items.map((item) => item.response));
          return stats ? [sampleId, stats.n, formatNumber(stats.mean), formatNumber(stats.sd), formatNumber(stats.min), formatNumber(stats.max)] : null;
        })
        .filter(Boolean)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

      return {
        summary: `Grouped summary for ${rows.length} sample ID group(s).`,
        headers: ['Sample ID', 'N', 'Mean', 'SD', 'Min', 'Max'],
        rows
      };
    }

    if (axes.hasConcentrationFactor) {
      const groups = new Map();
      observations.forEach((item) => {
        if (!groups.has(item.concentrationLabel)) {
          groups.set(item.concentrationLabel, {
            concentrationLabel: item.concentrationLabel,
            concentrationValue: item.concentrationValue,
            values: []
          });
        }
        groups.get(item.concentrationLabel).values.push(item.response);
      });

      const rows = Array.from(groups.values())
        .map((item) => ({ ...item, stats: summarizeNumeric(item.values) }))
        .filter((item) => item.stats)
        .sort(sortByConcentration)
        .map((item) => [
          item.concentrationLabel,
          item.stats.n,
          formatNumber(item.stats.mean),
          formatNumber(item.stats.sd),
          formatNumber(item.stats.min),
          formatNumber(item.stats.max)
        ]);

      return {
        summary: `Grouped summary for ${rows.length} concentration group(s).`,
        headers: ['Concentration', 'N', 'Mean', 'SD', 'Min', 'Max'],
        rows
      };
    }

    const stats = summarizeNumeric(observations.map((item) => item.response));
    const rows = stats
      ? [['All Wells', stats.n, formatNumber(stats.mean), formatNumber(stats.sd), formatNumber(stats.min), formatNumber(stats.max)]]
      : [];

    return {
      summary: 'Grouped summary across all mapped wells.',
      headers: ['Series', 'N', 'Mean', 'SD', 'Min', 'Max'],
      rows
    };
  }

  function analyzeNestedSummary(observations) {
    const axes = describeObservationAxes(observations);
    if (!(axes.hasSampleFactor && axes.hasConcentrationFactor)) {
      return analyzeGroupedSummary(observations);
    }

    const sampleGroups = groupBy(observations, (item) => item.sampleId);
    const rows = [];

    Array.from(sampleGroups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([sampleId, sampleItems]) => {
        const sampleStats = summarizeNumeric(sampleItems.map((item) => item.response));
        if (sampleStats) {
          rows.push([
            sampleId,
            'Sample Total',
            '-',
            sampleStats.n,
            formatNumber(sampleStats.mean),
            formatNumber(sampleStats.sd),
            formatNumber(sampleStats.min),
            formatNumber(sampleStats.max)
          ]);
        }

        const concentrationGroups = new Map();
        sampleItems.forEach((item) => {
          const key = item.concentrationLabel;
          if (!concentrationGroups.has(key)) {
            concentrationGroups.set(key, {
              concentrationLabel: item.concentrationLabel,
              concentrationValue: item.concentrationValue,
              values: []
            });
          }
          concentrationGroups.get(key).values.push(item.response);
        });

        Array.from(concentrationGroups.values())
          .map((item) => ({ ...item, stats: summarizeNumeric(item.values) }))
          .filter((item) => item.stats)
          .sort(sortByConcentration)
          .forEach((item) => {
            rows.push([
              sampleId,
              'Concentration',
              item.concentrationLabel,
              item.stats.n,
              formatNumber(item.stats.mean),
              formatNumber(item.stats.sd),
              formatNumber(item.stats.min),
              formatNumber(item.stats.max)
            ]);
          });
      });

    return {
      summary: `Nested summary by sample then concentration for ${sampleGroups.size} sample(s).`,
      headers: ['Sample ID', 'Level', 'Group', 'N', 'Mean', 'SD', 'Min', 'Max'],
      rows
    };
  }

  function analyzeDimensionSummary(observations, dimension) {
    const isRow = dimension === 'row';
    const groups = groupBy(observations, (item) => (isRow ? item.rowLabel : String(item.columnNumber)));
    const rows = Array.from(groups.entries())
      .map(([label, items]) => {
        const stats = summarizeNumeric(items.map((item) => item.response));
        return { label, stats };
      })
      .filter((item) => item.stats)
      .sort((a, b) => {
        if (isRow) {
          return rowLabelToIndex(a.label) - rowLabelToIndex(b.label);
        }
        return Number(a.label) - Number(b.label);
      })
      .map((item) => [
        item.label,
        item.stats.n,
        formatNumber(item.stats.mean),
        formatNumber(item.stats.sd),
        formatNumber(item.stats.min),
        formatNumber(item.stats.max)
      ]);

    return {
      summary: `${isRow ? 'Row' : 'Column'} summary for ${rows.length} ${isRow ? 'row(s)' : 'column(s)'}.`,
      headers: [isRow ? 'Row' : 'Column', 'N', 'Mean', 'SD', 'Min', 'Max'],
      rows
    };
  }

  function getDoseAxisConfig(observations) {
    const axes = describeObservationAxes(observations);

    if (axes.numericConcentrationCount >= 2) {
      return {
        xSource: 'Concentration',
        xAccessor: (item) => item.concentrationValue,
        xLabelAccessor: (item) => item.concentrationLabel,
        seriesHeader: axes.hasSampleFactor ? 'Sample ID' : 'Series',
        seriesAccessor: axes.hasSampleFactor
          ? (item) => item.sampleId
          : () => 'All Wells'
      };
    }

    if (axes.numericSampleCount >= 2) {
      return {
        xSource: 'Sample ID',
        xAccessor: (item) => item.sampleValue,
        xLabelAccessor: (item) => item.sampleId,
        seriesHeader: axes.hasConcentrationFactor ? 'Concentration' : 'Series',
        seriesAccessor: axes.hasConcentrationFactor
          ? (item) => item.concentrationLabel
          : () => 'All Wells'
      };
    }

    return null;
  }

  function getRegressionAxisConfig(observations) {
    const doseAxis = getDoseAxisConfig(observations);
    if (doseAxis) {
      return doseAxis;
    }

    const axes = describeObservationAxes(observations);
    return {
      xSource: 'Column',
      xAccessor: (item) => item.columnNumber,
      xLabelAccessor: (item) => String(item.columnNumber),
      seriesHeader: axes.hasSampleFactor ? 'Sample ID' : 'Series',
      seriesAccessor: axes.hasSampleFactor
        ? (item) => item.sampleId
        : () => 'All Wells'
    };
  }

  function linearRegression(points) {
    if (!Array.isArray(points) || points.length < 2) {
      return null;
    }
    const xValues = points.map((item) => item.x);
    const yValues = points.map((item) => item.y);
    const xMean = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
    const yMean = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < points.length; index += 1) {
      const dx = points[index].x - xMean;
      numerator += dx * (points[index].y - yMean);
      denominator += dx * dx;
    }
    if (denominator === 0) {
      return null;
    }
    const slope = numerator / denominator;
    const intercept = yMean - (slope * xMean);
    const yPred = points.map((item) => intercept + (slope * item.x));
    const ssRes = yValues.reduce((sum, item, index) => sum + ((item - yPred[index]) ** 2), 0);
    const ssTot = yValues.reduce((sum, item) => sum + ((item - yMean) ** 2), 0);
    const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
    return { slope, intercept, r2 };
  }

  function analyzeLinearRegression(observations) {
    const config = getRegressionAxisConfig(observations);
    const seriesGroups = groupBy(observations, (item) => config.seriesAccessor(item));
    const rows = Array.from(seriesGroups.entries())
      .map(([seriesLabel, items]) => {
        const pointGroups = new Map();
        items.forEach((item) => {
          const x = config.xAccessor(item);
          if (!Number.isFinite(x)) {
            return;
          }
          if (!pointGroups.has(x)) {
            pointGroups.set(x, []);
          }
          pointGroups.get(x).push(item.response);
        });

        const points = Array.from(pointGroups.entries())
          .map(([x, values]) => {
            const stats = summarizeNumeric(values);
            return stats ? { x, y: stats.mean } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.x - b.x);

        const fit = linearRegression(points);
        if (!fit) {
          return null;
        }

        return [
          seriesLabel,
          config.xSource,
          points.length,
          formatNumber(fit.slope),
          formatNumber(fit.intercept),
          formatNumber(fit.r2, 5)
        ];
      })
      .filter(Boolean)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    return {
      summary: `Linear regression fitted for ${rows.length} series using ${config.xSource} as X.`,
      headers: [config.seriesHeader, 'X Source', 'Points', 'Slope', 'Intercept', 'R²'],
      rows
    };
  }

  function logistic4Point(x, params) {
    const exponent = (params.logEC50 - Math.log10(x)) * params.hill;
    return params.bottom + ((params.top - params.bottom) / (1 + (10 ** exponent)));
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(max, Math.max(min, value));
  }

  function fitDoseResponse4PL(points) {
    if (!Array.isArray(points) || points.length < 4) {
      return null;
    }
    const xValues = points.map((item) => item.x).filter((item) => item > 0);
    if (xValues.length < 4) {
      return null;
    }
    const yValues = points.map((item) => item.y);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const yRange = Math.max(1e-9, yMax - yMin);
    const logXValues = xValues.map((item) => Math.log10(item));
    const minLogX = Math.min(...logXValues);
    const maxLogX = Math.max(...logXValues);
    const initial = {
      bottom: yMin,
      top: yMax,
      logEC50: (minLogX + maxLogX) / 2,
      hill: 1
    };
    const bounds = {
      bottom: { min: yMin - (yRange * 2), max: yMax + yRange },
      top: { min: yMin - yRange, max: yMax + (yRange * 2) },
      logEC50: { min: minLogX - 2, max: maxLogX + 2 },
      hill: { min: 0.05, max: 8 }
    };
    const ensureParams = (source) => {
      const params = {
        bottom: clamp(source.bottom, bounds.bottom.min, bounds.bottom.max),
        top: clamp(source.top, bounds.top.min, bounds.top.max),
        logEC50: clamp(source.logEC50, bounds.logEC50.min, bounds.logEC50.max),
        hill: clamp(source.hill, bounds.hill.min, bounds.hill.max)
      };
      if (params.top <= params.bottom) {
        params.top = params.bottom + 1e-9;
      }
      return params;
    };
    const calcSse = (params) => {
      let total = 0;
      for (let index = 0; index < points.length; index += 1) {
        const predicted = logistic4Point(points[index].x, params);
        total += (points[index].y - predicted) ** 2;
      }
      return total;
    };

    let best = ensureParams(initial);
    let bestErr = calcSse(best);
    const steps = {
      bottom: yRange * 0.6,
      top: yRange * 0.6,
      logEC50: Math.max(0.1, (maxLogX - minLogX) * 0.5),
      hill: 0.8
    };
    const paramKeys = ['bottom', 'top', 'logEC50', 'hill'];

    for (let round = 0; round < 12; round += 1) {
      let improved = false;
      for (let keyIndex = 0; keyIndex < paramKeys.length; keyIndex += 1) {
        const key = paramKeys[keyIndex];
        const step = steps[key];
        [-1, 1].forEach((direction) => {
          const candidate = ensureParams({
            ...best,
            [key]: best[key] + (direction * step)
          });
          const err = calcSse(candidate);
          if (err < bestErr) {
            best = candidate;
            bestErr = err;
            improved = true;
          }
        });
      }
      if (!improved) {
        paramKeys.forEach((key) => {
          steps[key] *= 0.5;
        });
      }
      const maxStep = Math.max(...Object.values(steps));
      if (maxStep < 1e-6) {
        break;
      }
    }

    const yMean = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
    const ssTot = yValues.reduce((sum, value) => sum + ((value - yMean) ** 2), 0);
    const ssRes = points.reduce((sum, point) => sum + ((point.y - logistic4Point(point.x, best)) ** 2), 0);
    const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
    return {
      ...best,
      ec50: 10 ** best.logEC50,
      r2,
      rmse: Math.sqrt(ssRes / points.length)
    };
  }

  function getMeanDosePoints(sampleItems, requirePositiveX, xAccessor) {
    const groups = new Map();
    sampleItems.forEach((item) => {
      const xValue = xAccessor(item);
      if (!Number.isFinite(xValue)) {
        return;
      }
      if (requirePositiveX && xValue <= 0) {
        return;
      }
      if (!groups.has(xValue)) {
        groups.set(xValue, []);
      }
      groups.get(xValue).push(item.response);
    });
    return Array.from(groups.entries())
      .map(([x, values]) => {
        const stats = summarizeNumeric(values);
        return stats ? { x, y: stats.mean, n: stats.n } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
  }

  function analyzeEc50Like(observations, mode) {
    const config = getDoseAxisConfig(observations);
    if (!config) {
      return {
        summary: `${mode.toUpperCase()} fit requires at least 2 numeric concentration or sample ID values.`,
        headers: [mode.toUpperCase()],
        rows: []
      };
    }

    const sampleGroups = groupBy(observations, (item) => config.seriesAccessor(item));
    let skipped = 0;
    const rows = Array.from(sampleGroups.entries())
      .map(([seriesLabel, sampleItems]) => {
        const points = getMeanDosePoints(sampleItems, true, config.xAccessor);
        if (points.length < 4) {
          skipped += 1;
          return null;
        }
        const fit = fitDoseResponse4PL(points);
        if (!fit) {
          skipped += 1;
          return null;
        }
        const trend = points.length >= 2 && points[points.length - 1].y > points[0].y ? 'up' : 'down';
        return [
          seriesLabel,
          points.length,
          formatNumber(fit.ec50),
          formatNumber(fit.hill),
          formatNumber(fit.top),
          formatNumber(fit.bottom),
          formatNumber(fit.r2, 5),
          trend
        ];
      })
      .filter(Boolean)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    return {
      summary: `${mode.toUpperCase()} fit completed for ${rows.length} series using ${config.xSource} as dose axis. ${skipped ? `${skipped} series skipped (need >=4 positive numeric dose values).` : ''}`.trim(),
      headers: [config.seriesHeader, 'Points', mode.toUpperCase(), 'Hill', 'Top', 'Bottom', 'R²', 'Trend'],
      rows
    };
  }

  function analyzeSurvival(observations) {
    const config = getDoseAxisConfig(observations);
    if (!config) {
      return {
        summary: 'Survival analysis requires numeric concentration or sample ID values.',
        headers: ['Series'],
        rows: []
      };
    }

    const sampleGroups = groupBy(observations, (item) => config.seriesAccessor(item));
    const rows = [];

    Array.from(sampleGroups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([seriesLabel, sampleItems]) => {
        const concentrationGroups = new Map();
        sampleItems.forEach((item) => {
          const xValue = config.xAccessor(item);
          const xLabel = config.xLabelAccessor(item);
          if (!Number.isFinite(xValue)) {
            return;
          }
          if (!concentrationGroups.has(xLabel)) {
            concentrationGroups.set(xLabel, {
              concentrationLabel: xLabel,
              concentrationValue: xValue,
              values: []
            });
          }
          concentrationGroups.get(xLabel).values.push(item.response);
        });
        const groups = Array.from(concentrationGroups.values())
          .map((item) => ({ ...item, stats: summarizeNumeric(item.values) }))
          .filter((item) => item.stats)
          .sort(sortByConcentration);
        if (!groups.length) {
          return;
        }

        const numericGroups = groups.filter((item) => Number.isFinite(item.concentrationValue));
        let baseline = numericGroups.length
          ? numericGroups.reduce((best, item) => (
            item.concentrationValue < best.concentrationValue ? item : best
          ), numericGroups[0])
          : null;
        if (!baseline) {
          baseline = groups[0];
        }
        const baselineMean = baseline.stats?.mean;

        groups.forEach((item) => {
          const survival = Number.isFinite(baselineMean) && baselineMean !== 0
            ? (item.stats.mean / baselineMean) * 100
            : null;
          rows.push([
            seriesLabel,
            baseline.concentrationLabel,
            formatNumber(baselineMean),
            item.concentrationLabel,
            item.stats.n,
            formatNumber(item.stats.mean),
            formatNumber(survival, 2)
          ]);
        });
      });

    return {
      summary: `Survival analysis computed as (group mean / baseline mean) * 100 for ${sampleGroups.size} series using ${config.xSource} as dose axis.`,
      headers: [config.seriesHeader, `Baseline ${config.xSource}`, 'Baseline Mean', config.xSource, 'N', 'Mean', 'Survival %'],
      rows
    };
  }

  function renderAnalysis() {
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }

    unmountAnalysisChart();
    syncCurrentResultsFromGrid();
    const method = String(assayAnalysisMethodInput?.value || 'grouped_summary');
    const { observations, nonNumericCount } = collectNumericObservations();
    if (!observations.length) {
      assayAnalysisSummary.textContent = nonNumericCount
        ? `No numeric values found. Non-numeric result cells: ${nonNumericCount}.`
        : 'No result values to analyze.';
      assayAnalysisTable.innerHTML = '';
      return;
    }

    let result;
    if (method === 'nested_summary') {
      result = analyzeNestedSummary(observations);
    } else if (method === 'row_summary') {
      result = analyzeDimensionSummary(observations, 'row');
    } else if (method === 'column_summary') {
      result = analyzeDimensionSummary(observations, 'column');
    } else if (method === 'linear_regression') {
      result = analyzeLinearRegression(observations);
    } else if (method === 'ec50') {
      result = analyzeEc50Like(observations, 'ec50');
    } else if (method === 'ic50') {
      result = analyzeEc50Like(observations, 'ic50');
    } else if (method === 'survival') {
      result = analyzeSurvival(observations);
    } else {
      result = analyzeGroupedSummary(observations);
    }

    const ignoredNote = nonNumericCount ? ` Non-numeric cells ignored: ${nonNumericCount}.` : '';
    const rowCountNote = ` Rows: ${result.rows.length}.`;
    assayAnalysisSummary.textContent = `${result.summary}${rowCountNote}${ignoredNote}`;
    if (!result.rows.length) {
      assayAnalysisTable.innerHTML = '<p class="small-note">No analyzable rows for this method.</p>';
      return;
    }

    const tableHtml = buildAnalysisTable(result.headers, result.rows);
    assayAnalysisTable.innerHTML = hasReactVis
      ? `
        <div class="assay-analysis-results">
          <div class="assay-analysis-chart" data-assay-analysis-chart></div>
          ${tableHtml}
        </div>
      `
      : tableHtml;
    renderAnalysisChart(result, method);
  }

  function onAnalysisMethodChange() {
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }
    assayAnalysisSummary.textContent = '';
    unmountAnalysisChart();
    assayAnalysisTable.innerHTML = '';
    syncCurrentResultsFromGrid();
    if (getResultValueCount()) {
      renderAnalysis();
    }
  }

  function onAnalyzeResults() {
    renderAnalysis();
  }

  function sortedAssaysByUpdated() {
    return (state.assays || [])
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
  }

  function renderResultsAssayOptions(preferredId = '') {
    if (!assayResultsAssaySelect) {
      return;
    }
    const rows = sortedAssaysByUpdated();
    const options = ['<option value="">Select assay plate</option>'];
    rows.forEach((assay) => {
      const label = `${assay.assayNumber || '-'} | ${assay.name || assay.id}`;
      options.push(`<option value="${assay.id}">${safeText(label)}</option>`);
    });
    assayResultsAssaySelect.innerHTML = options.join('');
    const candidate = preferredId || activeResultsAssayId;
    if (candidate && rows.some((assay) => assay.id === candidate)) {
      assayResultsAssaySelect.value = candidate;
      return;
    }
    if (rows.length) {
      assayResultsAssaySelect.value = rows[0].id;
    }
  }

  function loadAssayForResults(assayId) {
    const assay = getAssayById(assayId);
    if (!assay) {
      activeResultsAssayId = '';
      renderActiveAssayInfo(null);
      return;
    }
    activeResultsAssayId = assay.id;
    if (assayResultsAssaySelect) {
      assayResultsAssaySelect.value = assay.id;
    }
    assayIdInput.value = assay.id;
    assayPlateTypeInput.value = String(assay.plateType || '96');
    assaySampleAxisInput.value = assay.sampleAxis === 'column' ? 'column' : 'row';
    syncAxisDisplay();
    const def = getCurrentDefinition();
    const axisValues = restoreAssayLayoutState(assay, def);
    renderPlatePreview(axisValues);
    renderLayoutList();
    renderPlateDefinition();
    renderResultTable();
    renderActiveAssayInfo(assay);
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
    unmountAnalysisChart();
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
    setResultStatus(`Loaded ${getResultValueCount()} result value(s) for ${assay.assayNumber || assay.id}.`);
  }

  function onResultsAssaySelected() {
    const assayId = assayResultsAssaySelect?.value || '';
    if (!assayId) {
      activeResultsAssayId = '';
      renderActiveAssayInfo(null);
      setResultStatus('No assay plate selected.');
      return;
    }
    loadAssayForResults(assayId);
  }

  function onResultsAssayLoad() {
    const assayId = assayResultsAssaySelect?.value || '';
    if (!assayId) {
      setResultStatus('Select an assay plate first.');
      return;
    }
    loadAssayForResults(assayId);
  }

  function onSaveResults() {
    ensureState();
    const assayId = activeResultsAssayId || assayResultsAssaySelect?.value || '';
    if (!assayId) {
      setResultStatus('Select an assay plate first.');
      return;
    }
    const assay = getAssayById(assayId);
    if (!assay) {
      setResultStatus('Selected assay plate was not found.');
      return;
    }
    const def = getPlateDefinition(assay.plateType || assayPlateTypeInput?.value || '96');
    syncCurrentResultsFromGrid();
    assay.resultValues = filterResultsToMappedWells(normalizeResults(currentResults, def));
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

  function renderLayoutList() {
    if (!assayLayoutList) {
      return;
    }
    const rows = sortLayout(currentLayout);
    if (!rows.length) {
      assayLayoutList.innerHTML = '<p class="small-note">No mapped wells yet.</p>';
      return;
    }
    assayLayoutList.innerHTML = rows.map((item) => `
      <article class="list-row">
        <span><strong>${safeText(item.well)}</strong> — Sample: ${safeText(item.sampleId || '-')}</span>
        <span>Conc: ${safeText(item.concentration || '-')}</span>
        <div class="card-actions list-actions">
          <button type="button" class="ghost-btn" data-layout-edit="${item.well}">Edit</button>
          <button type="button" class="danger-btn" data-layout-delete="${item.well}">Delete</button>
        </div>
      </article>
    `).join('');
  }

  function onPlatePreviewInput(event) {
    const axisInput = event.target.closest('[data-axis-dimension]');
    if (axisInput) {
      syncAxisTemplateValues(getAxisTemplateValues());
      return;
    }

    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }

    updateInlineWellOverride(
      inlineInput.dataset.well,
      inlineInput.dataset.wellInlineField,
      inlineInput.value
    );
  }

  function onPlatePreviewChange(event) {
    const axisInput = event.target.closest('[data-axis-dimension]');
    if (axisInput) {
      setLayoutFromAxisAndOverrides();
      renderLayoutList();
      renderPlatePreview();
      renderResultTable();
      setLayoutStatus('Updated axis-based mapping from in-plate row/column definitions.');
      setCsvStatus(`Mapped wells: ${currentLayout.length}.`);
      return;
    }

    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }

    updateInlineWellOverride(
      inlineInput.dataset.well,
      inlineInput.dataset.wellInlineField,
      inlineInput.value
    );
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(`Updated ${String(inlineInput.dataset.well || '').trim().toUpperCase()}.`);
    setCsvStatus(`Mapped wells: ${currentLayout.length}.`);
  }

  function onPlatePreviewFocusIn(event) {
    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }
    setActiveWellSelection(inlineInput.dataset.well);
  }

  function onPlatePreviewClick(event) {
    if (event.target.closest('[data-axis-dimension]')) {
      return;
    }

    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (inlineInput) {
      setActiveWellSelection(inlineInput.dataset.well);
      return;
    }

    const cell = event.target.closest('[data-well]');
    if (!cell) {
      return;
    }
    const wellId = String(cell.dataset.well || '').trim().toUpperCase();
    if (!wellId) {
      return;
    }
    setActiveWellSelection(wellId);
    cell.querySelector('[data-well-inline-field]')?.focus();
  }

  function onClearWellMappings() {
    manualWellOverrides = {};
    suppressedWells = new Set();
    setAxisTemplateValues({ sampleValues: [], concentrationValues: [] });
    currentLayout = [];
    activeWellEditorId = '';
    currentResults = {};
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus('Cleared all well mappings.');
    setCsvStatus('');
    updateActiveWellPreviewState();
  }

  function focusPlateWellInput(wellId) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell || !assayPlatePreview) {
      return;
    }
    const selector = `[data-well="${normalizedWell}"] [data-well-inline-field="${plateEditField}"]`;
    assayPlatePreview.querySelector(selector)?.focus();
  }

  function onLayoutListClick(event) {
    const editBtn = event.target.closest('[data-layout-edit]');
    if (editBtn) {
      const well = editBtn.dataset.layoutEdit;
      const item = currentLayout.find((entry) => entry.well === well);
      if (!item) {
        return;
      }
      setActiveWellSelection(item.well || '');
      focusPlateWellInput(item.well || '');
      setLayoutStatus(`Focused ${well} in plate preview.`);
      return;
    }
    const deleteBtn = event.target.closest('[data-layout-delete]');
    if (deleteBtn) {
      const well = deleteBtn.dataset.layoutDelete;
      delete manualWellOverrides[well];
      suppressedWells.add(well);
      setLayoutFromAxisAndOverrides();
      if (activeWellEditorId === well) {
        activeWellEditorId = '';
      }
      renderLayoutList();
      renderPlatePreview();
      renderResultTable();
      setLayoutStatus(`Deleted ${well}.`);
      setCsvStatus(`Mapped wells: ${currentLayout.length}.`);
    }
  }

  function renderProjectOptions() {
    if (!assayProjectInput) {
      return;
    }
    const selected = assayProjectInput.value;
    const options = ['<option value="">Select project</option>'];
    (state.projects || []).forEach((project) => {
      const isSelected = selected === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });
    assayProjectInput.innerHTML = options.join('');
    if (selected && (state.projects || []).some((project) => project.id === selected)) {
      assayProjectInput.value = selected;
    }
  }

  function renderNotebookOptions() {
    if (!assayNotebookEntryInput) {
      return;
    }
    const selected = assayNotebookEntryInput.value;
    const projectId = assayProjectInput?.value || '';
    const entries = (state.notebookEntries || [])
      .filter((entry) => !projectId || entry.projectId === projectId)
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
    const options = ['<option value="">Not linked</option>'];
    entries.forEach((entry) => {
      options.push(`<option value="${entry.id}">${safeText(notebookLabel(entry))}</option>`);
    });
    assayNotebookEntryInput.innerHTML = options.join('');

    if (selected && entries.some((entry) => entry.id === selected)) {
      assayNotebookEntryInput.value = selected;
      return;
    }

    if (selected && !entries.some((entry) => entry.id === selected)) {
      assayNotebookEntryInput.innerHTML += `<option value="${safeText(selected)}">${safeText(`${selected} (missing notebook page)`)}</option>`;
      assayNotebookEntryInput.value = selected;
    }
  }

  function renderPlateDefinition() {
    if (!assayPlateDefinition) {
      return;
    }
    const def = getPlateDefinition(assayPlateTypeInput?.value);
    assayPlateDefinition.textContent = `Plate layout: ${def.rows} rows x ${def.columns} columns (${def.rows * def.columns} wells).`;
  }

  function syncAxisDisplay() {
    if (!assayConcentrationAxisDisplay) {
      return;
    }
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    assayConcentrationAxisDisplay.value = axisLabel(oppositeAxis(sampleAxis));
    renderAxisSwitchButtons();
  }

  function onPlateTypeChange() {
    currentResults = normalizeResults(currentResults, getCurrentDefinition());
    setLayoutFromAxisAndOverrides();
    activeWellEditorId = '';
    syncAxisTemplateValues();
    renderPlateDefinition();
    renderAssayNumberDisplay();
    renderPlatePreview();
    renderResultTable();
    renderLayoutList();
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
    unmountAnalysisChart();
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
    setCsvStatus(`Mapped wells: ${currentLayout.length}. Result wells: ${getResultValueCount()}.`);
  }

  function exportCsvTemplate() {
    const def = getCurrentDefinition();
    const layoutMap = layoutToMap(currentLayout);
    const lines = ['well,row,column,sample_id,concentration'];
    buildAllWells(def).forEach((well) => {
      const value = layoutMap[well.well] || { sampleId: '', concentration: '' };
      lines.push([
        well.well,
        well.row,
        well.column,
        escapeCsv(value.sampleId),
        escapeCsv(value.concentration)
      ].join(','));
    });

    const content = `${lines.join('\n')}\n`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = sanitizeFilePart(assayNameInput?.value, 'assay');
    link.href = url;
    link.download = `${baseName}-${def.value}well-template.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setCsvStatus(`Exported ${def.label} CSV template.`);
  }

  async function onImportCsv(event) {
    const file = event?.target?.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = await file.text();
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) {
        setCsvStatus('Import failed: CSV file is empty.');
        return;
      }

      const header = parseCsvLine(lines[0]).map((cell) => String(cell || '').trim().toLowerCase());
      const indexWell = header.indexOf('well');
      const indexRow = header.indexOf('row');
      const indexColumn = header.indexOf('column');
      const indexSample = header.indexOf('sample_id');
      const indexConcentration = header.indexOf('concentration');
      if (indexWell < 0 && (indexRow < 0 || indexColumn < 0)) {
        setCsvStatus('Import failed: CSV needs "well" or both "row" and "column" columns.');
        return;
      }

      const def = getCurrentDefinition();
      const valid = new Set(buildAllWells(def).map((item) => item.well));
      const imported = [];
      for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
        const cells = parseCsvLine(lines[rowIndex]);
        const well = (indexWell >= 0 ? cells[indexWell] : '').trim().toUpperCase();
        const fallbackRow = (indexRow >= 0 ? cells[indexRow] : '').trim().toUpperCase();
        const fallbackColumn = Number((indexColumn >= 0 ? cells[indexColumn] : '').trim());
        const resolvedWell = well || (fallbackRow && Number.isFinite(fallbackColumn) ? `${fallbackRow}${fallbackColumn}` : '');
        if (!resolvedWell || !valid.has(resolvedWell)) {
          continue;
        }
        const sampleId = indexSample >= 0 ? String(cells[indexSample] || '').trim() : '';
        const concentration = indexConcentration >= 0 ? String(cells[indexConcentration] || '').trim() : '';
        if (!sampleId && !concentration) {
          continue;
        }
        imported.push({ well: resolvedWell, sampleId, concentration });
      }

      setAxisTemplateValues({ sampleValues: [], concentrationValues: [] }, def);
      suppressedWells = new Set();
      manualWellOverrides = layoutToMap(normalizeLayout(imported, def));
      setLayoutFromAxisAndOverrides();
      renderPlatePreview();
      renderLayoutList();
      renderResultTable();
      setCsvStatus(`Imported ${currentLayout.length} mapped wells from ${file.name}.`);
    } catch {
      setCsvStatus('Import failed: could not parse CSV file.');
    } finally {
      if (assayImportFile) {
        assayImportFile.value = '';
      }
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    ensureState();

    const name = assayNameInput?.value.trim() || '';
    if (!name) {
      return;
    }

    const plateDef = getPlateDefinition(assayPlateTypeInput?.value);
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const concentrationAxis = oppositeAxis(sampleAxis);
    const project = (state.projects || []).find((item) => item.id === assayProjectInput?.value);
    const notebookEntry = (state.notebookEntries || []).find((entry) => entry.id === assayNotebookEntryInput?.value);
    const editingId = assayIdInput?.value || '';
    const existing = (state.assays || []).find((item) => item.id === editingId);
    const axisValues = getAxisTemplateValues();
    syncAxisTemplateValues(axisValues);
    setLayoutFromAxisAndOverrides();

    const record = {
      id: existing?.id || createId(),
      assayNumber: existing?.assayNumber || nextAssayNumber(),
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
      manualWellOverrides: normalizeManualWellOverrideMap(manualWellOverrides, plateDef),
      suppressedWells: Array.from(suppressedWells),
      notebookEntryId: assayNotebookEntryInput?.value || '',
      notebookEntryProtocolName: notebookEntry?.protocolName || '',
      notebookEntryType: notebookEntry?.notebookType || '',
      wellLayout: normalizeLayout(currentLayout, plateDef),
      resultValues: filterResultsToMappedWells(normalizeResults(currentResults, plateDef)),
      notes: assayNotesInput?.value.trim() || '',
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
    assayIdInput.value = '';
    assayForm.reset();
    activeResultsAssayId = '';
    activeWellEditorId = '';
    plateEditField = 'sampleId';
    manualWellOverrides = {};
    suppressedWells = new Set();
    currentLayout = [];
    currentResults = {};
    resultPasteAnchor = { rowIndex: 0, columnIndex: 0 };
    axisTemplateValues = { sampleValues: [], concentrationValues: [] };
    if (assayAnalysisMethodInput) {
      assayAnalysisMethodInput.value = 'grouped_summary';
    }
    setCsvStatus('');
    setLayoutStatus('');
    if (assaySampleAxisInput) {
      assaySampleAxisInput.value = 'row';
    }
    if (assayPlateTypeInput) {
      assayPlateTypeInput.value = '96';
    }
    renderProjectOptions();
    renderNotebookOptions();
    syncAxisDisplay();
    renderPlateEditFieldButtons();
    syncAxisTemplateValues();
    renderPlateDefinition();
    renderPlatePreview();
    renderAssayNumberDisplay();
    renderResultsAssayOptions();
    renderActiveAssayInfo(null);
    renderResultTable();
    renderLayoutList();
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
    unmountAnalysisChart();
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
    updateActiveWellPreviewState();
    setAssayMode('create');
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

  function editAssay(assayId) {
    const assay = getAssayById(assayId);
    if (!assay) {
      return;
    }
    assayIdInput.value = assay.id;
    assayNameInput.value = assay.name || '';
    assayProjectInput.value = assay.projectId || '';
    renderProjectOptions();
    assayProjectInput.value = assay.projectId || '';
    renderNotebookOptions();
    assayPlateTypeInput.value = String(assay.plateType || '96');
    assaySampleAxisInput.value = assay.sampleAxis === 'column' ? 'column' : 'row';
    const def = getCurrentDefinition();
    const axisValues = restoreAssayLayoutState(assay, def);
    activeResultsAssayId = assay.id;
    syncAxisDisplay();
    renderPlateDefinition();
    renderPlatePreview(axisValues);
    renderAssayNumberDisplay();
    renderResultsAssayOptions(assay.id);
    renderActiveAssayInfo(assay);
    renderResultTable();
    renderLayoutList();
    assayNotebookEntryInput.value = assay.notebookEntryId || '';
    if (assay.notebookEntryId && !Array.from(assayNotebookEntryInput.options).some((option) => option.value === assay.notebookEntryId)) {
      const option = document.createElement('option');
      option.value = assay.notebookEntryId;
      option.textContent = `${assay.notebookEntryId} (missing notebook page)`;
      assayNotebookEntryInput.append(option);
      assayNotebookEntryInput.value = assay.notebookEntryId;
    }
    if (assayNotesInput) {
      assayNotesInput.value = assay.notes || '';
    }
    setCsvStatus(assay.wellLayout?.length ? `Loaded ${assay.wellLayout.length} mapped wells from saved assay.` : '');
    setResultStatus(`Loaded ${Object.keys(currentResults).length} result value(s) from saved assay.`);
    setLayoutStatus('');
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
    unmountAnalysisChart();
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
  }

  function deleteAssay(assayId) {
    state.assays = (state.assays || []).filter((item) => item.id !== assayId);
    if (activeResultsAssayId === assayId) {
      activeResultsAssayId = '';
      currentResults = {};
      currentLayout = [];
      renderResultTable();
      renderActiveAssayInfo(null);
      if (assayAnalysisSummary) {
        assayAnalysisSummary.textContent = '';
      }
      unmountAnalysisChart();
      if (assayAnalysisTable) {
        assayAnalysisTable.innerHTML = '';
      }
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
    const term = String(assaySearchInput?.value || '').trim().toLowerCase();
    const rows = sortedAssaysByUpdated().filter((item) => matchesSearch(item, term));

    if (!rows.length) {
      assayList.innerHTML = '<p class="small-note">No assays found.</p>';
      return;
    }

    assayList.innerHTML = rows.map((assay) => `
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

  function render() {
    ensureState();
    const addedNumbers = ensureAssayNumbers();
    if (addedNumbers) {
      persist();
    }
    renderProjectOptions();
    renderNotebookOptions();
    syncAxisDisplay();
    renderPlateEditFieldButtons();
    syncAxisTemplateValues();
    renderPlateDefinition();
    renderAssayNumberDisplay();
    renderResultsAssayOptions(activeResultsAssayId || assayResultsAssaySelect?.value || '');
    renderActiveAssayInfo(getAssayById(activeResultsAssayId));
    renderPlatePreview();
    renderResultTable();
    renderLayoutList();
    renderList();
    setAssayMode(assayMode);
  }

  return {
    render,
    renderProjectOptions,
    renderNotebookOptions,
    renderList
  };
}
