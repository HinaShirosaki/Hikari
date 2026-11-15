import { AXIS_FIELDS, getAssayAxisFields } from '../axis-fields.js';
import {
  applyAxisTemplate,
  buildAllWells,
  buildMappedWellSet,
  filterResultsToMappedWells,
  isValidWellForDefinition,
  layoutToMap,
  mergeAxisTemplateValues,
  normalizeCurrentAxisTemplateValues,
  normalizeLayout,
  normalizeManualWellOverrideMap
} from '../plate-model.js';

// Axis template values are the labels a plate layout is
// generated from; this owns reading them back off the preview and re-deriving
// the layout when either axis changes.
function createAxisValues({
  runtime,
  assayPlatePreview,
  getCurrentDefinition,
  getAxisFields = () => getAssayAxisFields()
} = {}) {
  function setAxisTemplateValues(values, def = getCurrentDefinition()) {
    runtime.axisTemplateValues = normalizeCurrentAxisTemplateValues(values, def, getAxisFields());
    return runtime.axisTemplateValues;
  }

  function readAxisValuesFromPlatePreview() {
    if (!assayPlatePreview) {
      return null;
    }
    const fields = getAxisFields();
    const values = {};
    for (const input of assayPlatePreview.querySelectorAll('[data-axis-dimension]')) {
      const field = input.dataset.axisField;
      if (field !== fields[input.dataset.axisDimension]) continue;
      const { valuesKey } = AXIS_FIELDS[field];
      values[valuesKey] ||= [];
      values[valuesKey][Number(input.dataset.axisIndex)] = input.value;
    }
    return values;
  }

  function getAxisTemplateValues({ includePreview = true } = {}) {
    return mergeAxisTemplateValues({
      def: getCurrentDefinition(),
      fields: getAxisFields(),
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

  // isMappedWell runs once per grid cell, so rebuilding the set each call made a
  // 1536-well plate O(n^2). Layout writers always assign a new array, so the
  // array's identity is the cache key.
  let mappedWells = { layout: null, set: new Set() };
  function getMappedWellSet() {
    if (mappedWells.layout !== runtime.currentLayout) {
      mappedWells = { layout: runtime.currentLayout, set: buildMappedWellSet(runtime.currentLayout) };
    }
    return mappedWells.set;
  }

  function isMappedWell(wellId) {
    return getMappedWellSet().has(String(wellId || '').trim().toUpperCase());
  }

  function filterMappedResults(results) {
    return filterResultsToMappedWells(results, runtime.currentLayout);
  }

  function setLayoutFromAxisAndOverrides({ preserveActiveWell = true, axisValues = null } = {}) {
    const def = getCurrentDefinition();
    const fields = getAxisFields();
    const normalizedAxisValues = axisValues
      ? normalizeCurrentAxisTemplateValues(axisValues, def, fields)
      : getAxisTemplateValues();
    setAxisTemplateValues(normalizedAxisValues, def);
    normalizeManualWellOverrides(def);
    normalizeSuppressedWells(def);
    const baseLayout = applyAxisTemplate({ def, fields, values: normalizedAxisValues });
    const map = layoutToMap(baseLayout);
    Object.entries(runtime.manualWellOverrides).forEach(([well, value]) => {
      map[well] = { ...map[well], ...value };
    });
    runtime.suppressedWells.forEach((well) => {
      delete map[well];
    });
    runtime.currentLayout = normalizeLayout(Object.entries(map).map(([well, value]) => ({
      well,
      ...value
    })), def);
    if (preserveActiveWell && runtime.activeWellEditorId && !isValidWellForDefinition(runtime.activeWellEditorId, def)) {
      runtime.activeWellEditorId = '';
    }
  }

  function getEffectiveWellMapping(wellId) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell) {
      return { sampleId: '', concentration: '' };
    }
    const current = runtime.currentLayout.find(well => well.well === normalizedWell);
    return current || { sampleId: '', concentration: '' };
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

  return {
    setAxisTemplateValues,
    readAxisValuesFromPlatePreview,
    getAxisTemplateValues,
    normalizeManualWellOverrides,
    normalizeSuppressedWells,
    getMappedWellSet,
    isMappedWell,
    filterMappedResults,
    setLayoutFromAxisAndOverrides,
    getEffectiveWellMapping,
    updateActiveWellPreviewState,
    setActiveWellSelection
  };
}

export { createAxisValues };
