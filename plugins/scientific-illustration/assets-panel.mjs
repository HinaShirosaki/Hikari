import { createPresentation } from './i18n.mjs';
import { cropRasterPatch, fitRasterBox, prepareRaster, validateSvg } from './artwork.mjs';
import { oneOffImageStyle } from './figure-settings.mjs';
import { encodeText } from './library.mjs';
import { icon } from './workspace-tools.mjs';

const i18nUi = createPresentation('figura');

export function initAssetsPanel({ workspace, getSelection, getCanvas, getIllustrationId, selectCopies, showAssets, sendToChat, status }) {
  const $ = id => document.getElementById(id), cache = new Map();
  let library, saveSelection, inspectedId;
  // Details live in a docked pane so they never cover the canvas or neighbouring tiles.
  function inspect(entry, row) {
    const changed = entry.id !== inspectedId, preview = row.querySelector('.asset-preview').src;
    inspectedId = entry.id;
    $('saved-assets').querySelector('.is-inspected')?.classList.remove('is-inspected');
    row.classList.add('is-inspected');
    if (preview || changed) $('asset-dock-preview').src = preview;
    i18nUi.setText($('asset-dock').querySelector('.asset-name'), entry.name);
    $('asset-dock').querySelector('.asset-summary').textContent = entry.description || '';
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target, id = image.dataset.assetPreview;
      observer.unobserve(image);
      if (!cache.has(id)) cache.set(id, workspace.request({ action: 'asset_render', asset_id: id }).then(result => {
        if (!result.ok) throw new Error(result.error);
        return result.previews[0].data_url;
      }).catch(error => { cache.delete(id); throw error; }));
      void cache.get(id).then(url => {
        if (!image.isConnected) return;
        image.src = url; if (id === inspectedId) $('asset-dock-preview').src = url;
      }).catch(() => { image.hidden = true; });
    }
  }, { root: $('saved-assets') });
  async function insert(entry, button) {
    const illustrationId = getIllustrationId(), canvas = getCanvas(); button.disabled = true;
    try {
      const current = workspace.getDocument(), dimensions = current.canvases[canvas];
      // Keep native size unless the component would crowd the destination.
      const scale = Math.min(1, dimensions.width * .7 / entry.width, dimensions.height * .7 / entry.height);
      const result = await workspace.request({ action: 'apply', illustration_id: illustrationId, expected_revision: current.revision, request_id: crypto.randomUUID(),
        operations: [{ op: 'insert_asset', asset_id: entry.id, canvas, width: entry.width * scale }] });
      if (!result.ok) throw new Error(result.error);
      selectCopies(result.inserted_assets[0].ids); status(i18nUi.text("Inserted {p0}", { p0: entry.name }));
    } catch (error) { status(error.message); }
    finally { button.disabled = false; }
  }
  function render(next = library) {
    if (!next) return;
    library = next; observer.disconnect();
    const focused = document.activeElement?.closest('[data-saved-asset]');
    const focusedId = focused?.dataset.savedAsset, action = document.activeElement?.dataset.assetAction;
    const query = $('asset-search').value.trim().toLowerCase();
    const entries = library.reusable_assets.filter(asset => `${asset.name}\n${asset.description || ''}`.toLowerCase().includes(query));
    $('saved-assets').replaceChildren();
    for (const id of cache.keys()) if (!library.reusable_assets.some(asset => asset.id === id)) cache.delete(id);
    for (const entry of entries) {
      const row = document.createElement('div'); row.className = 'saved-asset'; row.dataset.savedAsset = entry.id; row.setAttribute('role', 'listitem');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'asset-insert'; button.dataset.assetAction = 'insert';
      i18nUi.setAttribute(button, "aria-label", i18nUi.message("Insert {p0}", { p0: entry.name }));
      button.setAttribute('aria-describedby', 'asset-dock-text');
      const image = document.createElement('img'); image.className = 'asset-preview'; image.alt = entry.name; image.dataset.assetPreview = entry.id;
      button.append(image); button.addEventListener('click', () => void insert(entry, button));
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'icon-button asset-edit'; edit.dataset.assetAction = 'edit';
      const editLabel = { i18nKey: 'figura.assets.editDetails', i18nParams: { name: entry.name } };
      i18nUi.setAttribute(edit, 'title', editLabel); i18nUi.setAttribute(edit, 'aria-label', editLabel); edit.append(icon('info'));
      edit.addEventListener('click', () => openSave({ asset_id: entry.id, expected_assets_revision: library.assets_revision }, entry.name, entry.description));
      row.append(button, edit);
      row.addEventListener('pointerenter', () => inspect(entry, row));
      row.addEventListener('focusin', () => inspect(entry, row));
      $('saved-assets').append(row); observer.observe(image);
    }
    const inspected = entries.find(entry => entry.id === inspectedId) || entries[0];
    $('asset-dock').hidden = !inspected;
    if (inspected) inspect(inspected, $('saved-assets').querySelector(`[data-saved-asset="${inspected.id}"]`));
    // The hint only explains how to fill an empty library.
    $('assets-hint').hidden = library.reusable_assets.length > 0;
    i18nUi.setText($('assets-hint'), i18nUi.message("Import artwork, or right-click components and choose Save as an asset."));
    $('assets-empty').hidden = entries.length > 0;
    i18nUi.setText($('assets-empty'), (library.reusable_assets.length ? i18nUi.message("No assets match your search.") : i18nUi.message("Your reusable components will appear here.")));
    if (focusedId && action) ($('saved-assets').querySelector(`[data-saved-asset="${focusedId}"] [data-asset-action="${action}"]`) || $('asset-search')).focus({ preventScroll: true });
  }
  $('asset-search').addEventListener('input', () => render());
  function openSave(intent, name, description = '') {
    saveSelection = intent;
    i18nUi.setText($('save-asset-title'), intent.asset_id ? { i18nKey: 'figura.assets.details', i18nParams: {} } : i18nUi.message('Save reusable component'));
    $('asset-name').value = name; $('asset-description').value = description;
    i18nUi.setText($('asset-save-error'), '');
    $('remove-asset').hidden = !intent.asset_id;
    if (intent.asset_id) { i18nUi.setAttribute($('remove-asset'), "title", i18nUi.message("Remove {p0} from Assets", { p0: name })); $('remove-asset').setAttribute('aria-label', $('remove-asset').title); }
    $('save-asset-dialog').showModal(); $('asset-name').focus(); $('asset-name').select();
  }
  function save() {
    const selection = getSelection(); if (!selection?.ids.length) return;
    openSave({ ids: [...selection.ids], illustration_id: getIllustrationId(), expected_revision: workspace.getDocument().revision }, selection.name);
  }
  $('cancel-save-asset').addEventListener('click', () => $('save-asset-dialog').close());
  $('remove-asset').addEventListener('click', async () => {
    const button = $('remove-asset'); button.disabled = true;
    try {
      const result = await workspace.manageAsset('asset_delete', { asset_id: saveSelection.asset_id });
      if (!result.ok) throw new Error(result.error);
      $('save-asset-dialog').close(); $('asset-search').focus();
    } catch (error) { i18nUi.setOwnedText($('asset-save-error'), error.message); }
    finally { button.disabled = false; }
  });
  $('save-asset-dialog').addEventListener('close', () => { saveSelection = null; });
  $('save-asset-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!saveSelection || $('confirm-save-asset').disabled) return;
    const button = $('confirm-save-asset'); button.disabled = true;
    try {
      const details = { name: $('asset-name').value, description: $('asset-description').value };
      const updating = Boolean(saveSelection.asset_id);
      const result = updating
        ? await workspace.request({ action: 'asset_update', ...saveSelection, ...details, request_id: crypto.randomUUID() })
        : await workspace.manageAsset('asset_save', { ...saveSelection, ...details });
      if (!result.ok) throw new Error(result.error);
      $('save-asset-dialog').close(); showAssets();
      status(updating ? i18nUi.value({ i18nKey: 'figura.assets.detailsSaved', i18nParams: {} }) : i18nUi.text("Asset saved for future illustrations"));
    } catch (error) { i18nUi.setOwnedText($('asset-save-error'), error.message); }
    finally { button.disabled = false; }
  });
  const savedStyle = () => workspace.getDocument().imageGenerationStyle.preset;
  $('generate-asset').addEventListener('click', () => {
    $('generate-asset-error').textContent = ''; $('generate-asset-style').value = savedStyle();
    $('generate-asset-dialog').showModal(); $('generate-asset-description').focus();
  });
  $('cancel-generate-asset').addEventListener('click', () => $('generate-asset-dialog').close());
  $('generate-asset-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('confirm-generate-asset'); button.disabled = true;
    try {
      const description = $('generate-asset-description').value.trim().replace(/[.\s]+$/, '');
      if (!description) throw new Error('Describe the component to generate.');
      await sendToChat(`Generate a reusable asset: ${description}.${oneOffImageStyle($('generate-asset-style').value, savedStyle())}`);
      $('generate-asset-dialog').close(); $('generate-asset-description').value = '';
      status('Codex is generating the asset. It appears in Assets once saved.');
    } catch (error) { $('generate-asset-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  return { render, save, closeSave: () => $('save-asset-dialog').close() };
}

const fileType = file => {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return 'image/svg+xml';
  if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return file.type;
  if (!file.type) return /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : '';
  return '';
};
const readDataUrl = (file, type) => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read the selected file.'));
  reader.readAsDataURL(new Blob([file], { type }));
});
async function readItem(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Artwork must be at most 5 MiB.');
  const mime = fileType(file), name = file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Imported artwork';
  if (mime !== 'image/svg+xml') return { type: 'raster', name, ...await prepareRaster(await readDataUrl(file, mime)) };
  const svg = validateSvg(await file.text()), box = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  return { type: 'vector', name, svg, dataUrl: `data:image/svg+xml;base64,${encodeText(svg)}`, width: box[2], height: box[3] };
}

