import { escapeCsv, parseCsvLine, sanitizeFilePart } from '../shared.js';
import { buildAllWells, layoutToMap, normalizeLayout } from '../plate-model.js';
import { plateUi } from '../localization.js';

// CSV plate-template export and import. Self-contained leaf wired by index.js.
export function createLayoutCsv({
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
}) {
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
    setCsvStatus(plateUi('status.exportedTemplate', { count: def.value }));
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
        setCsvStatus(plateUi('status.csvEmpty'), true);
        return;
      }

      const header = parseCsvLine(lines[0]).map((cell) => String(cell || '').trim().toLowerCase());
      const indexWell = header.indexOf('well');
      const indexRow = header.indexOf('row');
      const indexColumn = header.indexOf('column');
      const indexSample = header.indexOf('sample_id');
      const indexConcentration = header.indexOf('concentration');
      if (indexWell < 0 && (indexRow < 0 || indexColumn < 0)) {
        setCsvStatus(plateUi('status.csvColumns'), true);
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
      setCsvStatus(plateUi('status.csvImported', { count: runtime.currentLayout.length, file: file.name }));
    } catch {
      setCsvStatus(plateUi('status.csvParse'), true);
    } finally {
      if (assayImportFile) {
        assayImportFile.value = '';
      }
    }
  }

  return { exportCsvTemplate, onImportCsv };
}
