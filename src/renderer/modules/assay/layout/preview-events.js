import { oppositeAxis } from '../shared.js';
import { parseWellId, wellIdFor } from '../plate-model.js';

// Plate-preview DOM event handlers plus the focus/keyboard-navigation helpers
// they drive. Pure event entry points wired by index.js; no layout state of its own.
export function createPlatePreviewEvents({
  runtime,
  assayPlatePreview,
  inventorySamplePicker,
  serialDilution,
  getCurrentDefinition,
  getSampleAxis,
  getFillMode,
  getAxisTemplateValues,
  syncAxisTemplateValues,
  setLayoutFromAxisAndOverrides,
  updateInlineWellOverride,
  recognizeConcentrationUnit,
  autoFillConcentrationRange,
  renderPlatePreview,
  renderResultTable,
  setLayoutStatus,
  setCsvStatus,
  setActiveWellSelection
}) {
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
      const isConcentrationAxis = axisInput.dataset.axisDimension === oppositeAxis(getSampleAxis());
      if (isConcentrationAxis) {
        recognizeConcentrationUnit(axisInput.value);
      }
      setLayoutFromAxisAndOverrides();
      const mode = getFillMode();
      if (isConcentrationAxis && mode !== 'factor') {
        autoFillConcentrationRange(mode, { silent: true });
      }
      renderPlatePreview();
      renderResultTable();
      setLayoutStatus('');
      setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}.`);
      return;
    }

    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }

    if (inlineInput.dataset.wellInlineField === 'concentration') {
      recognizeConcentrationUnit(inlineInput.value);
    }
    updateInlineWellOverride(
      inlineInput.dataset.well,
      inlineInput.dataset.wellInlineField,
      inlineInput.value
    );
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(`Updated ${String(inlineInput.dataset.well || '').trim().toUpperCase()}.`);
    setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}.`);
  }

  function onPlatePreviewFocusIn(event) {
    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }
    setActiveWellSelection(inlineInput.dataset.well);
  }

  function onPlatePreviewClick(event) {
    if (event.target.closest('.assay-sample-picker')) {
      return;
    }
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

  function onPlatePreviewKeyDown(event) {
    if (String(event?.key || '') !== 'Enter') {
      return;
    }

    const axisInput = event.target.closest('[data-axis-dimension]');
    if (axisInput) {
      event.preventDefault();
      const nextTarget = getNextAxisInputTarget(
        axisInput.dataset.axisDimension,
        axisInput.dataset.axisIndex
      );
      if (nextTarget) {
        focusAxisInput(nextTarget.dimension, nextTarget.index);
      }
      return;
    }

    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }

    event.preventDefault();
    const nextWell = getNextWellTarget(
      inlineInput.dataset.well,
      inlineInput.dataset.wellInlineField
    );
    if (nextWell) {
      focusPlateWellField(nextWell, inlineInput.dataset.wellInlineField);
    }
  }

  function onPlatePreviewContextMenu(event) {
    const cell = event.target.closest('[data-well]');
    if (!cell || event.target.closest('[data-axis-dimension]')) {
      inventorySamplePicker.hide();
      return;
    }
    const wellId = String(cell.dataset.well || '').trim().toUpperCase();
    if (!wellId) {
      inventorySamplePicker.hide();
      return;
    }
    event.preventDefault();
    inventorySamplePicker.show(wellId, event.clientX, event.clientY);
  }

  function onGlobalPointerDown(event) {
    if (!inventorySamplePicker.isOpen()) {
      return;
    }
    if (inventorySamplePicker.containsTarget(event.target)) {
      return;
    }
    inventorySamplePicker.hide();
  }

  function onGlobalKeyDown(event) {
    if (String(event?.key || '') === 'Escape') {
      inventorySamplePicker.hide();
      serialDilution.close();
    }
  }

  function onPlatePreviewScroll() {
    inventorySamplePicker.hide();
  }

  function focusPlateWellInput(wellId) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell || !assayPlatePreview) {
      return;
    }
    const selector = `[data-well="${normalizedWell}"] [data-well-inline-field="${runtime.plateEditField}"]`;
    assayPlatePreview.querySelector(selector)?.focus();
  }

  function focusPlateWellField(wellId, field) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    const normalizedField = field === 'concentration' ? 'concentration' : 'sampleId';
    if (!normalizedWell || !assayPlatePreview) {
      return;
    }
    const input = assayPlatePreview.querySelector(`[data-well="${normalizedWell}"] [data-well-inline-field="${normalizedField}"]`);
    input?.focus();
    input?.select?.();
  }

  function focusAxisInput(dimension, index) {
    const normalizedDimension = dimension === 'column' ? 'column' : 'row';
    const normalizedIndex = Number(index);
    if (!assayPlatePreview || !Number.isFinite(normalizedIndex) || normalizedIndex < 0) {
      return;
    }
    const input = assayPlatePreview.querySelector(`[data-axis-dimension="${normalizedDimension}"][data-axis-index="${normalizedIndex}"]`);
    input?.focus();
    input?.select?.();
  }

  function getNextAxisInputTarget(dimension, index) {
    const def = getCurrentDefinition();
    const max = dimension === 'column' ? def.columns : def.rows;
    const nextIndex = Number(index) + 1;
    if (!Number.isFinite(nextIndex) || nextIndex < 0 || nextIndex >= max) {
      return null;
    }
    return { dimension, index: nextIndex };
  }

  function getWellEntryDirection(field) {
    return field === 'concentration' ? oppositeAxis(getSampleAxis()) : getSampleAxis();
  }

  function getNextWellTarget(wellId, field) {
    const parsed = parseWellId(wellId);
    const def = getCurrentDefinition();
    if (!parsed) {
      return '';
    }

    let nextRow = parsed.rowIndex;
    let nextColumn = parsed.columnIndex;

    if (getWellEntryDirection(field) === 'column') {
      if (parsed.rowIndex + 1 < def.rows) {
        nextRow = parsed.rowIndex + 1;
      } else if (parsed.columnIndex + 1 < def.columns) {
        nextRow = 0;
        nextColumn = parsed.columnIndex + 1;
      } else {
        return '';
      }
    } else if (parsed.columnIndex + 1 < def.columns) {
      nextColumn = parsed.columnIndex + 1;
    } else if (parsed.rowIndex + 1 < def.rows) {
      nextRow = parsed.rowIndex + 1;
      nextColumn = 0;
    } else {
      return '';
    }

    return wellIdFor(nextRow, nextColumn);
  }

  return {
    onPlatePreviewInput,
    onPlatePreviewChange,
    onPlatePreviewFocusIn,
    onPlatePreviewClick,
    onPlatePreviewKeyDown,
    onPlatePreviewContextMenu,
    onGlobalPointerDown,
    onGlobalKeyDown,
    onPlatePreviewScroll,
    focusPlateWellInput
  };
}
