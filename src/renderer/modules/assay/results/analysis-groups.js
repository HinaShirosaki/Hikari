import { rowLabelToIndex } from '../plate-model.js';
import { parseDimensionGroupSpec } from '../analysis/shared.js';
import { resultFieldToColumnIndex } from './result-fields.js';

// Row/column analysis groups over the result grid: the current range selection,
// the group specs the inputs hold, and the colour highlighting that shows them.
function createAssayAnalysisGroups({
  elements,
  getCurrentDefinition,
  onAnalysisConfigChange,
  getResultGrid
} = {}) {
  const {
    assayAnalysisColumnGroupsInput,
    assayAnalysisRowGroupsInput,
    assayAnalysisSelectionStatus
  } = elements;

  const analysisGroupColorCount = 4;
  const analysisGroupColorClasses = Array.from({ length: analysisGroupColorCount }, (_item, index) => index + 1)
    .flatMap((colorIndex) => [
      `assay-analysis-row-group-color-${colorIndex}`,
      `assay-analysis-column-group-color-${colorIndex}`
    ]);

  function setAnalysisSelectionStatus(message, isError = false) {
    if (!assayAnalysisSelectionStatus) {
      return;
    }
    assayAnalysisSelectionStatus.textContent = message || '';
    assayAnalysisSelectionStatus.classList.toggle('is-error', Boolean(isError && message));
  }

  function getCurrentResultRangeSelection() {
    if (!getResultGrid() || typeof getResultGrid().getRanges !== 'function') {
      return { rowLabels: [], columnLabels: [] };
    }
    const ranges = getResultGrid().getRanges();
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

  function getAnalysisGroups() {
    const plate = getCurrentDefinition();
    return {
      row: parseDimensionGroupSpec(
        assayAnalysisRowGroupsInput?.value,
        'row',
        Number(plate?.rows)
      ),
      column: parseDimensionGroupSpec(
        assayAnalysisColumnGroupsInput?.value,
        'column',
        Number(plate?.columns)
      )
    };
  }

  function getAnalysisGroupColorIndex(groupIndex) {
    return (groupIndex % analysisGroupColorCount) + 1;
  }

  function clearAnalysisGroupClasses(element) {
    if (!element?.classList) {
      return;
    }
    element.classList.remove(
      'assay-analysis-row-group-cell',
      'assay-analysis-column-group-cell',
      'assay-analysis-column-group-header',
      ...analysisGroupColorClasses
    );
  }

  function buildGroupMemberIndex(groups) {
    const memberIndex = new Map();
    groups.forEach((group, groupIndex) => {
      group.members.forEach((member) => memberIndex.set(String(member), groupIndex));
    });
    return memberIndex;
  }

  function applyAnalysisGroupHighlights(analysisGroups) {
    if (!getResultGrid()) {
      return;
    }
    const rowGroups = analysisGroups?.row?.groups || [];
    const columnGroups = analysisGroups?.column?.groups || [];
    const rowMemberIndex = buildGroupMemberIndex(rowGroups);
    const columnMemberIndex = buildGroupMemberIndex(columnGroups);
    const rows = typeof getResultGrid().getRows === 'function' ? getResultGrid().getRows() : [];

    rows.forEach((row) => {
      const rowLabel = String(row?.getData?.()?.rowLabel || '').trim().toUpperCase();
      const rowGroupIndex = rowMemberIndex.get(rowLabel);
      const cells = typeof row?.getCells === 'function' ? row.getCells() : [];
      cells.forEach((cell) => {
        const element = cell?.getElement?.();
        clearAnalysisGroupClasses(element);
        if (Number.isInteger(rowGroupIndex)) {
          element?.classList?.add(
            'assay-analysis-row-group-cell',
            `assay-analysis-row-group-color-${getAnalysisGroupColorIndex(rowGroupIndex)}`
          );
        }
      });
    });

    const columns = typeof getResultGrid().getColumns === 'function' ? getResultGrid().getColumns() : [];
    columns.forEach((column) => {
      const columnIndex = resultFieldToColumnIndex(column?.getField?.());
      const groupIndex = columnMemberIndex.get(String(columnIndex + 1));
      const headerElement = column?.getElement?.();
      clearAnalysisGroupClasses(headerElement);
      if (!Number.isInteger(groupIndex)) {
        return;
      }
      const colorIndex = getAnalysisGroupColorIndex(groupIndex);
      headerElement?.classList?.add(
        'assay-analysis-column-group-header',
        `assay-analysis-column-group-color-${colorIndex}`
      );
      const cells = typeof column?.getCells === 'function' ? column.getCells() : [];
      cells.forEach((cell) => {
        cell?.getElement?.()?.classList?.add(
          'assay-analysis-column-group-cell',
          `assay-analysis-column-group-color-${colorIndex}`
        );
      });
    });
  }

  function refreshAnalysisGroupDisplay() {
    const analysisGroups = getAnalysisGroups();
    applyAnalysisGroupHighlights(analysisGroups);
    return analysisGroups;
  }

  function updateResultRangeSelectionStatus() {
    const selection = getCurrentResultRangeSelection();
    // Selection is already visible in the result grid and the toolbar labels make
    // the available actions clear. Keep this status target for validation feedback.
    setAnalysisSelectionStatus('');
    return selection;
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
    if (!members.length) {
      setAnalysisSelectionStatus(`Select at least one ${dimension === 'row' ? 'row' : 'column'} before adding a group.`, true);
      return;
    }

    const input = dimension === 'row' ? assayAnalysisRowGroupsInput : assayAnalysisColumnGroupsInput;
    const groupName = nextGroupName(dimension);
    appendGroupEntry(input, groupName, members);
    refreshAnalysisGroupDisplay();
    setAnalysisSelectionStatus('');
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
    refreshAnalysisGroupDisplay();
    setAnalysisSelectionStatus('Cleared row and column groups.');
    if (typeof onAnalysisConfigChange === 'function') {
      onAnalysisConfigChange();
    }
  }

  return {
    setAnalysisSelectionStatus,
    getCurrentResultRangeSelection,
    getAnalysisGroups,
    applyAnalysisGroupHighlights,
    refreshAnalysisGroupDisplay,
    updateResultRangeSelectionStatus,
    onAddSelectedRowGroup,
    onAddSelectedColumnGroup,
    onClearAnalysisGroups
  };
}

export { createAssayAnalysisGroups };
