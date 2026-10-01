// Scene data is shared by manual controls and the agent. Artwork and labels
// never share a layer. DOM validation of SVG happens in artwork.mjs.
import { COMPLEXITY_LEVELS, DEFAULT_COMPLEXITY } from './complexity.mjs';
export const CANVASES = ['main', 'scratch'];
export const MAX_DOCUMENT_CHARS = 12000000;
export const OBJECT_FIELDS = ['id', 'name', 'type', 'canvas', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'svg', 'dataUrl', 'textFree', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'align', 'anchor', 'italic', 'underline', 'fill', 'stroke', 'strokeWidth'];
export const TEXT_FIELDS = ['text', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'align', 'anchor', 'italic', 'underline'];
const clone = value => JSON.parse(JSON.stringify(value));

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function fields(value, allowed) {
  const invalid = Object.keys(value).find(key => !allowed.includes(key));
  if (invalid) throw new Error(`Unknown field: ${invalid}.`);
}
function number(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be ${min}–${max}.`);
  return value;
}
function string(value, label, limit) {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label} must be a string of at most ${limit} characters.`);
  return value;
}
function choice(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label} must be one of ${choices.join(', ')}.`);
  return value;
}
export function color(value, allowNone = false) {
  if ((allowNone && value === 'none') || /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) return value;
  throw new Error('Use a hex color (#rrggbb or #rrggbbaa).');
}
export function createDocument() {
  return { version: 1, revision: crypto.randomUUID(), title: 'Untitled figure', complexity: DEFAULT_COMPLEXITY,
    canvases: { main: { width: 1200, height: 800, background: '#ffffff' }, scratch: { width: 500, height: 350, background: '#ffffff' } },
    objects: [], receipts: [] };
}
export function normalizeObject(raw, validateSvg = value => value) {
  record(raw, 'Object'); fields(raw, OBJECT_FIELDS);
  const type = choice(raw.type, ['vector', 'raster', 'text'], 'type');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(raw.id || '')) throw new Error('Object id must be 1–100 letters, numbers, underscores or hyphens.');
  const result = { id: raw.id, name: string(raw.name ?? raw.id, 'name', 200), type,
    canvas: choice(raw.canvas ?? 'main', CANVASES, 'canvas'),
    x: number(raw.x ?? 0, 'x', -16000, 16000), y: number(raw.y ?? 0, 'y', -16000, 16000),
    width: number(raw.width ?? 200, 'width', 1, 8000), height: number(raw.height ?? 100, 'height', 1, 8000),
    rotation: number(raw.rotation ?? 0, 'rotation', -360, 360), opacity: number(raw.opacity ?? 1, 'opacity', 0, 1), visible: raw.visible ?? true };
  if (typeof result.visible !== 'boolean') throw new Error('visible must be boolean.');
  if (type === 'vector') {
    for (const key of ['dataUrl', 'textFree', ...TEXT_FIELDS]) if (key in raw) throw new Error(`${key} is not a vector property.`);
    result.svg = validateSvg(string(raw.svg, 'svg', 300000));
    if (!result.svg.trim()) throw new Error('Vector objects need a text-free SVG.');
    if (raw.fill !== undefined) result.fill = color(raw.fill, true);
    if (raw.stroke !== undefined) result.stroke = color(raw.stroke, true);
    if (raw.strokeWidth !== undefined) result.strokeWidth = number(raw.strokeWidth, 'strokeWidth', 0, 50);
  } else if (type === 'raster') {
    for (const key of ['svg', 'fill', 'stroke', 'strokeWidth', ...TEXT_FIELDS]) if (key in raw) throw new Error(`${key} is not a raster property.`);
    const dataUrl = string(raw.dataUrl, 'dataUrl', 7000000);
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error('Raster objects need embedded PNG, JPEG or WebP bytes.');
    if (raw.textFree !== true) throw new Error('Confirm raster artwork is text-free with textFree: true. Put labels in text objects.');
    result.dataUrl = dataUrl; result.textFree = true;
  } else {
    for (const key of ['svg', 'dataUrl', 'textFree', 'fill', 'stroke', 'strokeWidth']) if (key in raw) throw new Error(`${key} is not a text property.`);
    Object.assign(result, { text: string(raw.text ?? 'Label', 'text', 3000), fontFamily: string(raw.fontFamily ?? 'Arial', 'fontFamily', 100),
      fontSize: number(raw.fontSize ?? 24, 'fontSize', 4, 300), fontWeight: number(raw.fontWeight ?? 400, 'fontWeight', 100, 900),
      color: color(raw.color ?? '#222222'), align: choice(raw.align ?? 'start', ['start', 'middle', 'end'], 'align'),
      anchor: choice(raw.anchor ?? 'top', ['top', 'middle', 'bottom'], 'anchor'), italic: raw.italic ?? false, underline: raw.underline ?? false });
    if (typeof result.italic !== 'boolean' || typeof result.underline !== 'boolean') throw new Error('italic and underline must be boolean.');
  }
  return result;
}
export function normalizeCanvas(raw) {
  record(raw, 'Canvas'); fields(raw, ['width', 'height', 'background']);
  return { width: number(raw.width, 'Canvas width', 64, 8000), height: number(raw.height, 'Canvas height', 64, 8000), background: color(raw.background) };
}
export function normalizeDocument(raw, validateSvg) {
  record(raw, 'Document');
  if (raw.version !== 1 || !Array.isArray(raw.objects) || raw.objects.length > 200) throw new Error('Unsupported document or too many objects (maximum 200).');
  const objects = raw.objects.map(obj => normalizeObject(obj, validateSvg));
  if (new Set(objects.map(obj => obj.id)).size !== objects.length) throw new Error('Object IDs must be unique across both canvases.');
  const result = { version: 1, revision: string(raw.revision, 'revision', 100), title: string(raw.title, 'title', 200),
    complexity: choice(raw.complexity ?? DEFAULT_COMPLEXITY, COMPLEXITY_LEVELS, 'complexity'),
    canvases: Object.fromEntries(CANVASES.map(key => [key, normalizeCanvas(raw.canvases?.[key])])), objects, receipts: (raw.receipts || []).slice(-64) };
  if (JSON.stringify(result).length > MAX_DOCUMENT_CHARS) throw new Error('The illustration is too large. Use smaller raster assets.');
  return result;
}
export function validateRequest(args) {
  record(args, 'Request'); fields(args, ['action', 'canvas', 'include_assets', 'expected_revision', 'request_id', 'operations', 'visible']);
  choice(args.action, ['read', 'render', 'apply', 'scratch'], 'action');
  if (args.action === 'scratch') {
    fields(args, ['action', 'visible']);
    if (typeof args.visible !== 'boolean') throw new Error('Scratch requires visible: true or false.');
    return args;
  }
  if (args.visible !== undefined) throw new Error('visible is only supported by the scratch action.');
  if (args.canvas !== undefined) choice(args.canvas, [...CANVASES, 'both'], 'canvas');
  if (args.include_assets !== undefined && typeof args.include_assets !== 'boolean') throw new Error('include_assets must be boolean.');
  if (args.action === 'apply') {
    if (!args.expected_revision || !args.request_id) throw new Error('Apply requires expected_revision and request_id. Read the canvas first.');
    string(args.expected_revision, 'expected_revision', 100); string(args.request_id, 'request_id', 100);
    if (!Array.isArray(args.operations) || !args.operations.length || args.operations.length > 100) throw new Error('Apply needs 1–100 operations.');
  } else if (args.operations !== undefined || args.request_id !== undefined || args.expected_revision !== undefined) throw new Error('Read/render do not accept mutation fields.');
  return args;
}
export function applyOperations(document, operations, validateSvg) {
  const next = clone(document);
  for (const operation of operations) {
    record(operation, 'Operation');
    fields(operation, ['op', 'object', 'id', 'patch', 'canvas', 'ids', 'copy', 'new_id', 'title', 'complexity']);
    if (operation.op === 'upsert') {
      const object = normalizeObject(operation.object, validateSvg);
      const index = next.objects.findIndex(item => item.id === object.id);
      if (index < 0) next.objects.push(object); else next.objects[index] = object;
    } else if (operation.op === 'update') {
      const index = next.objects.findIndex(item => item.id === operation.id);
      if (index < 0) throw new Error(`Object ${operation.id} does not exist.`);
      record(operation.patch, 'patch');
      if (['id', 'type'].some(key => key in operation.patch)) throw new Error('Update preserves id and type.');
      const updated = { ...next.objects[index], ...operation.patch };
      for (const key of ['fill', 'stroke', 'strokeWidth']) if (updated.type === 'vector' && operation.patch[key] === null) delete updated[key];
      next.objects[index] = normalizeObject(updated, validateSvg);
    } else if (operation.op === 'delete') {
      if (!next.objects.some(item => item.id === operation.id)) throw new Error(`Object ${operation.id} does not exist.`);
      next.objects = next.objects.filter(item => item.id !== operation.id);
    } else if (operation.op === 'transfer') {
      const object = next.objects.find(item => item.id === operation.id);
      if (!object) throw new Error(`Object ${operation.id} does not exist.`);
      const canvas = choice(operation.canvas, CANVASES, 'canvas');
      if (operation.copy) {
        if (!operation.new_id || next.objects.some(item => item.id === operation.new_id)) throw new Error('Copy requires an unused new_id.');
        next.objects.push(normalizeObject({ ...object, id: operation.new_id, canvas }, validateSvg));
      } else object.canvas = canvas;
    } else if (operation.op === 'canvas') {
      const key = choice(operation.canvas, CANVASES, 'canvas');
      next.canvases[key] = normalizeCanvas({ ...next.canvases[key], ...record(operation.patch, 'patch') });
    } else if (operation.op === 'order') {
      const key = choice(operation.canvas, CANVASES, 'canvas');
      const objects = next.objects.filter(obj => obj.canvas === key);
      if (!Array.isArray(operation.ids) || operation.ids.length !== objects.length || new Set(operation.ids).size !== objects.length || operation.ids.some(id => !objects.some(obj => obj.id === id))) throw new Error('Order must list every object on that canvas exactly once, back to front.');
      next.objects = [...next.objects.filter(obj => obj.canvas !== key), ...operation.ids.map(id => objects.find(obj => obj.id === id))];
    } else if (operation.op === 'title') next.title = string(operation.title, 'title', 200);
    else if (operation.op === 'complexity') next.complexity = choice(operation.complexity, COMPLEXITY_LEVELS, 'complexity');
    else throw new Error(`Unknown operation: ${operation.op}.`);
  }
  next.revision = crypto.randomUUID();
  return normalizeDocument(next, validateSvg);
}
export function readDocument(document, includeAssets = false) {
  const result = clone(document); delete result.receipts;
  if (!includeAssets) result.objects = result.objects.map(object => {
    if (object.type !== 'raster') return object;
    const { dataUrl, ...metadata } = object;
    return { ...metadata, assetBytes: Math.floor(dataUrl.length * 0.75) };
  });
  return result;
}
