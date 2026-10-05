// Scene data is shared by manual controls and the agent. Artwork and labels
// never share a layer. DOM validation of SVG happens in artwork.mjs.
import { COMPLEXITY_LEVELS, DEFAULT_COMPLEXITY } from './complexity.mjs';
import { imageGenerationPercent } from './image-generation.mjs';
import { normalizeSourceContext } from './source-context.mjs';
import { selectionBounds, transformSelection } from './grouping.mjs';
export const CANVASES = ['main', 'scratch'];
export const MAX_DOCUMENT_CHARS = 12000000;
export const OBJECT_FIELDS = ['id', 'name', 'type', 'canvas', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'svg', 'dataUrl', 'textFree', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'align', 'anchor', 'italic', 'underline', 'fill', 'stroke', 'strokeWidth'];
export const TEXT_FIELDS = ['text', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'align', 'anchor', 'italic', 'underline'];
const clone = value => JSON.parse(JSON.stringify(value));
export const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

export function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
export function fields(value, allowed) {
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
  return { version: 1, revision: crypto.randomUUID(), title: 'Untitled figure', complexity: DEFAULT_COMPLEXITY, imageGenerationPercent: null,
    canvases: { main: { width: 1200, height: 800, background: '#ffffff' }, scratch: { width: 500, height: 350, background: '#ffffff' } },
    objects: [], groups: [], receipts: [] };
}
export function normalizeObject(raw, validateSvg = value => value) {
  record(raw, 'Object'); fields(raw, OBJECT_FIELDS);
  const type = choice(raw.type, ['vector', 'raster', 'text'], 'type');
  if (!validId(raw.id)) throw new Error('Object id must be 1–100 letters, numbers, underscores or hyphens.');
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
  if (raw.groups !== undefined && (!Array.isArray(raw.groups) || raw.groups.length > 100)) throw new Error('Use at most 100 groups.');
  const used = new Set(objects.map(object => object.id)), members = new Set();
  const groups = (raw.groups || []).map(group => {
    record(group, 'Group'); fields(group, ['id', 'name', 'canvas', 'ids']);
    if (!validId(group.id) || used.has(group.id)) throw new Error('Group IDs must be unique and use 1–100 letters, numbers, underscores or hyphens.');
    used.add(group.id);
    const canvas = choice(group.canvas, CANVASES, 'Group canvas');
    if (!Array.isArray(group.ids) || group.ids.length < 2 || new Set(group.ids).size !== group.ids.length) throw new Error('Groups need at least two distinct component IDs.');
    for (const id of group.ids) {
      if (!objects.some(object => object.id === id && object.canvas === canvas) || members.has(id)) throw new Error('Each group member must exist on the same canvas and belong to only one group.');
      members.add(id);
    }
    return { id: group.id, name: string(group.name ?? 'Group', 'Group name', 200), canvas, ids: [...group.ids] };
  });
  const result = { version: 1, revision: string(raw.revision, 'revision', 100), title: string(raw.title, 'title', 200),
    complexity: choice(raw.complexity ?? DEFAULT_COMPLEXITY, COMPLEXITY_LEVELS, 'complexity'),
    imageGenerationPercent: imageGenerationPercent(raw.imageGenerationPercent),
    canvases: Object.fromEntries(CANVASES.map(key => [key, normalizeCanvas(raw.canvases?.[key])])), objects, groups, receipts: (raw.receipts || []).slice(-64) };
  if (raw.source !== undefined) result.source = normalizeSourceContext(raw.source);
  if (raw.pendingAssetGroups !== undefined) {
    if (!Array.isArray(raw.pendingAssetGroups) || raw.pendingAssetGroups.length > 100 || raw.pendingAssetGroups.some(id => !validId(id))
      || new Set(raw.pendingAssetGroups).size !== raw.pendingAssetGroups.length) throw new Error('Invalid pending asset groups.');
    result.pendingAssetGroups = raw.pendingAssetGroups.filter(id => groups.some(group => group.id === id));
  }
  if (JSON.stringify(result).length > MAX_DOCUMENT_CHARS) throw new Error('The illustration is too large. Use smaller raster assets.');
  return result;
}
export function validateRequest(args) {
  record(args, 'Request'); fields(args, ['action', 'canvas', 'include_assets', 'expected_revision', 'request_id', 'operations', 'visible', 'inspection_id', 'review']);
  choice(args.action, ['read', 'render', 'apply', 'scratch', 'inspect', 'inspection_status'], 'action');
  if (args.action === 'inspection_status') { fields(args, ['action']); return args; }
  if (args.action === 'inspect') {
    fields(args, ['action', 'expected_revision', 'inspection_id', 'review']);
    for (const key of ['expected_revision', 'inspection_id']) {
      if (!string(args[key], key, 100).trim()) throw new Error(`${key} is required.`);
    }
    record(args.review, 'review'); fields(args.review, ['layout', 'labels', 'artwork', 'science']);
    for (const key of ['layout', 'labels', 'artwork', 'science']) {
      if (!string(args.review[key], key, 1000).trim()) throw new Error(`Describe the ${key} inspection.`);
    }
    return args;
  }
  if (args.inspection_id !== undefined || args.review !== undefined) throw new Error('Inspection fields require the inspect action.');
  if (args.action === 'scratch') {
    fields(args, ['action', 'visible']);
    if (typeof args.visible !== 'boolean') throw new Error('Scratch requires visible: true or false.');
    return args;
  }
  if (args.visible !== undefined) throw new Error('visible is only supported by the scratch action.');
  if (args.canvas !== undefined) {
    if (args.action !== 'render') throw new Error('canvas is only supported by the render action.');
    choice(args.canvas, [...CANVASES, 'both'], 'canvas');
  }
  if (args.include_assets !== undefined) {
    if (args.action !== 'read') throw new Error('include_assets is only supported by the read action.');
    if (typeof args.include_assets !== 'boolean') throw new Error('include_assets must be boolean.');
  }
  if (args.action === 'apply') {
    if (!args.expected_revision || !args.request_id) throw new Error('Apply requires expected_revision and request_id. Read the canvas first.');
    string(args.expected_revision, 'expected_revision', 100); string(args.request_id, 'request_id', 100);
    if (!Array.isArray(args.operations) || !args.operations.length || args.operations.length > 100) throw new Error('Apply needs 1–100 operations.');
  } else if (args.operations !== undefined || args.request_id !== undefined || args.expected_revision !== undefined) throw new Error('Read/render do not accept mutation fields.');
  return args;
}
export function applyOperations(document, operations, validateSvg) {
  const next = clone(document);
  next.groups ??= [];
  const pruneGroups = () => {
    next.groups = next.groups.map(group => ({ ...group, ids: group.ids.filter(id => next.objects.some(object => object.id === id && object.canvas === group.canvas)) })).filter(group => group.ids.length >= 2);
  };
  const transform = (ids, patch) => {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('Transform requires distinct component IDs.');
    const objects = ids.map(id => {
      const object = next.objects.find(item => item.id === id);
      if (!object) throw new Error(`Object ${id} does not exist.`);
      return object;
    });
    const transformed = new Map(transformSelection(objects, patch).map(object => [object.id, object]));
    next.objects = next.objects.map(object => transformed.get(object.id) || object);
  };
  for (const operation of operations) {
    record(operation, 'Operation');
    fields(operation, ['op', 'object', 'id', 'patch', 'canvas', 'ids', 'copy', 'new_id', 'title', 'complexity', 'imageGenerationPercent', 'name']);
    const group = next.groups.find(item => item.id === operation.id);
    if (operation.op === 'group') {
      if (!validId(operation.id) || next.objects.some(item => item.id === operation.id) || group) throw new Error('Group requires an unused group ID.');
      const ids = operation.ids;
      if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length || ids.some(id => !next.objects.some(object => object.id === id))) throw new Error('Group requires at least two distinct existing component IDs.');
      const canvas = next.objects.find(object => object.id === ids[0]).canvas;
      if (ids.some(id => next.objects.find(object => object.id === id).canvas !== canvas)) throw new Error('Group members must be on the same canvas.');
      const merged = next.groups.filter(item => item.ids.some(id => ids.includes(id)));
      if (merged.some(item => item.ids.some(id => !ids.includes(id)))) throw new Error('Select every member of an existing group before regrouping it.');
      next.groups = next.groups.filter(item => !merged.includes(item));
      next.groups.push({ id: operation.id, name: string(operation.name ?? 'Group', 'Group name', 200), canvas, ids: [...ids] });
    } else if (operation.op === 'ungroup') {
      if (!group) throw new Error(`Group ${operation.id} does not exist.`);
      next.groups = next.groups.filter(item => item.id !== group.id);
    } else if (operation.op === 'transform') {
      if ((operation.id !== undefined) === (operation.ids !== undefined)) throw new Error('Transform takes either a group id or component ids.');
      if (operation.id !== undefined && !group) throw new Error(`Group ${operation.id} does not exist.`);
      transform(group ? group.ids : operation.ids, operation.patch);
    } else if (operation.op === 'upsert') {
      const object = normalizeObject(operation.object, validateSvg);
      const index = next.objects.findIndex(item => item.id === object.id);
      if (index < 0) next.objects.push(object); else next.objects[index] = object;
    } else if (operation.op === 'update') {
      if (group) {
        const patch = record(operation.patch, 'patch'); fields(patch, ['name', 'x', 'y', 'width', 'height']);
        const { name, ...geometry } = patch;
        if (name !== undefined) group.name = string(name, 'Group name', 200);
        if (Object.keys(geometry).length) transform(group.ids, geometry);
        continue;
      }
      const index = next.objects.findIndex(item => item.id === operation.id);
      if (index < 0) throw new Error(`Object ${operation.id} does not exist.`);
      record(operation.patch, 'patch');
      if (['id', 'type'].some(key => key in operation.patch)) throw new Error('Update preserves id and type.');
      const updated = { ...next.objects[index], ...operation.patch };
      for (const key of ['fill', 'stroke', 'strokeWidth']) if (updated.type === 'vector' && operation.patch[key] === null) delete updated[key];
      next.objects[index] = normalizeObject(updated, validateSvg);
    } else if (operation.op === 'delete') {
      if (!group && !next.objects.some(item => item.id === operation.id)) throw new Error(`Object ${operation.id} does not exist.`);
      next.objects = next.objects.filter(item => group ? !group.ids.includes(item.id) : item.id !== operation.id);
    } else if (operation.op === 'transfer') {
      if (group) {
        const canvas = choice(operation.canvas, CANVASES, 'canvas');
        if (operation.copy) {
          if (!validId(operation.new_id) || next.groups.some(item => item.id === operation.new_id) || next.objects.some(item => item.id === operation.new_id)) throw new Error('Copy requires an unused new_id.');
          const copies = next.objects.filter(object => group.ids.includes(object.id)).map(object => normalizeObject({ ...object, canvas, id: `object-${crypto.randomUUID()}` }, validateSvg));
          next.objects.push(...copies); next.groups.push({ ...group, id: operation.new_id, canvas, ids: copies.map(object => object.id) });
        } else {
          group.canvas = canvas;
          next.objects.filter(object => group.ids.includes(object.id)).forEach(object => { object.canvas = canvas; });
        }
        continue;
      }
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
    else if (operation.op === 'image_generation') {
      if (!Object.hasOwn(operation, 'imageGenerationPercent')) throw new Error('image_generation requires imageGenerationPercent (0–100 or null).');
      next.imageGenerationPercent = imageGenerationPercent(operation.imageGenerationPercent);
    }
    else throw new Error(`Unknown operation: ${operation.op}.`);
    pruneGroups();
  }
  next.revision = crypto.randomUUID();
  return normalizeDocument(next, validateSvg);
}
export function readDocument(document, includeAssets = false) {
  const result = clone(document); delete result.receipts;
  result.groups = (document.groups || []).map(group => ({ ...clone(group), bounds: selectionBounds(document.objects.filter(object => group.ids.includes(object.id))) }));
  if (!includeAssets) result.objects = result.objects.map(object => {
    if (object.type !== 'raster') return object;
    const { dataUrl, ...metadata } = object;
    return { ...metadata, assetBytes: Math.floor(dataUrl.length * 0.75) };
  });
  return result;
}
