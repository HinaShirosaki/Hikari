import { escapeCsv, parseCsvLine } from '../shared.js';
import { buildAllWells, layoutToMap, normalizeLayout } from '../plate-model.js';
import { AXIS_FIELDS, CONDITION_FIELDS, hasWellValues } from '../axis-fields.js';
import { plateUi } from '../localization.js';

export function buildLayoutCsv(wells, axisFields, conditionFields) {
  const hasConditionAxis = CONDITION_FIELDS.includes(axisFields.row) || CONDITION_FIELDS.includes(axisFields.column);
  const axisColumns = hasConditionAxis ? ['row_axis', 'column_axis'] : [];
  const lines = [['well', 'row', 'column', 'sample_id', 'concentration', ...conditionFields, ...axisColumns].join(',')];
  for (const item of wells) {
    const { well, row, column, sampleId, concentration } = item;
    const fields = conditionFields.map(field => escapeCsv(item[field]));
    const axes = hasConditionAxis ? [axisFields.row, axisFields.column] : [];
    lines.push([well, row, column, escapeCsv(sampleId), escapeCsv(concentration), ...fields, ...axes].join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function createLayoutCsvImporter({
  runtime,
  assayImportFile,
  getCurrentDefinition,
  setAxisTemplateValues,
  setAxisAssignments,
  setLayoutFromAxisAndOverrides,
  renderPlatePreview,
  renderResultTable,
  setCsvStatus
}) {
  return async function onImportCsv(event) {
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
        setCsvStatus(plateUi('status.csvEmpty'), true);
        return;
      }

      const header = parseCsvLine(lines[0]).map((cell) => String(cell || '').trim().toLowerCase());
      const indexWell = header.indexOf('well');
      const indexRow = header.indexOf('row');
      const indexColumn = header.indexOf('column');
      const indexSample = header.indexOf('sample_id');
      const indexConcentration = header.indexOf('concentration');
      const indexRowAxis = header.indexOf('row_axis');
      const indexColumnAxis = header.indexOf('column_axis');
      const conditions = CONDITION_FIELDS.map(field => [field, header.indexOf(field)]).filter(([, index]) => index >= 0);
      if (indexWell < 0 && (indexRow < 0 || indexColumn < 0)) {
        setCsvStatus(plateUi('status.csvColumns'), true);
        return;
      }

      const def = getCurrentDefinition();
      const valid = new Set(buildAllWells(def).map((item) => item.well));
      const imported = [];
      let axes = null;
      for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
        const cells = parseCsvLine(lines[rowIndex]);
        if (!axes && indexRowAxis >= 0 && indexColumnAxis >= 0) {
          const row = cells[indexRowAxis]?.trim().toLowerCase();
          const column = cells[indexColumnAxis]?.trim().toLowerCase();
          if (row !== column && Object.hasOwn(AXIS_FIELDS, row) && Object.hasOwn(AXIS_FIELDS, column)) axes = { row, column };
        }
        const well = (indexWell >= 0 ? cells[indexWell] : '').trim().toUpperCase();
        const fallbackRow = (indexRow >= 0 ? cells[indexRow] : '').trim().toUpperCase();
        const fallbackColumn = Number((indexColumn >= 0 ? cells[indexColumn] : '').trim());
        const resolvedWell = well || (fallbackRow && Number.isFinite(fallbackColumn) ? `${fallbackRow}${fallbackColumn}` : '');
        if (!resolvedWell || !valid.has(resolvedWell)) {
          continue;
        }
        const sampleId = indexSample >= 0 ? String(cells[indexSample] || '').trim() : '';
        const concentration = indexConcentration >= 0 ? String(cells[indexConcentration] || '').trim() : '';
        const item = { well: resolvedWell, sampleId, concentration };
        for (const [field, index] of conditions) {
          const value = String(cells[index] || '').trim();
          if (value) item[field] = value;
        }
        if (hasWellValues(item)) imported.push(item);
      }

      if (axes) setAxisAssignments(axes);
      const axisValues = setAxisTemplateValues({}, def);
      runtime.suppressedWells = new Set();
      runtime.manualWellOverrides = layoutToMap(normalizeLayout(imported, def));
      setLayoutFromAxisAndOverrides({ axisValues });
      renderPlatePreview(axisValues);
      renderResultTable();
      setCsvStatus(plateUi('status.csvImported', { count: runtime.currentLayout.length, file: file.name }));
    } catch {
      setCsvStatus(plateUi('status.csvParse'), true);
    } finally {
      if (assayImportFile) {
        assayImportFile.value = '';
      }
    }
  };
}
