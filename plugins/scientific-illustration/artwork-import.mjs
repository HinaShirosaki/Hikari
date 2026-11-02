import { createPresentation } from "./i18n.mjs";
const i18nUi = createPresentation("figura");
import { validateSvg } from './artwork.mjs';
import { encodeText } from './workspace.mjs';
import { prepareRaster, fitRasterBox } from './raster.mjs';

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
