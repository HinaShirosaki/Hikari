// Real storage-tree/dialog actions with disposable renderer state.
export async function checkLocalizedSamples({ core, i18n, check }) {
  const { createDefaultWells } = await import('../../../src/renderer/lib/inventory-containers.js');
  const { containerToCsv } = await import('../../../src/renderer/modules/personal-inventory/csv-io.js');
  const module = core.moduleRuntime.modules.personalInventory;
  const state = core.state;
  const byId = id => document.getElementById(id);
  const root = byId('sample-registry-view'); const nav = byId('inventory-location-nav');
  const menu = byId('inventory-container-context-menu'); const overlay = byId('inventory-add-container-overlay');
  const settle = () => new Promise(resolve => setTimeout(resolve, 25));
  const find = (attribute, value, host = root) => [...host.querySelectorAll('[' + attribute + ']')].find(node => node.getAttribute(attribute) === value);
  const context = node => node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 240 }));
  const submit = () => byId('inventory-add-container-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const field = (id, value) => { const node = byId(id); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); return node; };
  const assertBindings = () => {
    for (const node of root.querySelectorAll('[data-i18n]')) {
      if (node.children.length) continue;
      const key = node.dataset.i18n;
      check(i18n.has(key) && node.textContent === i18n.t(key, JSON.parse(node.getAttribute('data-i18n-params') || '{}')), 'Samples binding: ' + key);
    }
    for (const attribute of ['title', 'aria-label', 'placeholder', 'data-hover-caption']) {
      const binding = 'data-i18n-' + attribute.replace(/^data-/, '');
      for (const node of root.querySelectorAll('[' + binding + ']')) {
        const key = node.getAttribute(binding);
        check(node.getAttribute(attribute) === i18n.t(key, JSON.parse(node.getAttribute('data-i18n-params') || '{}')), 'Samples attribute binding: ' + key);
      }
    }
  };
  core.navigationShell.showView('sample-registry-view'); i18n.setLocale('en');
  const section = 'I18N Rack <&>'; const spareSection = 'I18N Empty <&>';
  state.settings.sampleInventoryLocations.push(section, spareSection);
  const grid = { id: 'i18n-sample-grid', name: 'Box <&>', type: 'customGrid', gridRows: 3, gridCols: 5 };
  grid.wells = createDefaultWells(grid); grid.wells[0].content = 'Stored well note <&>';
  const folder = { id: 'i18n-sample-folder', name: 'Folder <&>' }; grid.folderId = folder.id;
  const plate = { id: 'i18n-sample-plate', name: 'Plate <&>', type: 'plate96', wells: createDefaultWells('plate96') };
  const tube = { id: 'i18n-sample-tube', name: 'Tube <&>', type: 'single', wells: [], singleContent: '' };
  state.inventory[section] = [grid, plate, tube]; state.inventoryFolders[section] = [folder];
  state.samples.push({ id: 'i18n-storage-sample', code: 'SAMPLE <&>', name: 'Stored sample <&>', type: 'plasmid',
    lot: 'LOT-<&>', notes: 'User notes <&>', details: { backbone: 'pTEST' },
    inventoryLink: { section, containerId: grid.id, wellIndex: 0 }, chemicalLinks: [] });
  module.history.persist(); module.renderSections(); find('data-inventory-section', section, nav).click();
  find('data-container-open', grid.id, nav).click(); await settle(); assertBindings();
  check(nav.textContent.includes('3 containers · 1 folder') && root.querySelector('h4').textContent.includes('3 x 5 grid box'), 'English storage counts and custom grid labels retain their original text');
  check(root.querySelector('[data-well-index="0"]').title === 'W1: Stored well note <&> | Samples: SAMPLE <&> | Types: Plasmid', 'English well tooltip retains canonical sample and well values');
  const sampleRecord = state.samples.find(item => item.id === 'i18n-storage-sample');
  const csv = containerToCsv(state.samples, section, grid);
  const treeControl = find('data-container-open', grid.id, nav); const wellControl = root.querySelector('[data-well-index="0"]');
  const before = JSON.stringify(state); i18n.setLocale('es');
  check(JSON.stringify(state) === before && treeControl.isConnected && wellControl.isConnected, 'Language switching preserves records, selection, folder state and tree/grid controls');
  check(nav.textContent.includes('3 contenedores · 1 carpeta') && root.querySelector('h4').textContent.includes('Caja de 3 x 5 posiciones'), 'Storage counts and custom dimensions translate live');
  check(wellControl.title === 'W1: Stored well note <&> | Muestras: SAMPLE <&> | Tipos: Plasmid', 'Only well tooltip chrome translates; user content and sample vocabulary stay literal');
  check(containerToCsv(state.samples, section, grid) === csv, 'Display language never changes CSV headers, well IDs, type IDs or exported samples'); assertBindings();

  // Sample-editor copy is a later batch; its unsaved field must survive.
  wellControl.click(); const sampleName = root.querySelector('[data-well-sample-name]');
  sampleName.value = 'Independent unsaved sample draft <&>'; sampleName.focus(); sampleName.setSelectionRange(2, 9);
  const activeGrid = root.querySelector('.well-grid'); const fill = root.querySelector('[data-well-sample-clone]');
  const draftState = JSON.stringify(state); i18n.setLocale('en'); i18n.setLocale('es');
  check(sampleName.isConnected && sampleName.value === 'Independent unsaved sample draft <&>' && document.activeElement === sampleName
    && sampleName.selectionStart === 2 && sampleName.selectionEnd === 9 && activeGrid.isConnected && JSON.stringify(state) === draftState,
  'Storage translation preserves the sample editor draft, focus, selection and linked data');
  check(fill.getAttribute('aria-label') === 'Rellenar más pocillos con la muestra seleccionada.' && fill.dataset.hoverCaption === fill.getAttribute('aria-label'), 'Fill-well accessibility and hover instructions translate together');

  context(find('data-inventory-section', section, nav)); const blockedDelete = menu.querySelector('[data-location-context-delete]');
  check(blockedDelete.disabled && blockedDelete.title.startsWith('Mueva o elimine'), 'Populated-location delete guard has a translated explanation'); i18n.setLocale('en');
  check(blockedDelete.isConnected && blockedDelete.disabled && blockedDelete.title.startsWith('Move or remove'), 'An open translated menu preserves its disabled action');
  i18n.setLocale('es'); menu.querySelector('[data-location-context-add-folder]').click();
  check(!overlay.hidden && byId('inventory-add-container-title').textContent === 'Nueva carpeta', 'Location menu opens the translated folder dialog');
  check(byId('inventory-add-container-location').disabled && byId('inventory-add-container-location').value === section
    && byId('inventory-add-container-type-field').hidden && byId('inventory-add-container-type').disabled, 'Folder mode keeps its target location and hides physical container types');
  const folderName = field('inventory-add-container-name', 'Created folder <&>'); folderName.focus(); folderName.setSelectionRange(1, 7);
  const dialogNode = byId('inventory-add-container-form'); const options = [...byId('inventory-add-container-type').options].map(item => item.value);
  const notebook = byId('biology-notebook-result'); const notebookDraft = notebook.value; notebook.value = 'Independent notebook storage draft';
  const preSave = JSON.stringify(state); i18n.setLocale('en');
  check(byId('inventory-add-container-title').textContent === 'New Folder' && folderName.placeholder === 'e.g. Project Samples'
    && dialogNode.isConnected && document.activeElement === folderName && folderName.selectionStart === 1 && folderName.value === 'Created folder <&>'
    && JSON.stringify(state) === preSave, 'Folder dialog translation keeps form nodes, values, selection and unsaved state');
  i18n.setLocale('es'); submit(); await settle();
  const createdFolder = state.inventoryFolders[section].find(item => item.name === 'Created folder <&>');
  check(Boolean(createdFolder) && overlay.hidden && notebook.value === 'Independent notebook storage draft', 'Folder creation works in Spanish and preserves other module drafts'); notebook.value = notebookDraft;
  context(find('data-inventory-folder-context', createdFolder.id, nav)); menu.querySelector('[data-folder-context-add-folder]').click();
  check(byId('inventory-add-container-title').textContent === 'Nueva carpeta dentro' && byId('inventory-add-container-note').textContent === 'Crear una carpeta dentro de Created folder <&>.', 'Nested folder dialog binds its raw parent name safely');
  field('inventory-add-container-name', 'Nested folder <&>'); submit();
  const nestedFolder = state.inventoryFolders[section].find(item => item.name === 'Nested folder <&>');
  check(nestedFolder?.parentFolderId === createdFolder.id, 'Nested folder parent IDs remain canonical in Spanish');
  find('data-folder-add-container', nestedFolder.id, nav).click();
  check(byId('inventory-add-container-title').textContent === 'Añadir contenedor a la carpeta'
    && byId('inventory-add-container-note').textContent === 'Colocar este contenedor en Nested folder <&>.', 'Folder add control opens the correct translated container dialog');
  field('inventory-add-container-name', 'New box <&>'); field('inventory-add-container-type', 'customGrid');
  field('inventory-add-container-rows', '2'); field('inventory-add-container-cols', '4');
  const customFields = byId('inventory-add-container-grid-fields'); const customState = JSON.stringify(state); i18n.setLocale('en'); i18n.setLocale('es');
  check(!customFields.hidden && byId('inventory-add-container-rows').value === '2' && byId('inventory-add-container-cols').value === '4'
    && JSON.stringify([...byId('inventory-add-container-type').options].map(item => item.value)) === JSON.stringify(options)
    && JSON.stringify(state) === customState, 'Custom grid drafts and type IDs survive live translation without saving'); submit(); await settle();
  const createdBox = state.inventory[section].find(item => item.name === 'New box <&>');
  check(createdBox?.type === 'customGrid' && createdBox.gridRows === 2 && createdBox.gridCols === 4 && createdBox.folderId === nestedFolder.id
    && createdBox.wells.length === 8 && createdBox.wells[7].name === 'W8', 'Spanish container creation retains dimensions, folder link and canonical well names');
  check(module.history.undo() && !state.inventory[section].some(item => item.id === createdBox.id), 'Container creation undo removes the new container normally');
  check(module.history.redo() && state.inventory[section].some(item => item.id === createdBox.id), 'Container creation redo restores the original ID and dimensions'); i18n.setLocale('es');

  context(find('data-container-open', createdBox.id, nav)); menu.querySelector('[data-container-context-rename]').click();
  const rename = nav.querySelector('[data-folder-tree-rename-input]'); rename.value = 'Renamed box <&>'; rename.setSelectionRange(2, 8); i18n.setLocale('en');
  check(rename.getAttribute('aria-label') === 'Rename container' && rename.value === 'Renamed box <&>' && document.activeElement === rename
    && rename.selectionStart === 2 && rename.selectionEnd === 8, 'Inline rename updates its accessibility label without disturbing typing');
  i18n.setLocale('es'); rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check(state.inventory[section].find(item => item.id === createdBox.id)?.name === 'Renamed box <&>', 'Translated container rename saves the literal name');
  context(find('data-inventory-folder-context', nestedFolder.id, nav)); menu.querySelector('[data-folder-context-delete]').click();
  check(!state.inventoryFolders[section].some(item => item.id === nestedFolder.id)
    && state.inventory[section].find(item => item.id === createdBox.id)?.folderId === createdFolder.id, 'Folder deletion keeps and reparents its containers normally');
  context(find('data-container-open', createdBox.id, nav)); menu.querySelector('[data-container-context-delete]').click();
  check(!state.inventory[section].some(item => item.id === createdBox.id) && state.samples.some(item => item.id === sampleRecord.id), 'Container deletion preserves samples in other containers');
  check(module.history.undo() && state.inventory[section].some(item => item.id === createdBox.id), 'Container deletion undo restores it normally'); i18n.setLocale('es');
  context(find('data-inventory-section', spareSection, nav));
  check(!menu.querySelector('[data-location-context-delete]').disabled && menu.querySelector('[data-location-context-delete]').title === 'Eliminar ubicación', 'Empty location retains its enabled translated delete action');
  menu.querySelector('[data-location-context-delete]').click(); check(!state.settings.sampleInventoryLocations.includes(spareSection), 'Empty-location deletion uses the canonical name');
  find('data-container-open', plate.id, nav).click();
  check(root.querySelectorAll('.well').length === 96 && root.querySelector('.well').textContent.trim() === 'A1'
    && root.querySelector('[data-i18n="samples.container.plateHint"]').textContent.startsWith('Microplaca'), 'Plate instructions translate while all 96 well addresses stay canonical');
  find('data-container-open', tube.id, nav).click(); const preview = root.querySelector('.falcon-preview');
  check(preview.getAttribute('aria-label') === 'Tubo vacío', 'Empty single-container accessibility label translates');
  i18n.setLocale('en'); check(preview.getAttribute('aria-label') === 'Empty tube', 'Single-container English accessibility text returns live');
  state.samples.push({ id: 'i18n-tube-sample', name: 'Tube sample <&>', code: 'TUBE-<&>', type: 'protein', inventoryLink: { section, containerId: tube.id, wellIndex: null } });
  module.renderSections(); i18n.setLocale('es');
  check(root.querySelector('.falcon-preview').getAttribute('aria-label') === 'Relleno de muestra de tipo Protein', 'Occupied single-container label preserves sample vocabulary');
  check(module.openSample(sampleRecord.id), 'The linked sample remains available after storage undo and deletion'); i18n.setLocale('es');
  check(root.querySelector('h4').textContent.includes('Box <&>') && !root.querySelector('h4 img'), 'Storage names remain literal and escaped through translated actions'); assertBindings();
  window.qaI18nSamples = { section, gridId: grid.id, plateId: plate.id, tubeId: tube.id, folderId: createdFolder.id };
}
