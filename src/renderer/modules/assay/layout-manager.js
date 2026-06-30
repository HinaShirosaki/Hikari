import {
  axisLabel,
  oppositeAxis
} from './shared.js';
import {
  applyAxisTemplate,
  buildAllWells,
  buildMappedWellSet,
  filterResultsToMappedWells,
  getAssayAxisTemplateValues,
  getAxisLength,
  getPlateDefinition,
  isValidWellForDefinition,
  layoutToMap,
  layoutsEqual,
  mergeAxisTemplateValues,
  normalizeCurrentAxisTemplateValues,
  normalizeLayout,
  normalizeManualWellOverrideMap,
  normalizeResults,
  removeSuppressedWellsFromLayout
} from './plate-model.js';
import { createInventorySamplePicker } from './inventory-sample-picker.js';
import { createPlatePreviewEvents } from './layout/preview-events.js';
import { createLayoutCsv } from './layout/csv.js';
import { createSerialDilutionController } from './serial-dilution.js';
import { buildPlatePreviewHtml } from './plate-preview-renderer.js';
import {
  isKnownUnit,
  splitConcentrationValue
} from './concentration-utils.js';
import { createConcentrationFill } from './layout/concentration-fill.js';

export function createAssayLayoutManager({
  runtime,
  elements,
  safeText,
  getInventorySamples,
  setCsvStatus,
  setLayoutStatus,
  renderResultTable,
  clearAnalysisOutput
}) {
  const {
    assayConcentrationAxisColumnBtn,
    assayConcentrationAxisInput,
    assayConcentrationAxisRowBtn,
    assayConcentrationUnitInput,
    assayDilutionFactorInput,
    assayDilutionFillBtn,
    assayFillModeInput,
    assayImportFile,
    assayNumberDisplay,
    assayPlateDefinition,
    assayPlateFieldConcentrationBtn,
    assayPlateFieldSampleBtn,
    assayPlatePreview,
    assaySerialDilutionContent,
    assaySerialDilutionOverlay,
    assaySerialDilutionSummary,
    assaySerialDilutionVolumeInput,
    assaySampleAxisColumnBtn,
    assaySampleAxisInput,
    assaySampleAxisRowBtn,
    assayNameInput,
    assayPlateTypeInput
  } = elements;

  function getCurrentDefinition() {
    return getPlateDefinition(assayPlateTypeInput?.value);
  }

  function getConcentrationUnit() {
    return String(runtime.concentrationUnit || '').trim();
  }

  function setConcentrationUnit(value) {
    runtime.concentrationUnit = String(value || '').trim();
    if (assayConcentrationUnitInput) {
      assayConcentrationUnitInput.value = runtime.concentrationUnit;
    }
  }

  function onConcentrationUnitInput() {
    runtime.concentrationUnit = String(assayConcentrationUnitInput?.value || '').trim();
    renderPlatePreview();
    if (serialDilution.isOpen()) {
      serialDilution.render();
    }
  }

  // When a concentration cell carries a recognized unit (e.g. "100 nM"), adopt it as
  // the axis unit so bare cells, fills and the dilution dialog all use it.
  function recognizeConcentrationUnit(text) {
    const parts = splitConcentrationValue(text);
    if (parts && isKnownUnit(parts.unit) && getConcentrationUnit() !== parts.unit) {
      setConcentrationUnit(parts.unit);
      return true;
    }
    return false;
  }

  function getSampleAxis() {
    return assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
  }

  function setAxisTemplateValues(values, def = getCurrentDefinition(), sampleAxis = getSampleAxis()) {
    runtime.axisTemplateValues = normalizeCurrentAxisTemplateValues(values, def, sampleAxis);
    return runtime.axisTemplateValues;
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
    const sampleAxis = getSampleAxis();
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

  function getAxisTemplateValues({ includePreview = true } = {}) {
    return mergeAxisTemplateValues({
      def: getCurrentDefinition(),
      sampleAxis: getSampleAxis(),
      sources: includePreview
        ? [runtime.axisTemplateValues, readAxisValuesFromPlatePreview()]
        : [runtime.axisTemplateValues]
    });
  }

  function normalizeManualWellOverrides(def) {
    runtime.manualWellOverrides = normalizeManualWellOverrideMap(runtime.manualWellOverrides, def);
  }

  function normalizeSuppressedWells(def) {
    const validIds = new Set(buildAllWells(def).map((item) => item.well));
    runtime.suppressedWells = new Set(
      Array.from(runtime.suppressedWells || [])
        .map((well) => String(well || '').trim().toUpperCase())
        .filter((well) => validIds.has(well))
    );
  }

  function getMappedWellSet() {
    return buildMappedWellSet(runtime.currentLayout);
  }

  function isMappedWell(wellId) {
    return getMappedWellSet().has(String(wellId || '').trim().toUpperCase());
  }

  function filterMappedResults(results) {
    return filterResultsToMappedWells(results, runtime.currentLayout);
  }

  function setLayoutFromAxisAndOverrides({ preserveActiveWell = true, axisValues = null } = {}) {
    const def = getCurrentDefinition();
    const sampleAxis = getSampleAxis();
    const normalizedAxisValues = axisValues
      ? normalizeCurrentAxisTemplateValues(axisValues, def, sampleAxis)
      : getAxisTemplateValues();
    const { sampleValues, concentrationValues } = normalizedAxisValues;
    setAxisTemplateValues(normalizedAxisValues, def, sampleAxis);
    normalizeManualWellOverrides(def);
    normalizeSuppressedWells(def);
    const baseLayout = applyAxisTemplate({
      def,
      sampleAxis,
      sampleValues,
      concentrationValues
    });
    const map = layoutToMap(baseLayout);
    Object.entries(runtime.manualWellOverrides).forEach(([well, value]) => {
      const sampleId = String(value?.sampleId || '').trim();
      const concentration = String(value?.concentration || '').trim();
      if (!sampleId && !concentration) {
        delete map[well];
        return;
      }
      map[well] = { sampleId, concentration };
    });
    runtime.suppressedWells.forEach((well) => {
      delete map[well];
    });
    runtime.currentLayout = normalizeLayout(Object.entries(map).map(([well, value]) => ({
      well,
      sampleId: value.sampleId,
      concentration: value.concentration
    })), def);
    runtime.currentResults = filterMappedResults(runtime.currentResults);
    if (preserveActiveWell && runtime.activeWellEditorId && !isValidWellForDefinition(runtime.activeWellEditorId, def)) {
      runtime.activeWellEditorId = '';
    }
  }

  function getEffectiveWellMapping(wellId) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell) {
      return { sampleId: '', concentration: '' };
    }
    const currentMap = layoutToMap(runtime.currentLayout);
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
      cell.classList.toggle('is-active', String(cell.dataset.well || '').trim().toUpperCase() === runtime.activeWellEditorId);
    });
  }

  function setActiveWellSelection(wellId) {
    runtime.activeWellEditorId = String(wellId || '').trim().toUpperCase();
    updateActiveWellPreviewState();
  }

  function applyInventorySampleToWell(wellId, sampleValue) {
    updateInlineWellOverride(wellId, 'sampleId', sampleValue);
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(`Updated ${wellId} from inventory.`);
    setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}.`);
    requestAnimationFrame(() => {
      assayPlatePreview
        ?.querySelector(`[data-well="${wellId}"] [data-well-inline-field="sampleId"]`)
        ?.focus();
    });
  }

  const inventorySamplePicker = createInventorySamplePicker({
    safeText,
    getInventorySamples,
    getEffectiveWellMapping,
    setActiveWellSelection,
    applyInventorySample: applyInventorySampleToWell
  });

  const serialDilution = createSerialDilutionController({
    elements: {
      overlay: assaySerialDilutionOverlay,
      content: assaySerialDilutionContent,
      summary: assaySerialDilutionSummary,
      volumeInput: assaySerialDilutionVolumeInput
    },
    safeText,
    getSampleAxis,
    getCurrentLayout: () => runtime.currentLayout,
    getConcentrationUnit,
    findInventorySampleRecordBySampleId: inventorySamplePicker.findInventorySampleRecordBySampleId,
    hideInventorySamplePicker: inventorySamplePicker.hide
  });

  const {
    getFillMode,
    syncFillModeInputs,
    onFillConcentrations,
    autoFillConcentrationRange
  } = createConcentrationFill({
    runtime,
    assayFillModeInput,
    assayDilutionFactorInput,
    assayPlatePreview,
    serialDilution,
    getSampleAxis,
    getConcentrationUnit,
    getAxisTemplateValues,
    syncAxisTemplateValues,
    setLayoutFromAxisAndOverrides,
    renderPlatePreview,
    renderResultTable,
    setLayoutStatus
  });

  const {
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
  } = createPlatePreviewEvents({
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
  });

  function updateInlineWellOverride(wellId, field, rawValue) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell) {
      return;
    }

    const def = getCurrentDefinition();
    const sampleAxis = getSampleAxis();
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
      delete runtime.manualWellOverrides[normalizedWell];
      if (base.sampleId || base.concentration) {
        runtime.suppressedWells.add(normalizedWell);
      } else {
        runtime.suppressedWells.delete(normalizedWell);
      }
    } else if (matchesBase) {
      delete runtime.manualWellOverrides[normalizedWell];
      runtime.suppressedWells.delete(normalizedWell);
    } else {
      runtime.suppressedWells.delete(normalizedWell);
      runtime.manualWellOverrides[normalizedWell] = next;
    }

    runtime.activeWellEditorId = normalizedWell;
    setLayoutFromAxisAndOverrides();
  }

  function deriveManualWellOverridesFromLayout(layout, def, axisValues = null) {
    const sampleAxis = getSampleAxis();
    const resolvedAxisValues = axisValues
      ? normalizeCurrentAxisTemplateValues(axisValues, def, sampleAxis)
      : getAxisTemplateValues();
    const baseLayout = applyAxisTemplate({
      def,
      sampleAxis,
      sampleValues: resolvedAxisValues.sampleValues,
      concentrationValues: resolvedAxisValues.concentrationValues
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
    runtime.manualWellOverrides = overrides;
  }

  function syncAxisTemplateValues(values = null) {
    setAxisTemplateValues(values || getAxisTemplateValues());
  }

  function renderAxisSwitchButtons() {
    const sampleAxis = getSampleAxis();
    const concentrationAxis = oppositeAxis(sampleAxis);
    assaySampleAxisRowBtn?.classList.toggle('calendar-view-active', sampleAxis === 'row');
    assaySampleAxisColumnBtn?.classList.toggle('calendar-view-active', sampleAxis === 'column');
    assayConcentrationAxisRowBtn?.classList.toggle('calendar-view-active', concentrationAxis === 'row');
    assayConcentrationAxisColumnBtn?.classList.toggle('calendar-view-active', concentrationAxis === 'column');
  }

  function renderPlateEditFieldButtons() {
    assayPlateFieldSampleBtn?.classList.toggle('calendar-view-active', runtime.plateEditField === 'sampleId');
    assayPlateFieldConcentrationBtn?.classList.toggle('calendar-view-active', runtime.plateEditField === 'concentration');
  }

  function syncAxisDisplay() {
    const sampleAxis = getSampleAxis();
    if (assayConcentrationAxisInput) {
      assayConcentrationAxisInput.value = oppositeAxis(sampleAxis);
    }
    renderAxisSwitchButtons();
  }

  function setSampleAxis(axis) {
    if (!assaySampleAxisInput) {
      return;
    }
    const next = axis === 'column' ? 'column' : 'row';
    if (assaySampleAxisInput.value === next) {
      syncAxisDisplay();
      return;
    }
    assaySampleAxisInput.value = next;
    syncAxisDisplay();
    setLayoutFromAxisAndOverrides();
    renderPlatePreview();
    renderResultTable();
  }

  function setConcentrationAxis(axis) {
    setSampleAxis(axis === 'row' ? 'column' : 'row');
  }

  function setPlateEditField(field) {
    runtime.plateEditField = field === 'concentration' ? 'concentration' : 'sampleId';
    renderPlateEditFieldButtons();
    renderPlatePreview();
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
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(`Switched axes. Sample axis is now ${axisLabel(assaySampleAxisInput.value)}.`);
  }

  function restoreAssayLayoutState(assay, def) {
    const sampleAxis = assay?.sampleAxis === 'column' ? 'column' : 'row';
    const axisValues = getAssayAxisTemplateValues(assay, def);
    setAxisTemplateValues(axisValues, def, sampleAxis);
    setConcentrationUnit(assay?.concentrationUnit);
    runtime.suppressedWells = new Set(Array.isArray(assay?.suppressedWells) ? assay.suppressedWells : []);
    runtime.activeWellEditorId = '';

    const savedLayout = normalizeLayout(assay?.wellLayout, def);
    const persistedOverrides = normalizeManualWellOverrideMap(assay?.manualWellOverrides, def);

    if (Object.keys(persistedOverrides).length) {
      runtime.manualWellOverrides = persistedOverrides;
    } else {
      runtime.manualWellOverrides = {};
      const expectedIntersectionLayout = removeSuppressedWellsFromLayout(applyAxisTemplate({
        def,
        sampleAxis,
        sampleValues: axisValues.sampleValues,
        concentrationValues: axisValues.concentrationValues
      }), def, runtime.suppressedWells);
      const expectedLegacyUnionLayout = removeSuppressedWellsFromLayout(applyAxisTemplate({
        def,
        sampleAxis,
        sampleValues: axisValues.sampleValues,
        concentrationValues: axisValues.concentrationValues,
        mappingMode: 'union'
      }), def, runtime.suppressedWells);

      if (!layoutsEqual(savedLayout, expectedIntersectionLayout, def)
        && !layoutsEqual(savedLayout, expectedLegacyUnionLayout, def)) {
        deriveManualWellOverridesFromLayout(savedLayout, def, axisValues);
      }
    }

    setLayoutFromAxisAndOverrides({ axisValues });
    runtime.currentResults = filterMappedResults(normalizeResults(assay?.resultValues, def));
    return axisValues;
  }

  function renderPlatePreview(sourceValues = null) {
    if (!assayPlatePreview) {
      return;
    }
    inventorySamplePicker.hide();
    const def = getCurrentDefinition();
    const sampleAxis = getSampleAxis();
    const { sampleValues, concentrationValues } = sourceValues
      ? normalizeCurrentAxisTemplateValues(sourceValues, def, sampleAxis)
      : getAxisTemplateValues();

    assayPlatePreview.innerHTML = buildPlatePreviewHtml({
      def,
      sampleAxis,
      layout: runtime.currentLayout,
      sampleValues,
      concentrationValues,
      concentrationUnit: getConcentrationUnit(),
      plateEditField: runtime.plateEditField,
      activeWellEditorId: runtime.activeWellEditorId,
      safeText
    });

    if (serialDilution.isOpen()) {
      serialDilution.render();
    }
  }

  function onClearWellMappings() {
    runtime.manualWellOverrides = {};
    runtime.suppressedWells = new Set();
    setAxisTemplateValues({ sampleValues: [], concentrationValues: [] });
    runtime.currentLayout = [];
    runtime.activeWellEditorId = '';
    runtime.currentResults = {};
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus('Cleared all well mappings.');
    setCsvStatus('');
    updateActiveWellPreviewState();
    if (typeof clearAnalysisOutput === 'function') {
      clearAnalysisOutput();
    }
  }

  function renderPlateDefinition() {
    if (!assayPlateDefinition) {
      return;
    }
    const def = getCurrentDefinition();
    assayPlateDefinition.textContent = `Plate layout: ${def.rows} rows x ${def.columns} columns (${def.rows * def.columns} wells).`;
  }

  function renderAssayNumberDisplay(numberText = '') {
    if (!assayNumberDisplay) {
      return;
    }
    assayNumberDisplay.textContent = numberText || '';
  }

  function onPlateTypeChange() {
    runtime.currentResults = normalizeResults(runtime.currentResults, getCurrentDefinition());
    setLayoutFromAxisAndOverrides();
    runtime.activeWellEditorId = '';
    syncAxisTemplateValues();
    renderPlateDefinition();
    renderPlatePreview();
    renderResultTable();
    if (typeof clearAnalysisOutput === 'function') {
      clearAnalysisOutput();
    }
    setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}. Result wells: ${Object.keys(runtime.currentResults || {}).length}.`);
  }

  const { exportCsvTemplate, onImportCsv } = createLayoutCsv({
    runtime,
    assayNameInput,
    assayImportFile,
    getCurrentDefinition,
    getSampleAxis,
    setAxisTemplateValues,
    setLayoutFromAxisAndOverrides,
    renderPlatePreview,
    renderResultTable,
    setCsvStatus
  });

  return {
    getCurrentDefinition,
    getSampleAxis,
    getMappedWellSet,
    isMappedWell,
    filterMappedResults,
    setAxisTemplateValues,
    getAxisTemplateValues,
    syncAxisTemplateValues,
    setLayoutFromAxisAndOverrides,
    restoreAssayLayoutState,
    renderAxisSwitchButtons,
    renderPlateEditFieldButtons,
    setSampleAxis,
    setConcentrationAxis,
    getConcentrationUnit,
    setConcentrationUnit,
    onConcentrationUnitInput,
    onFillConcentrations,
    syncFillModeInputs,
    setPlateEditField,
    syncAxisDisplay,
    onSwapAxes,
    renderPlatePreview,
    onPlatePreviewInput,
    onPlatePreviewChange,
    onPlatePreviewFocusIn,
    onPlatePreviewClick,
    onPlatePreviewKeyDown,
    onPlatePreviewContextMenu,
    onClearWellMappings,
    openSerialDilutionDialog: serialDilution.open,
    closeSerialDilutionDialog: serialDilution.close,
    onSerialDilutionOverlayClick: serialDilution.onOverlayClick,
    onSerialDilutionDialogInput: serialDilution.onDialogInput,
    getSerialDilutionSnapshot: serialDilution.getSnapshot,
    restoreSerialDilutionSnapshot: serialDilution.restoreSnapshot,
    resetSerialDilutionState: serialDilution.reset,
    getSerialDilutionSummaryData: serialDilution.getSummaryData,
    focusPlateWellInput,
    renderPlateDefinition,
    renderAssayNumberDisplay,
    updateActiveWellPreviewState,
    onPlateTypeChange,
    exportCsvTemplate,
    onImportCsv,
    hideInventorySamplePicker: inventorySamplePicker.hide,
    onGlobalPointerDown,
    onGlobalKeyDown,
    onPlatePreviewScroll
  };
}
