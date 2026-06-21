import {
  axisLabel,
  escapeCsv,
  oppositeAxis,
  parseCsvLine,
  sanitizeFilePart
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
  parseWellId,
  removeSuppressedWellsFromLayout,
  wellIdFor
} from './plate-model.js';
import { createInventorySamplePicker } from './inventory-sample-picker.js';
import { createSerialDilutionController } from './serial-dilution.js';
import { buildPlatePreviewHtml } from './plate-preview-renderer.js';
import {
  buildDilutionSeries,
  buildInterpolatedSeries,
  isKnownUnit,
  splitConcentrationValue
} from './concentration-utils.js';

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
    assayFillStartInput,
    assayFillEndInput,
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

  function getFillMode() {
    const mode = String(assayFillModeInput?.value || 'factor');
    return mode === 'linear' || mode === 'log' ? mode : 'factor';
  }

  // Show the factor input for 'factor' mode and the start/end inputs for range modes.
  function syncFillModeInputs() {
    const isRange = getFillMode() !== 'factor';
    if (assayDilutionFactorInput) assayDilutionFactorInput.hidden = isRange;
    if (assayFillStartInput) assayFillStartInput.hidden = !isRange;
    if (assayFillEndInput) assayFillEndInput.hidden = !isRange;
  }

  function commitConcentrationValues(sampleValues, concentrationValues, statusMessage) {
    syncAxisTemplateValues({ sampleValues, concentrationValues });
    setLayoutFromAxisAndOverrides();
    renderPlatePreview();
    renderResultTable();
    if (serialDilution.isOpen()) {
      serialDilution.render();
    }
    setLayoutStatus(statusMessage);
  }

  // Serial dilution: first cell is the start, each following column/row = previous / factor.
  function autoFillConcentrationSeries() {
    const factor = Number(assayDilutionFactorInput?.value);
    if (!(Number.isFinite(factor) && factor > 0)) {
      setLayoutStatus('Enter a positive dilution factor to auto-fill concentrations.');
      return;
    }
    const values = getAxisTemplateValues();
    const concentrationValues = values.concentrationValues.slice();
    if (concentrationValues.length < 2) {
      setLayoutStatus('The concentration axis needs at least two positions to fill a dilution series.');
      return;
    }
    const series = buildDilutionSeries(concentrationValues[0], factor, concentrationValues.length);
    if (!series) {
      setLayoutStatus('Enter a starting concentration in the first concentration cell before auto-filling.');
      return;
    }
    for (let index = 1; index < concentrationValues.length; index += 1) {
      concentrationValues[index] = series[index];
    }
    const steps = concentrationValues.length - 1;
    commitConcentrationValues(
      values.sampleValues,
      concentrationValues,
      `Auto-filled ${steps} concentration step${steps === 1 ? '' : 's'} at a 1:${factor} dilution.`
    );
  }

  // Interpolate every concentration position between the start and end inputs.
  function autoFillConcentrationRange(mode) {
    const values = getAxisTemplateValues();
    const concentrationValues = values.concentrationValues.slice();
    if (concentrationValues.length < 2) {
      setLayoutStatus('The concentration axis needs at least two positions to fill a range.');
      return;
    }
    const series = buildInterpolatedSeries({
      startValue: assayFillStartInput?.value,
      endValue: assayFillEndInput?.value,
      count: concentrationValues.length,
      mode,
      axisUnit: getConcentrationUnit()
    });
    if (!series) {
      setLayoutStatus(mode === 'log'
        ? 'Enter positive start and end concentrations (log spacing cannot include 0).'
        : 'Enter a start and end concentration to fill the range.');
      return;
    }
    commitConcentrationValues(
      values.sampleValues,
      series,
      `Auto-filled ${series.length} concentrations from ${series[0]} to ${series[series.length - 1]} (${mode}).`
    );
  }

  function onFillConcentrations() {
    const mode = getFillMode();
    if (mode === 'factor') {
      autoFillConcentrationSeries();
    } else {
      autoFillConcentrationRange(mode);
    }
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
      if (axisInput.dataset.axisDimension === oppositeAxis(getSampleAxis())) {
        recognizeConcentrationUnit(axisInput.value);
      }
      setLayoutFromAxisAndOverrides();
      renderPlatePreview();
      renderResultTable();
      setLayoutStatus('Updated axis-based mapping from in-plate row/column definitions.');
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

  function exportCsvTemplate() {
    const def = getCurrentDefinition();
    const layoutMap = layoutToMap(runtime.currentLayout);
    const lines = ['well,row,column,sample_id,concentration'];
    buildAllWells(def).forEach((well) => {
      const value = layoutMap[well.well] || { sampleId: '', concentration: '' };
      lines.push([
        well.well,
        well.row,
        well.column,
        escapeCsv(value.sampleId),
        escapeCsv(value.concentration)
      ].join(','));
    });

    const content = `${lines.join('\n')}\n`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = sanitizeFilePart(assayNameInput?.value, 'assay');
    link.href = url;
    link.download = `${baseName}-${def.value}well-template.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setCsvStatus(`Exported ${def.label} CSV template.`);
  }

  async function onImportCsv(event) {
    const file = event?.target?.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = await file.text();
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) {
        setCsvStatus('Import failed: CSV file is empty.');
        return;
      }

      const header = parseCsvLine(lines[0]).map((cell) => String(cell || '').trim().toLowerCase());
      const indexWell = header.indexOf('well');
      const indexRow = header.indexOf('row');
      const indexColumn = header.indexOf('column');
      const indexSample = header.indexOf('sample_id');
      const indexConcentration = header.indexOf('concentration');
      if (indexWell < 0 && (indexRow < 0 || indexColumn < 0)) {
        setCsvStatus('Import failed: CSV needs "well" or both "row" and "column" columns.');
        return;
      }

      const def = getCurrentDefinition();
      const valid = new Set(buildAllWells(def).map((item) => item.well));
      const imported = [];
      for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
        const cells = parseCsvLine(lines[rowIndex]);
        const well = (indexWell >= 0 ? cells[indexWell] : '').trim().toUpperCase();
        const fallbackRow = (indexRow >= 0 ? cells[indexRow] : '').trim().toUpperCase();
        const fallbackColumn = Number((indexColumn >= 0 ? cells[indexColumn] : '').trim());
        const resolvedWell = well || (fallbackRow && Number.isFinite(fallbackColumn) ? `${fallbackRow}${fallbackColumn}` : '');
        if (!resolvedWell || !valid.has(resolvedWell)) {
          continue;
        }
        const sampleId = indexSample >= 0 ? String(cells[indexSample] || '').trim() : '';
        const concentration = indexConcentration >= 0 ? String(cells[indexConcentration] || '').trim() : '';
        if (!sampleId && !concentration) {
          continue;
        }
        imported.push({ well: resolvedWell, sampleId, concentration });
      }

      setAxisTemplateValues({ sampleValues: [], concentrationValues: [] }, def, getSampleAxis());
      runtime.suppressedWells = new Set();
      runtime.manualWellOverrides = layoutToMap(normalizeLayout(imported, def));
      setLayoutFromAxisAndOverrides();
      renderPlatePreview();
      renderResultTable();
      setCsvStatus(`Imported ${runtime.currentLayout.length} mapped wells from ${file.name}.`);
    } catch {
      setCsvStatus('Import failed: could not parse CSV file.');
    } finally {
      if (assayImportFile) {
        assayImportFile.value = '';
      }
    }
  }

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
