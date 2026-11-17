import { normalizeDocument, applyOperations, readDocument, validateRequest, CANVASES, MAX_DOCUMENT_CHARS, validId } from './model.mjs';
import { EMPTY_PLOT_SVG, fitRasterBox, preparePlots, prepareRaster, validateSvg } from './artwork.mjs';
import { renderPreview } from './figure-export.mjs';
import { CANVAS_TOOL_CONTRACT, agentInstructions, createInspectionTracker } from './agent/figure-agent.mjs';
import { instantiateClipboard } from './clipboard.mjs';
import { createFileStore, createIllustrationLibrary, failure, LIBRARY_ACTIONS, LIBRARY_PATH, readLibrary, signature, validateLibraryRequest } from './library.mjs';
import { ASSETS_PATH, ASSET_ACTIONS, assetContent, compoundGroups, createReusableAssetStore, instantiateAsset, snapshotAsset, validateAssetRequest } from './reusable-assets.mjs';

export { encodeText } from './library.mjs';

export function createWorkspace({ hikari, onChange = () => {}, onLibraryChange = () => {}, onAssetsChange = () => {}, onHistoryChange = () => {}, onStatus = () => {} }) {
  const files = createFileStore(hikari);
  const inspections = createInspectionTracker();
  const assetRuns = new Map();
  const undoStack = [], redoStack = [];
  let tail = Promise.resolve();
  const illustrations = createIllustrationLibrary({
    hikari, files, onLibraryChange, onStatus, recordUndo,
    onChange,
    onPublish: reportHistory,
    onResetHistory() { undoStack.length = 0; redoStack.length = 0; }
  });
  const assetStore = createReusableAssetStore({
    hikari, files, onAssetsChange, onStatus,
    getContext: () => ({ library: illustrations.getIndex(), documentState: illustrations.getDocument() })
  });

  function assetRun(runId, illustrationId) {
    let run = assetRuns.get(runId);
    if (!run || run.illustrationId !== illustrationId) {
      run = { illustrationId: illustrationId, checked: false };
      assetRuns.delete(runId); assetRuns.set(runId, run);
      if (assetRuns.size > 64) assetRuns.delete(assetRuns.keys().next().value);
    }
    return run;
  }

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

  function recordUndo(previous) {
    undoStack.push(previous);
    if (undoStack.length > 25) undoStack.shift();
    redoStack.length = 0;
    reportHistory();
  }

  async function apply(args, deadline = Infinity, importedIds = [], { agentRequest = false, inspectionRunId = '', importedSources = {} } = {}) {
    const library = illustrations.getIndex(), documentState = illustrations.getDocument();
    const hash = await signature(args);
    const receipt = documentState.receipts.find(item => item.id === args.request_id);
    if (receipt) return receipt.hash === hash
      ? { ok: true, status: 'already_applied', illustration_id: library.activeId, applied_revision: receipt.revision, inserted_assets: receipt.inserted_assets || [],
        raster_imports: receipt.raster_imports || [], auto_saved_assets: receipt.auto_saved_assets || [], ...readDocument(documentState), ...readLibrary(library), ...assetStore.read() }
      : failure('request_id_conflict', 'This request_id was already used with different arguments.');
    if (documentState.revision !== args.expected_revision) return { ...failure('revision_conflict', 'The user or another request changed the figure. Read it again before applying.'), revision: documentState.revision };
    const operations = [], insertedAssets = [];
    const placementDocument = { ...documentState, canvases: { ...documentState.canvases } };
    for (const operation of args.operations) {
      if (operation.op !== 'insert_asset') {
        operations.push(operation.op === 'upsert' && operation.object?.type === 'plot' && !operation.object.svg
          ? { ...operation, object: { ...operation.object, svg: EMPTY_PLOT_SVG } } : operation);
        if (operation.op === 'canvas' && CANVASES.includes(operation.canvas)) placementDocument.canvases[operation.canvas] = { ...placementDocument.canvases[operation.canvas], ...operation.patch };
        continue;
      }
      const instance = instantiateAsset(await assetStore.loadAsset(operation.asset_id), operation, placementDocument);
      operations.push(...instance.operations); insertedAssets.push(instance.inserted);
    }
    let next = applyOperations(documentState, operations, validateSvg);
    await preparePlots(next, documentState, hikari, validateSvg);
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
      if (agentRequest || importedSources[obj.id] === 'codex') snapshots.push({ asset: assetStore.rasterComponent(raster, obj.name.trim() || 'Generated component', obj),
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
    const autoSavedAssets = await assetStore.saveAutomaticAssets(snapshots, deadline);
    next.receipts = [...next.receipts, { id: args.request_id, hash, revision: next.revision, inserted_assets: insertedAssets,
      raster_imports: rasterImports, auto_saved_assets: autoSavedAssets }].slice(-64);
    if (JSON.stringify(next).length > MAX_DOCUMENT_CHARS) throw new Error('The illustration is too large. Use smaller assets.');
    await illustrations.save(next);
    if (agentRequest && inspectionRunId) inspections.edited(inspectionRunId);
    recordUndo(previous);
    return { ok: true, status: 'applied', persisted: true, illustration_id: library.activeId, inserted_assets: insertedAssets,
      raster_imports: rasterImports, auto_saved_assets: autoSavedAssets, ...readDocument(illustrations.getDocument()), ...illustrations.read(), ...assetStore.read() };
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
        const library = illustrations.getIndex(), documentState = illustrations.getDocument();
        const run = assetRun(inspectionRunId, library.activeId);
        if (args.action === 'asset_list' && agentRequest) run.checked = true;
        if (agentRequest && inspectionRunId && ['apply', 'asset_save', 'inspect'].includes(args.action) && !run.checked) return failure('assets_required', 'First call asset_list in this run. Inspect relevant matches with asset_read and asset_render before generating or modifying components.');
        if (LIBRARY_ACTIONS.includes(args.action)) return await illustrations.request(args, deadline);
        if (ASSET_ACTIONS.includes(args.action)) return await assetStore.request(args, deadline, assets);
        if (args.illustration_id && args.illustration_id !== library.activeId) return { ...failure('illustration_changed', 'Another illustration is open. List and open the intended illustration before editing.'), ...readLibrary(library) };
        if (args.action === 'inspection_status') return { ok: true, status: 'inspection_status', illustration_id: library.activeId,
          revision: documentState.revision, inspection: inspections.status(library.activeId, documentState.revision, inspectionRunId) };
        if (args.action === 'inspect') {
          const status = inspections.status(library.activeId, documentState.revision, inspectionRunId, true);
          if (!status.inspection_id || args.inspection_id !== status.inspection_id || args.expected_revision !== documentState.revision) return inspections.inspect(library.activeId, documentState.revision, inspectionRunId, args);
          const snapshots = agentRequest ? compoundGroups(documentState).filter(group => documentState.pendingAssetGroups?.includes(group.id)).map(group => ({
            asset: snapshotAsset(documentState, { id: group.id, name: group.name.trim() || 'Compound component' }, validateSvg), origin: 'agent-group', group_id: group.id
          })) : [];
          const autoSavedAssets = await assetStore.saveAutomaticAssets(snapshots, deadline);
          // Pending group IDs are part of the saved scene, so interrupted runs
          // and reloads cannot bypass archiving. Acknowledge only after the
          // asset index commits; a failed acknowledgement is safe to retry.
          if (agentRequest && documentState.pendingAssetGroups?.length) {
            if (Date.now() >= deadline) return failure('expired', 'The group save expired. Render and inspect again.');
            await illustrations.save({ ...documentState, pendingAssetGroups: [] });
          }
          const result = inspections.inspect(library.activeId, documentState.revision, inspectionRunId, args);
          return { ...result, auto_saved_assets: autoSavedAssets, ...assetStore.read(), ...illustrations.read() };
        }
        if (args.action === 'apply') return await apply(args, deadline, importedIds, { agentRequest, inspectionRunId, importedSources });
        if (args.action === 'render') {
          const canvases = !args.canvas || args.canvas === 'both' ? CANVASES : [args.canvas];
          const previews = await Promise.all(canvases.map(key => renderPreview(documentState, key)));
          if (Date.now() >= deadline) return failure('expired', 'The render expired. Render the canvas again before inspecting.');
          return { ok: true, status: 'rendered', illustration_id: library.activeId, revision: documentState.revision, previews,
            inspection: inspections.rendered(library.activeId, documentState.revision, inspectionRunId, canvases) };
        }
        return { ok: true, status: 'read', illustration_id: library.activeId, ...readDocument(documentState, args.include_assets), ...readLibrary(library), ...assetStore.read(),
          inspection: inspections.status(library.activeId, documentState.revision, inspectionRunId), asset_reuse: { required: true, checked: run.checked },
          agent_contract: { request_schema: CANVAS_TOOL_CONTRACT.inputSchema, instructions: agentInstructions(documentState.complexity, documentState.imageGenerationPercent, documentState.imageGenerationStyle, documentState.imageStyleLine, documentState.palette) } };
      } catch (error) { onStatus(error.message); return failure('failed', error.message); }
    }).catch(error => failure('unavailable', error.message));
  }

  async function history(direction) {
    return enqueue(async () => {
      const from = direction === 'redo' ? redoStack : undoStack;
      const to = direction === 'redo' ? undoStack : redoStack;
      if (!from.length) return;
      const documentState = illustrations.getDocument();
      const restored = { ...from[from.length - 1], revision: crypto.randomUUID(), receipts: documentState.receipts };
      const current = documentState;
      await illustrations.save(restored); from.pop(); to.push(current); reportHistory();
    });
  }

  const ready = (async () => {
    const { value: stored } = await hikari.call('storage.get');
    await illustrations.load(stored);
    await assetStore.load(stored);
    if (!stored?.assetsPath) await hikari.call('storage.set', { value: { version: 2, libraryPath: LIBRARY_PATH, assetsPath: ASSETS_PATH } });
    assetStore.publish();
    illustrations.publish();
    onStatus('');
  })();
  ready.catch(error => onStatus(`Could not open illustration: ${error.message}`));

  return {
    ready, request, history,
    getDocument: illustrations.getDocument,
    getLibrary: illustrations.read,
    getAssets: assetStore.read,
    async paste(snapshot, { illustrationId, canvas, offset = 15 }) {
      // Capture the clipboard before joining the shared persistence queue.
      const copied = structuredClone(snapshot);
      return enqueue(async () => {
        try {
          const library = illustrations.getIndex(), documentState = illustrations.getDocument();
          if (illustrationId !== library.activeId) return failure('illustration_changed', 'Another illustration is open. Paste into the active illustration.');
          const instance = instantiateClipboard(copied, canvas, offset, validateSvg);
          // A single local action can contain every object plus their groups;
          // scene validation still enforces the shared size and object limits.
          const result = await apply({ action: 'apply', expected_revision: documentState.revision,
            request_id: crypto.randomUUID(), operations: instance.operations });
          return { ...result, pasted_ids: instance.ids };
        } catch (error) { onStatus(error.message); return failure('failed', error.message); }
      });
    },
    importAsset: input => enqueue(() => assetStore.importAsset(input)),
    manageAsset: (action, params) => enqueue(() => assetStore.manage(action, params)),
    manage: (action, id, title, source) => enqueue(() => illustrations.manage(action, id, title, source)),
    async flush() { await tail; await ready; },
    getExportDocument: id => enqueue(() => illustrations.getExportDocument(id))
  };
}
