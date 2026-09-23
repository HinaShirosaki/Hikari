import { wellIdFor } from './plate-model.js';
import { bindFileDropTarget } from '../../lib/file-drop.js';
import { createResultImportController } from './results/result-import.js';
import { createResultGridModel } from './results/grid-model.js';
import { createAssayAnalysisGroups } from './results/analysis-groups.js';
import { toResultField, resultFieldToColumnIndex } from './results/result-fields.js';

export {
  detectAssayResultMatrixCandidates,
  getAssayResultImportTarget
} from './result-import-detector.js';
import { showTransientNotice } from '../../lib/notify.js';

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
    assayResultTable,
    assayResultFileInput
  } = elements;

  let resultGrid = null;
  let resultGridSignature = '';
  const {
    getAnalysisGroups,
    applyAnalysisGroupHighlights,
    refreshAnalysisGroupDisplay,
    onAddSelectedRowGroup,
    onAddSelectedColumnGroup,
    onClearAnalysisGroups
  } = createAssayAnalysisGroups({
    elements,
    getCurrentDefinition,
    onAnalysisConfigChange,
    getResultGrid: () => resultGrid
  });

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
    resultRowVisible,
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
      setResultStatus(`Only mapped wells accept result values. ${wellIdFor(rowIndex, columnIndex)} is not mapped.`, true);
      return;
    }
    runtime.resultPasteAnchor = { rowIndex, columnIndex };
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
  }

  function ensureResultGrid(def) {
    if (!assayResultTable) {
      return false;
    }
    if (!TabulatorLib) {
      assayResultTable.innerHTML = '<p class="small-note">Spreadsheet component failed to load (Tabulator).</p>';
      showTransientNotice('Spreadsheet component failed to load (Tabulator).', { type: 'error' });
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
        initialFilter: resultRowVisible,
        selectableRange: true,
        selectableRangeColumns: true,
        selectableRangeRows: true,
      };
      const gridHeight = getResultGridHeight(def);
      if (gridHeight) {
        gridOptions.height = gridHeight;
      }
      resultGrid = new TabulatorLib(host, gridOptions);
      if (typeof resultGrid.on === 'function') {
        // Tabulator 6 ignores callbacks passed in the options object, so these two have
        // to be registered here like the rest -- cellEdited is what writes a typed
        // value into the result model at all.
        resultGrid.on('cellEdited', onResultGridCellEdited);
        resultGrid.on('cellClick', onResultGridCellClick);
        // This reads the grid's cell elements, so it has to wait for tableBuilt --
        // calling it right after the constructor warns and returns nothing.
        resultGrid.on('tableBuilt', refreshAnalysisGroupDisplay);
        resultGrid.on('renderComplete', () => applyAnalysisGroupHighlights(getAnalysisGroups()));
      }
      resultGridSignature = signature;
      return true;
    }
    resultGrid.replaceData(buildResultGridData(def));
    refreshAnalysisGroupDisplay();
    return true;
  }

  function renderResultTable() {
    ensureResultGrid(getCurrentDefinition());
  }

  // Tabulator measures column widths on build, so a grid built (or resized) while its
  // panel was folded away comes back with zero-width columns until it redraws.
  function redrawResultGrid() {
    if (resultGrid?.initialized !== false && typeof resultGrid?.redraw === 'function') {
      resultGrid.redraw(true);
    }
  }

  function syncCurrentResultsFromGrid() {
    // Tabulator defers its initial build to the next task. During that window the
    // instance exists, but getRows() is empty even when the saved assay supplied
    // result data. Keep the restored model as the source of truth until the grid
    // is ready so a clean-load snapshot cannot be recorded as an empty plate.
    if (!resultGrid || resultGrid.initialized === false) {
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
    setResultStatus(`Pasted ${pastedCount} value(s). Skipped ${skippedCount} unmapped cell(s).`);
    notifyResultsChanged();
  }

  function onClearResults() {
    runtime.currentResults = {};
    renderResultTable();
    if (typeof clearAnalysisOutput === 'function') {
      clearAnalysisOutput();
    }
    setResultStatus('Cleared all result values.');
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
      setResultStatus(String(error?.message || error || 'Unable to import the dropped result file.'), true);
    }
  });

  refreshAnalysisGroupDisplay();

  return {
    buildResultGridSignature,
    resultRowVisible,
    refreshRowVisibility: () => resultGrid?.setFilter?.(resultRowVisible),
    buildResultGridColumns,
    buildResultGridData,
    getResultGridHeight,
    getResultValueCount,
    clearResultGrid,
    renderResultTable,
    redrawResultGrid,
    syncCurrentResultsFromGrid,
    refreshAnalysisGroupDisplay,
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
