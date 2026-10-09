// Saved components are immutable snapshots. The index is the commit point;
// placed copies never depend on the original illustration or asset file.
import { normalizeObject, MAX_DOCUMENT_CHARS, CANVASES, validId, record, fields } from './model.mjs';
import { selectionBounds, transformSelection } from './grouping.mjs';

export const ASSETS_PATH = 'reusable-assets.json';
export const ASSET_ACTIONS = ['asset_list', 'asset_read', 'asset_render', 'asset_save', 'asset_delete'];
export const assetPath = id => `assets/${id}/component.json`;
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
export const createAssetLibrary = () => ({ version: 1, revision: crypto.randomUUID(), assets: [], receipts: [] });

export function normalizeAssetLibrary(raw) {
  if (raw?.version !== 1 || !validId(raw.revision) || !Array.isArray(raw.assets)) throw new Error('Invalid reusable asset library.');
  const assets = raw.assets.map(entry => {
    if (!validId(entry.id) || !validName(entry.name) || !Number.isFinite(entry.width) || entry.width <= 0 || !Number.isFinite(entry.height) || entry.height <= 0
      || !Number.isInteger(entry.objectCount) || entry.objectCount < 1 || entry.objectCount > 200) throw new Error('Invalid reusable asset entry.');
    if (entry.fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(entry.fingerprint)) throw new Error('Invalid asset fingerprint.');
    if (entry.origin !== undefined && !['manual', 'codex', 'storage', 'agent', 'agent-group'].includes(entry.origin)) throw new Error('Invalid asset origin.');
    return { id: entry.id, name: entry.name, width: entry.width, height: entry.height,
      objectCount: entry.objectCount, updatedAt: String(entry.updatedAt || ''),
      ...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}), ...(entry.origin ? { origin: entry.origin } : {}) };
  });
  if (new Set(assets.map(entry => entry.id)).size !== assets.length) throw new Error('Duplicate reusable asset IDs.');
  if (JSON.stringify(assets).length > MAX_DOCUMENT_CHARS) throw new Error('The reusable asset index is too large. Remove unused assets.');
  return { version: 1, revision: raw.revision, assets, receipts: Array.isArray(raw.receipts) ? raw.receipts.slice(-64) : [] };
}
export function readAssetLibrary(library) {
  return { assets_revision: library.revision, reusable_assets: library.assets.map(entry => ({ ...entry })) };
}

export function validateAssetRequest(args) {
  if (!ASSET_ACTIONS.includes(args?.action)) throw new Error('Invalid reusable asset action.');
  if (args.action === 'asset_list') { fields(args, ['action']); return; }
  if (['asset_read', 'asset_render'].includes(args.action)) {
    fields(args, ['action', 'asset_id', ...(args.action === 'asset_read' ? ['include_assets'] : [])]);
    if (!validId(args.asset_id)) throw new Error('Choose an asset_id from asset_list.');
    if (args.include_assets !== undefined && typeof args.include_assets !== 'boolean') throw new Error('include_assets must be boolean.');
    return;
  }
  fields(args, ['action', 'expected_assets_revision', 'request_id', ...(args.action === 'asset_save'
    ? ['illustration_id', 'expected_revision', 'name', 'id', 'ids', 'raster_asset', 'textFree'] : ['asset_id'])]);
  if (!validId(args.expected_assets_revision) || !validId(args.request_id)) throw new Error('Supply expected_assets_revision from asset_list/read and a unique request_id.');
  if (args.action === 'asset_delete') {
    if (!validId(args.asset_id)) throw new Error('Choose an asset_id from asset_list.');
    return;
  }
  if (!validId(args.illustration_id) || !validId(args.expected_revision)) throw new Error('Asset save requires illustration_id and expected_revision from read.');
  if (!validName(args.name)) throw new Error('Give the asset a name of 1–200 characters.');
  if ([args.id, args.ids, args.raster_asset].filter(value => value !== undefined).length !== 1) throw new Error('Save takes a component/group id, component ids, or raster_asset.');
  if (args.raster_asset !== undefined && (!validId(args.raster_asset) || args.textFree !== true)) throw new Error('Raster asset save requires raster_asset and textFree: true.');
  if (args.raster_asset === undefined && args.textFree !== undefined) throw new Error('textFree is only supported with raster_asset.');
  if (args.id !== undefined && !validId(args.id)) throw new Error('Invalid component/group id.');
  if (args.ids !== undefined && (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 200
    || args.ids.some(id => !validId(id)) || new Set(args.ids).size !== args.ids.length)) throw new Error('Select 1–200 distinct component ids.');
}

