import { fitRasterBox, prepareRaster, validateSvg } from './artwork.mjs';
import { renderPreview } from './figure-export.mjs';
import { failure, readLibrary, signature } from './library.mjs';
import { selectionBounds, transformSelection } from './geometry.mjs';
import { normalizeObject, MAX_DOCUMENT_CHARS, MAX_OBJECTS, CANVASES, validId, record, fields } from './model.mjs';

// Saved components are immutable snapshots. The index is the commit point;
// placed copies never depend on the original illustration or asset file.

export const ASSETS_PATH = 'reusable-assets.json';
export const ASSET_ACTIONS = ['asset_list', 'asset_read', 'asset_render', 'asset_save', 'asset_update', 'asset_delete'];
export const MAX_ASSET_DESCRIPTION = 2000;
export const assetPath = id => `assets/${id}/component.json`;
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const validDescription = value => typeof value === 'string' && value.length <= MAX_ASSET_DESCRIPTION;
export const createAssetLibrary = () => ({ version: 1, revision: crypto.randomUUID(), assets: [], receipts: [] });

export function normalizeAssetLibrary(raw) {
  if (raw?.version !== 1 || !validId(raw.revision) || !Array.isArray(raw.assets)) throw new Error('Invalid reusable asset library.');
  const assets = raw.assets.map(entry => {
    if (!validId(entry.id) || !validName(entry.name) || !Number.isFinite(entry.width) || entry.width <= 0 || !Number.isFinite(entry.height) || entry.height <= 0
      || !Number.isInteger(entry.objectCount) || entry.objectCount < 1 || entry.objectCount > MAX_OBJECTS) throw new Error('Invalid reusable asset entry.');
    if (entry.fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(entry.fingerprint)) throw new Error('Invalid asset fingerprint.');
    if (entry.origin !== undefined && !['manual', 'codex', 'storage', 'agent', 'agent-group'].includes(entry.origin)) throw new Error('Invalid asset origin.');
    if (entry.description !== undefined && !validDescription(entry.description)) throw new Error('Invalid asset description.');
    return { id: entry.id, name: entry.name, description: entry.description?.trim() || '', width: entry.width, height: entry.height,
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
    ? ['illustration_id', 'expected_revision', 'name', 'description', 'id', 'ids', 'raster_asset', 'textFree', 'objects']
    : args.action === 'asset_update' ? ['asset_id', 'name', 'description'] : ['asset_id'])]);
  if (!validId(args.expected_assets_revision) || !validId(args.request_id)) throw new Error('Supply expected_assets_revision from asset_list/read and a unique request_id.');
  if (args.description !== undefined && !validDescription(args.description)) throw new Error(`Asset description must be at most ${MAX_ASSET_DESCRIPTION} characters.`);
  if (['asset_delete', 'asset_update'].includes(args.action)) {
    if (!validId(args.asset_id)) throw new Error('Choose an asset_id from asset_list.');
    if (args.action === 'asset_update') {
      if (args.name === undefined && args.description === undefined) throw new Error('Supply a name or description to update.');
      if (args.name !== undefined && !validName(args.name)) throw new Error('Give the asset a name of 1–200 characters.');
    }
    return;
  }
  // Generated components never touch a figure, so only canvas saves need one.
  if (args.objects === undefined && (!validId(args.illustration_id) || !validId(args.expected_revision))) throw new Error('Asset save requires illustration_id and expected_revision from read.');
  if (!validName(args.name)) throw new Error('Give the asset a name of 1–200 characters.');
  if ([args.id, args.ids, args.raster_asset, args.objects].filter(value => value !== undefined).length !== 1) throw new Error('Save takes a component/group id, component ids, raster_asset, or objects.');
  if (args.objects !== undefined && (!Array.isArray(args.objects) || !args.objects.length || args.objects.length > 200
    || args.objects.some(object => object?.type !== 'vector'))) throw new Error('objects takes 1–200 type:"vector" SVG components. Save image_gen output with raster_asset.');
  if (args.raster_asset !== undefined && (!validId(args.raster_asset) || args.textFree !== true)) throw new Error('Raster asset save requires raster_asset and textFree: true.');
  if (args.raster_asset === undefined && args.textFree !== undefined) throw new Error('textFree is only supported with raster_asset.');
  if (args.id !== undefined && !validId(args.id)) throw new Error('Invalid component/group id.');
  if (args.ids !== undefined && (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > MAX_OBJECTS
    || args.ids.some(id => !validId(id)) || new Set(args.ids).size !== args.ids.length)) throw new Error(`Select 1–${MAX_OBJECTS} distinct component ids.`);
}

