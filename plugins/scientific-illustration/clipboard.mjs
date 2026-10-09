import { createDocument, normalizeDocument, MAX_DOCUMENT_CHARS, record, fields, CANVASES } from './model.mjs';

export const CLIPBOARD_FORMAT = 'hikari.figura.components';

export function normalizeClipboard(raw, validateSvg) {
  record(raw, 'Copied components'); fields(raw, ['format', 'version', 'objects', 'groups']);
  if (raw.format !== CLIPBOARD_FORMAT || raw.version !== 1 || !Array.isArray(raw.objects) || !raw.objects.length) throw new Error('Invalid copied components.');
  const scene = normalizeDocument({ ...createDocument(), objects: raw.objects, groups: raw.groups }, validateSvg);
  if (new Set(scene.objects.map(object => object.canvas)).size !== 1) throw new Error('Copy components from one canvas at a time.');
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
export function installCanvasClipboard({ document, canHandle, getSelection, paste, validateSvg, status }) {
  let snapshot = null, pasted = 0, pasteEventSeen = false;
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
  document.addEventListener('copy', event => {
    if (!canHandle(event)) { snapshot = null; pasted = 0; return; }
    try {
      const value = capture(); if (!value) return;
      event.clipboardData?.setData('text/plain', JSON.stringify(value)); event.preventDefault(); status('Components copied');
    } catch (error) { status(error.message); }
  });
  document.addEventListener('paste', event => {
    if (!canHandle(event)) return;
    pasteEventSeen = true;
    const value = parseClipboard(event.clipboardData?.getData('text/plain'), validateSvg);
    if (!value) { snapshot = null; pasted = 0; return; }
    if (JSON.stringify(value) !== JSON.stringify(snapshot)) { snapshot = value; pasted = 0; }
    event.preventDefault(); insert(snapshot);
  });
  return {
    handleKey(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || !canHandle(event)) return false;
      const key = event.key.toLowerCase(); if (!['c', 'v'].includes(key)) return false;
      try {
        if (key === 'c') {
          if (!capture()) return false;
          event.preventDefault(); command('copy'); status('Components copied');
        } else {
          pasteEventSeen = false;
          command('paste');
          if (!pasteEventSeen) insert(snapshot);
          event.preventDefault();
        }
      } catch (error) { event.preventDefault(); status(error.message); }
      return true;
    }
  };
}