// Content keys ignore component IDs and canvas translation. The saved snapshot
// keeps full precision, names, editable layers and original paint order.
export function assetContent(asset) {
  if (asset.objects.length === 1 && asset.objects[0].type === 'raster') {
    const object = asset.objects[0];
    return { raster: object.dataUrl, rotation: object.rotation, opacity: object.opacity, visible: object.visible,
      aspectRatio: Math.round(object.width / object.height * 1e6) / 1e6 };
  }
  return asset.objects.map(({ id, name, canvas, ...object }) => Object.fromEntries(Object.entries(object)
    .map(([key, value]) => [key, typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value])));
}
export function compoundGroups(document) {
  return document.groups.filter(group => document.objects.filter(object => group.ids.includes(object.id) && object.type !== 'text').length >= 2);
}

export function snapshotAsset(document, args, validateSvg) {
  const group = document.groups.find(group => group.id === args.id);
  const ids = args.ids || group?.ids || [args.id];
  const objects = document.objects.filter(object => ids.includes(object.id));
  if (objects.length !== ids.length) throw new Error('Every selected component must exist.');
  if (new Set(objects.map(object => object.canvas)).size !== 1) throw new Error('Save components from one canvas at a time.');
  const bounds = selectionBounds(objects);
  return normalizeAsset({ version: 1, name: args.name.trim(), objects: objects.map(object => ({ ...object,
    canvas: 'main', x: object.x - bounds.x, y: object.y - bounds.y })) }, validateSvg);
}
export function normalizeAsset(raw, validateSvg) {
  if (raw?.version !== 1 || !validName(raw.name) || !Array.isArray(raw.objects) || !raw.objects.length || raw.objects.length > 200) throw new Error('Invalid reusable component.');
  const objects = raw.objects.map(object => normalizeObject(object, validateSvg));
  if (new Set(objects.map(object => object.id)).size !== objects.length || objects.some(object => object.canvas !== 'main')) throw new Error('Invalid reusable component objects.');
  const bounds = selectionBounds(objects);
  if (Math.abs(bounds.x) > 1e-7 || Math.abs(bounds.y) > 1e-7) throw new Error('Reusable component bounds must start at the origin.');
  const asset = { version: 1, name: raw.name, width: bounds.width, height: bounds.height, objects };
  if (JSON.stringify(asset).length > MAX_DOCUMENT_CHARS) throw new Error('The reusable component is too large. Use smaller raster assets.');
  return asset;
}
export function readAsset(asset, includeAssets = false) {
  return { ...asset, objects: asset.objects.map(object => {
    if (includeAssets || object.type !== 'raster') return { ...object };
    const { dataUrl, ...metadata } = object;
    return { ...metadata, assetBytes: Math.floor(dataUrl.length * 0.75) };
  }) };
}
export function instantiateAsset(asset, operation, document) {
  fields(record(operation, 'insert_asset'), ['op', 'asset_id', 'canvas', 'x', 'y', 'width', 'height']);
  if (!validId(operation.asset_id) || !CANVASES.includes(operation.canvas)) throw new Error('insert_asset requires asset_id and canvas: main or scratch.');
  const { width: cw, height: ch } = document.canvases[operation.canvas];
  const { width, height, x, y } = operation;
  const scale = width !== undefined ? width / asset.width : height !== undefined ? height / asset.height : 1;
  const patch = { x: x ?? (cw - asset.width * scale) / 2, y: y ?? (ch - asset.height * scale) / 2,
    ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) };
  const objects = transformSelection(asset.objects, patch).map(object => ({ ...object, id: `object-${crypto.randomUUID()}`, canvas: operation.canvas }));
  const groupId = objects.length > 1 ? `group-${crypto.randomUUID()}` : null;
  return { operations: [...objects.map(object => ({ op: 'upsert', object })), ...(groupId ? [{ op: 'group', id: groupId, name: asset.name, ids: objects.map(object => object.id) }] : [])],
    inserted: { asset_id: operation.asset_id, canvas: operation.canvas, ids: objects.map(object => object.id), group_id: groupId, bounds: selectionBounds(objects) } };
}
export function assetPreviewDocument(asset) {
  const padding = 8, width = Math.max(64, asset.width + padding * 2), height = Math.max(64, asset.height + padding * 2);
  return { title: asset.name, groups: [], canvases: { main: { width, height, background: '#ffffff' } },
    objects: asset.objects.map(object => ({ ...object, x: object.x + (width - asset.width) / 2, y: object.y + (height - asset.height) / 2 })) };
}
