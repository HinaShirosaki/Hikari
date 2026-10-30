import { chemicalUi, chemicalError, chemicalImportFailure } from './localization.js';
export function installImportFlow(ctx) {
  const { persist } = ctx;
  const { chemicalImportFile } = ctx.elements;
  const parseChemicalImportFile = (...args) => ctx.parseChemicalImportFile(...args);
  const inferChemicalImportHeaders = (...args) => ctx.inferChemicalImportHeaders(...args);
  const importChemicalRows = (...args) => ctx.importChemicalRows(...args);
  const setChemicalImportResult = (...args) => ctx.setChemicalImportResult(...args);
  const setChemicalImportStatus = (...args) => ctx.setChemicalImportStatus(...args);
  const syncChemicalSqliteBundle = (...args) => ctx.syncChemicalSqliteBundle(...args);
  const renderAll = (...args) => ctx.renderAll(...args);

// Spreadsheet import: parse file -> map headers to chemical fields -> merge
// rows into the inventory (update matches, create the rest) -> persist and
// force a SQLite sync.
async function onChemicalImportFileChange(event) {
  const file = event?.target?.files?.[0];
  if (!file) {
    return;
  }
  setChemicalImportStatus(chemicalUi('import.reading', { file: file.name }), 'busy');
  try {
    const parsed = await parseChemicalImportFile(file);
    if (!Array.isArray(parsed.headers) || !parsed.headers.length) {
      throw chemicalError('import.headerRequired');
    }
    if (!Array.isArray(parsed.rows) || !parsed.rows.length) {
      throw chemicalError('import.noRows');
    }

    setChemicalImportStatus(chemicalUi('import.matching'), 'busy');
    const inference = await inferChemicalImportHeaders(parsed.headers, parsed.rows);
    if (inference.fieldToColumn.name == null) {
      throw chemicalError('import.nameColumn');
    }

    const result = importChemicalRows(parsed, inference, file.name);
    if (!result.created && !result.updated) {
      setChemicalImportStatus(chemicalUi('import.nothing', { file: file.name, count: result.skipped }), 'error');
      return;
    }

    persist();
    void syncChemicalSqliteBundle(true);
    renderAll();
    setChemicalImportResult(result, inference, file.name);
  } catch (error) {
    setChemicalImportStatus(chemicalImportFailure(error), 'error');
  } finally {
    if (chemicalImportFile) {
      chemicalImportFile.value = '';
    }
  }
}

  ctx.onChemicalImportFileChange = onChemicalImportFileChange;
}
