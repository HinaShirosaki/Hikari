import { createPresentation } from './i18n.mjs';
import { fitRasterBox, prepareRaster, validateSvg } from './artwork.mjs';
import { createDocument, normalizeDocument, MAX_DOCUMENT_CHARS, record, fields, CANVASES } from './model.mjs';

const i18nUi = createPresentation('figura');

export const CLIPBOARD_FORMAT = 'hikari.figura.components';

export function normalizeClipboard(raw, validateSvg) {
  record(raw, 'Copied components'); fields(raw, ['format', 'version', 'objects', 'groups']);
  if (raw.format !== CLIPBOARD_FORMAT || raw.version !== 1 || !Array.isArray(raw.objects) || !raw.objects.length) throw new Error('Invalid copied components.');
  const scene = normalizeDocument({ ...createDocument(), objects: raw.objects, groups: raw.groups }, validateSvg);
  return { format: CLIPBOARD_FORMAT, version: 1, objects: scene.objects, groups: scene.groups };
}

export function copyComponents(scene, ids, validateSvg) {
  const objects = scene.objects.filter(object => ids.includes(object.id));
  if (!ids.length || new Set(ids).size !== ids.length || objects.length !== ids.length) throw new Error('Select existing components to copy.');
  const groups = scene.groups.filter(group => group.ids.every(id => ids.includes(id)));
  return normalizeClipboard({ format: CLIPBOARD_FORMAT, version: 1, objects, groups }, validateSvg);
}

export function instantiateClipboard(raw, canvas, offset = 15, validateSvg) {
  const snapshot = normalizeClipboard(raw, validateSvg);
  if (!CANVASES.includes(canvas) || !Number.isFinite(offset) || offset < 0) throw new Error('Invalid paste destination.');
  // Keep the entire assembly rigid when its saved positions approach a limit.
  const dx = Math.min(offset, 16000 - Math.max(...snapshot.objects.map(object => object.x)));
  const dy = Math.min(offset, 16000 - Math.max(...snapshot.objects.map(object => object.y)));
  const ids = new Map(snapshot.objects.map(object => [object.id, `object-${crypto.randomUUID()}`]));
  const objects = snapshot.objects.map(object => ({ ...object, id: ids.get(object.id), canvas, x: object.x + dx, y: object.y + dy }));
  const groups = snapshot.groups.map(group => ({ ...group, id: `group-${crypto.randomUUID()}`, canvas, ids: group.ids.map(id => ids.get(id)) }));
  return { ids: objects.map(object => object.id), operations: [
    ...objects.map(object => ({ op: 'upsert', object })),
    ...groups.map(group => ({ op: 'group', id: group.id, name: group.name, ids: group.ids }))
  ] };
}

export function parseClipboard(text, validateSvg) {
  if (typeof text !== 'string' || text.length > MAX_DOCUMENT_CHARS) return null;
  try { return normalizeClipboard(JSON.parse(text), validateSvg); } catch { return null; }
}

