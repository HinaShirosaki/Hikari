import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("plate");
import { toRowLabel } from '../plate-model.js';
import {
  detectAssayResultMatrixCandidates,
  getAssayResultImportTarget
} from '../result-import-detector.js';
import { bindPlateMessage, plateError, plateFailure, plateMessage, plateNotice, plateUi, setPlateAttribute } from '../localization.js';

// Owns the "attach result file" flow: parsing, the candidate-picker overlay,
// preview grid, and applying a detected matrix back into the result table.
export function createResultImportController({
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
}) {
  const {
    assayAttachResultFileBtn,
    assayResultFileInput,
    assayResultImportOverlay,
    assayResultImportApplyBtn,
    assayResultImportStatus,
    assayResultImportCandidates,
    assayResultImportPreview
  } = elements;

  let resultImportState = null;
  let resultImportPreviewGrid = null;

  function setResultImportStatus(message, isError = false) {
    if (isError && message) {
      plateNotice(message, { type: 'error' });
    }
    if (assayResultImportStatus) {
      bindPlateMessage(assayResultImportStatus, message);
      assayResultImportStatus.classList.toggle('is-error', Boolean(isError && message));
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
      i18nUi.setHtml(assayResultImportCandidates, '');
    }
    if (assayResultImportPreview) {
      i18nUi.setHtml(assayResultImportPreview, '');
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
    i18nUi.setHtml(assayResultImportPreview, '');
    if (!candidate) {
      i18nUi.setHtml(assayResultImportPreview, `<p class="small-note">${plateMessage('import.previewEmpty')}</p>`);
      return;
    }
    if (!TabulatorLib) {
      const table = document.createElement('table');
      table.className = 'assay-serial-dilution-table assay-result-import-fallback-table';
      i18nUi.setHtml(table, `
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
      `);
      assayResultImportPreview.append(table);
      return;
    }
    const host = document.createElement('div');
    host.className = 'assay-tabulator assay-result-import-preview-grid';
    host.setAttribute('role', 'grid');
    setPlateAttribute(host, 'aria-label', 'import.previewGrid');
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
    i18nUi.setHtml(assayResultImportCandidates, candidates.map((candidate) => {
      const active = candidate.id === selectedId ? ' is-active' : '';
      const numericPercent = Math.round((candidate.numericRatio || 0) * 100);
      const fillPercent = Math.round((candidate.nonBlankRatio || 0) * 100);
      return `
        <button type="button" class="assay-result-import-choice${active}" data-result-import-candidate="${escapeHtml(candidate.id)}">
          <strong>${candidate.tableName ? escapeHtml(candidate.tableName) : plateMessage('import.sheet')} · ${escapeHtml(candidate.rangeLabel)}</strong>
          <span>${plateMessage('import.candidateMeta', { rows: candidate.rows, columns: candidate.columns, numeric: numericPercent, filled: fillPercent })}</span>
        </button>
      `;
    }).join(''));
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
    setResultImportStatus(plateUi('import.detected', { count: candidates.length, file: fileName }));
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
      reader.addEventListener('error', () => reject(reader.error || plateError('import.readFailed')));
      reader.readAsArrayBuffer(file);
    });
  }

  async function applyResultImportCandidate(candidate) {
    if (!candidate || !resultImportState) {
      setResultStatus(plateUi('import.selectMatrix'), true);
      return;
    }
    if (typeof persistResultAttachment !== 'function') {
      setResultStatus(plateUi('import.storageUnavailable'), true);
      return;
    }

    if (assayResultImportApplyBtn) {
      assayResultImportApplyBtn.disabled = true;
    }
    setResultImportStatus(plateUi('import.saving', { file: resultImportState.fileName }));

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
      setResultStatus(plateUi('import.done', { pasted: counts.pastedCount, file: importedFileName, skipped: counts.skippedCount }));
    } catch (error) {
      const message = plateFailure(error, 'import.failed');
      setResultImportStatus(message, true);
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
      setResultStatus(plateUi('import.selectAssay'), true);
      return;
    }
    if (typeof parseResultImportFile !== 'function') {
      setResultStatus(plateUi('import.parserUnavailable'), true);
      return;
    }

    setResultStatus(plateUi('import.reading', { file: file.name }));
    try {
      const dataBase64 = await readResultImportFileBase64(file);
      const parsed = await parseResultImportFile({
        fileName: file.name,
        dataBase64
      });
      const importTarget = getAssayResultImportTarget(runtime.currentLayout, getCurrentDefinition());
      const candidates = detectAssayResultMatrixCandidates(parsed?.tables || [], importTarget);
      if (!candidates.length) {
        setResultStatus(plateUi(importTarget.source === 'mapped' ? 'import.noMappedMatrix' : 'import.noMatrix', {
          rows: importTarget.rows, columns: importTarget.columns, file: file.name
        }), true);
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
      const message = plateFailure(error, 'import.readFailed');
      setResultStatus(message, true);
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
      setResultStatus(plateUi('import.controlUnavailable'), true);
      return;
    }
    const selectedAssayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    if (!selectedAssayId) {
      setResultStatus(plateUi('import.selectAssay'), true);
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

  return {
    importResultFile,
    onResultFileChange,
    onAttachResultFileClick,
    onResultImportOverlayClick,
    onResultImportCandidateClick,
    applySelectedResultImportCandidate,
    closeResultImportDialog
  };
}
