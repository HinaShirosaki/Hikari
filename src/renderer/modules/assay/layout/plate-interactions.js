import { createInventorySamplePicker } from '../inventory-sample-picker.js';
import { createPlatePreviewEvents } from './preview-events.js';
import { createSerialDilutionController } from '../serial-dilution.js';
import { createConcentrationFill } from './concentration-fill.js';
import { applyAxisTemplate, getAxisLength, isValidWellForDefinition, layoutToMap } from '../plate-model.js';
import { AXIS_FIELDS, getFieldAxis, hasWellValues } from '../axis-fields.js';
import { plateUi } from '../localization.js';

// Per-well edits that sit on top of the generated layout: dropping an inventory
// sample onto a well, inline field edits, and folding those back into the
// manual-override map the plate is rebuilt from.
function createPlateInteractions({
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
  syncAxisTemplateValues,
  renderPlatePreview
} = {}) {
  function applyInventorySampleToWell(wellId, sampleValue) {
    updateInlineWellOverride(wellId, 'sampleId', sampleValue);
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(plateUi('status.updatedFromInventory', { well: wellId }));
    setCsvStatus(plateUi('status.mappedWells', { count: runtime.currentLayout.length }));
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
    getConcentrationAxis: () => getFieldAxis(getAxisFields(), 'concentration'),
    getConcentrationLength: () => getAxisLength(getFieldAxis(getAxisFields(), 'concentration'), getCurrentDefinition()),
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
    getAxisFields,
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
    const baseMap = layoutToMap(applyAxisTemplate({ def, fields: getAxisFields(), values: getAxisTemplateValues() }));
    const current = getEffectiveWellMapping(normalizedWell);
    const base = baseMap[normalizedWell] || { sampleId: '', concentration: '' };
    const value = String(rawValue ?? '').trim();
    const override = { ...runtime.manualWellOverrides[normalizedWell] };
    if (value === (base[field] || '')) {
      delete override[field];
    } else {
      override[field] = value;
    }
    if (runtime.suppressedWells.delete(normalizedWell)) {
      for (const { wellKey } of Object.values(AXIS_FIELDS)) {
        if (wellKey !== field && base[wellKey] && !current[wellKey]) override[wellKey] = '';
      }
    }
    if (Object.keys(override).length) runtime.manualWellOverrides[normalizedWell] = override;
    else delete runtime.manualWellOverrides[normalizedWell];

    runtime.activeWellEditorId = normalizedWell;
    setLayoutFromAxisAndOverrides();
  }

  function deriveManualWellOverridesFromLayout(layout, def, axisValues = null) {
    const baseLayout = applyAxisTemplate({
      def,
      fields: getAxisFields(),
      values: axisValues || getAxisTemplateValues()
    });
    const baseMap = layoutToMap(baseLayout);
    const currentMap = layoutToMap(layout);
    const overrides = {};
    Object.entries(currentMap).forEach(([well, current]) => {
      if (!isValidWellForDefinition(well, def)) {
        return;
      }
      const base = baseMap[well] || {};
      if (!hasWellValues(current)) return;
      const override = {};
      for (const { wellKey } of Object.values(AXIS_FIELDS)) {
        const value = current[wellKey] || '';
        if (value !== (base[wellKey] || '')) override[wellKey] = value;
      }
      if (Object.keys(override).length) overrides[well] = override;
    });
    runtime.manualWellOverrides = overrides;
  }


  return {
    inventorySamplePicker,
    serialDilution,
    getFillMode,
    syncFillModeInputs,
    onFillConcentrations,
    autoFillConcentrationRange,
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
    applyInventorySampleToWell,
    updateInlineWellOverride,
    deriveManualWellOverridesFromLayout
  };
}

export { createPlateInteractions };
