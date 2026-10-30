import {
  axisLabel,
  oppositeAxis
} from './shared.js';
import {
  applyAxisTemplate,
  getAssayAxisTemplateValues,
  getPlateDefinition,
  layoutsEqual,
  normalizeCurrentAxisTemplateValues,
  normalizeLayout,
  normalizeManualWellOverrideMap,
  normalizeResults,
  removeSuppressedWellsFromLayout
} from './plate-model.js';
import { createLayoutCsv } from './layout/csv.js';
import { buildPlatePreviewHtml } from './plate-preview-renderer.js';
import {
  isKnownUnit,
  splitConcentrationValue
} from './concentration-utils.js';
import { createAxisValues } from './layout/axis-values.js';
import { createPlateInteractions } from './layout/plate-interactions.js';

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
    assayDilutionFactorInput,
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


  const {
    setAxisTemplateValues,
    getAxisTemplateValues,
    isMappedWell,
    getMappedWellSet,
    filterMappedResults,
    setLayoutFromAxisAndOverrides,
    getEffectiveWellMapping,
    updateActiveWellPreviewState,
    setActiveWellSelection
  } = createAxisValues({
    runtime,
    assayPlatePreview,
    getCurrentDefinition,
    getSampleAxis
  });

  function syncAxisTemplateValues(values = null) {
    setAxisTemplateValues(values || getAxisTemplateValues());
  }

  const {
    inventorySamplePicker,
    serialDilution,
    syncFillModeInputs,
    onFillConcentrations,
    onPlatePreviewInput,
    onPlatePreviewChange,
    onPlatePreviewFocusIn,
    onPlatePreviewClick,
    onPlatePreviewKeyDown,
    onPlatePreviewContextMenu,
    onGlobalPointerDown,
    onGlobalKeyDown,
    onPlatePreviewScroll,
    focusPlateWellInput,
    deriveManualWellOverridesFromLayout
  } = createPlateInteractions({
    runtime,
    safeText,
    getInventorySamples,
    setCsvStatus,
    setLayoutStatus,
    renderResultTable,
    assayPlatePreview,
    assayFillModeInput,
    assayDilutionFactorInput,
    assaySerialDilutionOverlay,
    assaySerialDilutionContent,
    assaySerialDilutionSummary,
    assaySerialDilutionVolumeInput,
    getCurrentDefinition,
    getSampleAxis,
    getConcentrationUnit,
    recognizeConcentrationUnit,
    getAxisTemplateValues,
    getEffectiveWellMapping,
    setActiveWellSelection,
    setLayoutFromAxisAndOverrides,
    syncAxisTemplateValues: (values) => syncAxisTemplateValues(values),
    renderPlatePreview: (values) => renderPlatePreview(values)
  });

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
    assayPlateFieldSampleBtn?.setAttribute('aria-pressed', String(runtime.plateEditField === 'sampleId'));
    assayPlateFieldConcentrationBtn?.setAttribute('aria-pressed', String(runtime.plateEditField === 'concentration'));
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
    // normalizeResults silently discards every well outside the new plate, so
    // capture the count first -- resizing a filled plate is destructive and the
    // user gets no other signal that measurements were dropped.
    const resultsBefore = Object.keys(runtime.currentResults || {}).length;
    runtime.currentResults = normalizeResults(runtime.currentResults, getCurrentDefinition());
    const droppedResults = resultsBefore - Object.keys(runtime.currentResults || {}).length;
    setLayoutFromAxisAndOverrides();
    runtime.activeWellEditorId = '';
    syncAxisTemplateValues();
    renderPlateDefinition();
    renderPlatePreview();
    renderResultTable();
    if (typeof clearAnalysisOutput === 'function') {
      clearAnalysisOutput();
    }
    setCsvStatus(droppedResults > 0
      ? `Plate resized. ${droppedResults} result${droppedResults === 1 ? '' : 's'} outside the new layout were dropped.`
      : '');
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