export function initArtworkImport({ workspace, getCanvas, getIllustrationId, select, showAssets, status }) {
  const $ = id => document.getElementById(id), dialog = $('raster-dialog'), shell = $('raster-preview-shell');
  let picker, session, generation = 0, busy = false;
  function clear() {
    generation++; session = null; picker = null; busy = false;
    shell.replaceChildren();
  }
  function close() { clear(); if (dialog.open) dialog.close(); }
  dialog.addEventListener('close', () => { if (!dialog.open && session) clear(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('cancel-raster').addEventListener('click', close);
  function setBusy(value) {
    busy = value;
    for (const id of ['confirm-raster', 'cancel-raster', 'import-asset-name']) $(id).disabled = value;
  }
  async function present(next, skipped) {
    session = { ...next, token: ++generation }; const current = session, { items } = next, single = items.length === 1;
    setBusy(false);
    const assetLabel = single ? i18nUi.message("Import asset") : i18nUi.message("Import {count} assets", { count: items.length });
    i18nUi.setText($('raster-title'), next.target === 'asset' ? assetLabel : i18nUi.message("Import artwork"));
    i18nUi.setText($('confirm-raster'), next.target === 'asset' ? assetLabel : i18nUi.message("Add artwork"));
    $('import-asset-name-field').hidden = next.target !== 'asset' || !single;
    $('import-asset-name').required = next.target === 'asset' && single; $('import-asset-name').value = items[0].name;
    const raster = items.some(item => item.type === 'raster');
    $('text-free-review').hidden = !raster; $('text-free').required = raster; $('text-free').checked = false;
    i18nUi.setText($('raster-text-free-label'), single ? i18nUi.message("I inspected this image and it contains no text. Labels belong in separate text layers.")
      : i18nUi.message("I inspected these images and they contain no text. Labels belong in separate text layers."));
    i18nUi.setText($('raster-dimensions'), single ? `${items[0].width} × ${items[0].height} px` : i18nUi.message("{count} files", { count: items.length }));
    i18nUi.setOwnedText($('raster-error'), skipped.join('\n'));
    shell.classList.toggle('is-grid', !single);
    const previews = items.map(item => {
      const image = document.createElement('img'); image.src = item.dataUrl; image.title = item.name;
      i18nUi.setAttribute(image, 'alt', i18nUi.message("Artwork preview")); return image;
    });
    shell.replaceChildren(...previews);
    if (!dialog.open) dialog.showModal();
    $('confirm-raster').disabled = true;
    try {
      await Promise.all(previews.map(image => image.decode()));
      if (session !== current) return;
      $('confirm-raster').disabled = false;
      if (next.target === 'asset' && single) $('import-asset-name').focus();
    } catch { if (session === current) i18nUi.setText($('raster-error'), i18nUi.message("Could not load the artwork preview.")); }
  }
  // Dropped, picked or folder files all open one review dialog. Unsupported
  // files are skipped so a folder can hold notes or other formats.
  async function openFiles(files, target, at) {
    close();
    const document = workspace.getDocument(); if (!document) return status(i18nUi.text("The illustration is still opening."));
    const intent = { target, illustrationId: getIllustrationId(), revision: document.revision, canvas: getCanvas(), at }, token = generation;
    const supported = [...files].filter(fileType), items = [], skipped = [];
    if (!supported.length) return status(i18nUi.text("Import SVG, PNG, JPEG, or WebP artwork."));
    // ponytail: every preview stays in memory until the dialog closes; stream the import if huge folders matter.
    for (const file of supported) {
      try { items.push(await readItem(file)); } catch (error) { skipped.push(`${file.name}: ${error.message}`); }
      if (token !== generation || intent.illustrationId !== getIllustrationId()) return;
    }
    if (!items.length) return status(skipped[0]);
    await present({ ...intent, items }, skipped);
  }
  function chooseFiles(input, target) {
    picker = target;
    input.click();
  }
  for (const [input, button, target] of [[$('asset-input'), 'import', 'canvas'], [$('asset-input'), 'import-asset', 'asset'], [$('asset-folder-input'), 'import-asset-folder', 'asset']]) {
    $(button).addEventListener('click', () => chooseFiles(input, target));
  }
  for (const input of [$('asset-input'), $('asset-folder-input')]) input.addEventListener('change', () => {
    const files = [...input.files], target = picker; input.value = ''; picker = null;
    if (files.length && target) void openFiles(files, target);
  });
  const stage = $('main-canvas'), hasFiles = event => event.dataTransfer?.types.includes('Files');
  stage.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; stage.classList.add('is-file-drop');
  });
  stage.addEventListener('dragleave', event => { if (!stage.contains(event.relatedTarget)) stage.classList.remove('is-file-drop'); });
  stage.addEventListener('drop', event => {
    stage.classList.remove('is-file-drop');
    if (!hasFiles(event)) return;
    event.preventDefault();
    const svg = stage.querySelector('svg'), at = svg && new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    void openFiles(event.dataTransfer.files, 'canvas', at && { x: at.x, y: at.y });
  });
  $('raster-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!session || busy || !event.target.reportValidity()) return;
    const current = session, textFree = $('text-free').checked; setBusy(true); i18nUi.setText($('raster-error'), '');
    const content = item => item.type === 'vector' ? { svg: item.svg } : { dataUrl: item.dataUrl, textFree };
    try {
      if (current.target === 'asset') {
        const failed = []; let imported = 0;
        for (const [index, item] of current.items.entries()) {
          if (current.items.length > 1) status(i18nUi.text("Importing {p0} of {p1}…", { p0: index + 1, p1: current.items.length }));
          const name = current.items.length === 1 ? $('import-asset-name').value.trim() : item.name;
          const result = await workspace.importAsset({ name, type: item.type, ...content(item) });
          if (session !== current) return;
          if (result.ok) imported++; else failed.push(`${item.name}: ${result.error}`);
        }
        if (!imported) throw new Error(failed.join('\n'));
        close(); $('asset-search').value = ''; showAssets();
        status(failed.length ? i18nUi.text("Imported {p0} of {p1} assets. {p2}", { p0: imported, p1: current.items.length, p2: failed.join(' ') })
          : current.items.length > 1 ? i18nUi.text("{count} assets imported", { count: imported }) : i18nUi.text("Asset imported"));
        return;
      }
      if (current.illustrationId !== getIllustrationId()) throw new Error('Another illustration is open. Import the artwork again.');
      // Dropped artwork centres on the drop point; later files cascade down and right.
      const operations = current.items.map((item, index) => {
        const size = fitRasterBox(item.width, item.height, 240), offset = index * 20;
        const x = current.at ? current.at.x - size.width / 2 + offset : 25 + offset, y = current.at ? current.at.y - size.height / 2 + offset : 25 + offset;
        return { op: 'upsert', object: { id: `object-${crypto.randomUUID()}`, name: item.name, type: item.type, canvas: current.canvas, x, y, ...size, ...content(item) } };
      });
      const result = await workspace.request({ action: 'apply', illustration_id: current.illustrationId, expected_revision: current.revision, request_id: crypto.randomUUID(), operations });
      if (!result.ok) throw new Error(result.error);
      if (session !== current) return;
      close(); select(operations.map(operation => operation.object.id)); status(i18nUi.text("Artwork imported"));
    } catch (error) { if (session === current) i18nUi.setOwnedText($('raster-error'), error.message); }
    finally { if (session === current) setBusy(false); }
  });
  return { close };
}

