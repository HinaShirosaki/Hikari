import { createDocument, normalizeDocument, applyOperations, readDocument, validateRequest, CANVASES, MAX_DOCUMENT_CHARS, validId } from './model.mjs';
import { validateSvg, renderPreview, svgSource } from './artwork.mjs';
import { CANVAS_TOOL_CONTRACT } from './agent/canvas-contract.mjs';
import { agentInstructions } from './agent/workflow.mjs';
import { normalizeSourceContext } from './source-context.mjs';
import { createInspectionTracker } from './inspection.mjs';
import { prepareRaster, fitRasterBox } from './raster.mjs';
import { instantiateClipboard } from './clipboard.mjs';
import { LIBRARY_PATH, LIBRARY_ACTIONS, normalizeLibrary, readLibrary, nextScenePath, validateLibraryRequest } from './library.mjs';
import { ASSETS_PATH, ASSET_ACTIONS, assetPath, createAssetLibrary, normalizeAssetLibrary, readAssetLibrary, validateAssetRequest,
  snapshotAsset, normalizeAsset, readAsset, instantiateAsset, assetPreviewDocument, assetContent, compoundGroups } from './reusable-assets.mjs';

export function encodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function decodeText(encoded) {
  return new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
}
async function signature(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const failure = (status, error) => ({ ok: false, status, error });

export function createWorkspace({ hikari, onChange = () => {}, onLibraryChange = () => {}, onAssetsChange = () => {}, onViewChange = () => {}, onHistoryChange = () => {}, onStatus = () => {} }) {
  let documentState;
  let ready;
  let tail = Promise.resolve();
  let library;
  let assetLibrary;
  let scratchVisible = false;
  const inspections = createInspectionTracker();
  const assetRuns = new Map();
  function assetRun(runId) {
    let run = assetRuns.get(runId);
    if (!run || run.illustrationId !== library.activeId) {
      run = { illustrationId: library.activeId, checked: false };
      assetRuns.delete(runId); assetRuns.set(runId, run);
      if (assetRuns.size > 64) assetRuns.delete(assetRuns.keys().next().value);
    }
    return run;
  }
  const readView = () => ({ scratch_visible: scratchVisible });
  const undoStack = [], redoStack = [];
  const enqueue = work => {
    const result = tail.then(() => ready).then(work);
    tail = result.catch(() => {});
    return result;
  };
  function reportHistory() {
    const history = { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
    onHistoryChange(history);
    void hikari.call('app.setHistory', history).catch(() => {});
  }
  function publish() { onChange(documentState, library.activeId); onLibraryChange(readLibrary(library)); onViewChange(readView()); reportHistory(); }
  async function writeJson(path, value) {
    const dataBase64 = encodeText(JSON.stringify(value));
    if (dataBase64.length > 24000000) throw new Error('The illustration exceeds the file storage size limit. Use smaller assets.');
    await hikari.call('files.write', { path, dataBase64 });
  }
  async function readJson(path) {
    return JSON.parse(decodeText((await hikari.call('files.read', { path })).dataBase64));
  }
  async function loadAsset(id) {
    if (!assetLibrary.assets.some(asset => asset.id === id)) throw new Error('This reusable asset does not exist. Refresh Assets.');
    return normalizeAsset(await readJson(assetPath(id)), validateSvg);
  }
  function rasterComponent(raster, name) {
    return normalizeAsset({ version: 1, name, objects: [{ id: `raster-${crypto.randomUUID()}`, name, type: 'raster', canvas: 'main',
      x: 0, y: 0, ...fitRasterBox(raster.width, raster.height), textFree: true, dataUrl: raster.dataUrl }] });
  }
  const assetEntry = (asset, fingerprint, origin) => ({ id: crypto.randomUUID(), name: asset.name, width: asset.width, height: asset.height,
    objectCount: asset.objects.length, updatedAt: new Date().toISOString(), fingerprint, origin });
  async function saveAutomaticAssets(snapshots, deadline) {
    const additions = [], saved = [];
    for (const { asset, origin, ...reference } of snapshots) {
      const fingerprint = await signature(assetContent(asset));
      const existing = [...assetLibrary.assets, ...additions.map(item => item.entry)].find(entry => entry.fingerprint === fingerprint);
      const entry = existing || assetEntry(asset, fingerprint, origin);
      if (!existing) additions.push({ entry, asset });
      saved.push({ ...reference, asset_id: entry.id, name: entry.name, reused: Boolean(existing) });
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
      return { ok: true, status: 'asset_render', asset_id: args.asset_id, previews: [{ ...preview, canvas: 'asset' }] };
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
      if (args.illustration_id !== library.activeId) return { ...failure('illustration_changed', 'Another illustration is open. Reopen the intended illustration before saving components.'), ...readLibrary(library) };
      if (args.expected_revision !== documentState.revision) return { ...failure('revision_conflict', 'The figure changed. Read it again before saving components.'), revision: documentState.revision };
      raster = imported ? await prepareRaster(imported.data_url, { trim: true }) : null;
      asset = raster ? rasterComponent(raster, args.name.trim()) : snapshotAsset(documentState, args, validateSvg);
      const fingerprint = await signature(assetContent(asset));
      entry = raster && assetLibrary.assets.find(item => item.fingerprint === fingerprint);
      if (entry) asset = null;
      else entry = assetEntry(asset, fingerprint, imported?.source === 'codex' ? 'codex' : imported ? 'storage' : 'manual');
    } else {
      entry = assetLibrary.assets.find(item => item.id === args.asset_id);
      if (!entry) return failure('not_found', 'This reusable asset does not exist.');
    }
    const saving = args.action === 'asset_save';
    const next = normalizeAssetLibrary({ ...assetLibrary, revision: crypto.randomUUID(), assets: asset ? [...assetLibrary.assets, entry] : saving ? assetLibrary.assets : assetLibrary.assets.filter(item => item.id !== entry.id),
      receipts: [...assetLibrary.receipts, { id: args.request_id, hash, assetId: entry.id }].slice(-64) });
    if (Date.now() >= deadline) return failure('expired', 'The asset request expired before saving.');
    await hikari.call('app.setUnsaved', { unsaved: true });
    try {
      if (asset) await writeJson(assetPath(entry.id), asset);
      await writeJson(ASSETS_PATH, next);
      assetLibrary = next; onAssetsChange(readAssetLibrary(assetLibrary)); onStatus(saving ? 'Asset saved' : 'Asset removed');
      // No file-removal verb is needed. Reclaim deleted bytes only after the
      // index commits; failure here cannot invalidate the committed library.
      if (!saving) await writeJson(assetPath(entry.id), { deleted: true }).catch(() => {});
      const trim = raster && (({ dataUrl, ...metadata }) => metadata)(raster);
      return { ok: true, status: saving ? 'asset_saved' : 'asset_deleted', persisted: true, asset_id: entry.id,
        ...(trim ? { raster_import: trim } : {}), ...readAssetLibrary(assetLibrary) };
    } finally { await hikari.call('app.setUnsaved', { unsaved: false }); }
  }
  async function save(next) {
    onStatus('Saving…');
    await hikari.call('app.setUnsaved', { unsaved: true });
    try {
      const entry = library.illustrations.find(item => item.id === library.activeId);
      const path = nextScenePath(entry);
      const nextLibrary = { ...library, revision: crypto.randomUUID(), illustrations: library.illustrations.map(item => item.id === entry.id
        ? { ...item, path, title: next.title, updatedAt: new Date().toISOString() } : item) };
      await writeJson(path, next);
      await writeJson(LIBRARY_PATH, nextLibrary);
      documentState = next; library = nextLibrary; publish(); onStatus('');
    } finally { await hikari.call('app.setUnsaved', { unsaved: false }); }
  }
  async function apply(args, deadline = Infinity, importedIds = [], { agentRequest = false, inspectionRunId = '', importedSources = {} } = {}) {
    const hash = await signature(args);
    const receipt = documentState.receipts.find(item => item.id === args.request_id);
    if (receipt) return receipt.hash === hash
      ? { ok: true, status: 'already_applied', illustration_id: library.activeId, applied_revision: receipt.revision, inserted_assets: receipt.inserted_assets || [],
        raster_imports: receipt.raster_imports || [], auto_saved_assets: receipt.auto_saved_assets || [], ...readDocument(documentState), ...readLibrary(library), ...readAssetLibrary(assetLibrary) }
      : failure('request_id_conflict', 'This request_id was already used with different arguments.');
    if (documentState.revision !== args.expected_revision) return { ...failure('revision_conflict', 'The user or another request changed the figure. Read it again before applying.'), revision: documentState.revision };
    const operations = [], insertedAssets = [];
    const placementDocument = { ...documentState, canvases: { ...documentState.canvases } };
    for (const operation of args.operations) {
      if (operation.op !== 'insert_asset') {
        operations.push(operation);
        if (operation.op === 'canvas' && CANVASES.includes(operation.canvas)) placementDocument.canvases[operation.canvas] = { ...placementDocument.canvases[operation.canvas], ...operation.patch };
        continue;
      }
      const instance = instantiateAsset(await loadAsset(operation.asset_id), operation, placementDocument);
      operations.push(...instance.operations); insertedAssets.push(instance.inserted);
    }
    let next = applyOperations(documentState, operations, validateSvg);
    // Decode raster bytes before persistence: invalid/truncated images fail the
    // entire batch, and no inaccessible asset can break future readback.
    // Newly imported images fit their box to the image's aspect ratio (keeping
    // width); manual resizing afterwards may still stretch them deliberately.
    const imported = new Set(importedIds), copies = new Set(insertedAssets.flatMap(item => item.ids));
    const rasterImports = [], snapshots = [], prepared = new Map();
    for (const obj of next.objects.filter(object => object.type === 'raster')) {
      const changed = documentState.objects.find(object => object.id === obj.id)?.dataUrl !== obj.dataUrl;
      const incoming = imported.has(obj.id) || (agentRequest && changed && !copies.has(obj.id));
      const key = `${incoming}:${obj.dataUrl}`;
      if (!prepared.has(key)) prepared.set(key, await prepareRaster(obj.dataUrl, { trim: incoming }));
      const raster = prepared.get(key);
      if (!incoming) continue;
      obj.dataUrl = raster.dataUrl;
      Object.assign(obj, fitRasterBox(raster.width, raster.height, obj.width));
      const { dataUrl, ...metadata } = raster;
      rasterImports.push({ object_id: obj.id, ...metadata });
      if (agentRequest || importedSources[obj.id] === 'codex') snapshots.push({ asset: rasterComponent(raster, obj.name.trim() || 'Generated component'),
        origin: importedSources[obj.id] === 'codex' ? 'codex' : importedSources[obj.id] === 'storage' ? 'storage' : 'agent', object_id: obj.id });
    }
    next = normalizeDocument(next, validateSvg);
    if (Date.now() >= deadline) return failure('expired', 'The request expired before application. Read the figure again.');
    const previous = documentState;
    const groupsToSave = [];
    if (agentRequest) for (const group of compoundGroups(next)) {
      const before = previous.groups.find(item => item.id === group.id);
      const current = snapshotAsset(next, { id: group.id, name: group.name.trim() || 'Compound component' }, validateSvg);
      if (!before || await signature(assetContent(current)) !== await signature(assetContent(snapshotAsset(previous, { id: before.id, name: before.name.trim() || 'Compound component' }, validateSvg)))) groupsToSave.push(group.id);
    }
    if (groupsToSave.length) next.pendingAssetGroups = [...new Set([...(next.pendingAssetGroups || []), ...groupsToSave])];
    const autoSavedAssets = await saveAutomaticAssets(snapshots, deadline);
    next.receipts = [...next.receipts, { id: args.request_id, hash, revision: next.revision, inserted_assets: insertedAssets,
      raster_imports: rasterImports, auto_saved_assets: autoSavedAssets }].slice(-64);
    if (JSON.stringify(next).length > MAX_DOCUMENT_CHARS) throw new Error('The illustration is too large. Use smaller assets.');
    await save(next);
    undoStack.push(previous); if (undoStack.length > 25) undoStack.shift(); redoStack.length = 0; reportHistory();
    return { ok: true, status: 'applied', persisted: true, illustration_id: library.activeId, inserted_assets: insertedAssets,
      raster_imports: rasterImports, auto_saved_assets: autoSavedAssets, ...readDocument(documentState), ...readLibrary(library), ...readAssetLibrary(assetLibrary) };
  }
  async function libraryAction(args, deadline) {
    if (args.action === 'list') return { ok: true, status: 'listed', ...readLibrary(library) };
    const hash = await signature(args);
    const receipt = library.receipts.find(item => item.id === args.request_id);
    if (receipt) return receipt.hash === hash ? { ok: true, status: 'already_applied', illustration_id: receipt.illustrationId, ...readLibrary(library) }
      : failure('request_id_conflict', 'This request_id was already used with different arguments.');
    if (args.expected_library_revision !== library.revision) return { ...failure('revision_conflict', 'The illustration library changed. List it again.'), ...readLibrary(library) };
    const original = library.illustrations.find(item => item.id === args.illustration_id);
    if (args.action !== 'create' && !original) return failure('not_found', 'This illustration does not exist.');
    if (args.action !== 'open' && library.illustrations.length >= 100) return failure('limit', 'The library holds at most 100 illustrations.');
    const id = args.action === 'open' ? original.id : crypto.randomUUID();
    const next = args.action === 'create' ? createDocument() : normalizeDocument(await readJson(original.path), validateSvg);
    if (args.action !== 'open') {
      next.title = args.title?.trim() || (args.action === 'duplicate' ? `${next.title} copy`.slice(0, 200) : 'Untitled figure');
      next.revision = crypto.randomUUID(); next.receipts = [];
      if (args.action === 'create' && args.source !== undefined) next.source = normalizeSourceContext(args.source);
    }
    const entry = { id, title: next.title, path: `illustrations/${id}/scene-a.json`, updatedAt: new Date().toISOString() };
    const nextLibrary = { ...library, revision: crypto.randomUUID(), activeId: id,
      illustrations: args.action === 'open' ? library.illustrations : [...library.illustrations, entry],
      receipts: [...library.receipts, { id: args.request_id, hash, illustrationId: id }].slice(-64) };
    if (Date.now() >= deadline) return failure('expired', 'The request expired before selection.');
    await hikari.call('app.setUnsaved', { unsaved: true });
    try {
      if (args.action !== 'open') await writeJson(entry.path, next);
      await writeJson(LIBRARY_PATH, nextLibrary);
      library = nextLibrary; documentState = next; undoStack.length = 0; redoStack.length = 0;
      scratchVisible = false;
      publish(); onStatus('');
      return { ok: true, status: args.action === 'open' ? 'opened' : 'created', illustration_id: id, ...readLibrary(library), ...readDocument(documentState) };
    } finally { await hikari.call('app.setUnsaved', { unsaved: false }); }
  }
  async function request(input, deadline = Infinity, assets = {}, { inspectionRunId = '', agentRequest = false } = {}) {
    let args; const importedIds = [], importedSources = Object.create(null);
    try {
      args = JSON.parse(JSON.stringify(input));
      if (LIBRARY_ACTIONS.includes(args.action)) validateLibraryRequest(args);
      else if (ASSET_ACTIONS.includes(args.action)) validateAssetRequest(args);
      else {
        if (args.illustration_id !== undefined && !validId(args.illustration_id)) throw new Error('Invalid illustration_id.');
        for (const operation of args.operations || []) {
          if (!operation.raster_asset) continue;
          if (!['upsert', 'update'].includes(operation.op)) throw new Error('raster_asset is only supported by upsert/update.');
          const target = operation.op === 'upsert' ? operation.object : operation.patch;
          if (!target || target.textFree !== true || (operation.op === 'upsert' && target.type !== 'raster')) throw new Error('Raster import requires a raster object/patch with textFree: true.');
          const asset = Object.hasOwn(assets, operation.raster_asset) && assets[operation.raster_asset];
          if (!asset?.data_url) throw new Error(`Missing raster asset: ${operation.raster_asset}`);
          target.dataUrl = asset.data_url;
          importedIds.push(operation.op === 'upsert' ? target.id : operation.id);
          importedSources[operation.op === 'upsert' ? target.id : operation.id] = asset.source;
          delete operation.raster_asset;
        }
        const { illustration_id: _illustrationId, ...drawingRequest } = args;
        validateRequest(drawingRequest);
      }
    } catch (error) { return failure('invalid_arguments', error.message); }
    return enqueue(async () => {
      try {
        if (Date.now() >= deadline) return failure('expired', 'The request expired.');
        const run = assetRun(inspectionRunId);
        if (args.action === 'asset_list' && agentRequest) run.checked = true;
        if (agentRequest && inspectionRunId && ['apply', 'asset_save', 'inspect'].includes(args.action) && !run.checked) return failure('assets_required', 'First call asset_list in this run. Inspect relevant matches with asset_read and asset_render before generating or modifying components.');
        if (LIBRARY_ACTIONS.includes(args.action)) return await libraryAction(args, deadline);
        if (ASSET_ACTIONS.includes(args.action)) return await assetAction(args, deadline, assets);
        if (args.illustration_id && args.illustration_id !== library.activeId) return { ...failure('illustration_changed', 'Another illustration is open. List and open the intended illustration before editing.'), ...readLibrary(library) };
        if (args.action === 'inspection_status') return { ok: true, status: 'inspection_status', illustration_id: library.activeId,
          revision: documentState.revision, inspection: inspections.status(library.activeId, documentState.revision, inspectionRunId) };
        if (args.action === 'inspect') {
          const status = inspections.status(library.activeId, documentState.revision, inspectionRunId, true);
          if (!status.inspection_id || args.inspection_id !== status.inspection_id || args.expected_revision !== documentState.revision) return inspections.inspect(library.activeId, documentState.revision, inspectionRunId, args);
          const snapshots = agentRequest ? compoundGroups(documentState).filter(group => documentState.pendingAssetGroups?.includes(group.id)).map(group => ({
            asset: snapshotAsset(documentState, { id: group.id, name: group.name.trim() || 'Compound component' }, validateSvg), origin: 'agent-group', group_id: group.id
          })) : [];
          const autoSavedAssets = await saveAutomaticAssets(snapshots, deadline);
          // Pending group IDs are part of the saved scene, so interrupted runs
          // and reloads cannot bypass archiving. Acknowledge only after the
          // asset index commits; a failed acknowledgement is safe to retry.
          if (agentRequest && documentState.pendingAssetGroups?.length) {
            if (Date.now() >= deadline) return failure('expired', 'The group save expired. Render and inspect again.');
            await save({ ...documentState, pendingAssetGroups: [] });
          }
          const result = inspections.inspect(library.activeId, documentState.revision, inspectionRunId, args);
          return { ...result, auto_saved_assets: autoSavedAssets, ...readAssetLibrary(assetLibrary), ...readLibrary(library) };
        }
        if (args.action === 'scratch') {
          scratchVisible = args.visible; onViewChange(readView());
          return { ok: true, status: 'view_updated', illustration_id: library.activeId, revision: documentState.revision, ...readView() };
        }
        if (args.action === 'apply') return await apply(args, deadline, importedIds, { agentRequest, inspectionRunId, importedSources });
        if (args.action === 'render') {
          const canvases = !args.canvas || args.canvas === 'both' ? CANVASES : [args.canvas];
          const previews = await Promise.all(canvases.map(key => renderPreview(documentState, key)));
          if (Date.now() >= deadline) return failure('expired', 'The render expired. Render both canvases again before inspecting.');
          return { ok: true, status: 'rendered', illustration_id: library.activeId, revision: documentState.revision, ...readView(), previews,
            inspection: inspections.rendered(library.activeId, documentState.revision, inspectionRunId, canvases) };
        }
        return { ok: true, status: 'read', illustration_id: library.activeId, ...readDocument(documentState, args.include_assets), ...readLibrary(library), ...readAssetLibrary(assetLibrary), ...readView(),
          inspection: inspections.status(library.activeId, documentState.revision, inspectionRunId), asset_reuse: { required: true, checked: run.checked },
          agent_contract: { request_schema: CANVAS_TOOL_CONTRACT.inputSchema, instructions: agentInstructions(documentState.complexity, documentState.imageGenerationPercent) } };
      } catch (error) { onStatus(error.message); return failure('failed', error.message); }
    }).catch(error => failure('unavailable', error.message));
  }
  async function history(direction) {
    return enqueue(async () => {
      const from = direction === 'redo' ? redoStack : undoStack;
      const to = direction === 'redo' ? undoStack : redoStack;
      if (!from.length) return;
      const restored = { ...from[from.length - 1], revision: crypto.randomUUID(), receipts: documentState.receipts };
      const current = documentState;
      await save(restored); from.pop(); to.push(current); reportHistory();
    });
  }
  ready = (async () => {
    const { value: stored } = await hikari.call('storage.get');
    if (stored?.version === 2 && stored.libraryPath) {
      if (stored.libraryPath !== LIBRARY_PATH) throw new Error('Invalid library path.');
      library = normalizeLibrary(await readJson(LIBRARY_PATH));
      documentState = normalizeDocument(await readJson(library.illustrations.find(item => item.id === library.activeId).path), validateSvg);
    } else {
      const id = crypto.randomUUID();
      documentState = stored?.workspacePath ? normalizeDocument(await readJson(stored.workspacePath), validateSvg) : createDocument();
      const path = stored?.workspacePath || `illustrations/${id}/scene-a.json`;
      library = normalizeLibrary({ version: 1, revision: crypto.randomUUID(), activeId: id, receipts: [],
        illustrations: [{ id, title: documentState.title, path, updatedAt: new Date().toISOString() }] });
      if (!stored?.workspacePath) await writeJson(path, documentState);
      await writeJson(LIBRARY_PATH, library);
    }
    if (stored?.assetsPath) {
      if (stored.assetsPath !== ASSETS_PATH) throw new Error('Invalid reusable asset library path.');
      assetLibrary = normalizeAssetLibrary(await readJson(ASSETS_PATH));
    } else {
      assetLibrary = createAssetLibrary(); await writeJson(ASSETS_PATH, assetLibrary);
      await hikari.call('storage.set', { value: { version: 2, libraryPath: LIBRARY_PATH, assetsPath: ASSETS_PATH } });
    }
    onAssetsChange(readAssetLibrary(assetLibrary));
    publish(); onStatus('');
  })();
  ready.catch(error => onStatus(`Could not open illustration: ${error.message}`));
  return { ready, request, history, getDocument: () => documentState, getLibrary: () => library && readLibrary(library), getAssets: () => assetLibrary && readAssetLibrary(assetLibrary), getView: readView,
    async paste(snapshot, { illustrationId, canvas, offset = 15 }) {
      // Capture the clipboard before joining the shared persistence queue.
      const copied = structuredClone(snapshot);
      return enqueue(async () => {
        try {
          if (illustrationId !== library.activeId) return failure('illustration_changed', 'Another illustration is open. Paste into the active illustration.');
          const instance = instantiateClipboard(copied, canvas, offset, validateSvg);
          // A single local action can contain all 200 objects plus their groups;
          // scene validation still enforces the shared size and object limits.
          const result = await apply({ action: 'apply', expected_revision: documentState.revision,
            request_id: crypto.randomUUID(), operations: instance.operations });
          return { ...result, pasted_ids: instance.ids };
        } catch (error) { onStatus(error.message); return failure('failed', error.message); }
      });
    },
    async importAsset(input) { return enqueue(async () => {
      try {
        let asset;
        if (input.type === 'raster') {
          if (input.textFree !== true) throw new Error('Confirm that imported artwork contains no text.');
          asset = rasterComponent(await prepareRaster(input.dataUrl), input.name.trim());
        } else if (input.type === 'vector') {
          const svg = validateSvg(input.svg), box = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
          asset = normalizeAsset({ version: 1, name: input.name.trim(), objects: [{ id: `vector-${crypto.randomUUID()}`, name: input.name.trim(),
            type: 'vector', canvas: 'main', x: 0, y: 0, ...fitRasterBox(box[2], box[3]), svg }] }, validateSvg);
        } else throw new Error('Import SVG, PNG, JPEG, or WebP artwork.');
        const [saved] = await saveAutomaticAssets([{ asset, origin: 'manual' }], Infinity);
        onStatus(saved.reused ? 'This asset is already saved' : 'Asset imported');
        return { ok: true, status: 'asset_imported', persisted: true, ...saved, ...readAssetLibrary(assetLibrary) };
      } catch (error) { onStatus(error.message); return failure('failed', error.message); }
    }); },
    async manageAsset(action, params = {}) { return enqueue(async () => {
      try {
        const args = { action, ...(action === 'asset_save' ? { illustration_id: library.activeId, expected_revision: documentState.revision } : {}),
          ...params, expected_assets_revision: assetLibrary.revision, request_id: crypto.randomUUID() };
        validateAssetRequest(args); return await assetAction(args, Infinity);
      } catch (error) { onStatus(error.message); return failure('failed', error.message); }
    }); },
    async manage(action, id, title, source) { return enqueue(async () => {
      try {
        const args = { action, ...(id ? { illustration_id: id } : {}), ...(title ? { title } : {}),
          ...(source !== undefined ? { source } : {}),
          expected_library_revision: library.revision, request_id: crypto.randomUUID() };
        validateLibraryRequest(args);
        return await libraryAction(args, Infinity);
      }
      catch (error) { onStatus(error.message); return failure('failed', error.message); }
    }); },
    async flush() { await tail; await ready; },
    async exportSvg(canvas) { await tail; await ready; return svgSource(documentState, canvas); } };
}
