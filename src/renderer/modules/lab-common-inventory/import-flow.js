export function installImportFlow(ctx) {
  const { persist } = ctx;
  const { chemicalImportFile } = ctx.elements;
  const parseChemicalImportFile = (...args) => ctx.parseChemicalImportFile(...args);
  const inferChemicalImportHeaders = (...args) => ctx.inferChemicalImportHeaders(...args);
  const importChemicalRows = (...args) => ctx.importChemicalRows(...args);
  const buildImportMappingSummary = (...args) => ctx.buildImportMappingSummary(...args);
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
  setChemicalImportStatus(`Reading ${file.name}...`, 'busy');
  try {
    const parsed = await parseChemicalImportFile(file);
    if (!Array.isArray(parsed.headers) || !parsed.headers.length) {
      throw new Error('Import file needs a header row.');
    }
    if (!Array.isArray(parsed.rows) || !parsed.rows.length) {
      throw new Error('Import file does not contain chemical rows.');
    }

    setChemicalImportStatus('Matching spreadsheet columns...', 'busy');
    const inference = await inferChemicalImportHeaders(parsed.headers, parsed.rows);
    if (inference.fieldToColumn.name == null) {
      throw new Error('Could not find a chemical name column.');
    }

    const result = importChemicalRows(parsed, inference, file.name);
    if (!result.created && !result.updated) {
      setChemicalImportStatus(`No chemicals imported from ${file.name}. ${result.skipped} rows were skipped.`, 'error');
      return;
    }

    persist();
    void syncChemicalSqliteBundle(true);
    renderAll();
    const mappingSummary = buildImportMappingSummary(inference);
    const llmNote = inference.llmError ? ` LLM mapping unavailable: ${inference.llmError}` : '';
    setChemicalImportStatus(
      `Imported ${result.created} new and updated ${result.updated} chemicals from ${file.name}. Skipped ${result.skipped}. ${mappingSummary ? `Mapped ${mappingSummary}.` : ''}${llmNote}`,
      inference.llmError ? 'warning' : 'success'
    );
  } catch (error) {
    setChemicalImportStatus(`Import failed: ${String(error?.message || error)}`, 'error');
  } finally {
    if (chemicalImportFile) {
      chemicalImportFile.value = '';
    }
  }
}

  ctx.onChemicalImportFileChange = onChemicalImportFileChange;
}
