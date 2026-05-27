import {
  rowLabelToIndex,
  toRowLabel,
  wellIdFor
} from './plate-model.js';
import { oppositeAxis } from './shared.js';
import { bindFileDropTarget } from '../file-drop.js';
import {
  detectAssayResultMatrixCandidates,
  getAssayResultImportTarget
} from './result-import-detector.js';

export {
  detectAssayResultMatrixCandidates,
  getAssayResultImportTarget
} from './result-import-detector.js';

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

export function createAssayResultsManager({
  runtime,
  elements,
  TabulatorLib,
  isMappedWell,
  getCurrentDefinition,
  getSampleAxis,
  filterAndNormalizeResults,
  setResultStatus,
  clearAnalysisOutput,
  onAnalysisConfigChange,
  parseResultImportFile,
  persistResultAttachment,
  onResultImportApplied
}) {
  const {
    assayAnalysisAddColumnGroupBtn,
    assayAnalysisAddRowGroupBtn,
    assayAnalysisClearGroupsBtn,
    assayAnalysisColumnGroupsInput,
    assayAnalysisGroupNameInput,
    assayAnalysisRowGroupsInput,
    assayAnalysisSelectionStatus,
    assayResultTable,
    assayAttachResultFileBtn,
    assayResultFileInput,
    assayResultImportOverlay,
    assayResultImportCloseBtn,
    assayResultImportCancelBtn,
    assayResultImportApplyBtn,
    assayResultImportStatus,
    assayResultImportCandidates,
    assayResultImportPreview
  } = elements;

  let resultGrid = null;
  let resultGridSignature = '';
  let resultImportState = null;
  let resultImportPreviewGrid = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function axisDisplayLabel(axisKey) {
    return axisKey === 'sampleId' ? 'Sample ID' : 'Concentration';
  }

  function buildLayoutMap() {
    const map = {};
    (Array.isArray(runtime.currentLayout) ? runtime.currentLayout : []).forEach((item) => {
      const well = String(item?.well || '').trim().toUpperCase();
      if (!well) {
        return;
      }
      map[well] = {
        sampleId: String(item?.sampleId || '').trim(),
        concentration: String(item?.concentration || '').trim()
      };
    });
    return map;
  }

  function buildAxisMetadata(def) {
    const sampleAxis = typeof getSampleAxis === 'function' ? getSampleAxis() : 'row';
    const rowField = sampleAxis === 'row' ? 'sampleId' : 'concentration';
    const columnField = oppositeAxis(sampleAxis) === 'column' ? 'concentration' : 'sampleId';
    const layoutMap = buildLayoutMap();
    const rowValues = new Array(def.rows).fill('');
    const columnValues = new Array(def.columns).fill('');

    for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
        const mapping = layoutMap[wellIdFor(rowIndex, columnIndex)];
        if (!mapping) {
          continue;
        }
        if (!rowValues[rowIndex] && mapping[rowField]) {
          rowValues[rowIndex] = mapping[rowField];
        }
        if (!columnValues[columnIndex] && mapping[columnField]) {
          columnValues[columnIndex] = mapping[columnField];
        }
      }
    }

    return {
      rowField,
      columnField,
      rowValues,
      columnValues
    };
  }

  function getResultValueCount() {
    return Object.keys(runtime.currentResults || {}).length;
  }

  function buildResultGridSignature(def) {
    const metadata = buildAxisMetadata(def);
    return JSON.stringify({
      rows: def.rows,
      columns: def.columns,
      rowField: metadata.rowField,
      columnField: metadata.columnField,
      columnValues: metadata.columnValues
    });
  }

  function buildResultGridColumns(def) {
    const metadata = buildAxisMetadata(def);
    const columns = [
      {
        title: '',
        field: 'rowLabel',
        width: 54,
        minWidth: 54,
        headerSort: false,
        hozAlign: 'center',
        frozen: true,
        editable: false
      },
      {
        title: axisDisplayLabel(metadata.rowField),
        field: 'rowMeta',
        width: 92,
        minWidth: 92,
        headerSort: false,
        hozAlign: 'center',
        frozen: true,
        editable: false,
        formatter: (cell) => String(cell.getValue() || '—')
      }
    ];
    for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
      const metaValue = String(metadata.columnValues[columnIndex] || '').trim();
      columns.push({
        title: `
          <div class="assay-result-col-head">
            <span class="assay-result-col-index">${columnIndex + 1}</span>
            <span class="assay-result-col-meta">${escapeHtml(metaValue || '—')}</span>
          </div>
        `,
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
    const metadata = buildAxisMetadata(def);
    const rows = [];
    for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
      const row = {
        __rowIndex: rowIndex,
        rowLabel: toRowLabel(rowIndex),
        rowMeta: metadata.rowValues[rowIndex] || '—'
      };
      for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
        const well = wellIdFor(rowIndex, columnIndex);
        row[toResultField(columnIndex)] = runtime.currentResults[well] || '';
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
      delete runtime.currentResults[well];
      return true;
    }
    runtime.currentResults[well] = value;
    return true;
  }

  function setAnalysisSelectionStatus(message) {
    if (!assayAnalysisSelectionStatus) {
      return;
    }
    assayAnalysisSelectionStatus.textContent = message || '';
  }

  function summarizeSelectionLabels(labels, maxItems = 8) {
    const normalized = Array.isArray(labels)
      ? labels.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    if (normalized.length <= maxItems) {
      return normalized.join(', ');
    }
    return `${normalized.slice(0, maxItems).join(', ')}, +${normalized.length - maxItems} more`;
  }

  function getCurrentResultRangeSelection() {
    if (!resultGrid || typeof resultGrid.getRanges !== 'function') {
      return { rowLabels: [], columnLabels: [] };
    }
    const ranges = resultGrid.getRanges();
    if (!Array.isArray(ranges) || !ranges.length) {
      return { rowLabels: [], columnLabels: [] };
    }
    const activeRange = ranges[ranges.length - 1];
    if (!activeRange) {
      return { rowLabels: [], columnLabels: [] };
    }

    const rowLabels = Array.isArray(activeRange.getRows?.())
      ? activeRange.getRows()
        .map((row) => String(row?.getData?.()?.rowLabel || '').trim().toUpperCase())
        .filter((value) => /^[A-Z]+$/.test(value))
      : [];
    const columnLabels = Array.isArray(activeRange.getColumns?.())
      ? activeRange.getColumns()
        .map((column) => resultFieldToColumnIndex(column?.getField?.()))
        .filter((columnIndex) => columnIndex >= 0)
        .map((columnIndex) => String(columnIndex + 1))
      : [];

    return {
      rowLabels: [...new Set(rowLabels)].sort((a, b) => rowLabelToIndex(a) - rowLabelToIndex(b)),
      columnLabels: [...new Set(columnLabels)].sort((a, b) => Number(a) - Number(b))
    };
  }

  function updateResultRangeSelectionStatus() {
    const selection = getCurrentResultRangeSelection();
    setAnalysisSelectionStatus('');
    return selection;
  }

  function sanitizeGroupName(raw, fallbackName) {
    const cleaned = String(raw || '')
      .replace(/[:;\n\r]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || fallbackName;
  }

  function nextGroupName(dimension) {
    const input = dimension === 'row' ? assayAnalysisRowGroupsInput : assayAnalysisColumnGroupsInput;
    const prefix = dimension === 'row' ? 'Row Group' : 'Column Group';
    const existing = String(input?.value || '')
      .split(/[\n;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return `${prefix} ${existing.length + 1}`;
  }

  function appendGroupEntry(input, groupName, members) {
    if (!input) {
      return;
    }
    const current = String(input.value || '').trim();
    const entry = `${groupName}: ${members.join(',')}`;
    input.value = current ? `${current}\n${entry}` : entry;
  }

  function addSelectedRangeGroup(dimension) {
    const selection = updateResultRangeSelectionStatus();
    const members = dimension === 'row' ? selection.rowLabels : selection.columnLabels;
    if (members.length < 2) {
      setAnalysisSelectionStatus(`Select at least two ${dimension === 'row' ? 'rows' : 'columns'} before adding a group.`);
      return;
    }

    const input = dimension === 'row' ? assayAnalysisRowGroupsInput : assayAnalysisColumnGroupsInput;
    const fallbackName = nextGroupName(dimension);
    const groupName = sanitizeGroupName(assayAnalysisGroupNameInput?.value, fallbackName);
    appendGroupEntry(input, groupName, members);
    setAnalysisSelectionStatus(`Added "${groupName}" with ${members.length} ${dimension === 'row' ? 'row(s)' : 'column(s)'}.`);
    if (typeof onAnalysisConfigChange === 'function') {
      onAnalysisConfigChange();
    }
  }

  function onAddSelectedRowGroup() {
    addSelectedRangeGroup('row');
  }

  function onAddSelectedColumnGroup() {
    addSelectedRangeGroup('column');
  }

  function onClearAnalysisGroups() {
    if (assayAnalysisRowGroupsInput) {
      assayAnalysisRowGroupsInput.value = '';
    }
    if (assayAnalysisColumnGroupsInput) {
      assayAnalysisColumnGroupsInput.value = '';
    }
    if (assayAnalysisGroupNameInput) {
      assayAnalysisGroupNameInput.value = '';
    }
    setAnalysisSelectionStatus('Cleared row and column groups.');
    if (typeof onAnalysisConfigChange === 'function') {
      onAnalysisConfigChange();
    }
  }

  function clearResultGrid() {
    if (!resultGrid) {
      return;
    }
    resultGrid.destroy();
    resultGrid = null;
    resultGridSignature = '';
    setAnalysisSelectionStatus('');
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
    runtime.resultPasteAnchor = { rowIndex, columnIndex };
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
    runtime.resultPasteAnchor = { rowIndex, columnIndex };
    setResultStatus(`Active cell: ${wellIdFor(rowIndex, columnIndex)}.`);
  }

  function getResultGridHeight(def) {
    if (def.rows <= 14) {
      return '';
    }
    return `${(14 * 33) + 58}px`;
  }

  function ensureResultGrid(def) {
    if (!assayResultTable) {
      return false;
    }
    if (!TabulatorLib) {
      assayResultTable.innerHTML = '<p class="small-note">Spreadsheet component failed to load (Tabulator).</p>';
      return false;
    }
    const signature = buildResultGridSignature(def);
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
      const gridOptions = {
        data: buildResultGridData(def),
        columns: buildResultGridColumns(def),
        index: '__rowIndex',
        layout: 'fitDataTable',
        reactiveData: false,
        selectableRange: true,
        selectableRangeColumns: true,
        selectableRangeRows: true,
        cellEdited: onResultGridCellEdited,
        cellClick: onResultGridCellClick
      };
      const gridHeight = getResultGridHeight(def);
      if (gridHeight) {
        gridOptions.height = gridHeight;
      }
      resultGrid = new TabulatorLib(host, gridOptions);
      if (typeof resultGrid.on === 'function') {
        resultGrid.on('rangeAdded', updateResultRangeSelectionStatus);
        resultGrid.on('rangeChanged', updateResultRangeSelectionStatus);
        resultGrid.on('rangeRemoved', updateResultRangeSelectionStatus);
      }
      host.addEventListener('focus', () => {
        setResultStatus('Table selected. Paste starts at A1 unless a result cell is selected.');
      });
      resultGridSignature = signature;
      updateResultRangeSelectionStatus();
      return true;
    }
    resultGrid.replaceData(buildResultGridData(def));
    updateResultRangeSelectionStatus();
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
    if (!resultGrid) {
      runtime.currentResults = filterAndNormalizeResults(runtime.currentResults);
      return runtime.currentResults;
    }

    const def = getCurrentDefinition();
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

    runtime.currentResults = filterAndNormalizeResults(nextResults);
    return runtime.currentResults;
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
        rowIndex: runtime.resultPasteAnchor.rowIndex,
        columnIndex: runtime.resultPasteAnchor.columnIndex,
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
      runtime.currentResults = {};
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
    runtime.resultPasteAnchor = { rowIndex: startRowIndex, columnIndex: startColumnIndex };
    return { pastedCount, skippedCount };
  }

  function setResultImportStatus(message) {
    if (assayResultImportStatus) {
      assayResultImportStatus.textContent = message || '';
    }
  }

  function destroyResultImportPreviewGrid() {
    if (!resultImportPreviewGrid) {
      return;
    }
    resultImportPreviewGrid.destroy();
    resultImportPreviewGrid = null;
  }

  function closeResultImportDialog() {
    if (assayResultImportOverlay) {
      assayResultImportOverlay.hidden = true;
    }
    destroyResultImportPreviewGrid();
    resultImportState = null;
    if (assayResultImportCandidates) {
      assayResultImportCandidates.innerHTML = '';
    }
    if (assayResultImportPreview) {
      assayResultImportPreview.innerHTML = '';
    }
    setResultImportStatus('');
  }

  function buildResultImportPreviewRows(candidate) {
    return (Array.isArray(candidate?.matrix) ? candidate.matrix : []).map((row, rowIndex) => {
      const data = {
        __rowIndex: rowIndex,
        rowLabel: toRowLabel(rowIndex)
      };
      for (let columnIndex = 0; columnIndex < candidate.columns; columnIndex += 1) {
        data[toResultField(columnIndex)] = String(row?.[columnIndex] ?? '');
      }
      return data;
    });
  }

  function buildResultImportPreviewColumns(candidate) {
    const columns = [
      {
        title: '',
        field: 'rowLabel',
        width: 54,
        minWidth: 54,
        headerSort: false,
        hozAlign: 'center',
        frozen: true,
        editable: false
      }
    ];
    for (let columnIndex = 0; columnIndex < candidate.columns; columnIndex += 1) {
      columns.push({
        title: String(columnIndex + 1),
        field: toResultField(columnIndex),
        headerSort: false,
        hozAlign: 'center',
        headerHozAlign: 'center',
        minWidth: 72,
        editable: false
      });
    }
    return columns;
  }

  function renderResultImportPreview(candidate) {
    destroyResultImportPreviewGrid();
    if (!assayResultImportPreview) {
      return;
    }
    assayResultImportPreview.innerHTML = '';
    if (!candidate) {
      assayResultImportPreview.innerHTML = '<p class="small-note">Select a detected matrix to preview it.</p>';
      return;
    }
    if (!TabulatorLib) {
      const table = document.createElement('table');
      table.className = 'assay-serial-dilution-table assay-result-import-fallback-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th></th>
            ${Array.from({ length: candidate.columns }, (_item, index) => `<th>${index + 1}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${candidate.matrix.map((row, rowIndex) => `
            <tr>
              <th>${toRowLabel(rowIndex)}</th>
              ${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      `;
      assayResultImportPreview.append(table);
      return;
    }
    const host = document.createElement('div');
    host.className = 'assay-tabulator assay-result-import-preview-grid';
    host.setAttribute('role', 'grid');
    host.setAttribute('aria-label', 'Read-only assay result import preview');
    assayResultImportPreview.append(host);
    resultImportPreviewGrid = new TabulatorLib(host, {
      data: buildResultImportPreviewRows(candidate),
      columns: buildResultImportPreviewColumns(candidate),
      index: '__rowIndex',
      layout: 'fitDataTable',
      reactiveData: false,
      selectable: false
    });
  }

  function renderResultImportCandidates() {
    if (!assayResultImportCandidates || !resultImportState) {
      return;
    }
    const { candidates, selectedId } = resultImportState;
    assayResultImportCandidates.innerHTML = candidates.map((candidate) => {
      const active = candidate.id === selectedId ? ' is-active' : '';
      const numericPercent = Math.round((candidate.numericRatio || 0) * 100);
      const fillPercent = Math.round((candidate.nonBlankRatio || 0) * 100);
      return `
        <button type="button" class="assay-result-import-choice${active}" data-result-import-candidate="${escapeHtml(candidate.id)}">
          <strong>${escapeHtml(candidate.tableName || 'Sheet')} · ${escapeHtml(candidate.rangeLabel)}</strong>
          <span>${escapeHtml(`${candidate.rows} x ${candidate.columns}`)} result cells · ${numericPercent}% numeric · ${fillPercent}% filled</span>
        </button>
      `;
    }).join('');
  }

  function selectResultImportCandidate(candidateId) {
    if (!resultImportState) {
      return;
    }
    const candidate = resultImportState.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      return;
    }
    resultImportState.selectedId = candidate.id;
    if (assayResultImportApplyBtn) {
      assayResultImportApplyBtn.disabled = false;
    }
    renderResultImportCandidates();
    renderResultImportPreview(candidate);
  }

  function openResultImportDialog({ fileName, dataBase64, candidates, importTarget }) {
    if (!assayResultImportOverlay) {
      return;
    }
    resultImportState = {
      fileName,
      dataBase64,
      candidates,
      importTarget,
      selectedId: candidates[0]?.id || ''
    };
    assayResultImportOverlay.hidden = false;
    if (assayResultImportApplyBtn) {
      assayResultImportApplyBtn.disabled = !resultImportState.selectedId;
    }
    setResultImportStatus(`Detected ${candidates.length} plate-sized matrix choices in ${fileName}.`);
    renderResultImportCandidates();
    selectResultImportCandidate(resultImportState.selectedId);
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    const chunks = [];
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      let binary = '';
      for (let offset = 0; offset < chunk.length; offset += 1) {
        binary += String.fromCharCode(chunk[offset]);
      }
      chunks.push(binary);
    }
    return btoa(chunks.join(''));
  }

  function readResultImportFileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        try {
          resolve(arrayBufferToBase64(reader.result));
        } catch (error) {
          reject(error);
        }
      });
      reader.addEventListener('error', () => reject(reader.error || new Error('Unable to read result file.')));
      reader.readAsArrayBuffer(file);
    });
  }

  async function applyResultImportCandidate(candidate) {
    if (!candidate || !resultImportState) {
      setResultStatus('Select a result matrix before importing.');
      return;
    }
    if (typeof persistResultAttachment !== 'function') {
      setResultStatus('Result file attachment storage is unavailable.');
      return;
    }

    if (assayResultImportApplyBtn) {
      assayResultImportApplyBtn.disabled = true;
    }
    setResultImportStatus(`Saving ${resultImportState.fileName} beside the assay plate...`);

    try {
      const importedFileName = resultImportState.fileName;
      const importTarget = resultImportState.importTarget || getAssayResultImportTarget(runtime.currentLayout, getCurrentDefinition());
      const attachment = await persistResultAttachment({
        fileName: importedFileName,
        dataBase64: resultImportState.dataBase64,
        candidate
      });
      const counts = applyResultMatrix({
        matrix: candidate.matrix,
        startRowIndex: importTarget.startRowIndex,
        startColumnIndex: importTarget.startColumnIndex,
        replaceAll: true
      });
      renderResultTable();
      if (typeof clearAnalysisOutput === 'function') {
        clearAnalysisOutput();
      }
      if (typeof onResultImportApplied === 'function') {
        await onResultImportApplied({
          candidate,
          attachment,
          fileName: importedFileName,
          counts
        });
      }
      closeResultImportDialog();
      setResultStatus(`Imported ${counts.pastedCount} result value(s) from ${importedFileName}. Skipped ${counts.skippedCount} unmapped cell(s). Attached file saved beside the plate.`);
    } catch (error) {
      const message = String(error?.message || error || 'Unable to import result file.');
      setResultImportStatus(message);
      setResultStatus(message);
      if (assayResultImportApplyBtn) {
        assayResultImportApplyBtn.disabled = false;
      }
    }
  }

  async function importResultFile(file) {
    if (!file) {
      return;
    }
    const selectedAssayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    if (!selectedAssayId) {
      setResultStatus('Select an assay plate before attaching a result file.');
      return;
    }
    if (typeof parseResultImportFile !== 'function') {
      setResultStatus('Result file parser is unavailable.');
      return;
    }

    setResultStatus(`Reading ${file.name}...`);
    try {
      const dataBase64 = await readResultImportFileBase64(file);
      const parsed = await parseResultImportFile({
        fileName: file.name,
        dataBase64
      });
      const importTarget = getAssayResultImportTarget(runtime.currentLayout, getCurrentDefinition());
      const candidates = detectAssayResultMatrixCandidates(parsed?.tables || [], importTarget);
      if (!candidates.length) {
        const areaLabel = importTarget.source === 'mapped' ? 'mapped-area ' : '';
        setResultStatus(`No ${importTarget.rows} x ${importTarget.columns} ${areaLabel}result matrix was detected in ${file.name}.`);
        return;
      }
      if (candidates.length === 1) {
        resultImportState = {
          fileName: file.name,
          dataBase64,
          candidates,
          importTarget,
          selectedId: candidates[0].id
        };
        await applyResultImportCandidate(candidates[0]);
        return;
      }
      openResultImportDialog({
        fileName: file.name,
        dataBase64,
        candidates,
        importTarget
      });
    } catch (error) {
      const message = String(error?.message || error || 'Unable to read result file.');
      setResultStatus(message);
      setResultImportStatus(message);
    }
  }

  async function onResultFileChange(event) {
    const file = event.target?.files?.[0] || null;
    if (event.target) {
      event.target.value = '';
    }
    await importResultFile(file);
  }

  function onAttachResultFileClick() {
    if (!assayAttachResultFileBtn || !assayResultFileInput) {
      setResultStatus('Result file attachment control is unavailable.');
      return;
    }
    const selectedAssayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    if (!selectedAssayId) {
      setResultStatus('Select an assay plate before attaching a result file.');
      return;
    }
    assayResultFileInput.click();
  }

  function onResultImportOverlayClick(event) {
    if (event.target === assayResultImportOverlay) {
      closeResultImportDialog();
    }
  }

  function onResultImportCandidateClick(event) {
    const button = event.target.closest('[data-result-import-candidate]');
    if (!button) {
      return;
    }
    selectResultImportCandidate(button.dataset.resultImportCandidate);
  }

  function applySelectedResultImportCandidate() {
    if (!resultImportState) {
      return;
    }
    const candidate = resultImportState.candidates.find((item) => item.id === resultImportState.selectedId);
    void applyResultImportCandidate(candidate);
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
    runtime.currentResults = {};
    renderResultTable();
    if (typeof clearAnalysisOutput === 'function') {
      clearAnalysisOutput();
    }
    setResultStatus('Cleared all result values. Only mapped wells are editable.');
  }

  bindFileDropTarget({
    target: elements.assayResultsLayout || assayResultTable,
    accept: assayResultFileInput?.getAttribute?.('accept') || '',
    disabled: () => Boolean(elements.assayResultsLayout?.hidden),
    onFiles: ([file]) => importResultFile(file),
    onRejected: () => {
      setResultStatus('Drop a CSV or Excel result file to attach it.');
    },
    onError: (error) => {
      setResultStatus(String(error?.message || error || 'Unable to import the dropped result file.'));
    }
  });

  return {
    getResultValueCount,
    clearResultGrid,
    renderResultTable,
    syncCurrentResultsFromGrid,
    setAnalysisSelectionStatus,
    onAddSelectedRowGroup,
    onAddSelectedColumnGroup,
    onClearAnalysisGroups,
    onResultTablePaste,
    onClearResults,
    onAttachResultFileClick,
    onResultFileChange,
    closeResultImportDialog,
    onResultImportOverlayClick,
    onResultImportCandidateClick,
    applySelectedResultImportCandidate
  };
}
