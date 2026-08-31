import { createInventorySamplePicker } from '../inventory-sample-picker.js';
import { createPlatePreviewEvents } from './preview-events.js';
import { createSerialDilutionController } from '../serial-dilution.js';
import { createConcentrationFill } from './concentration-fill.js';
import {
  applyAxisTemplate,
  isValidWellForDefinition,
  layoutToMap,
  normalizeCurrentAxisTemplateValues
} from '../plate-model.js';

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
