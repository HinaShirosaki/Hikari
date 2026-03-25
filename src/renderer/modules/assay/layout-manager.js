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
  removeSuppressedWellsFromLayout,
  sortLayout,
  toRowLabel,
  wellIdFor
} from './plate-model.js';

export function createAssayLayoutManager({
  runtime,
  elements,
  safeText,
  setCsvStatus,
  setLayoutStatus,
  setResultStatus,
  renderResultTable,
  clearAnalysisOutput
}) {
  const {
    assayConcentrationAxisDisplay,
    assayImportFile,
    assayLayoutList,
    assayNumberDisplay,
    assayPlateDefinition,
    assayPlateFieldConcentrationBtn,
    assayPlateFieldSampleBtn,
    assayPlatePreview,
    assaySampleAxisColumnBtn,
    assaySampleAxisInput,
    assaySampleAxisRowBtn,
    assayNameInput,
    assayPlateTypeInput
  } = elements;

  function getCurrentDefinition() {
    return getPlateDefinition(assayPlateTypeInput?.value);
  }

  function getSampleAxis() {
    return assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
  }

  function setAxisTemplateValues(values, def = getCurrentDefinition(), sampleAxis = getSampleAxis()) {
    runtime.axisTemplateValues = normalizeCurrentAxisTemplateValues(values, def, sampleAxis);
    return runtime.axisTemplateValues;
  }

  function hasAxisTemplateValues(values) {
    return (Array.isArray(values) ? values : []).some((item) => String(item || '').trim());
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
    assaySampleAxisRowBtn?.classList.toggle('calendar-view-active', sampleAxis === 'row');
    assaySampleAxisColumnBtn?.classList.toggle('calendar-view-active', sampleAxis === 'column');
  }

  function renderPlateEditFieldButtons() {
    assayPlateFieldSampleBtn?.classList.toggle('calendar-view-active', runtime.plateEditField === 'sampleId');
    assayPlateFieldConcentrationBtn?.classList.toggle('calendar-view-active', runtime.plateEditField === 'concentration');
  }

  function syncAxisDisplay() {
    if (!assayConcentrationAxisDisplay) {
      return;
    }
    const sampleAxis = getSampleAxis();
    assayConcentrationAxisDisplay.value = axisLabel(oppositeAxis(sampleAxis));
    renderAxisSwitchButtons();
  }

  function setSampleAxis(axis) {
    if (!assaySampleAxisInput) {
      return;
    }
    const next = axis === 'column' ? 'column' : 'row';
    if (assaySampleAxisInput.value === next) {
      return;
    }
    assaySampleAxisInput.value = next;
    syncAxisDisplay();
    setLayoutFromAxisAndOverrides();
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
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
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(`Switched axes. Sample axis is now ${axisLabel(assaySampleAxisInput.value)}.`);
  }

  function restoreAssayLayoutState(assay, def) {
    const sampleAxis = assay?.sampleAxis === 'column' ? 'column' : 'row';
    const axisValues = getAssayAxisTemplateValues(assay, def);
    setAxisTemplateValues(axisValues, def, sampleAxis);
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
    const def = getCurrentDefinition();
    const sampleAxis = getSampleAxis();
    const concentrationAxis = oppositeAxis(sampleAxis);
    const cellMap = layoutToMap(runtime.currentLayout);
    const totalWells = def.rows * def.columns;
    const maxRows = totalWells > 384 ? 16 : def.rows;
    const maxColumns = totalWells > 384 ? 24 : def.columns;

    const { sampleValues, concentrationValues } = sourceValues
      ? normalizeCurrentAxisTemplateValues(sourceValues, def, sampleAxis)
      : getAxisTemplateValues();
    const rowAxisRole = sampleAxis === 'row' ? 'sample' : 'concentration';
    const columnAxisRole = sampleAxis === 'row' ? 'concentration' : 'sample';
    const rowAxisLabel = rowAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
    const columnAxisLabel = columnAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
    const rowAxisValues = rowAxisRole === 'sample' ? sampleValues : concentrationValues;
    const columnAxisValues = columnAxisRole === 'sample' ? sampleValues : concentrationValues;

    const headers = ['<th></th>', `<th>${safeText(rowAxisLabel)}</th>`];
    for (let col = 0; col < maxColumns; col += 1) {
      headers.push(`<th>${col + 1}</th>`);
    }

    const axisRowCells = [`<th>${safeText(columnAxisLabel)}</th>`, '<td></td>'];
    for (let col = 0; col < maxColumns; col += 1) {
      const value = String(columnAxisValues[col] || '');
      axisRowCells.push(`
        <td class="assay-axis-cell">
          <input
            type="text"
            class="assay-axis-input"
            data-axis-dimension="column"
            data-axis-index="${col}"
            value="${safeText(value)}"
            placeholder="${columnAxisRole === 'sample' ? 'Sample' : 'Conc'}"
          />
        </td>
      `);
    }

    const rows = [];
    for (let row = 0; row < maxRows; row += 1) {
      const rowLabel = toRowLabel(row);
      const rowAxisValue = String(rowAxisValues[row] || '');
      const cells = [
        `<th>${rowLabel}</th>`,
        `
          <td class="assay-axis-cell">
            <input
              type="text"
              class="assay-axis-input"
              data-axis-dimension="row"
              data-axis-index="${row}"
              value="${safeText(rowAxisValue)}"
              placeholder="${rowAxisRole === 'sample' ? 'Sample' : 'Conc'}"
            />
          </td>
        `
      ];
      for (let col = 0; col < maxColumns; col += 1) {
        const well = wellIdFor(row, col);
        const layout = cellMap[well];
        const filled = layout && (layout.sampleId || layout.concentration) ? ' is-filled' : '';
        const active = runtime.activeWellEditorId === well ? ' is-active' : '';
        const sampleValue = String(layout?.sampleId || '').trim();
        const concentrationValue = String(layout?.concentration || '').trim();
        const sampleLabel = sampleValue || '-';
        const concentrationLabel = concentrationValue || '-';
        const editable = runtime.plateEditField === 'concentration' ? 'Concentration' : 'Sample ID';
        const editableValue = runtime.plateEditField === 'concentration' ? concentrationValue : sampleValue;
        const secondaryMeta = runtime.plateEditField === 'concentration'
          ? `S: ${safeText(sampleLabel)}`
          : `C: ${safeText(concentrationLabel)}`;
        const meta = layout
          ? `Sample ID: ${layout.sampleId || '-'} | Concentration: ${layout.concentration || '-'}`
          : 'Sample ID: - | Concentration: -';
        cells.push(`
          <td class="assay-well${filled}${active}" data-well="${well}" title="${safeText(`${well} • ${meta} • Click to edit ${editable}`)}">
            <div class="assay-well-id">${safeText(well)}</div>
            <input
              type="text"
              class="assay-well-inline-input"
              data-well-inline-field="${runtime.plateEditField}"
              data-well="${well}"
              value="${safeText(editableValue)}"
              placeholder="${runtime.plateEditField === 'concentration' ? 'Conc' : 'Sample'}"
            />
            <div class="assay-well-meta">${secondaryMeta}</div>
          </td>
        `);
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }

    const note = totalWells > 384
      ? `<p class="small-note">Previewing first ${maxRows} rows x ${maxColumns} columns for ${def.label} plate.</p>`
      : '';

    assayPlatePreview.innerHTML = `
      <p class="small-note">Sample ID axis: ${axisLabel(sampleAxis)}. Concentration axis: ${axisLabel(concentrationAxis)}. When both axes have values, mapped wells use the x by y intersection area only. Type directly in a well cell for a specific override.</p>
      ${note}
      <div class="assay-plate-table-wrap">
        <table class="assay-plate-table">
          <thead><tr>${headers.join('')}</tr></thead>
          <tbody><tr class="assay-plate-editor-row">${axisRowCells.join('')}</tr>${rows.join('')}</tbody>
        </table>
      </div>
    `;
  }

  function renderLayoutList() {
    if (!assayLayoutList) {
      return;
    }
    const rows = sortLayout(runtime.currentLayout);
    if (!rows.length) {
      assayLayoutList.innerHTML = '<p class="small-note">No mapped wells yet.</p>';
      return;
    }
    assayLayoutList.innerHTML = rows.map((item) => `
      <article class="list-row">
        <span><strong>${safeText(item.well)}</strong> — Sample: ${safeText(item.sampleId || '-')}</span>
        <span>Conc: ${safeText(item.concentration || '-')}</span>
        <div class="card-actions list-actions">
          <button type="button" class="ghost-btn" data-layout-edit="${item.well}">Edit</button>
          <button type="button" class="danger-btn" data-layout-delete="${item.well}">Delete</button>
        </div>
      </article>
    `).join('');
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
      setLayoutFromAxisAndOverrides();
      renderLayoutList();
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

    updateInlineWellOverride(
      inlineInput.dataset.well,
      inlineInput.dataset.wellInlineField,
      inlineInput.value
    );
    renderLayoutList();
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

  function onClearWellMappings() {
    runtime.manualWellOverrides = {};
    runtime.suppressedWells = new Set();
    setAxisTemplateValues({ sampleValues: [], concentrationValues: [] });
    runtime.currentLayout = [];
    runtime.activeWellEditorId = '';
    runtime.currentResults = {};
    renderLayoutList();
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

  function onLayoutListClick(event) {
    const editBtn = event.target.closest('[data-layout-edit]');
    if (editBtn) {
      const well = editBtn.dataset.layoutEdit;
      const item = runtime.currentLayout.find((entry) => entry.well === well);
      if (!item) {
        return;
      }
      setActiveWellSelection(item.well || '');
      focusPlateWellInput(item.well || '');
      setLayoutStatus(`Focused ${well} in plate preview.`);
      return;
    }
    const deleteBtn = event.target.closest('[data-layout-delete]');
    if (deleteBtn) {
      const well = deleteBtn.dataset.layoutDelete;
      delete runtime.manualWellOverrides[well];
      runtime.suppressedWells.add(well);
      setLayoutFromAxisAndOverrides();
      if (runtime.activeWellEditorId === well) {
        runtime.activeWellEditorId = '';
      }
      renderLayoutList();
      renderPlatePreview();
      renderResultTable();
      setLayoutStatus(`Deleted ${well}.`);
      setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}.`);
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
    renderLayoutList();
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
      renderLayoutList();
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
    setPlateEditField,
    syncAxisDisplay,
    onSwapAxes,
    renderPlatePreview,
    renderLayoutList,
    onPlatePreviewInput,
    onPlatePreviewChange,
    onPlatePreviewFocusIn,
    onPlatePreviewClick,
    onClearWellMappings,
    focusPlateWellInput,
    onLayoutListClick,
    renderPlateDefinition,
    renderAssayNumberDisplay,
    updateActiveWellPreviewState,
    onPlateTypeChange,
    exportCsvTemplate,
    onImportCsv
  };
}