// Native copy/paste events expose clipboard data without adding host permissions.
// The private snapshot also supports Ctrl shortcuts on macOS and hosts where
// a browser clipboard command is unavailable. Native text pastes take priority.
export function installCanvasClipboard({ document, canHandle, getSelection, getPasteContext = () => null, paste, readExternal, pasteExternal, validateSvg, status }) {
  let snapshot = null, pasted = 0, pasteEventSeen = false, pasteAttempt = 0;
  function command(action) {
    try { return document.execCommand(action); } catch { return false; }
  }
  function capture() {
    const { scene, ids } = getSelection();
    if (!scene || !ids.length) return null;
    snapshot = copyComponents(scene, ids, validateSvg); pasted = 0;
    return snapshot;
  }
  function insert(value) {
    if (!value) return;
    const offset = (++pasted) * 15;
    void paste(value, offset).catch(error => status(error.message));
  }
  function insertReadClipboard(data = null, fallback = false, attempt = pasteAttempt) {
    // Invoke the reader now so it captures DataTransfer while it is readable.
    // Native reads happen only in response to Paste, never in the background.
    const context = getPasteContext(), pending = readExternal?.(data);
    if (!pending) { if (fallback) insert(snapshot); return; }
    void Promise.resolve(pending).then(async clipboard => {
      if (attempt !== pasteAttempt || context !== getPasteContext() || !canHandle({ target: document.activeElement })) return;
      if (!clipboard) { if (fallback) insert(snapshot); return; }
      const value = parseClipboard(clipboard.text, validateSvg);
      if (value) {
        if (JSON.stringify(value) !== JSON.stringify(snapshot)) { snapshot = value; pasted = 0; }
        insert(value); return;
      }
      snapshot = null; pasted = 0;
      await pasteExternal?.(clipboard);
    }).catch(error => { if (attempt === pasteAttempt) status(error.message); });
  }
  document.addEventListener('copy', event => {
    if (!canHandle(event)) { snapshot = null; pasted = 0; return; }
    try {
      const value = capture(); if (!value) return;
      event.clipboardData?.setData('text/plain', JSON.stringify(value)); event.preventDefault(); status('Components copied');
    } catch (error) { status(error.message); }
  });
  document.addEventListener('paste', event => {
    if (!canHandle(event)) return;
    pasteAttempt++;
    pasteEventSeen = true;
    const value = parseClipboard(event.clipboardData?.getData('text/plain'), validateSvg);
    if (!value) {
      snapshot = null; pasted = 0;
      if (readExternal) { event.preventDefault(); insertReadClipboard(event.clipboardData); }
      return;
    }
    if (JSON.stringify(value) !== JSON.stringify(snapshot)) { snapshot = value; pasted = 0; }
    event.preventDefault(); insert(snapshot);
  });
  function copy() {
    if (!canHandle({ target: document.activeElement })) return false;
    try {
      if (!capture()) return false;
      command('copy'); status('Components copied'); return true;
    } catch (error) { status(error.message); return false; }
  }
  function pasteSelection(nativeKey = false) {
    if (!canHandle({ target: document.activeElement })) return false;
    const attempt = ++pasteAttempt;
    pasteEventSeen = false;
    command('paste');
    if (!pasteEventSeen) {
      const fallback = () => { if (attempt === pasteAttempt && !pasteEventSeen) insertReadClipboard(null, true, attempt); };
      // execCommand can be refused in the sandbox. Let the trusted keyboard
      // action deliver its real paste event before trying the host fallback.
      if (nativeKey) (document.defaultView || globalThis).setTimeout(fallback, 0);
      else fallback();
    }
    return pasteEventSeen;
  }
  return {
    copy, paste: () => { pasteSelection(); return true; },
    handleKey(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || !canHandle(event)) return false;
      const key = event.key.toLowerCase(); if (!['c', 'v'].includes(key)) return false;
      try {
        if (key === 'c') {
          if (!copy()) return false;
          event.preventDefault();
        } else {
          if (pasteSelection(true)) event.preventDefault();
        }
      } catch (error) { event.preventDefault(); status(error.message); }
      return true;
    }
  };
}

const toDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read the pasted structure.')); reader.readAsDataURL(file);
});

export async function readChemicalClipboard(hikari, data = null) {
  // Capture DataTransfer synchronously; Chromium can clear it after the event.
  const text = data?.getData('text/plain') || '';
  // Only text that is itself an SVG document; rejected Figura JSON also contains "<svg".
  const localSvg = data?.getData('image/svg+xml') || (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text) ? text : '');
  const formats = [...(data?.types || [])];
  const files = [...(data?.files || [])].filter(file => file.type.startsWith('image/'));
  let native = null, nativeError = '';
  try { native = await hikari.call('clipboard.readChemical'); } catch (error) {
    // Native paste events can still supply an image on an older host or when
    // an existing install has not granted the optional native reader access.
    nativeError = String(error?.message || error);
  }
  const local = await Promise.all(files.map(file => {
    if (file.size > 9 * 1024 * 1024) throw new Error('The pasted structure image is too large. Copy a smaller selection.');
    return toDataUrl(file);
  }));
  if (!data && !native && !nativeError) return null;
  return { text: text || native?.text || '', images: [...new Set([...(native?.images || []), ...local])],
    vectors: [...(native?.vectors || []), ...(localSvg ? [{ svg: localSvg, source: 'svg' }] : [])], vectorError: native?.vectorError || '',
    formats: [...new Set([...(native?.formats || []), ...formats])], nativeError };
}

export function prepareChemicalVector(source) {
  if (typeof source !== 'string' || source.length > 3000000) throw new Error('The vector structure is too large.');
  // ChemDraw SVG exports may include the standard SVG public doctype. It has
  // no role in the drawing; reject entities/internal subsets before removing it.
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('SVG entities are not supported.');
  const svg = validateSvg(source.replace(/<!DOCTYPE[^>]*>/gi, ''), { chemical: true });
  const box = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  return { type: 'vector', svg, width: box[2], height: box[3] };
}

