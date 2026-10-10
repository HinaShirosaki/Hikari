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

export function initArtworkImport({ workspace, getCanvas, getIllustrationId, getSelected, select, showAssets, status }) {
  const $ = id => document.getElementById(id), dialog = $('raster-dialog'), preview = $('raster-preview');
  let picker, session, generation = 0, busy = false;
  function clear() {
    generation++; session = null; picker = null; busy = false;
    preview.removeAttribute('src');
  }
  function close() { clear(); if (dialog.open) dialog.close(); }
  dialog.addEventListener('close', () => { if (!dialog.open && session) clear(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('cancel-raster').addEventListener('click', close);
  function setBusy(value) {
    busy = value;
    for (const id of ['confirm-raster', 'cancel-raster', 'import-asset-name']) $(id).disabled = value;
  }
  async function present(next) {
    session = { ...next, token: ++generation }; const current = session;
    setBusy(false);
    $('raster-title').textContent = next.target === 'asset' ? 'Import asset' : next.replaceId ? 'Replace artwork' : 'Import artwork';
    $('confirm-raster').textContent = next.target === 'asset' ? 'Import asset' : next.replaceId ? 'Replace artwork' : 'Add artwork';
    $('import-asset-name-field').hidden = next.target !== 'asset';
    $('import-asset-name').required = next.target === 'asset'; $('import-asset-name').value = next.name;
    $('text-free-review').hidden = next.type === 'vector';
    $('text-free').required = next.type === 'raster'; $('text-free').checked = false;
    $('raster-dimensions').textContent = `${next.width} × ${next.height} px`;
    $('raster-error').textContent = ''; preview.src = next.dataUrl;
    if (!dialog.open) dialog.showModal();
    $('confirm-raster').disabled = true;
    try {
      await preview.decode();
      if (session !== current) return;
      $('confirm-raster').disabled = false;
      if (next.target === 'asset') $('import-asset-name').focus();
    } catch { if (session === current) $('raster-error').textContent = 'Could not load the artwork preview.'; }
  }
  function chooseFile(target, replaceId = '') {
    close();
    const document = workspace.getDocument(); if (!document) return status('The illustration is still opening.');
    picker = { target, illustrationId: getIllustrationId(), revision: document.revision, canvas: getCanvas(), replaceId,
      object: replaceId ? document.objects.find(object => object.id === replaceId) : null };
    $('asset-input').click();
  }
  $('import').addEventListener('click', () => chooseFile('canvas'));
  $('import-asset').addEventListener('click', () => chooseFile('asset'));
  $('replace-raster').addEventListener('click', () => { const object = getSelected(); if (object?.type === 'raster') chooseFile('canvas', object.id); });
  $('asset-input').addEventListener('change', async () => {
    const file = $('asset-input').files[0], intent = picker; $('asset-input').value = ''; picker = null;
    if (!file || !intent) return;
    const token = ++generation;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Artwork must be at most 5 MiB.');
      const mime = fileType(file); if (!mime) throw new Error('Import SVG, PNG, JPEG, or WebP artwork.');
      const name = intent.target === 'asset' ? file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Imported asset' : file.name.slice(0, 200);
      let next;
      if (mime === 'image/svg+xml') {
        if (intent.replaceId) throw new Error('Use PNG, JPEG, or WebP to replace raster artwork.');
        const svg = validateSvg(await file.text()), box = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
        next = { ...intent, type: 'vector', name, svg, dataUrl: `data:image/svg+xml;base64,${encodeText(svg)}`, width: box[2], height: box[3] };
      } else next = { ...intent, type: 'raster', name, ...await prepareRaster(await readDataUrl(file, mime)) };
      if (token !== generation || intent.illustrationId !== getIllustrationId()) return;
      await present(next);
    } catch (error) { if (token === generation) status(error.message); }
  });
  $('raster-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!session || busy || !event.target.reportValidity()) return;
    const current = session; setBusy(true); $('raster-error').textContent = '';
    try {
      const dataUrl = current.dataUrl;
      let result, id;
      if (current.target === 'asset') {
        result = await workspace.importAsset({ name: $('import-asset-name').value.trim(), type: current.type,
          ...(current.type === 'vector' ? { svg: current.svg } : { dataUrl, textFree: $('text-free').checked }) });
      } else {
        if (current.illustrationId !== getIllustrationId()) throw new Error('Another illustration is open. Import the artwork again.');
        const size = fitRasterBox(current.width, current.height, current.object?.width || 240);
        id = current.replaceId || `object-${crypto.randomUUID()}`;
        const content = current.type === 'vector' ? { svg: current.svg } : { dataUrl, textFree: $('text-free').checked };
        const operation = current.replaceId ? { op: 'update', id, patch: { ...content, ...size } }
          : { op: 'upsert', object: { id, name: current.name, type: current.type, canvas: current.canvas, x: 25, y: 25, ...size, ...content } };
        result = await workspace.request({ action: 'apply', illustration_id: current.illustrationId, expected_revision: current.revision, request_id: crypto.randomUUID(), operations: [operation] });
      }
      if (!result.ok) throw new Error(result.error);
      if (session !== current) return;
      close();
      if (current.target === 'asset') { $('asset-search').value = ''; showAssets(); status(result.reused ? 'This asset is already saved' : 'Asset imported'); }
      else { select(id); status('Artwork imported'); }
    } catch (error) { if (session === current) $('raster-error').textContent = error.message; }
    finally { if (session === current) setBusy(false); }
  });
  return { close };
}
