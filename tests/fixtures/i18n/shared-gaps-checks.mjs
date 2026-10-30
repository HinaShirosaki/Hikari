// Real dialog/control markup and service, with isolated dirty editors and close IPC.
export async function checkLocalizedSharedGaps({ core, i18n, check }) {
  const { createUnsavedChangesService } = await import('../../../src/renderer/services/unsavedChangesService.js');
  const original = document.getElementById('unsaved-changes-overlay');
  const overlay = original.cloneNode(true); const nodes = new Map();
  for (const node of [overlay, ...overlay.querySelectorAll('[id]')]) { nodes.set(node.id, node); node.id = 'qa-' + node.id; }
  overlay.querySelector('[aria-labelledby]').setAttribute('aria-labelledby', 'qa-unsaved-changes-title');
  overlay.querySelector('[aria-describedby]').setAttribute('aria-describedby', 'qa-unsaved-changes-description');
  document.body.append(overlay);
  const byId = suffix => nodes.get('unsaved-changes-' + suffix);
  const dirty = { protocol: true, assay: true }; let pluginDirty = true;
  const responses = []; const saved = []; let reloads = 0; let failValidation = false; let saveError = ''; let flushError = '';
  let releaseSave; let delaySave = false;
  const sourceApi = key => ({ hasUnsavedChanges: () => Boolean(dirty[key]), saveUnsavedChanges: async () => {
    saved.push(key); if (delaySave) { delaySave = false; await new Promise(resolve => { releaseSave = resolve; }); }
    if (saveError) throw new Error(saveError); if (failValidation) return false; dirty[key] = false; return true;
  } });
  const service = createUnsavedChangesService({
    moduleRegistry: { get: key => key in dirty ? sourceApi(key) : null },
    externalSources: () => pluginDirty ? [{ key: 'plugin:qa', label: 'My Plugin <&>', moduleApi: {
      hasUnsavedChanges: () => pluginDirty, saveUnsavedChanges: async () => { pluginDirty = false; return true; }
    } }] : [],
    api: { respondToAppClose: action => responses.push(action) },
    flushPendingSaves: async () => { if (flushError) throw new Error(flushError); },
    documentObject: { getElementById: id => nodes.get(id), createElement: tag => document.createElement(tag), addEventListener: (...args) => overlay.addEventListener(...args) },
    windowObject: { addEventListener() {}, location: { reload: () => { reloads++; } } }
  });
  try {
    i18n.setLocale('en'); service.handleCloseRequested();
    check(byId('title').textContent === 'Save changes before quitting?' && byId('save-btn').textContent === 'Save 3 & Quit'
      && byId('discard-btn').textContent === 'Discard All & Quit', 'English shared quit dialog retains its title and action wording');
    const boxes = [...byId('list').querySelectorAll('input')]; boxes[1].checked = false; boxes[1].dispatchEvent(new Event('change'));
    const formRows = [...byId('list').children]; const focused = byId('save-btn'); focused.focus(); i18n.setLocale('es');
    check(byId('title').textContent === '¿Guardar los cambios antes de salir?' && byId('save-btn').textContent === 'Guardar 2 y salir'
      && document.activeElement === focused && formRows.every(node => node.isConnected) && !boxes[1].checked, 'Quit dialog translates live without changing focus, rows or save selection');
    check(byId('list').textContent === 'ProtocoloPlacaMy Plugin <&>' && !byId('list').querySelector('img'), 'Built-in editor labels translate while plugin names remain literal and escaped');
    delaySave = true; const saving = service.saveAndQuit();
    check(byId('status').textContent === 'Guardando Protocolo...' && byId('save-btn').disabled && boxes.every(node => node.disabled), 'Pending save status translates and all dialog controls stay locked');
    i18n.setLocale('en'); check(byId('status').textContent === 'Saving Protocol...' && saved.length === 1 && byId('save-btn').textContent === 'Saving...', 'Language changes do not duplicate a deferred save');
    releaseSave(); await saving;
    check(overlay.hidden && responses.at(-1) === 'quit' && !dirty.protocol && dirty.assay && !pluginDirty, 'Only checked sources save and the existing close handshake completes');

    await service.requestReload(); i18n.setLocale('es');
    check(byId('title').textContent === '¿Guardar los cambios antes de recargar?' && byId('save-btn').textContent === 'Guardar y recargar'
      && byId('discard-btn').textContent === 'Descartar y recargar', 'Reload reuses translated action-specific dialog text');
    failValidation = true; await service.saveAndQuit();
    check(byId('status').textContent === 'No se pudo guardar Placa. Compruebe los campos obligatorios e inténtelo de nuevo.' && reloads === 0 && !byId('save-btn').disabled,
      'Failed validation stays in the translated dialog without reloading');
    i18n.setLocale('en'); check(byId('status').textContent === 'Could not save Plate. Check the required fields and try again.', 'An existing validation failure switches back to exact English');
    failValidation = false; saveError = 'Backend detail <&>'; await service.saveAndQuit(); i18n.setLocale('es');
    check(byId('status').textContent === 'No se pudo guardar Placa: Backend detail <&>' && !byId('status').querySelector('img'), 'Raw save errors stay literal inside a translated message');
    saveError = ''; flushError = 'Disk fixture <&>'; await service.saveAndQuit();
    check(byId('status').textContent === 'No se pudo guardar en la carpeta de almacenamiento: Disk fixture <&>' && reloads === 0, 'Storage failures preserve the reload guard and backend detail');
    flushError = ''; await service.saveAndQuit(); check(overlay.hidden && reloads === 1, 'Retry still flushes storage before reloading');
    dirty.protocol = true; service.handleCloseRequested(); byId('cancel-btn').click();
    check(overlay.hidden && dirty.protocol && responses.at(-1) === 'cancel', 'Cancel preserves the unsaved editor');

    const more = document.getElementById('app-more-btn');
    if (more) {
      check(more.dataset.caption === 'Más módulos' && getComputedStyle(more, '::before').content.includes('Más módulos'), 'Dock overflow pseudo-element reads the translated caption');
      i18n.setLocale('en'); check(getComputedStyle(more, '::before').content.includes('More modules'), 'Dock overflow caption retains exact English');
    }
    const alignment = document.querySelector('.sequence-viewer-alignment-dialog');
    const workspace = alignment.closest('.sequence-viewer-alignment-workspace'); workspace.classList.add('is-file-drop-active');
    const activeView = document.body.dataset.activeView; core.navigationShell.showView('sequence-viewer-detail-view');
    i18n.setLocale('es'); check(getComputedStyle(alignment, '::after').content.includes('Suelte el archivo de secuencia para alinear'), 'DNA drag/drop pseudo-element translates without touching sequence values');
    i18n.setLocale('en'); check(getComputedStyle(alignment, '::after').content.includes('Drop sequence file to align'), 'DNA drag/drop caption retains its English wording');
    workspace.classList.remove('is-file-drop-active'); core.navigationShell.showView(activeView);
    window.qaI18nShared = { prepareCapture() { dirty.protocol = true; dirty.assay = true; pluginDirty = true; service.handleCloseRequested(); i18n.setLocale('es'); }, close() { byId('cancel-btn').click(); } };
  } catch (error) { overlay.remove(); throw error; }
}
