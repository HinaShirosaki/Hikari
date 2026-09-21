import { buildMappedWellSet, layoutToMap, parseWellId, toRowLabel, wellIdFor } from '../plate-model.js';
import { parseFirstNumericToken, parseNumericResult } from '../shared.js';
import { applyPlateTransform, isTransformActive, normalizeTransformSpec } from '../derived-plate.js';
import { createSpreadsheetFillHandle } from '../../../lib/spreadsheet-tables/fill-handle.js';
import { fillCellContent } from '../../../lib/notebook-table-formulas.js';
import { createSpreadsheetReferencePicker } from '../../../lib/spreadsheet-reference-picker.js';

// The Transformed Plate grid (Table2) and the numeric observations analyses are
// computed from. Holds the derived plate so no other module can write it.
function createDerivedPlateGrid({
  safeText,
  runtime,
  TabulatorLib,
  getCurrentDefinition,
  getResultGridHeight,
  buildResultGridColumns,
  buildResultGridData,
  buildResultGridSignature,
  onTransformChange,
  assayResultTable,
  assayDerivedPlatePanel,
  assayDerivedPlateTable,
  assayTransformSummary,
  assayAnalysisRowGroupsInput,
  assayAnalysisColumnGroupsInput
} = {}) {
  let derivedPlate = null;
  let transformFormulas = {};
  let transformEnabled = false;
  let transformGrid = null;
  let transformGridSignature = '';

  // Reuse the Notebook gesture with plate coordinates and a single batched commit.
  const fillHandle = createSpreadsheetFillHandle({
    host: assayDerivedPlateTable,
    getGrids: () => [transformGrid],
    getDraftTables: () => [{
      columns: Array.from({ length: getCurrentDefinition().columns }, (_, index) => ({ field: `c${index + 1}` })),
      rows: transformGrid?.getData?.() || []
    }],
    canFillCell: ({ columnIndex, rowIndex }) => (
      buildMappedWellSet(runtime.currentLayout).has(wellIdFor(rowIndex, columnIndex))
    ),
    canStartFillCell: ({ columnIndex, rowIndex }) => {
      const well = wellIdFor(rowIndex, columnIndex);
      // An empty transformed cell has nothing to copy. Leaving its edge unclaimed
      // gives the compact cell its full click area for opening the formula editor.
      return buildMappedWellSet(runtime.currentLayout).has(well)
        && Boolean(String(transformFormulas[well] ?? '').trim());
    },
    applyFill: ({ columnIndex, rowIndex, targets, source }) => {
      targets.forEach((target) => {
        const well = wellIdFor(target.rowIndex, target.columnIndex);
        const value = fillCellContent(source, target.columnIndex - columnIndex, target.rowIndex - rowIndex, {
          plateAddressing: true
        }).trim();
        if (value) transformFormulas[well] = value;
        else delete transformFormulas[well];
      });
      onTransformChange();
    }
  });
  assayDerivedPlateTable?.addEventListener?.('mousemove', fillHandle.onHostMouseMove);
  assayDerivedPlateTable?.addEventListener?.('mouseleave', fillHandle.hideFillHandle);
  assayDerivedPlateTable?.addEventListener?.('mousedown', fillHandle.onHostFillPointerDown, true);

  function getTransformSpec() {
    return normalizeTransformSpec({ mode: 'cells', enabled: transformEnabled, formulas: transformFormulas });
  }

  function setTransformSummary(text) {
    if (assayTransformSummary) {
      assayTransformSummary.textContent = text;
    }
  }

  function clearTransformGrid() {
    fillHandle.cancelFillDrag();
    transformGrid?.destroy?.();
    transformGrid = null;
    transformGridSignature = '';
    if (assayDerivedPlateTable) {
      assayDerivedPlateTable.innerHTML = '';
    }
  }

  function transformColumnIndex(field) {
    const parsed = Number(String(field || '').replace(/^c/, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : -1;
  }

  function findTransformFormulaEditor() {
    return assayDerivedPlateTable?.querySelector?.('.tabulator-cell input') || null;
  }

  function qualifiedAddressOfPlateCell(cellElement) {
    const tableRoot = assayResultTable?.contains?.(cellElement)
      ? assayResultTable
      : (assayDerivedPlateTable?.contains?.(cellElement) ? assayDerivedPlateTable : null);
    if (!tableRoot) {
      return '';
    }
    const columnIndex = transformColumnIndex(cellElement.getAttribute?.('tabulator-field'));
    // The row's own frozen label, not its position among the rendered rows: Tabulator
    // renders vertically virtual, so a scrolled plate holds only the visible window and
    // a DOM index would name the wrong well. The label is what wellIdFor would build.
    const rowLabel = String(
      cellElement.closest?.('.tabulator-row')?.querySelector?.('[tabulator-field="rowLabel"]')?.textContent || ''
    ).trim().toUpperCase();
    if (columnIndex < 0 || !/^[A-Z]+$/.test(rowLabel)) {
      return '';
    }
    const tableName = tableRoot === assayResultTable ? 'Table1' : 'Table2';
    return `${tableName}:${rowLabel}${columnIndex + 1}`;
  }

  // The same point-mode controller powers Notebook tables. Assay only supplies its
  // plate-shaped Table1/Table2 address mapping.
  createSpreadsheetReferencePicker({
    roots: [assayResultTable, assayDerivedPlateTable],
    findEditor: findTransformFormulaEditor,
    shouldIgnore: (event) => fillHandle.pointerInFillZone(event),
    addressOfCell: ({ cellElement }) => qualifiedAddressOfPlateCell(cellElement)
  });

  function formatTransformCell(_cell, { well, mapped, value }) {
    if (!mapped) {
      return value || '—';
    }
    if (!value) {
      return '';
    }
    const computed = derivedPlate?.cells?.[well];
    const element = document.createElement('span');
    element.className = computed?.error
      ? 'assay-transform-cell assay-transform-cell--error'
      : 'assay-transform-cell assay-transform-cell--formula';
    element.textContent = computed?.error ? '#ERROR' : (computed?.text ?? value);
    element.title = computed?.error ? `${value} — ${computed.error}` : value;
    return element;
  }

  function onTransformGridCellEdited(cell) {
    const columnIndex = transformColumnIndex(cell?.getField?.());
    const rowIndex = Number(cell?.getRow?.()?.getData?.()?.__rowIndex);
    if (columnIndex < 0 || !Number.isFinite(rowIndex) || rowIndex < 0) {
      return;
    }
    const well = wellIdFor(rowIndex, columnIndex);
    const formula = String(cell?.getValue?.() ?? '').trim();
    if (formula) {
      transformFormulas[well] = formula;
    } else {
      delete transformFormulas[well];
    }
    onTransformChange();
  }

  function ensureTransformGrid(def) {
    if (!assayDerivedPlateTable || !isTransformActive(getTransformSpec())) {
      return false;
    }
    if (!TabulatorLib) {
      assayDerivedPlateTable.innerHTML = '<p class="small-note">Spreadsheet component failed to load (Tabulator).</p>';
      return false;
    }
    const signature = buildResultGridSignature(def);
    if (!transformGrid || transformGridSignature !== signature) {
      clearTransformGrid();
      const host = document.createElement('div');
      host.className = 'assay-tabulator assay-transform-grid';
      host.dataset.resultTableHost = '0';
      host.tabIndex = 0;
      host.setAttribute('role', 'grid');
      host.setAttribute('aria-label', 'Transformed assay plate spreadsheet');
      assayDerivedPlateTable.append(host);
      const options = {
        data: buildResultGridData(def, transformFormulas),
        columns: buildResultGridColumns(def, { formatter: formatTransformCell }),
        index: '__rowIndex',
        layout: 'fitDataTable',
        reactiveData: false,
        // Range selection otherwise wins the first interaction in some Electron
        // builds, making a formula cell feel like it needs a double-click.
        editTriggerEvent: 'click',
        selectableRange: true,
        selectableRangeColumns: true,
        selectableRangeRows: true
      };
      const height = getResultGridHeight(def);
      if (height) {
        options.height = height;
      }
      transformGrid = new TabulatorLib(host, options);
      transformGrid?.on?.('cellEdited', onTransformGridCellEdited);
      transformGridSignature = signature;
      return true;
    }
    transformGrid.replaceData?.(buildResultGridData(def, transformFormulas));
    return true;
  }

  // Recomputes every formula from the original result grid, then updates the formula
  // table and the numeric map used by analysis.
  function refreshDerivedPlate() {
    const spec = getTransformSpec();
    if (!isTransformActive(spec)) {
      derivedPlate = null;
      if (assayDerivedPlatePanel) assayDerivedPlatePanel.hidden = true;
      clearTransformGrid();
      setTransformSummary('');
      return null;
    }

    const result = applyPlateTransform({
      results: runtime.currentResults,
      spec,
      definition: getCurrentDefinition(),
      rowGroupSpec: String(assayAnalysisRowGroupsInput?.value || ''),
      columnGroupSpec: String(assayAnalysisColumnGroupsInput?.value || '')
    });
    derivedPlate = result;

    setTransformSummary(result.errorCount
      ? `${result.errorCount} formula error(s); hover #ERROR for details.`
      : '');

    if (assayDerivedPlatePanel) {
      assayDerivedPlatePanel.hidden = false;
    }
    ensureTransformGrid(getCurrentDefinition());
    return result;
  }

  function collectNumericObservations() {
    const layoutMap = layoutToMap(runtime.currentLayout);
    // A derived plate replaces the raw values wherever a transform is active; its map
    // is already numeric, so nothing is re-parsed.
    const derived = derivedPlate ? derivedPlate.numericResults : null;
    const observations = [];
    let nonNumericCount = 0;

    Object.entries(derived || runtime.currentResults || {}).forEach(([well, raw]) => {
      const response = derived ? raw : parseNumericResult(raw);
      if (!Number.isFinite(response)) {
        nonNumericCount += 1;
        return;
      }
      const parsedWell = parseWellId(well);
      if (!parsedWell) {
        return;
      }
      const mapping = layoutMap[well] || { sampleId: '', concentration: '' };
      const rawSampleId = String(mapping.sampleId || '').trim();
      const rawConcentration = String(mapping.concentration || '').trim();
      const concentrationLabel = rawConcentration || '-';
      observations.push({
        well,
        response,
        rowIndex: parsedWell.rowIndex,
        rowLabel: toRowLabel(parsedWell.rowIndex),
        columnIndex: parsedWell.columnIndex,
        columnNumber: parsedWell.columnIndex + 1,
        rawSampleId,
        sampleId: rawSampleId || '(unmapped)',
        sampleValue: parseFirstNumericToken(rawSampleId),
        rawConcentration,
        concentrationLabel,
        concentrationValue: parseFirstNumericToken(concentrationLabel)
      });
    });

    return { observations, nonNumericCount };
  }

  function buildAnalysisTable(headers, rows) {
    return `
      <table class="assay-plate-table">
        <thead>
          <tr>${headers.map((item) => `<th>${safeText(String(item))}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              ${row.map((cell) => `<td>${safeText(String(cell ?? '-'))}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function getGroupOptions() {
    const plate = getCurrentDefinition();
    return {
      rowGroups: {
        groupSpec: String(assayAnalysisRowGroupsInput?.value || ''),
        maxMemberCount: plate.rows
      },
      columnGroups: {
        groupSpec: String(assayAnalysisColumnGroupsInput?.value || ''),
        maxMemberCount: plate.columns
      }
    };
  }

  return {
    getDerivedPlate: () => derivedPlate,
    getTransformFormulas: () => transformFormulas,
    setTransformEnabled: (enabled) => { transformEnabled = enabled === true; },
    redrawTransformGrid: () => transformGrid?.redraw?.(true),
    setTransformFormulas(next) {
      transformFormulas = next;
      return transformFormulas;
    },
    getTransformSpec,
    setTransformSummary,
    clearTransformGrid,
    ensureTransformGrid,
    refreshDerivedPlate,
    collectNumericObservations,
    buildAnalysisTable,
    getGroupOptions
  };
}

export { createDerivedPlateGrid };
