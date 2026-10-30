// Real Plate setup/analyze controls with disposable renderer state.
export async function checkLocalizedPlate({ core, i18n, check }) {
  const module = core.moduleRuntime.modules.assay;
  const state = core.state;
  const byId = id => document.getElementById(id);
  const root = byId('assay-view');
  const settle = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
  const toast = () => document.querySelector('[data-hikari-transient-toast]');
  const params = node => JSON.parse(node.getAttribute('data-i18n-params') || '{}');
  const assertBindings = () => {
    for (const node of root.querySelectorAll('[data-i18n]')) {
      if (node.children.length || (node.matches('option') && !node.hasAttribute('value'))) continue;
      const key = node.dataset.i18n;
      check(i18n.has(key) && node.textContent === i18n.t(key, params(node)), 'Plate binding: ' + key);
    }
    for (const attribute of ['title', 'aria-label', 'placeholder', 'data-hover-caption', 'label']) {
      const binding = 'data-i18n-' + attribute.replace(/^data-/, '');
      for (const node of root.querySelectorAll('[' + binding + ']')) {
        const key = node.getAttribute(binding);
        check(node.getAttribute(attribute) === i18n.t(key, JSON.parse(node.getAttribute(binding + '-params') || node.getAttribute('data-i18n-params') || '{}')), 'Plate attribute binding: ' + key);
      }
    }
  };

  core.navigationShell.showView('assay-view'); i18n.setLocale('en');
  const assay = {
    id: 'i18n-plate', assayNumber: 'AS-I18N', name: 'Viability <&>', plateType: '96', plateLabel: '96 well',
    plateRows: 8, plateColumns: 12, wellCount: 96, sampleAxis: 'row', concentrationAxis: 'column', concentrationUnit: 'uM',
    sampleAxisValues: ['DMSO', 'Drug <&>'], concentrationAxisValues: ['10', '5', '2.5'], manualWellOverrides: {}, suppressedWells: [],
    resultValues: { A1: '100', A2: '80', A3: '60', B1: '90', B2: '50', B3: '20' }, updatedAt: new Date().toISOString()
  };
  state.assays.push(assay); module.history.persist(); module.render();
  root.querySelector('[data-assay-edit="i18n-plate"]').click(); await settle();
  // Save once through the real form so history holds a normalized record.
  byId('assay-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
  const preview = byId('assay-plate-preview');
  const wellA1 = preview.querySelector('td[data-well="A1"]');
  check(byId('assay-name').value === 'Viability <&>' && wellA1.title === 'A1 • Sample ID: DMSO | Conc.: 10 • Click to edit Sample ID',
    'English well tooltips keep their original wording and stored values: ' + byId('assay-name').value + ' / ' + wellA1?.title);
  check(preview.querySelector('thead th:nth-child(2)').textContent === 'Sample ID'
    && preview.querySelector('.assay-plate-editor-row th').textContent === 'Conc. (uM)', 'English plate axis headers keep the unit suffix');
  const option = [...byId('assay-plate-type').options].find(item => item.value === '96');
  check(option.textContent === '96 well' && root.querySelector('optgroup').label === 'Statistics', 'English options and option groups keep their text');
  assertBindings();

  // Unsaved Setup drafts and an active inline well edit survive language switches.
  const name = byId('assay-name'); name.value = 'Unsaved name <&>';
  const well = preview.querySelector('[data-well-inline-field][data-well="C4"]');
  well.value = 'NEW <&>'; well.focus(); well.setSelectionRange(1, 4);
  const notebook = byId('biology-notebook-result'); const notebookDraft = notebook.value; notebook.value = 'Independent notebook plate draft';
  const before = JSON.stringify(state.assays); i18n.setLocale('es');
  check(document.activeElement === well && well.isConnected && well.value === 'NEW <&>' && well.selectionStart === 1 && well.selectionEnd === 4
    && name.value === 'Unsaved name <&>' && notebook.value === 'Independent notebook plate draft' && JSON.stringify(state.assays) === before,
  'Language switching preserves the plate editor, drafts, focus, selection and saved assays');
  check(byId('assay-mode-create-btn').textContent === 'Configurar' && wellA1.isConnected
    && wellA1.title === 'A1 • ID de muestra: DMSO | Conc.: 10 • Haga clic para editar el ID de muestra', 'Plate grid tooltips translate live around stored values');
  check(well.placeholder === 'Muestra' && option.textContent === '96 pocillos' && root.querySelector('optgroup').label === 'Estadística',
    'Placeholders, plate types and method groups translate live');
  check(JSON.stringify([...byId('assay-analysis-kind').options].map(item => item.value)).includes('"plate_qc"'), 'Method option values stay canonical');
  notebook.value = notebookDraft; well.blur();

  // Setup statuses keep their binding until a later locale switch.
  byId('assay-dilution-factor').value = '';
  byId('assay-dilution-fill-btn').click();
  check(byId('assay-layout-status').textContent === 'Introduzca un factor de dilución positivo para rellenar las concentraciones.', 'Fill validation status translates');
  i18n.setLocale('en');
  check(byId('assay-layout-status').textContent === 'Enter a positive dilution factor to auto-fill concentrations.', 'Fill status switches back to its original English');
  byId('assay-dilution-factor').value = '2'; byId('assay-dilution-fill-btn').click(); i18n.setLocale('es');
  check(/^Se rellenaron 11 pasos de concentración con una dilución 1:2\.$/.test(byId('assay-layout-status').textContent), 'Fill result uses Spanish plurals: ' + byId('assay-layout-status').textContent);

  // The serial dilution dialog keeps a typed stock value across locale switches.
  byId('assay-serial-dilution-btn').click(); await settle();
  const dilution = byId('assay-serial-dilution-overlay'); const stock = dilution.querySelector('[data-assay-serial-stock-sample]');
  check(!dilution.hidden && byId('assay-serial-dilution-title').textContent === 'Dilución seriada'
    && dilution.querySelector('th').textContent === 'Muestra' && stock.placeholder === 'p. ej. 10 mM', 'Serial dilution dialog translates');
  const feedback = dilution.querySelector('.assay-serial-dilution-error');
  check(feedback?.textContent.trim() === 'DMSO: Introduzca una concentración de stock válida para esta muestra.', 'Dilution validation translates around the literal sample ID');
  stock.value = '20 mM'; i18n.setLocale('en');
  check(stock.isConnected && stock.value === '20 mM' && dilution.querySelector('th').textContent === 'Sample'
    && feedback.textContent.trim() === 'DMSO: Enter a valid stock concentration for this sample.', 'Dilution drafts survive translation');
  byId('assay-serial-dilution-close-btn').click(); i18n.setLocale('es');

  // Saving in Spanish stores literal names; undo/redo still restore them.
  name.value = 'Renamed <&>'; byId('assay-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
  check(state.assays.find(item => item.id === assay.id)?.name === 'Renamed <&>', 'Spanish Setup save keeps the literal assay name');
  const savedSummary = state.assays.find(item => item.id === assay.id)?.serialDilutionSummary;
  check(savedSummary?.feedbackMessages?.[0]?.text === 'DMSO: Enter a valid stock concentration for this sample.'
    && Object.keys(savedSummary.feedbackMessages[0]).join() === 'type,text', 'Saved dilution summaries stay canonical English without UI descriptors');
  check(module.history.undo() && state.assays.find(item => item.id === assay.id)?.name === 'Viability <&>', 'Plate undo restores the saved name');
  await settle();
  const redone = module.history.redo(); await settle();
  check(redone && state.assays.find(item => item.id === assay.id)?.name === 'Renamed <&>' && name.value === 'Renamed <&>',
    'Plate redo restores the rename: ' + redone + ' / ' + state.assays.find(item => item.id === assay.id)?.name + ' / ' + name.value); i18n.setLocale('es');
  check([...byId('assay-list').querySelectorAll('[data-assay-edit]')].some(node => node.getAttribute('aria-label') === 'Editar Renamed <&>'),
    'Assay list actions bind the literal assay name');
  assertBindings();

  // Analyze workspace chrome follows the selected method and the active locale.
  byId('assay-mode-results-btn').click();
  root.querySelector('[data-assay-results-select="i18n-plate"]').click(); await settle(60);
  const chartTitle = byId('assay-workspace-chart-title');
  check(byId('assay-workspace-title').textContent === 'Renamed <&>' && !byId('assay-workspace-title').hasAttribute('data-i18n'),
    'The workspace title shows the literal assay name without a translation binding');
  check(byId('assay-workspace-meta').textContent.startsWith('Placa de 96 pocillos')
    && byId('assay-workspace-chart-source').textContent === 'Resultados de la placa · Table1'
    && chartTitle.textContent === 'Estadística descriptiva', 'Analyze header, method and data source translate');
  i18n.setLocale('en');
  check(chartTitle.textContent === 'Summary statistics' && byId('assay-workspace-meta').textContent.startsWith('96-well plate'),
    'Analyze header returns to English live');
  i18n.setLocale('es');
  byId('assay-data-order-btn').click();
  check(byId('assay-data-order-btn').textContent === 'Gráfico primero', 'Data-order toggle translates');
  byId('assay-data-order-btn').click();
  byId('assay-analysis-add-row-group-btn').click();
  check(byId('assay-analysis-row-groups').value.startsWith('Row Group 1'), 'Group names stay canonical data in Spanish');
  byId('assay-analysis-clear-groups-btn').click();
  byId('assay-clear-results-btn').click(); await settle();
  check(toast()?.textContent === 'Se borraron todos los resultados.', 'Result notices translate: ' + toast()?.textContent);
  i18n.setLocale('en');
  check(toast()?.textContent === 'Cleared all result values.', 'An open notice switches language live');
  check(module.history.undo() && Object.keys(state.assays.find(item => item.id === assay.id)?.resultValues || {}).length === 6,
    'Undo restores results cleared in Spanish'); await settle();
  toast().hidden = true; i18n.setLocale('es'); assertBindings();
  window.qaI18nPlate = { assayId: assay.id };
}
