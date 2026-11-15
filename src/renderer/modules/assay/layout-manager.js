import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("plate");
import { oppositeAxis } from './shared.js';
import { AXIS_FIELDS, CONDITION_FIELDS, getAssayAxisFields, getFieldAxis, getSampleAxisOrientation, getVisibleConditionFields } from './axis-fields.js';
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
import { createLayoutCsvImporter } from './layout/csv.js';
import { exportPlateLayout } from './layout/export.js';
import { buildPlatePreviewHtml } from './plate-preview-renderer.js';
import {
  isKnownUnit,
  splitConcentrationValue
} from './concentration-utils.js';
import { createAxisValues } from './layout/axis-values.js';
import { createPlateInteractions } from './layout/plate-interactions.js';
import { plateUi, setPlateText } from './localization.js';

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
    assayColumnAxisInput,
    assayDilutionFillBtn,
    assayDilutionFactorInput,
    assayFillModeInput,
    assayImportFile,
    assayNumberDisplay,
    assayPlateDefinition,
    assayPlatePreview,
    assaySerialDilutionContent,
    assaySerialDilutionBtn,
    assaySerialDilutionOverlay,
    assaySerialDilutionSummary,
    assaySerialDilutionVolumeInput,
    assayRowAxisInput,
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

  let axisFields = getAssayAxisFields();
  const getAxisFields = () => axisFields;
  const getSampleAxis = () => getSampleAxisOrientation(axisFields);

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
    getAxisFields
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
    getAxisFields,
    getConcentrationUnit,
    recognizeConcentrationUnit,
    getAxisTemplateValues,
    getEffectiveWellMapping,
    setActiveWellSelection,
    setLayoutFromAxisAndOverrides,
    syncAxisTemplateValues: (values) => syncAxisTemplateValues(values),
    renderPlatePreview: (values, options) => renderPlatePreview(values, options)
  });

  function setAxisAssignments(fields) {
    axisFields = fields;
    if (assayRowAxisInput) assayRowAxisInput.value = fields.row;
    if (assayColumnAxisInput) assayColumnAxisInput.value = fields.column;
    const canFill = Boolean(getFieldAxis(fields, 'concentration'));
    if (assayFillModeInput) assayFillModeInput.disabled = !canFill;
    if (assayDilutionFactorInput) assayDilutionFactorInput.disabled = !canFill;
    if (assayDilutionFillBtn) assayDilutionFillBtn.disabled = !canFill;
    if (assaySerialDilutionBtn) {
      assaySerialDilutionBtn.disabled = !getFieldAxis(fields, 'sample') || !canFill;
    }
  }

  function onAxisAssignmentChange(axis, field) {
    if (!Object.hasOwn(AXIS_FIELDS, field) || field === axisFields[axis]) return;
    const axisValues = getAxisTemplateValues();
    const other = oppositeAxis(axis);
    const fields = { ...axisFields, [axis]: field };
    if (axisFields[other] === field) fields[other] = axisFields[axis];
    setAxisAssignments(fields);
    // Axis changes can temporarily unmap wells. Keep draft readings until Save
    // so switching the assignments back restores the same measurements.
    setLayoutFromAxisAndOverrides({ axisValues });
    renderPlatePreview(getAxisTemplateValues({ includePreview: false }));
    renderResultTable();
    setLayoutStatus('');
  }

  function resetAxisAssignments() {
    setAxisAssignments(getAssayAxisFields());
  }

  function restoreAssayLayoutState(assay, def) {
    setAxisAssignments(getAssayAxisFields(assay));
    const axisValues = getAssayAxisTemplateValues(assay, def);
    setAxisTemplateValues(axisValues, def);
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
        fields: axisFields,
        values: axisValues
      }), def, runtime.suppressedWells);
      const expectedLegacyUnionLayout = removeSuppressedWellsFromLayout(applyAxisTemplate({
        def,
        fields: axisFields,
        values: axisValues,
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

  function renderPlatePreview(sourceValues = null, { preserveEditors = false } = {}) {
    if (!assayPlatePreview) {
      return;
    }
    inventorySamplePicker.hide();
    const def = getCurrentDefinition();
    const values = sourceValues
      ? normalizeCurrentAxisTemplateValues(sourceValues, def, axisFields)
      : getAxisTemplateValues();

    const html = buildPlatePreviewHtml({
      def,
      fields: axisFields,
      layout: runtime.currentLayout,
      values,
      conditionFields: preserveEditors
        ? CONDITION_FIELDS.filter(field => assayPlatePreview.querySelector(`[data-well-inline-field="${field}"]`))
        : getVisibleConditionFields(axisFields, runtime.currentLayout),
      concentrationUnit: getConcentrationUnit(),
      activeWellEditorId: runtime.activeWellEditorId,
      safeText
    });

    if (preserveEditors && assayPlatePreview.querySelector('.assay-plate-table')) {
      // Edits change values, units and well colors, not the table structure.
      // Keep the actual input nodes so blur cannot remove the next click/Tab
      // target or interrupt a selection or an input-method composition.
      const updated = document.createElement('div');
      i18nUi.setHtml(updated, html);
      const wells = assayPlatePreview.querySelectorAll('td.assay-well');
      updated.querySelectorAll('td.assay-well').forEach((next, index) => {
        wells[index].className = next.className;
        wells[index].style.cssText = next.style.cssText;
      });
      const inputs = assayPlatePreview.querySelectorAll('input');
      updated.querySelectorAll('input').forEach((next, index) => {
        const input = inputs[index];
        for (const attribute of next.attributes) {
          if (attribute.name !== 'value') input.setAttribute(attribute.name, attribute.value);
        }
        if (input !== document.activeElement) input.value = next.value;
      });
      const headings = assayPlatePreview.querySelectorAll('thead th');
      updated.querySelectorAll('thead th').forEach((next, index) => {
        i18nUi.setHtml(headings[index], next.innerHTML);
      });
    } else {
      i18nUi.setHtml(assayPlatePreview, html);
    }

    if (serialDilution.isOpen()) {
      serialDilution.render();
    }
  }

  function onClearWellMappings() {
    runtime.manualWellOverrides = {};
    runtime.suppressedWells = new Set();
    setAxisTemplateValues({});
    runtime.currentLayout = [];
    runtime.activeWellEditorId = '';
    runtime.currentResults = {};
    renderPlatePreview(getAxisTemplateValues({ includePreview: false }));
    renderResultTable();
    setLayoutStatus(plateUi('status.clearedMappings'));
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
    setPlateText(assayPlateDefinition, 'status.plateLayout', { rows: def.rows, columns: def.columns, wells: def.rows * def.columns });
  }

  function renderAssayNumberDisplay(numberText = '') {
    if (!assayNumberDisplay) {
      return;
    }
    i18nUi.setText(assayNumberDisplay, (numberText || ''));
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
    setCsvStatus(droppedResults > 0 ? plateUi('status.resizeDropped', { count: droppedResults }) : '');
  }

  function exportLayout(format) {
    return exportPlateLayout(format, {
      assayName: assayNameInput?.value,
      definition: getCurrentDefinition(),
      layout: runtime.currentLayout,
      axisFields,
      concentrationUnit: getConcentrationUnit(),
      setCsvStatus
    });
  }

  const onImportCsv = createLayoutCsvImporter({
    runtime,
    assayImportFile,
    getCurrentDefinition,
    setAxisTemplateValues,
    setLayoutFromAxisAndOverrides,
    renderPlatePreview,
    renderResultTable,
    setCsvStatus,
    setAxisAssignments
  });

  return {
    getCurrentDefinition,
    getSampleAxis,
    getAxisFields,
    resetAxisAssignments,
    getMappedWellSet,
    isMappedWell,
    filterMappedResults,
    setAxisTemplateValues,
    getAxisTemplateValues,
    syncAxisTemplateValues,
    setLayoutFromAxisAndOverrides,
    restoreAssayLayoutState,
    onAxisAssignmentChange,
    getConcentrationUnit,
    setConcentrationUnit,
    onFillConcentrations,
    syncFillModeInputs,
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
    getSerialDilutionSummaryData: () => getFieldAxis(axisFields, 'sample') && getFieldAxis(axisFields, 'concentration')
      ? serialDilution.getSummaryData() : null,
    focusPlateWellInput,
    renderPlateDefinition,
    renderAssayNumberDisplay,
    updateActiveWellPreviewState,
    onPlateTypeChange,
    exportLayout,
    onImportCsv,
    hideInventorySamplePicker: inventorySamplePicker.hide,
    onGlobalPointerDown,
    onGlobalKeyDown,
    onPlatePreviewScroll
  };
}
