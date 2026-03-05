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
  const assayWellIdInput = document.getElementById('assay-well-id');
  const assayWellSampleIdInput = document.getElementById('assay-well-sample-id');
  const assayWellConcentrationInput = document.getElementById('assay-well-concentration');
  const assayWellUpsertBtn = document.getElementById('assay-well-upsert-btn');
  const assayWellRemoveBtn = document.getElementById('assay-well-remove-btn');
  const assayWellClearBtn = document.getElementById('assay-well-clear-btn');
  const assaySampleAxisValuesInput = document.getElementById('assay-sample-axis-values');
  const assayConcentrationAxisValuesInput = document.getElementById('assay-concentration-axis-values');
  const assayApplyAxisTemplateBtn = document.getElementById('assay-apply-axis-template-btn');
  const assayLayoutStatus = document.getElementById('assay-layout-status');
  const assayLayoutList = document.getElementById('assay-layout-list');
  const assayList = document.getElementById('assay-list');
  let currentLayout = [];
  let currentResults = {};
  let assayMode = 'create';
  let activeResultsAssayId = '';
  let resultGrid = null;
  let resultGridSignature = '';
  let resultPasteAnchor = { rowIndex: 0, columnIndex: 0 };

  assayForm?.addEventListener('submit', onSubmit);
  assayCancelBtn?.addEventListener('click', resetForm);
  assayModeCreateBtn?.addEventListener('click', () => setAssayMode('create'));
  assayModeResultsBtn?.addEventListener('click', () => setAssayMode('results'));
  assayProjectInput?.addEventListener('change', renderNotebookOptions);
  assayPlateTypeInput?.addEventListener('change', onPlateTypeChange);
  assaySampleAxisInput?.addEventListener('change', () => {
    syncAxisDisplay();
    renderPlatePreview();
  });
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
  assayWellUpsertBtn?.addEventListener('click', onUpsertWellMapping);
  assayWellRemoveBtn?.addEventListener('click', onRemoveWellMapping);
  assayWellClearBtn?.addEventListener('click', onClearWellMappings);
  assayApplyAxisTemplateBtn?.addEventListener('click', onApplyAxisTemplate);
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
      assayModeNote.textContent = isCreate
        ? 'Set up a new assay plate and mapping. Assay number is assigned automatically when saved.'
        : 'Open an existing assay plate to paste results and run analysis.';
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

  function parseAxisValues(raw) {
    return String(raw || '')
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function applyAxisTemplate({
    def,
    sampleAxis,
    sampleValues,
    concentrationValues
  }) {
    const layout = [];
    for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
        const sampleId = sampleAxis === 'row'
          ? (sampleValues[rowIndex] || '')
          : (sampleValues[columnIndex] || '');
        const concentration = sampleAxis === 'row'
          ? (concentrationValues[columnIndex] || '')
          : (concentrationValues[rowIndex] || '');
        if (!sampleId && !concentration) {
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

  function renderPlatePreview() {
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

    const headers = ['<th></th>'];
    for (let col = 0; col < maxColumns; col += 1) {
      headers.push(`<th>${col + 1}</th>`);
    }

    const rows = [];
    for (let row = 0; row < maxRows; row += 1) {
      const rowLabel = toRowLabel(row);
      const cells = [`<th>${rowLabel}</th>`];
      for (let col = 0; col < maxColumns; col += 1) {
        const well = wellIdFor(row, col);
        const layout = cellMap[well];
        const filled = layout && (layout.sampleId || layout.concentration) ? ' is-filled' : '';
        const meta = layout
          ? `Sample ID: ${layout.sampleId || '-'} | Concentration: ${layout.concentration || '-'}`
          : 'Sample ID: - | Concentration: -';
        cells.push(`<td class="assay-well${filled}" title="${safeText(`${well} • ${meta}`)}">${well}</td>`);
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }

    const note = totalWells > 384
      ? `<p class="small-note">Previewing first ${maxRows} rows x ${maxColumns} columns for ${def.label} plate.</p>`
      : '';

    assayPlatePreview.innerHTML = `
      <p class="small-note">Sample ID axis: ${axisLabel(sampleAxis)}. Concentration axis: ${axisLabel(concentrationAxis)}.</p>
      ${note}
      <div class="assay-plate-table-wrap">
        <table class="assay-plate-table">
          <thead><tr>${headers.join('')}</tr></thead>
          <tbody>${rows.join('')}</tbody>
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
    if (!value) {
      delete currentResults[well];
      return;
    }
    currentResults[well] = value;
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
    setResultValue(rowIndex, columnIndex, cell.getValue());
    resultPasteAnchor = { rowIndex, columnIndex };
    setResultStatus(`Result wells with values: ${getResultValueCount()}.`);
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
    setResultStatus(`Result wells with values: ${getResultValueCount()}.`);
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
        const value = String(rowCells[columnOffset] || '').trim();
        setResultValue(rowIndex, columnIndex, value);
        if (value) {
          pastedCount += 1;
        }
      }
    }
    resultPasteAnchor = { rowIndex: startRowIndex, columnIndex: startColumnIndex };
    return pastedCount;
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
    const pastedCount = applyResultMatrix({
      matrix,
      startRowIndex: start.rowIndex,
      startColumnIndex: start.columnIndex,
      replaceAll: start.fromTableSelection
    });
    renderResultTable();
    setResultStatus(`Pasted ${pastedCount} value(s). Result wells with values: ${getResultValueCount()}.`);
  }

  function onClearResults() {
    currentResults = {};
    renderResultTable();
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
    setResultStatus('Cleared all result values.');
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
      const concentrationLabel = String(mapping.concentration || '').trim() || '-';
      observations.push({
        well,
        response,
        rowIndex: parsedWell.rowIndex,
        rowLabel: toRowLabel(parsedWell.rowIndex),
        columnIndex: parsedWell.columnIndex,
        columnNumber: parsedWell.columnIndex + 1,
        sampleId: String(mapping.sampleId || '').trim() || '(unmapped)',
        concentrationLabel,
        concentrationValue: parseFirstNumericToken(concentrationLabel)
      });
    });

    return { observations, nonNumericCount };
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

  function analyzeGroupedSummary(observations) {
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

  function analyzeNestedSummary(observations) {
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
    const sampleGroups = groupBy(observations, (item) => item.sampleId);
    let fallbackToColumnCount = 0;
    const rows = Array.from(sampleGroups.entries())
      .map(([sampleId, sampleItems]) => {
        const concentrationGroups = new Map();
        sampleItems.forEach((item) => {
          if (!Number.isFinite(item.concentrationValue)) {
            return;
          }
          if (!concentrationGroups.has(item.concentrationValue)) {
            concentrationGroups.set(item.concentrationValue, []);
          }
          concentrationGroups.get(item.concentrationValue).push(item.response);
        });

        let xSource = 'Concentration';
        let points = Array.from(concentrationGroups.entries()).map(([x, values]) => {
          const stats = summarizeNumeric(values);
          return { x, y: stats ? stats.mean : null };
        }).filter((item) => Number.isFinite(item.y));

        if (points.length < 2) {
          xSource = 'Column';
          fallbackToColumnCount += 1;
          const columnGroups = new Map();
          sampleItems.forEach((item) => {
            if (!columnGroups.has(item.columnNumber)) {
              columnGroups.set(item.columnNumber, []);
            }
            columnGroups.get(item.columnNumber).push(item.response);
          });
          points = Array.from(columnGroups.entries()).map(([x, values]) => {
            const stats = summarizeNumeric(values);
            return { x, y: stats ? stats.mean : null };
          }).filter((item) => Number.isFinite(item.y));
        }

        points.sort((a, b) => a.x - b.x);
        const fit = linearRegression(points);
        if (!fit) {
          return null;
        }
        return [
          sampleId,
          xSource,
          points.length,
          formatNumber(fit.slope),
          formatNumber(fit.intercept),
          formatNumber(fit.r2, 5)
        ];
      })
      .filter(Boolean)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    return {
      summary: `Linear regression fitted for ${rows.length} sample(s). ${fallbackToColumnCount ? `${fallbackToColumnCount} sample(s) used column index as X because concentration values were unavailable.` : ''}`.trim(),
      headers: ['Sample ID', 'X Source', 'Points', 'Slope', 'Intercept', 'R²'],
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

  function getMeanDosePoints(sampleItems, requirePositiveX) {
    const groups = new Map();
    sampleItems.forEach((item) => {
      if (!Number.isFinite(item.concentrationValue)) {
        return;
      }
      if (requirePositiveX && item.concentrationValue <= 0) {
        return;
      }
      if (!groups.has(item.concentrationValue)) {
        groups.set(item.concentrationValue, []);
      }
      groups.get(item.concentrationValue).push(item.response);
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
    const sampleGroups = groupBy(observations, (item) => item.sampleId);
    let skipped = 0;
    const rows = Array.from(sampleGroups.entries())
      .map(([sampleId, sampleItems]) => {
        const points = getMeanDosePoints(sampleItems, true);
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
          sampleId,
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
      summary: `${mode.toUpperCase()} fit completed for ${rows.length} sample(s). ${skipped ? `${skipped} sample(s) skipped (need >=4 positive numeric concentrations).` : ''}`.trim(),
      headers: ['Sample ID', 'Points', mode.toUpperCase(), 'Hill', 'Top', 'Bottom', 'R²', 'Trend'],
      rows
    };
  }

  function analyzeSurvival(observations) {
    const sampleGroups = groupBy(observations, (item) => item.sampleId);
    const rows = [];

    Array.from(sampleGroups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([sampleId, sampleItems]) => {
        const concentrationGroups = new Map();
        sampleItems.forEach((item) => {
          if (!concentrationGroups.has(item.concentrationLabel)) {
            concentrationGroups.set(item.concentrationLabel, {
              concentrationLabel: item.concentrationLabel,
              concentrationValue: item.concentrationValue,
              values: []
            });
          }
          concentrationGroups.get(item.concentrationLabel).values.push(item.response);
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
            sampleId,
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
      summary: `Survival analysis computed as (group mean / baseline mean) * 100 for ${sampleGroups.size} sample(s).`,
      headers: ['Sample ID', 'Baseline Concentration', 'Baseline Mean', 'Concentration', 'N', 'Mean', 'Survival %'],
      rows
    };
  }

  function renderAnalysis() {
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }

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
    assayAnalysisTable.innerHTML = result.rows.length
      ? buildAnalysisTable(result.headers, result.rows)
      : '<p class="small-note">No analyzable rows for this method.</p>';
  }

  function onAnalysisMethodChange() {
    if (!assayAnalysisSummary || !assayAnalysisTable) {
      return;
    }
    assayAnalysisSummary.textContent = '';
    assayAnalysisTable.innerHTML = '';
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
    currentLayout = normalizeLayout(assay.wellLayout, def);
    currentResults = normalizeResults(assay.resultValues, def);
    renderPlateDefinition();
    renderResultTable();
    renderActiveAssayInfo(assay);
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
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
    assay.resultValues = normalizeResults(currentResults, def);
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

  function clearWellEditor() {
    if (assayWellIdInput) {
      assayWellIdInput.value = '';
    }
    if (assayWellSampleIdInput) {
      assayWellSampleIdInput.value = '';
    }
    if (assayWellConcentrationInput) {
      assayWellConcentrationInput.value = '';
    }
  }

  function onUpsertWellMapping() {
    const def = getCurrentDefinition();
    const wellId = String(assayWellIdInput?.value || '').trim().toUpperCase();
    const sampleId = String(assayWellSampleIdInput?.value || '').trim();
    const concentration = String(assayWellConcentrationInput?.value || '').trim();
    if (!wellId) {
      setLayoutStatus('Enter a well ID, e.g. A1.');
      return;
    }
    if (!isValidWellForDefinition(wellId, def)) {
      setLayoutStatus(`Well ${wellId} is not valid for the selected ${def.label} plate.`);
      return;
    }
    if (!sampleId && !concentration) {
      setLayoutStatus('Enter sample ID and/or concentration.');
      return;
    }
    currentLayout = currentLayout.filter((item) => item.well !== wellId);
    currentLayout.push({ well: wellId, sampleId, concentration });
    currentLayout = normalizeLayout(currentLayout, def);
    renderLayoutList();
    renderPlatePreview();
    setLayoutStatus(`Mapped ${wellId}.`);
    setCsvStatus(`Mapped wells: ${currentLayout.length}.`);
    clearWellEditor();
  }

  function onRemoveWellMapping() {
    const def = getCurrentDefinition();
    const wellId = String(assayWellIdInput?.value || '').trim().toUpperCase();
    if (!wellId) {
      setLayoutStatus('Enter a well ID to remove.');
      return;
    }
    const before = currentLayout.length;
    currentLayout = currentLayout.filter((item) => item.well !== wellId);
    currentLayout = normalizeLayout(currentLayout, def);
    renderLayoutList();
    renderPlatePreview();
    if (before === currentLayout.length) {
      setLayoutStatus(`No mapping found for ${wellId}.`);
    } else {
      setLayoutStatus(`Removed mapping for ${wellId}.`);
      setCsvStatus(`Mapped wells: ${currentLayout.length}.`);
    }
  }

  function onClearWellMappings() {
    currentLayout = [];
    renderLayoutList();
    renderPlatePreview();
    setLayoutStatus('Cleared all well mappings.');
    setCsvStatus('');
    clearWellEditor();
  }

  function onApplyAxisTemplate() {
    const def = getCurrentDefinition();
    const sampleAxis = assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
    const sampleValues = parseAxisValues(assaySampleAxisValuesInput?.value);
    const concentrationValues = parseAxisValues(assayConcentrationAxisValuesInput?.value);
    if (!sampleValues.length && !concentrationValues.length) {
      setLayoutStatus('Enter sample and/or concentration values first.');
      return;
    }

    const layout = applyAxisTemplate({
      def,
      sampleAxis,
      sampleValues,
      concentrationValues
    });
    currentLayout = normalizeLayout(layout, def);
    renderLayoutList();
    renderPlatePreview();

    const sampleAxisLength = sampleAxis === 'row' ? def.rows : def.columns;
    const concentrationAxisLength = sampleAxis === 'row' ? def.columns : def.rows;
    setLayoutStatus(
      `Applied template. Sample values: ${sampleValues.length}/${sampleAxisLength}, concentration values: ${concentrationValues.length}/${concentrationAxisLength}.`
    );
    setCsvStatus(`Mapped wells: ${currentLayout.length}.`);
  }

  function onLayoutListClick(event) {
    const editBtn = event.target.closest('[data-layout-edit]');
    if (editBtn) {
      const well = editBtn.dataset.layoutEdit;
      const item = currentLayout.find((entry) => entry.well === well);
      if (!item) {
        return;
      }
      assayWellIdInput.value = item.well || '';
      assayWellSampleIdInput.value = item.sampleId || '';
      assayWellConcentrationInput.value = item.concentration || '';
      setLayoutStatus(`Loaded ${well} into editor.`);
      return;
    }
    const deleteBtn = event.target.closest('[data-layout-delete]');
    if (deleteBtn) {
      const well = deleteBtn.dataset.layoutDelete;
      currentLayout = currentLayout.filter((item) => item.well !== well);
      renderLayoutList();
      renderPlatePreview();
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
  }

  function onPlateTypeChange() {
    const def = getCurrentDefinition();
    currentLayout = normalizeLayout(currentLayout, def);
    currentResults = normalizeResults(currentResults, def);
    renderPlateDefinition();
    renderAssayNumberDisplay();
    renderPlatePreview();
    renderResultTable();
    renderLayoutList();
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
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

      currentLayout = normalizeLayout(imported, def);
      renderPlatePreview();
      renderLayoutList();
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
      sampleAxisValues: parseAxisValues(assaySampleAxisValuesInput?.value),
      concentrationAxisValues: parseAxisValues(assayConcentrationAxisValuesInput?.value),
      notebookEntryId: assayNotebookEntryInput?.value || '',
      notebookEntryProtocolName: notebookEntry?.protocolName || '',
      notebookEntryType: notebookEntry?.notebookType || '',
      wellLayout: normalizeLayout(currentLayout, plateDef),
      resultValues: normalizeResults(currentResults, plateDef),
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
    currentLayout = [];
    currentResults = {};
    resultPasteAnchor = { rowIndex: 0, columnIndex: 0 };
    if (assaySampleAxisValuesInput) {
      assaySampleAxisValuesInput.value = '';
    }
    if (assayConcentrationAxisValuesInput) {
      assayConcentrationAxisValuesInput.value = '';
    }
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
    if (assayAnalysisTable) {
      assayAnalysisTable.innerHTML = '';
    }
    clearWellEditor();
    setAssayMode('create');
  }

  function onListClick(event) {
    const openResultsBtn = event.target.closest('[data-assay-open-results]');
    if (openResultsBtn) {
      setAssayMode('results');
      loadAssayForResults(openResultsBtn.dataset.assayOpenResults);
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
    if (assaySampleAxisValuesInput) {
      assaySampleAxisValuesInput.value = Array.isArray(assay.sampleAxisValues)
        ? assay.sampleAxisValues.join('\n')
        : '';
    }
    if (assayConcentrationAxisValuesInput) {
      assayConcentrationAxisValuesInput.value = Array.isArray(assay.concentrationAxisValues)
        ? assay.concentrationAxisValues.join('\n')
        : '';
    }
    const def = getCurrentDefinition();
    currentLayout = normalizeLayout(assay.wellLayout, def);
    currentResults = normalizeResults(assay.resultValues, def);
    activeResultsAssayId = assay.id;
    syncAxisDisplay();
    renderPlateDefinition();
    renderPlatePreview();
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
    assayNotesInput.value = assay.notes || '';
    setCsvStatus(assay.wellLayout?.length ? `Loaded ${assay.wellLayout.length} mapped wells from saved assay.` : '');
    setResultStatus(`Loaded ${Object.keys(currentResults).length} result value(s) from saved assay.`);
    setLayoutStatus('');
    if (assayAnalysisSummary) {
      assayAnalysisSummary.textContent = '';
    }
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