// Content keys ignore component IDs and canvas translation. The saved snapshot
// keeps full precision, names, editable layers and original paint order.
export function assetContent(asset) {
  if (asset.objects.length === 1 && asset.objects[0].type === 'raster') {
    const object = asset.objects[0];
    return { raster: object.dataUrl, rotation: object.rotation, opacity: object.opacity, visible: object.visible,
      ...(object.chemicalStructure ? { chemicalStructure: true, textFree: object.textFree } : {}),
      aspectRatio: Math.round(object.width / object.height * 1e6) / 1e6 };
  }
  return asset.objects.map(({ id, name, canvas, ...object }) => {
    // Plotly's generated clip IDs are random; data/layout define chart content.
    if (object.type === 'plot') delete object.svg;
    return Object.fromEntries(Object.entries(object)
      .map(([key, value]) => [key, typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value]));
  });
}
export function compoundGroups(document) {
  return document.groups.filter(group => document.objects.filter(object => group.ids.includes(object.id) && object.type !== 'text').length >= 2);
}

export function snapshotAsset(document, args, validateSvg) {
  const group = document.groups.find(group => group.id === args.id);
  const ids = args.ids || group?.ids || [args.id];
  const objects = document.objects.filter(object => ids.includes(object.id));
  if (objects.length !== ids.length) throw new Error('Every selected component must exist.');
  return originAsset(args.name.trim(), objects, validateSvg);
}
// An agent-built component: its objects share one coordinate space, in paint order.
export function componentAsset(name, objects, validateSvg) {
  return originAsset(name, objects.map(object => normalizeObject(object, validateSvg)), validateSvg);
}
function originAsset(name, objects, validateSvg) {
  const bounds = selectionBounds(objects);
  return normalizeAsset({ version: 1, name, objects: objects.map(object => ({ ...object,
    canvas: 'main', x: object.x - bounds.x, y: object.y - bounds.y })) }, validateSvg);
}
export function normalizeAsset(raw, validateSvg) {
  if (raw?.version !== 1 || !validName(raw.name) || !Array.isArray(raw.objects) || !raw.objects.length || raw.objects.length > MAX_OBJECTS) throw new Error('Invalid reusable component.');
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
  if (!validId(operation.asset_id) || !CANVASES.includes(operation.canvas)) throw new Error('insert_asset requires asset_id and canvas: main.');
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
function assetPreviewDocument(asset) {
  const padding = 8, width = Math.max(64, asset.width + padding * 2), height = Math.max(64, asset.height + padding * 2);
  return { title: asset.name, groups: [], canvases: { main: { width, height, background: '#ffffff' } },
    objects: asset.objects.map(object => ({ ...object, x: object.x + (width - asset.width) / 2, y: object.y + (height - asset.height) / 2 })) };
}

export function createReusableAssetStore({ hikari, files, getContext, onAssetsChange, onStatus }) {
  const { readJson, readExistingJson, writeJson } = files;
  let assetLibrary;

  async function load(stored) {
    const foundAssets = stored?.assetsPath ? null : await readExistingJson(ASSETS_PATH);
    if (stored?.assetsPath || foundAssets) {
      if (stored?.assetsPath && stored.assetsPath !== ASSETS_PATH) throw new Error('Invalid reusable asset library path.');
      assetLibrary = normalizeAssetLibrary(foundAssets || await readJson(ASSETS_PATH));
    } else {
      assetLibrary = createAssetLibrary(); await writeJson(ASSETS_PATH, assetLibrary);
    }
  }
  function publish() { onAssetsChange(readAssetLibrary(assetLibrary)); }

  async function loadAsset(id) {
    const entry = assetLibrary.assets.find(asset => asset.id === id);
    if (!entry) throw new Error('This reusable asset does not exist. Refresh Assets.');
    // Metadata lives in the index so edits have one atomic commit point and
    // never rewrite the saved artwork or change placed copies.
    return { ...normalizeAsset(await readJson(assetPath(id)), validateSvg), name: entry.name, description: entry.description };
  }
  function rasterComponent(raster, name, source = null) {
    return normalizeAsset({ version: 1, name, objects: [{ id: `raster-${crypto.randomUUID()}`, name, type: 'raster', canvas: 'main',
      x: 0, y: 0, ...fitRasterBox(raster.width, raster.height),
      ...(source?.chemicalStructure ? { chemicalStructure: true, textFree: source.textFree } : { textFree: true }), dataUrl: raster.dataUrl }] });
  }
  const assetEntry = (asset, fingerprint, origin, description = '') => ({ id: crypto.randomUUID(), name: asset.name, description: description.trim(), width: asset.width, height: asset.height,
    objectCount: asset.objects.length, updatedAt: new Date().toISOString(), fingerprint, origin });
  async function saveAutomaticAssets(snapshots, deadline) {
    const additions = [], saved = [];
    for (const { asset, origin, ...reference } of snapshots) {
      const fingerprint = await signature(assetContent(asset));
      const existing = [...assetLibrary.assets, ...additions.map(item => item.entry)].find(entry => entry.fingerprint === fingerprint);
      const entry = existing || assetEntry(asset, fingerprint, origin);
      if (!existing) additions.push({ entry, asset });
      saved.push({ ...reference, asset_id: entry.id, name: entry.name, description: entry.description, reused: Boolean(existing) });
    }
    if (!additions.length) return saved;
    const next = normalizeAssetLibrary({ ...assetLibrary, revision: crypto.randomUUID(), assets: [...assetLibrary.assets, ...additions.map(item => item.entry)] });
    if (Date.now() >= deadline) throw new Error('The asset save expired. Retry the request.');
    await hikari.call('app.setUnsaved', { unsaved: true });
    try {
      for (const { entry, asset } of additions) await writeJson(assetPath(entry.id), asset);
      await writeJson(ASSETS_PATH, next);
      assetLibrary = next; onAssetsChange(readAssetLibrary(assetLibrary));
    } finally { await hikari.call('app.setUnsaved', { unsaved: false }); }
    return saved;
  }
  async function assetAction(args, deadline, assets = {}) {
    if (args.action === 'asset_list') return { ok: true, status: 'asset_list', ...readAssetLibrary(assetLibrary) };
    if (['asset_read', 'asset_render'].includes(args.action)) {
      const asset = await loadAsset(args.asset_id);
      if (args.action === 'asset_read') return { ok: true, status: 'asset_read', asset_id: args.asset_id,
        component: readAsset(asset, args.include_assets), ...readAssetLibrary(assetLibrary) };
      const preview = await renderPreview(assetPreviewDocument(asset), 'main', 400);
      if (Date.now() >= deadline) return failure('expired', 'The asset preview expired.');
      return { ok: true, status: 'asset_render', asset_id: args.asset_id, name: asset.name, description: asset.description,
        assets_revision: assetLibrary.revision, previews: [{ ...preview, canvas: 'asset', asset_id: args.asset_id, name: asset.name, description: asset.description }] };
    }
    const imported = args.raster_asset && Object.hasOwn(assets, args.raster_asset) && assets[args.raster_asset];
    if (args.raster_asset && !imported?.data_url) throw new Error(`Missing raster asset: ${args.raster_asset}`);
    const hash = await signature(args.raster_asset ? { args, dataUrl: imported.data_url, source: imported.source || '' } : args), receipt = assetLibrary.receipts.find(item => item.id === args.request_id);
    if (receipt) return receipt.hash === hash
      ? { ok: true, status: 'already_applied', asset_id: receipt.assetId, ...readAssetLibrary(assetLibrary) }
      : failure('request_id_conflict', 'This request_id was already used with different arguments.');
    if (args.expected_assets_revision !== assetLibrary.revision) return { ...failure('revision_conflict', 'The reusable assets changed. List them again.'), ...readAssetLibrary(assetLibrary) };
    let asset, entry, raster;
    if (args.action === 'asset_save') {
      const { library, documentState } = getContext();
      if (!args.objects && args.illustration_id !== library.activeId) return { ...failure('illustration_changed', 'Another illustration is open. Reopen the intended illustration before saving components.'), ...readLibrary(library) };
      if (!args.objects && args.expected_revision !== documentState.revision) return { ...failure('revision_conflict', 'The figure changed. Read it again before saving components.'), revision: documentState.revision };
      raster = imported ? await prepareRaster(imported.data_url, { trim: true }) : null;
      asset = raster ? rasterComponent(raster, args.name.trim()) : args.objects ? componentAsset(args.name.trim(), args.objects, validateSvg) : snapshotAsset(documentState, args, validateSvg);
      const fingerprint = await signature(assetContent(asset));
      entry = raster && assetLibrary.assets.find(item => item.fingerprint === fingerprint);
      if (entry) asset = null;
      else entry = assetEntry(asset, fingerprint, imported?.source === 'codex' ? 'codex' : imported ? 'storage' : args.objects ? 'agent' : 'manual', args.description);
      if (!asset && args.description !== undefined) entry = { ...entry, description: args.description.trim(), updatedAt: new Date().toISOString() };
    } else {
      entry = assetLibrary.assets.find(item => item.id === args.asset_id);
      if (!entry) return failure('not_found', 'This reusable asset does not exist.');
      if (args.action === 'asset_update') entry = { ...entry, ...(args.name !== undefined ? { name: args.name.trim() } : {}),
        ...(args.description !== undefined ? { description: args.description.trim() } : {}), updatedAt: new Date().toISOString() };
    }
    const saving = args.action === 'asset_save', updating = args.action === 'asset_update';
    const next = normalizeAssetLibrary({ ...assetLibrary, revision: crypto.randomUUID(), assets: asset ? [...assetLibrary.assets, entry]
      : saving || updating ? assetLibrary.assets.map(item => item.id === entry.id ? entry : item) : assetLibrary.assets.filter(item => item.id !== entry.id),
      receipts: [...assetLibrary.receipts, { id: args.request_id, hash, assetId: entry.id }].slice(-64) });
    if (Date.now() >= deadline) return failure('expired', 'The asset request expired before saving.');
    await hikari.call('app.setUnsaved', { unsaved: true });
    try {
      if (asset) await writeJson(assetPath(entry.id), asset);
      await writeJson(ASSETS_PATH, next);
      assetLibrary = next; onAssetsChange(readAssetLibrary(assetLibrary)); onStatus(updating ? 'Asset details saved' : saving ? 'Asset saved' : 'Asset removed');
      // No file-removal verb is needed. Reclaim deleted bytes only after the
      // index commits; failure here cannot invalidate the committed library.
      if (!saving && !updating) await writeJson(assetPath(entry.id), { deleted: true }).catch(() => {});
      const trim = raster && (({ dataUrl, ...metadata }) => metadata)(raster);
      return { ok: true, status: updating ? 'asset_updated' : saving ? 'asset_saved' : 'asset_deleted', persisted: true, asset_id: entry.id,
        ...(trim ? { raster_import: trim } : {}), ...readAssetLibrary(assetLibrary) };
    } finally { await hikari.call('app.setUnsaved', { unsaved: false }); }
  }

  async function importAsset(input) {
    try {
      let asset;
      if (input.type === 'raster') {
        if (input.textFree !== true) throw new Error('Confirm that imported artwork contains no text.');
        asset = rasterComponent(await prepareRaster(input.dataUrl), input.name.trim());
      } else if (input.type === 'vector') {
        const svg = validateSvg(input.svg);
        const box = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
        asset = normalizeAsset({ version: 1, name: input.name.trim(), objects: [{ id: `vector-${crypto.randomUUID()}`, name: input.name.trim(),
          type: 'vector', canvas: 'main', x: 0, y: 0, ...fitRasterBox(box[2], box[3]), svg }] }, validateSvg);
      } else throw new Error('Import SVG, PNG, JPEG, or WebP artwork.');
      const [saved] = await saveAutomaticAssets([{ asset, origin: 'manual' }], Infinity);
      onStatus(saved.reused ? 'This asset is already saved' : 'Asset imported');
      return { ok: true, status: 'asset_imported', persisted: true, ...saved, ...readAssetLibrary(assetLibrary) };
    } catch (error) {
      onStatus(error.message);
      return failure('failed', error.message);
    }
  }

  async function manage(action, params = {}) {
    try {
      const { library, documentState } = getContext();
      const args = {
        action,
        ...(action === 'asset_save' ? { illustration_id: library.activeId, expected_revision: documentState.revision } : {}),
        ...params,
        expected_assets_revision: assetLibrary.revision,
        request_id: crypto.randomUUID()
      };
      validateAssetRequest(args);
      return await assetAction(args, Infinity);
    } catch (error) {
      onStatus(error.message);
      return failure('failed', error.message);
    }
  }

  return {
    load, publish, loadAsset, rasterComponent, saveAutomaticAssets, importAsset, manage, request: assetAction,
    read: () => assetLibrary && readAssetLibrary(assetLibrary)
  };
}
