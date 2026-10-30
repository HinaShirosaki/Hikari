// Real Chemicals controls and imports, isolated profile and deterministic IPC.
// The mapper and SQLite backends below never contact a model or user files.
export async function checkLocalizedChemicals({ core, i18n, check }) {
  const { casCodeNumber } = await import('../../../src/renderer/modules/lab-common-inventory/location-codes.js');
  const { installImportRecords } = await import('../../../src/renderer/modules/lab-common-inventory/import-records.js');
  const { CHEMICAL_IMPORT_FIELDS } = await import('../../../src/renderer/modules/lab-common-inventory/import-schema.js');
  const { buildChemicalImportResultMarkup } = await import('../../../src/renderer/modules/lab-common-inventory/import-presentation.js');
  const byId = id => document.getElementById(id);
  const module = core.moduleRuntime.modules.labCommonInventory;
  const state = core.state;
  const root = byId('lab-common-inventory-view');
  const status = byId('chemical-import-status');
  const fileInput = byId('chemical-import-file');
  const settle = () => new Promise(resolve => setTimeout(resolve, 25));
  const waitFor = async condition => {
    for (let n = 0; n < 120; n++) { if (condition()) return; await settle(); }
    throw new Error('Chemical i18n fixture did not settle');
  };
  const switchLocale = () => { i18n.setLocale('en'); i18n.setLocale('es'); };
  const input = (id, value) => { const node = byId(id); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); return node; };
  const select = (id, value) => { const node = byId(id); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); return node; };
  const save = () => byId('chemical-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const hideNotice = () => { const toast = document.querySelector('[data-hikari-transient-toast]'); if (toast) toast.hidden = true; };
  const upload = (text, name = 'chemicals<&>.csv') => {
    const files = new DataTransfer(); files.items.add(new File([text], name, { type: 'text/csv' }));
    fileInput.files = files.files; fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    return fileInput.files[0];
  };
  const csv = rows => rows.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\n');
  const assertBindings = container => {
    for (const node of container.querySelectorAll('[data-i18n]')) {
      if (node.children.length) continue;
      const params = JSON.parse(node.getAttribute('data-i18n-params') || '{}');
      check(i18n.has(node.dataset.i18n) && node.textContent === i18n.t(node.dataset.i18n, params), 'Chemical message binding: ' + node.dataset.i18n);
    }
  };
  const previous = { sync: window.hikariApi.syncSqliteBundle, parser: window.hikariApi.parseChemicalImportFile,
    direct: window.hikariApi.runDirectLlmPrompt, availability: document.body.dataset.agentAvailability };
  const restore = (key, value) => { if (value === undefined) delete window.hikariApi[key]; else window.hikariApi[key] = value; };
  const syncRequests = [];
  let failSync = false;
  window.hikariApi.syncSqliteBundle = async payload => {
    syncRequests.push(structuredClone(payload));
    return failSync ? { ok: false, error: 'SQLite fixture error <&>' } : { ok: true };
  };
  delete window.hikariApi.parseChemicalImportFile;
  try {
    core.navigationShell.showView('lab-common-inventory-view');
    i18n.setLocale('en');
    const rack = 'Rack <&>'; const shelf = 'Shelf B';
    for (const location of [rack, shelf]) if (!state.settings.inventoryLocations.includes(location)) state.settings.inventoryLocations.push(location);
    module.renderAll(); await settle();
    assertBindings(root);
    byId('chemical-open-add-btn').click(); await settle();
    check(byId('chemical-dialog-title').textContent === 'Add Chemical', 'Chemical dialog retains English by default');
    const name = input('chemical-name', 'I18N chemical <&>');
    input('chemical-cas', '7732-18-5'); select('chemical-location', rack);
    input('chemical-vendor', 'Vendor <&>'); input('chemical-catalog-number', 'CAT-01');
    input('chemical-unit-size', '500 mL'); input('chemical-price', '12.34 USD');
    input('chemical-stock', '10 mL'); input('chemical-url', 'https://example.invalid/reagent?x=1&y=2');
    input('chemical-expiration', '2027-03-15');
    name.focus(); name.setSelectionRange(2, 9);
    const form = byId('chemical-form'); const location = byId('chemical-location');
    const options = [...location.options].map(option => option.value);
    const sortValues = [...byId('chemical-sort').options].map(option => option.value);
    const snapshot = JSON.stringify(state); const syncCount = syncRequests.length;
    switchLocale();
    check(byId('chemical-dialog-title').textContent === 'Añadir sustancia química' && name.placeholder === '', 'Chemical dialog chrome translates without adding a field value');
    check(byId('chemical-form') === form && byId('chemical-name') === name && name.value === 'I18N chemical <&>'
      && document.activeElement === name && name.selectionStart === 2 && name.selectionEnd === 9, 'Chemical translation preserves draft nodes, focus, selection and names');
    check(location.value === rack && JSON.stringify([...location.options].map(option => option.value)) === JSON.stringify(options)
      && JSON.stringify([...byId('chemical-sort').options].map(option => option.value)) === JSON.stringify(sortValues), 'Location and sort option IDs remain canonical while labels translate');
    check(JSON.stringify(state) === snapshot && syncRequests.length === syncCount, 'Language switching never saves chemicals, audit records or SQLite snapshots');
    const notebook = byId('biology-notebook-result'); const oldNotebookDraft = notebook.value;
    notebook.value = 'Independent chemical-test notebook draft';
    save(); await settle();
    let chemical = state.labInventory.chemicals.find(item => item.name === 'I18N chemical <&>');
    check(Boolean(chemical) && byId('chemical-dialog-overlay').hidden, 'Saving a chemical in Spanish closes the dialog normally');
    const id = chemical.id; const code = chemical.locationCode;
    check(code.endsWith(String(casCodeNumber('7732-18-5'))) && chemical.casNumber === '7732-18-5' && chemical.location === rack, 'Chemical CAS-derived codes and location names stay canonical');
    check(chemical.price === '12.34 USD' && chemical.amountInStock === '10 mL' && chemical.expirationDate === '2027-03-15', 'Amounts, prices and date values are never translated');
    check(state.labInventory.blocks.at(-1).action === 'UPSERT_CHEMICAL' && state.labInventory.blocks.at(-1).payload.name === chemical.name, 'Audit action and payload names retain their original representation');
    const persisted = syncRequests.filter(request => request.mode === 'chemical').at(-1);
    check(persisted?.snapshot.labInventory.chemicals.some(item => item.id === id && item.locationCode === code), 'SQLite snapshots retain the original chemical fields and codes');
    check(notebook.value === 'Independent chemical-test notebook draft', 'Chemical save leaves another module’s draft intact');
    notebook.value = oldNotebookDraft;
    state.samples.push({ id: 'i18n-chemical-linked-sample', code: 'SAMPLE <&>', chemicalLinks: [id] }); module.renderAll(); await settle();
    const detail = byId('chemical-detail-content');
    check(byId('chemical-detail-title').textContent === chemical.name && !byId('chemical-detail-title').hasAttribute('data-i18n')
      && !detail.querySelector('img') && detail.textContent.includes('Muestras vinculadas') && detail.textContent.includes('SAMPLE <&>'), 'Chemical details translate labels while escaping names and preserving linked samples');
    const date = detail.querySelector('[data-i18n-date]');
    i18n.setLocale('en'); check(date.textContent === new Date(chemical.updatedAt).toLocaleString(), 'English chemical dates keep their original OS format');
    i18n.setLocale('es');
    const timestampOptions = JSON.parse(date.getAttribute('data-i18n-date-options'));
    check(timestampOptions.hour && timestampOptions.second
      && date.textContent === i18n.formatDate(new Date(chemical.updatedAt), timestampOptions), 'Chemical update dates retain their time of day in the active display locale');
    const immutable = JSON.stringify(state.labInventory); switchLocale();
    check(JSON.stringify(state.labInventory) === immutable, 'Chemical date/label updates cannot change audit hashes, values or records');

    byId('chemical-detail-edit-btn').click(); await settle();
    check(byId('chemical-dialog-title').textContent === 'Editar sustancia química' && location.value === rack, 'Existing chemical editing translates its distinct dialog title');
    input('chemical-vendor', 'Renamed vendor <&>'); name.focus(); name.setSelectionRange(1, 5); switchLocale();
    check(byId('chemical-id').value === id && name.value === chemical.name && byId('chemical-vendor').value === 'Renamed vendor <&>'
      && document.activeElement === name && name.selectionStart === 1, 'An open chemical edit retains its ID and unsaved values during translation');
    save(); await settle();
    check(state.labInventory.chemicals.find(item => item.id === id).vendor === 'Renamed vendor <&>'
      && state.labInventory.chemicals.find(item => item.id === id).locationCode === code, 'Translated editing updates the original chemical without changing its code');
    check(module.history.undo() && state.labInventory.chemicals.find(item => item.id === id).vendor === 'Vendor <&>', 'Chemical edit undo restores the saved record');
    check(module.history.redo() && state.labInventory.chemicals.find(item => item.id === id).vendor === 'Renamed vendor <&>', 'Chemical edit redo preserves its normal behavior');
    i18n.setLocale('es'); byId('chemical-detail-edit-btn').click(); await settle();
    input('chemical-name', 'Discard this chemical draft'); byId('chemical-cancel-btn').click(); switchLocale();
    check(state.labInventory.chemicals.find(item => item.id === id).name === 'I18N chemical <&>' && byId('chemical-dialog-title').textContent === 'Añadir sustancia química', 'Translated cancel discards changes and resets the title binding');
    const search = input('chemical-search', 'NO_MATCH_I18N_CHEMICAL');
    check(byId('chemical-list').textContent.includes('Ninguna sustancia química coincide') && byId('chemical-results-summary').textContent.includes('Mostrando 0'), 'Chemical search and count empty states translate');
    input('chemical-search', '7732-18-5'); select('chemical-filter-location', rack); select('chemical-sort', 'name_desc');
    search.focus(); search.setSelectionRange(1, 4); const row = byId('chemical-list').querySelector('[data-chemical-open="' + id + '"]'); switchLocale();
    check(row.isConnected && document.activeElement === search && search.value === '7732-18-5' && search.selectionStart === 1
      && byId('chemical-filter-location').value === rack && byId('chemical-sort').value === 'name_desc', 'Search/filter/sort choices and result nodes survive a locale change');
    input('chemical-search', ''); select('chemical-filter-location', ''); select('chemical-sort', 'name_asc');

    // Local CSV import maps known headers without any model or desktop parser.
    const headers = CHEMICAL_IMPORT_FIELDS.map(field => field.label);
    const incomingName = 'Imported "chemical", <&>';
    const importedCsv = csv([headers,
      ['I18N chemical <&>', '7732-18-5', rack, 'CSV vendor <&>', 'CSV-01', '250 mL', '9.50 USD', '20 mL', '', '2027-04-15'],
      [incomingName, '64-17-5', shelf, 'CSV supplier', 'CSV-02', '1 L', '15.00', '3 bottles', '', '2028-01-01'],
      ['', '', shelf, '', '', '', '', '', '', '']]);
    document.body.dataset.agentAvailability = 'offline';
    const inventoryBefore = JSON.stringify(state.labInventory);
    const selectedFile = upload(importedCsv); switchLocale();
    check(status.textContent === 'Leyendo chemicals<&>.csv...' && fileInput.files[0] === selectedFile
      && JSON.stringify(state.labInventory) === inventoryBefore, 'Reading status translates without replacing the selected import file or mutating records early');
    await waitFor(() => status.dataset.status === 'success'); await settle();
    chemical = state.labInventory.chemicals.find(item => item.id === id);
    const imported = state.labInventory.chemicals.find(item => item.name === incomingName);
    check(imported && chemical.vendor === 'CSV vendor <&>' && chemical.locationCode === code
      && imported.location === shelf && imported.expirationDate === '2028-01-01', 'CSV imports still merge by CAS and preserve canonical values/codes');
    check(status.textContent.startsWith('Se importaron 1 sustancias químicas nuevas y se actualizaron 1')
      && status.textContent.includes('Name -> Nombre') && status.textContent.includes('+2 más') && !status.querySelector('img'), 'Import results, target field labels and remaining counts translate while source headers stay literal');
    const importedSnapshot = JSON.stringify(state.labInventory); const resultNode = status.firstElementChild;
    switchLocale();
    check(resultNode.isConnected && status.textContent.includes('CAS Number -> Número CAS')
      && JSON.stringify(state.labInventory) === importedSnapshot, 'Completed mapping summaries update live without importing again');
    check(state.labInventory.blocks.at(-1).action === 'IMPORT_CHEMICALS'
      && state.labInventory.blocks.at(-1).payload.mappedColumns.some(item => item.field === 'casNumber' && item.header === 'CAS Number'), 'Import audit schemas and source headers stay canonical');

    // The presentation-only summary must retain the exact original English wording.
    const pure = { state, createId: () => 'unused' }; installImportRecords(pure);
    const inference = { decisions: CHEMICAL_IMPORT_FIELDS.map((field, index) => ({ field: field.key, header: 'Header ' + index, source: index === 1 ? 'llm' : 'local' })), llmError: 'Backend <&>' };
    const summaryHost = document.createElement('p'); const counts = { created: 2, updated: 3, skipped: 1 };
    i18n.setLocale('en'); summaryHost.innerHTML = buildChemicalImportResultMarkup(counts, inference, 'fixture<&>.csv');
    check(summaryHost.textContent === 'Imported 2 new and updated 3 chemicals from fixture<&>.csv. Skipped 1. Mapped '
      + pure.buildImportMappingSummary(inference) + '. LLM mapping unavailable: Backend <&>', 'Chemical import presentation preserves exact legacy English copy');
    i18n.setLocale('es');

    // Deferred header mapping tests locale changes while a simulated request is pending.
    let mappingRequest; let resolveMapping; let mappingCalls = 0;
    window.hikariApi.runDirectLlmPrompt = payload => { mappingCalls++; mappingRequest = payload; return new Promise(resolve => { resolveMapping = resolve; }); };
    document.body.dataset.agentAvailability = 'connected';
    upload(csv([['Name', 'Location', 'Unrecognized Column'], ['Fallback import <&>', rack, 'raw value']]));
    await waitFor(() => mappingCalls === 1); switchLocale();
    check(status.textContent === 'Asignando columnas de la hoja de cálculo...' && mappingCalls === 1, 'Header mapping progress translates without restarting the request');
    check(mappingRequest.moduleId === 'inventory' && mappingRequest.task === 'chemical-header-mapping'
      && mappingRequest.prompt.includes('"key":"casNumber"') && mappingRequest.prompt.includes('"label":"Name"'), 'Header mapping prompts retain English schema labels and canonical field keys');
    resolveMapping({ ok: false, error: 'Mapping backend detail <&>' });
    await waitFor(() => status.dataset.status === 'warning');
    check(state.labInventory.chemicals.some(item => item.name === 'Fallback import <&>')
      && status.textContent.includes('Asignación con LLM no disponible: Mapping backend detail <&>'), 'Mapping failure still imports locally and translates only the warning chrome');
    switchLocale(); check(status.textContent.includes('Mapping backend detail <&>') && !status.querySelector('img'), 'Backend mapping details remain literal across locale changes');
    document.body.dataset.agentAvailability = 'offline';
    restore('runDirectLlmPrompt', previous.direct);

    for (const [file, text, english] of [
      ['empty.csv', '', 'Import file needs a header row.'],
      ['headers.csv', 'Name,Location', 'Import file does not contain chemical rows.'],
      ['unknown.csv', 'Unknown,Other\na,b', 'Could not find a chemical name column.'],
      ['unavailable.xlsx', 'fixture', 'This build can only import Excel files through the desktop parser.']
    ]) {
      const savedInventory = JSON.stringify(state.labInventory); upload(text, file);
      await waitFor(() => status.dataset.status === 'error' && fileInput.files.length === 0);
      i18n.setLocale('en'); check(status.textContent === 'Import failed: ' + english, 'Local import errors retain exact English: ' + file);
      i18n.setLocale('es');
      check(status.textContent.startsWith('Error de importación:') && !status.textContent.includes(english)
        && JSON.stringify(state.labInventory) === savedInventory, 'Local import error details translate live without modifying records: ' + file); hideNotice();
    }
    window.hikariApi.parseChemicalImportFile = async () => ({ ok: false, error: 'Parser backend detail <&>' });
    upload('fixture', 'backend.csv'); await waitFor(() => status.dataset.status === 'error' && fileInput.files.length === 0); switchLocale();
    check(status.textContent === 'Error de importación: Parser backend detail <&>' && status.dataset.i18n === 'chemicals.import.failed', 'Parser backend errors replace older validation bindings and retain their original detail'); hideNotice();
    restore('parseChemicalImportFile', previous.parser);

    failSync = true;
    byId('chemical-list').querySelector('[data-chemical-open="' + id + '"]').click();
    byId('chemical-detail-edit-btn').click(); await settle(); input('chemical-stock', '11 mL'); save(); await settle();
    const toast = document.querySelector('[data-hikari-transient-toast]');
    check(toast?.textContent === 'No se pudo guardar el inventario de sustancias químicas en el archivo SQLite.', 'SQLite sync failures use translated local notices');
    switchLocale(); check(toast.textContent.includes('No se pudo guardar'), 'Active SQLite failure notices translate live'); hideNotice();
    failSync = false; module.renderAll(); await settle();
    const deletedId = imported.id;
    byId('chemical-list').querySelector('[data-chemical-open="' + deletedId + '"]').click(); byId('chemical-detail-delete-btn').click();
    check(!state.labInventory.chemicals.some(item => item.id === deletedId), 'Translated chemical delete removes the selected fixture record');
    check(module.history.undo() && state.labInventory.chemicals.some(item => item.id === deletedId), 'Chemical deletion remains undoable');
    i18n.setLocale('es'); module.renderAll(); await settle();
    check(state.samples.find(item => item.id === 'i18n-chemical-linked-sample').chemicalLinks.includes(id), 'Unrelated linked sample references survive chemical UI actions and history');
    assertBindings(root);
    window.qaI18nChemicals = { id, importedId: deletedId };
  } finally {
    restore('syncSqliteBundle', previous.sync); restore('parseChemicalImportFile', previous.parser); restore('runDirectLlmPrompt', previous.direct);
    document.body.dataset.agentAvailability = previous.availability;
    hideNotice();
  }
}
