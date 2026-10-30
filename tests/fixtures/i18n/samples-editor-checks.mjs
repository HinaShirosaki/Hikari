// Real sample editors, file-input events and deferred clipboard IPC; no live files/clipboard.
export async function checkLocalizedSampleEditors({ core, i18n, check }) {
  const { SAMPLE_TYPE_FIELDS } = await import('../../../src/renderer/modules/personal-inventory/type-fields.js');
  const { containerToCsv } = await import('../../../src/renderer/modules/personal-inventory/csv-io.js');
  const { buildStructureClipboardNotFoundMessage } = await import('../../../src/renderer/lib/compound-structure.js');
  const { sampleClipboardMessage, sampleStatusMarkup } = await import('../../../src/renderer/modules/personal-inventory/localization.js');
  const module = core.moduleRuntime.modules.personalInventory;
  const { section, gridId, tubeId } = window.qaI18nSamples;
  const root = document.getElementById('sample-registry-view');
  const query = selector => root.querySelector(selector);
  const settle = () => new Promise(resolve => setTimeout(resolve, 25));
  const select = (selector, value) => { const node = query(selector); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); return node; };
  const status = () => query('.well-editor-status')?.textContent;
  const open = id => [...root.querySelectorAll('[data-container-open]')].find(node => node.dataset.containerOpen === id).click();
  const upload = text => {
    const input = query('[data-container-import-input]'); const files = new DataTransfer();
    files.items.add(new File([text], 'samples.csv', { type: 'text/csv' })); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  core.navigationShell.showView('sample-registry-view'); module.openSample('i18n-storage-sample'); i18n.setLocale('en');
  const savedBefore = JSON.stringify(core.state.samples);
  for (const [type, fields] of Object.entries(SAMPLE_TYPE_FIELDS)) {
    select('[data-well-sample-type]', type);
    for (const field of fields) {
      const control = query('[data-sample-detail="' + field.key + '"]');
      check(control.closest('label').querySelector('[data-i18n]').textContent === field.label, 'English sample field matches its canonical schema: ' + type + '.' + field.key);
      if (field.placeholder) check(control.placeholder === field.placeholder, 'English scientific example remains exact: ' + type + '.' + field.key);
      if (field.options) {
        const values = [...control.options].map(option => option.value); control.value = field.options.at(-1);
        i18n.setLocale('es');
        check(control.value === field.options.at(-1) && JSON.stringify([...control.options].map(option => option.value)) === JSON.stringify(values), 'Translated sample options preserve stored enum values: ' + field.key);
        i18n.setLocale('en');
      }
    }
  }
  check(JSON.stringify(core.state.samples) === savedBefore, 'Changing sample-field UI and language does not save records');
  select('[data-well-sample-type]', 'antibody'); select('[data-sample-detail="clonality"]', 'Polyclonal');
  const name = query('[data-well-sample-name]'); name.value = 'Sample draft <&>'; name.focus(); name.setSelectionRange(2, 8);
  const details = query('[data-sample-type-fields]'); const before = JSON.stringify(core.state); i18n.setLocale('es');
  check(name.isConnected && document.activeElement === name && name.selectionStart === 2 && name.selectionEnd === 8 && name.value === 'Sample draft <&>'
    && details.isConnected && query('[data-sample-detail="clonality"]').value === 'Polyclonal' && JSON.stringify(core.state) === before, 'Live sample editing preserves nodes, focus, draft, enum and storage');
  check(query('[data-sample-detail="clonality"]').selectedOptions[0].textContent === 'Policlonal'
    && query('[data-well-sample-save]').getAttribute('aria-label') === 'Guardar muestra', 'Sample options and icon accessibility labels translate');
  query('[data-well-sample-code]').value = 'QA-STORED'; query('[data-well-sample-save]').click();
  check(core.state.samples.find(item => item.id === 'i18n-storage-sample').details.clonality === 'Polyclonal' && status() === 'Muestra QA-STORED guardada.', 'Spanish sample save preserves canonical details and escapes code parameters');
  i18n.setLocale('en'); check(status() === 'Saved sample QA-STORED.', 'A saved sample status translates back live');
  check(module.history.undo(), 'Sample editor save remains undoable'); i18n.setLocale('es');
  check(core.state.samples.find(item => item.id === 'i18n-storage-sample').name === 'Stored sample <&>', 'Sample undo restores its original data');

  query('[data-well-index="1"]').click(); query('[data-well-sample-create]').click();
  check(status() === 'El nombre de la muestra es obligatorio.', 'New grid sample validation translates');
  core.state.samples.push({ id: 'qa-code-collision', code: 'QA-DUP', name: 'Collision', type: 'other', inventoryLink: { section, containerId: gridId, wellIndex: 14 } });
  query('[data-well-sample-new-name]').value = 'Created grid sample'; query('[data-well-sample-new-code]').value = 'QA-DUP';
  query('[data-well-sample-create]').click(); check(status() === 'El código de muestra QA-DUP ya existe.', 'Duplicate-code validation preserves the literal code');
  core.state.samples = core.state.samples.filter(item => item.id !== 'qa-code-collision');
  query('[data-well-sample-new-name]').value = 'Created grid sample'; query('[data-well-sample-new-code]').value = 'QA-GRID'; query('[data-well-sample-create]').click();
  const created = core.state.samples.find(item => item.code === 'QA-GRID');
  check(created?.inventoryLink.wellIndex === 1 && status() === 'Muestra QA-GRID creada.', 'Grid sample creation keeps its canonical link');
  query('[data-well-sample-clone]').click(); check(status() === 'Arrastre por los pocillos para rellenarlos con QA-GRID.', 'Fill instruction translates');
  const target = query('[data-well-index="2"]'); target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await settle();
  check(status() === 'Se ha clonado QA-GRID en 1 pocillo.' && core.state.samples.some(item => item.inventoryLink?.containerId === gridId && item.inventoryLink.wellIndex === 2 && item.id !== created.id), 'Clone plural status translates while cloned records retain distinct IDs');
  module.openSample(created.id); query('[data-well-sample-delete]').click();
  check(status() === 'Muestra QA-GRID eliminada.' && !core.state.samples.some(item => item.id === created.id), 'Grid sample delete and status work in Spanish');

  core.state.samples = core.state.samples.filter(item => item.id !== 'i18n-tube-sample'); open(tubeId);
  query('[data-single-sample-create]').click(); check(status() === 'El nombre de la muestra es obligatorio.', 'Single-container validation translates');
  query('[data-single-sample-new-name]').value = 'Tube sample <&>'; query('[data-single-sample-new-code]').value = 'QA-TUBE';
  select('[data-single-sample-new-type]', 'primer'); select('[data-sample-detail="direction"]', 'Reverse');
  query('[data-single-sample-create]').click(); const tubeSample = core.state.samples.find(item => item.code === 'QA-TUBE');
  check(tubeSample?.details.direction === 'Reverse' && tubeSample.inventoryLink.wellIndex === null && status() === 'Muestra QA-TUBE creada.', 'Single-container creation keeps enum values and null slot IDs');
  query('[data-single-sample-name]').value = 'Edited tube <&>'; query('[data-single-sample-save]').click();
  check(core.state.samples.find(item => item.id === tubeSample.id).name === 'Edited tube <&>' && status() === 'Muestra QA-TUBE guardada.', 'Single sample editing works with translated controls');

  const oldClipboard = window.hikariApi.readChemicalClipboard;
  try {
    let resolveClipboard; let calls = 0;
    window.hikariApi.readChemicalClipboard = () => { calls++; return new Promise(resolve => { resolveClipboard = resolve; }); };
    select('[data-single-sample-type]', 'chemical'); query('[data-inventory-sample-structure-paste]').click();
    const structureStatus = query('[data-inventory-sample-structure-status]');
    check(structureStatus.textContent === 'Leyendo estructura química del portapapeles...', 'Pending clipboard status translates');
    i18n.setLocale('en'); check(structureStatus.textContent === 'Reading chemical structure from clipboard...' && calls === 1, 'Locale switches do not restart clipboard requests');
    resolveClipboard({ candidates: [{ format: 'text/plain', source: 'CCO' }], formats: ['text/plain'] }); await settle();
    check(structureStatus.textContent === 'Structure saved for this sample.' && core.state.samples.find(item => item.id === tubeSample.id).compoundStructure.smiles === 'CCO', 'Structure capture keeps canonical SMILES and updates its bound status');
    i18n.setLocale('es'); check(structureStatus.textContent === 'Estructura guardada para esta muestra.' && query('[data-inventory-sample-structure-paste]').textContent === 'Reemplazar estructura', 'Completed structure status and replacement control translate live');
    query('[data-inventory-sample-structure-paste]').click();
    resolveClipboard({ candidates: [{ format: 'image/native', imageDataUrl: 'data:image/png;base64,AAAA' }], formats: ['public.png', 'public.png'] }); await settle();
    check(structureStatus.textContent.includes('Formatos del portapapeles detectados: public.png.'), 'Unsupported clipboard formats stay literal within translated feedback');
    i18n.setLocale('en'); check(structureStatus.textContent === buildStructureClipboardNotFoundMessage(['public.png']), 'English clipboard feedback retains exact canonical wording');
    for (const formats of [[], [' public.png ', 'public.png', 'text/plain']]) {
      const span = document.createElement('div'); span.innerHTML = sampleStatusMarkup(sampleClipboardMessage(formats));
      check(span.textContent === buildStructureClipboardNotFoundMessage(formats), 'Clipboard UI preserves English deduplication and whitespace behavior');
    }
  } finally {
    if (oldClipboard === undefined) delete window.hikariApi.readChemicalClipboard; else window.hikariApi.readChemicalClipboard = oldClipboard;
  }

  i18n.setLocale('es'); open(gridId); query('[data-well-index="0"]').click();
  upload('well,code,name,type\nW4,α-CSV-DUP,Imported <&>,primer\nW5,β-CSV-DUP,Second,protein\nW999,SKIP,Skipped,other'); await settle();
  check(status().startsWith('Se importaron 2 muestras (nuevas: 2, actualizadas: 0). Se omitió 1 fila') && status().includes('CSV-DUP →'), 'CSV counts, skipped-row plural and code-conflict explanation translate together: ' + status());
  i18n.setLocale('en'); check(status().startsWith('Imported 2 samples (2 new, 0 updated). Skipped 1 row') && status().includes(' Renamed codes that clashed'), 'English compound CSV result wording remains exact');
  const exported = containerToCsv(core.state.samples, section, core.state.inventory[section].find(item => item.id === gridId));
  i18n.setLocale('es'); check(containerToCsv(core.state.samples, section, core.state.inventory[section].find(item => item.id === gridId)) === exported, 'Sample translation does not change exported schema, fields or values');
  const anchorClick = HTMLAnchorElement.prototype.click; const createUrl = URL.createObjectURL; const revoke = URL.revokeObjectURL;
  let exportBlob; let filename;
  try {
    HTMLAnchorElement.prototype.click = function () { filename = this.download; };
    URL.createObjectURL = blob => { exportBlob = blob; return 'blob:qa-sample-export'; }; URL.revokeObjectURL = () => {};
    query('[data-container-export-csv]').click();
    check(filename.endsWith('-Box.csv') && (await exportBlob.text()).replace(/^\uFEFF/, '') === exported && status() === 'CSV de Box <&> exportado.', 'Translated CSV export keeps the existing filename and exact file contents');
  } finally { HTMLAnchorElement.prototype.click = anchorClick; URL.createObjectURL = createUrl; URL.revokeObjectURL = revoke; }
  module.openSample('i18n-storage-sample');
}