// Crop the selected source in the active canvas. Persist only after Apply;
// the figure keeps its original rotation, stretch, and pixel placement.
export function initCanvasCrop({ workspace, getSelected, getCanvas, getIllustrationId, onStart, onActiveChange, select, status }) {
  const $ = id => document.getElementById(id);
  let session, generation = 0;
  function close({ focus = true } = {}) {
    generation++;
    if (!session) return;
    const current = session; session = null;
    current.observer?.disconnect(); current.cropper?.destroy(); current.overlay.remove(); current.stage.inert = current.inert; current.stage.classList.remove('is-cropping');
    onActiveChange(false, focus);
  }
  function layout(current) {
    const stage = current.stage.getBoundingClientRect(), parent = current.stage.parentElement.getBoundingClientRect();
    Object.assign(current.overlay.style, { left: `${stage.left - parent.left}px`, top: `${stage.top - parent.top}px`, width: `${stage.width}px`, height: `${stage.height}px` });
  }
  function syncFields(current) {
    if (session !== current || !current.cropper?.ready) return;
    const crop = current.cropper.getData(true);
    for (const key of ['x', 'y', 'width', 'height']) current.overlay.querySelector(`[data-crop-field="${key}"]`).value = crop[key];
    i18nUi.setText(current.overlay.querySelector('[data-crop-size]'), `${crop.width} × ${crop.height} px`);
  }
  async function apply() {
    const current = session; if (!current || current.saving || !current.cropper?.ready) return;
    const error = current.overlay.querySelector('[data-crop-error]'); i18nUi.setText(error, '');
    try {
      // Enter in a numeric field commits its value before applying the crop.
      const values = {};
      for (const key of ['width', 'height', 'x', 'y']) {
        const input = current.overlay.querySelector(`[data-crop-field="${key}"]`);
        if (!input.reportValidity() || !Number.isFinite(input.valueAsNumber)) return;
        values[key] = input.valueAsNumber;
      }
      current.cropper.setData(values);
      const crop = current.cropper.getData(true), patch = cropRasterPatch(current.object, current.raster, crop);
      const canvas = current.cropper.getCroppedCanvas({ width: crop.width, height: crop.height, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
      if (!canvas?.width || !canvas.height) throw new Error('Select a visible area to crop.');
      current.saving = true; current.cropper.disable();
      for (const control of current.overlay.querySelectorAll('button, input')) control.disabled = true;
      const result = await workspace.request({ action: 'apply', illustration_id: current.illustrationId, expected_revision: current.revision, request_id: crypto.randomUUID(),
        operations: [{ op: 'update', id: current.object.id, patch: { ...patch, dataUrl: canvas.toDataURL('image/png'), textFree: true } }] });
      if (!result.ok) throw new Error(result.error);
      if (session === current) { close(); select(current.object.id); status(i18nUi.text("Artwork cropped")); }
    } catch (failure) { if (session === current) i18nUi.setText(error, failure.message); }
    finally {
      if (session === current) {
        current.saving = false; current.cropper.enable();
        for (const control of current.overlay.querySelectorAll('button, input')) control.disabled = false;
      }
    }
  }
  async function start() {
    if (session) { if (!session.saving) close(); return; }
    const object = getSelected(); if (object?.type !== 'raster') return;
    const token = ++generation, illustrationId = getIllustrationId(), revision = workspace.getDocument().revision, canvas = getCanvas();
    try {
      const raster = await prepareRaster(object.dataUrl);
      if (token !== generation || illustrationId !== getIllustrationId() || revision !== workspace.getDocument().revision || object.id !== getSelected()?.id) return;
      if (typeof window.Cropper !== 'function') throw new Error('The bundled cropper could not load.');
      onStart();
      const stage = $(`${canvas}-canvas`), overlay = document.createElement('section'); overlay.className = 'canvas-crop-overlay'; overlay.id = 'canvas-crop-overlay';
      i18nUi.setAttribute(overlay, "aria-label", i18nUi.message("Crop {p0}", { p0: object.name }));
      overlay.innerHTML = `<div class="canvas-crop-heading"><strong data-crop-name></strong><button id="canvas-crop-reset" type="button">${i18nUi.html("Reset")}</button><button id="canvas-crop-cancel" type="button">${i18nUi.html("Cancel")}</button><button id="canvas-crop-apply" class="primary-button" type="button">${i18nUi.html("Apply crop")}</button></div>
        <div class="canvas-crop-image"><img id="canvas-crop-preview" data-i18n-alt="figura.full.6ae492" alt="Selected artwork crop preview"></div>
        <div class="canvas-crop-fields" role="group" data-i18n-aria-label="figura.full.d64f4317" aria-label="Crop in pixels">
          <label>X<input data-crop-field="x" type="number" min="0" step="1"></label><label>Y<input data-crop-field="y" type="number" min="0" step="1"></label>
          <label>${i18nUi.html("Width")}<input data-crop-field="width" type="number" min="1" step="1"></label><label>${i18nUi.html("Height")}<input data-crop-field="height" type="number" min="1" step="1"></label>
        </div><div class="canvas-crop-note"><span>${i18nUi.html("Drag the handles to crop.")}</span><span data-crop-size role="status"></span></div><p data-crop-error role="alert"></p>`;
      i18nUi.setText(overlay.querySelector('[data-crop-name]'), i18nUi.message("Crop {p0}", { p0: object.name }));
      const current = { object, raster, illustrationId, revision, canvas, stage, overlay, inert: stage.inert, saving: false };
      session = current; stage.inert = true; stage.classList.add('is-cropping'); stage.parentElement.append(overlay); layout(current); onActiveChange(true, false);
      current.observer = new ResizeObserver(() => { if (session === current) layout(current); }); current.observer.observe(stage);
      const image = $('canvas-crop-preview'); image.src = raster.dataUrl;
      $('canvas-crop-cancel').addEventListener('click', () => close());
      $('canvas-crop-apply').addEventListener('click', () => void apply());
      $('canvas-crop-reset').addEventListener('click', () => { current.cropper?.reset(); syncFields(current); });
      await image.decode(); if (session !== current) return;
      current.cropper = new window.Cropper(image, { viewMode: 1, autoCropArea: 1, dragMode: 'crop', zoomable: false, movable: false,
        rotatable: false, scalable: false, checkOrientation: false, toggleDragModeOnDblclick: false,
        ready: () => { syncFields(current); if (session === current) $('canvas-crop-apply').focus({ preventScroll: true }); }, crop: () => syncFields(current) });
      for (const input of overlay.querySelectorAll('[data-crop-field]')) input.addEventListener('change', () => {
        if (current.cropper?.ready && input.checkValidity() && Number.isFinite(input.valueAsNumber)) current.cropper.setData({ [input.dataset.cropField]: input.valueAsNumber });
        syncFields(current);
      });
    } catch (error) { if (token === generation) { close({ focus: false }); status(error.message); } }
  }
  $('crop-raster').addEventListener('click', () => void start());
  return {
    close,
    onDocumentChange(document, id) {
      if (!session) return;
      if (id !== session.illustrationId || getCanvas() !== session.canvas || getSelected()?.id !== session.object.id
        || document.revision !== session.revision && !session.saving) {
        close({ focus: false }); status(i18nUi.text("Crop canceled because the illustration changed."));
      }
    },
    handleKey(event) {
      if (!session) return false;
      if (event.key === 'Escape') { event.preventDefault(); if (!session.saving) close(); }
      if (event.key === 'Enter') { event.preventDefault(); void apply(); }
      return true;
    }
  };
}
