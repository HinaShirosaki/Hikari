import {
  rowLabelToIndex,
  wellIdFor
} from './plate-model.js';
import { bindFileDropTarget } from '../file-drop.js';
import { createResultImportController } from './results/result-import.js';
import { createResultGridModel } from './results/grid-model.js';

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
  onResultImportApplied,
  onResultsChanged
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
    assayResultFileInput
  } = elements;

  let resultGrid = null;
  let resultGridSignature = '';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const {
    buildResultGridSignature,
    buildResultGridColumns,
    buildResultGridData,
    getResultGridHeight
  } = createResultGridModel({ runtime, getSampleAxis, isMappedWell, escapeHtml, toResultField });

  function getResultValueCount() {
    return Object.keys(runtime.currentResults || {}).length;
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

  function notifyResultsChanged() {
    if (typeof onResultsChanged === 'function') {
      onResultsChanged();
    }
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
    notifyResultsChanged();
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

  const importController = createResultImportController({
    elements,
    runtime,
    TabulatorLib,
    escapeHtml,
    toResultField,
    applyResultMatrix,
    renderResultTable,
    getCurrentDefinition,
    setResultStatus,
    clearAnalysisOutput,
    parseResultImportFile,
    persistResultAttachment,
    onResultImportApplied
  });
  const {
    importResultFile,
    onResultFileChange,
    onAttachResultFileClick,
    onResultImportOverlayClick,
    onResultImportCandidateClick,
    applySelectedResultImportCandidate,
    closeResultImportDialog
  } = importController;

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
    notifyResultsChanged();
  }

  function onClearResults() {
    runtime.currentResults = {};
    renderResultTable();
    if (typeof clearAnalysisOutput === 'function') {
      clearAnalysisOutput();
    }
    setResultStatus('Cleared all result values. Only mapped wells are editable.');
    notifyResultsChanged();
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