export async function prepareChemicalImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 12000000
    || !/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml)[;,]/i.test(dataUrl)) throw new Error('The clipboard has no supported structure image.');
  if (/^data:image\/svg\+xml[;,]/i.test(dataUrl)) {
    const comma = dataUrl.indexOf(','), header = dataUrl.slice(0, comma);
    const source = /;base64/i.test(header) ? new TextDecoder().decode(Uint8Array.from(atob(dataUrl.slice(comma + 1)), c => c.charCodeAt(0)))
      : decodeURIComponent(dataUrl.slice(comma + 1));
    return prepareChemicalVector(source);
  }
  const image = await new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the pasted structure image.')); image.src = dataUrl;
  });
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height || width * height > 64000000) throw new Error('Structure images must be at most 64 megapixels.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(image, 0, 0);
  const png = canvas.toDataURL('image/png');
  if (png.length > 7000000) throw new Error('The pasted structure image is too large. Copy a smaller selection.');
  return prepareRaster(png, { trim: true });
}

export function chemicalStructureSnapshot(image, canvas, offset = 0) {
  const requestedWidth = Math.min(image.width, 360, canvas.width * .6, canvas.height * .6 * image.width / image.height);
  const size = fitRasterBox(image.width, image.height, requestedWidth);
  return { format: CLIPBOARD_FORMAT, version: 1, groups: [], objects: [{
    id: 'pasted-structure', name: 'Chemical structure', type: image.svg ? 'vector' : 'raster', canvas: 'main',
    x: Math.max(0, Math.min(canvas.width - size.width, (canvas.width - size.width) / 2 + offset)),
    y: Math.max(0, Math.min(canvas.height - size.height, (canvas.height - size.height) / 2 + offset)),
    ...size, ...(image.svg ? { svg: image.svg } : { dataUrl: image.dataUrl, textFree: false }), chemicalStructure: true
  }] };
}

export function createCanvasClipboard({ document, hikari, workspace, getContext, isInteracting, select, status }) {
  return installCanvasClipboard({ document, validateSvg, status,
    canHandle: event => {
      const target = event.target?.closest ? event.target : document.activeElement;
      return Boolean(getContext().state) && !isInteracting() && !document.querySelector('dialog[open], #canvas-crop-overlay')
        && !target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
        && !target?.isContentEditable;
    },
    getSelection() {
      const { state, selectedIds } = getContext();
      return { scene: state, ids: [...selectedIds] };
    },
    getPasteContext: () => getContext().illustrationId,
    readExternal: data => {
      const illustrationId = getContext().illustrationId;
      return readChemicalClipboard(hikari, data).then(clipboard => clipboard && ({ ...clipboard, illustrationId }));
    },
    pasteExternal: async clipboard => {
      if (!clipboard.images?.length && !clipboard.vectors?.length) {
        if (clipboard.vectorError) { status(clipboard.vectorError); return; }
        if (clipboard.nativeError) {
          status(i18nUi.text("Clipboard access is unavailable in this Hikari install. Copy the structure as an image and use Edit → Paste."));
        } else if (clipboard.formats?.some(format => /chemical|chemdraw|cambridge|cdx|molfile/i.test(format))) {
          status(i18nUi.text("The clipboard has structure data but no image preview. In ChemDraw, copy the structure as an image and paste again."));
        }
        return;
      }
      if (clipboard.illustrationId !== getContext().illustrationId) return;
      let image;
      const candidates = [...(clipboard.vectors || []), ...(clipboard.images || [])];
      for (const candidate of candidates) {
        // Do not flatten a vector payload, even if a lower-quality image preview
        // is also present. Molecular labels are part of the original SVG.
        try { image = typeof candidate === 'string' ? await prepareChemicalImage(candidate) : prepareChemicalVector(candidate.svg); break; }
        catch (error) { if (candidate === candidates.at(-1)) throw error; }
      }
      if (clipboard.illustrationId !== getContext().illustrationId) return;
      const { state, illustrationId } = getContext();
      const snapshot = chemicalStructureSnapshot(image, state.canvases.main);
      const result = await workspace.paste(snapshot, { illustrationId, canvas: 'main', offset: 0 });
      if (!result.ok) { status(result.error); return; }
      if (clipboard.illustrationId === getContext().illustrationId) select(result.pasted_ids, { reveal: false });
      status(image.svg ? i18nUi.text("Chemical structure pasted as vector artwork")
        : i18nUi.text("Chemical structure pasted as an image. Copy as SVG or PDF in ChemDraw for vector quality."));
    },
    paste: async (snapshot, offset) => {
      const id = getContext().illustrationId, canvas = 'main';
      const result = await workspace.paste(snapshot, { illustrationId: id, canvas, offset });
      if (!result.ok) { status(result.error); return; }
      if (id === getContext().illustrationId) select(result.pasted_ids, { reveal: false });
      status(i18nUi.text("Components pasted"));
    }
  });
}
