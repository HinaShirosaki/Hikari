import { createDocument, normalizeDocument, applyOperations, readDocument, validateRequest, CANVASES } from './model.mjs';
import { validateSvg, renderPreview, svgSource } from './artwork.mjs';
import { CANVAS_TOOL_CONTRACT } from './agent/canvas-contract.mjs';
import { agentInstructions } from './agent/workflow.mjs';
import { LIBRARY_PATH, LIBRARY_ACTIONS, normalizeLibrary, readLibrary, nextScenePath, validateLibraryRequest } from './library.mjs';

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

export function createWorkspace({ hikari, onChange = () => {}, onLibraryChange = () => {}, onViewChange = () => {}, onHistoryChange = () => {}, onStatus = () => {} }) {
  let documentState;
  let ready;
  let tail = Promise.resolve();
  let library;
  let scratchVisible = false;
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
      documentState = next; library = nextLibrary; publish(); onStatus('Saved');
    } finally { await hikari.call('app.setUnsaved', { unsaved: false }); }
  }
  async function apply(args, deadline = Infinity) {
    const hash = await signature(args);
    const receipt = documentState.receipts.find(item => item.id === args.request_id);
    if (receipt) return receipt.hash === hash
      ? { ok: true, status: 'already_applied', illustration_id: library.activeId, applied_revision: receipt.revision, ...readDocument(documentState), ...readLibrary(library) }
      : failure('request_id_conflict', 'This request_id was already used with different arguments.');
    if (documentState.revision !== args.expected_revision) return { ...failure('revision_conflict', 'The user or another request changed the figure. Read it again before applying.'), revision: documentState.revision };
    const next = applyOperations(documentState, args.operations, validateSvg);
    // Decode raster bytes before persistence: invalid/truncated images fail the
    // entire batch, and no inaccessible asset can break future readback.
    await Promise.all(next.objects.filter(obj => obj.type === 'raster').map(obj => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => image.naturalWidth * image.naturalHeight <= 64000000 ? resolve() : reject(new Error('Raster images must be at most 64 megapixels.'));
      image.onerror = () => reject(new Error(`Could not decode raster artwork ${obj.name}.`)); image.src = obj.dataUrl;
    })));
    if (Date.now() >= deadline) return failure('expired', 'The request expired before application. Read the figure again.');
    const previous = documentState;
    next.receipts = [...next.receipts, { id: args.request_id, hash, revision: next.revision }].slice(-64);
    await save(next);
    undoStack.push(previous); if (undoStack.length > 25) undoStack.shift(); redoStack.length = 0; reportHistory();
    return { ok: true, status: 'applied', persisted: true, illustration_id: library.activeId, ...readDocument(documentState), ...readLibrary(library) };
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
      publish(); onStatus('Saved');
      return { ok: true, status: args.action === 'open' ? 'opened' : 'created', illustration_id: id, ...readLibrary(library), ...readDocument(documentState) };
    } finally { await hikari.call('app.setUnsaved', { unsaved: false }); }
  }
  async function request(input, deadline = Infinity, assets = {}) {
    let args;
    try {
      args = JSON.parse(JSON.stringify(input));
      if (LIBRARY_ACTIONS.includes(args.action)) validateLibraryRequest(args);
      else {
        if (args.illustration_id !== undefined && (typeof args.illustration_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(args.illustration_id))) throw new Error('Invalid illustration_id.');
        for (const operation of args.operations || []) {
          if (!operation.raster_asset) continue;
          if (!['upsert', 'update'].includes(operation.op)) throw new Error('raster_asset is only supported by upsert/update.');
          const target = operation.op === 'upsert' ? operation.object : operation.patch;
          if (!target || target.textFree !== true || (operation.op === 'upsert' && target.type !== 'raster')) throw new Error('Raster import requires a raster object/patch with textFree: true.');
          const asset = Object.hasOwn(assets, operation.raster_asset) && assets[operation.raster_asset];
          if (!asset?.data_url) throw new Error(`Missing raster asset: ${operation.raster_asset}`);
          target.dataUrl = asset.data_url;
          delete operation.raster_asset;
        }
        const { illustration_id: _illustrationId, ...drawingRequest } = args;
        validateRequest(drawingRequest);
      }
    } catch (error) { return failure('invalid_arguments', error.message); }
    return enqueue(async () => {
      try {
        if (Date.now() >= deadline) return failure('expired', 'The request expired.');
        if (LIBRARY_ACTIONS.includes(args.action)) return await libraryAction(args, deadline);
        if (args.illustration_id && args.illustration_id !== library.activeId) return { ...failure('illustration_changed', 'Another illustration is open. List and open the intended illustration before editing.'), ...readLibrary(library) };
        if (args.action === 'scratch') {
          scratchVisible = args.visible; onViewChange(readView());
          return { ok: true, status: 'view_updated', illustration_id: library.activeId, revision: documentState.revision, ...readView() };
        }
        if (args.action === 'apply') return await apply(args, deadline);
        if (args.action === 'render') {
          const canvases = !args.canvas || args.canvas === 'both' ? CANVASES : [args.canvas];
          return { ok: true, status: 'rendered', illustration_id: library.activeId, revision: documentState.revision, ...readView(), previews: await Promise.all(canvases.map(key => renderPreview(documentState, key))) };
        }
        return { ok: true, status: 'read', illustration_id: library.activeId, ...readDocument(documentState, args.include_assets), ...readLibrary(library), ...readView(),
          agent_contract: { tool: 'plugin_canvas', plugin_id: 'scientific-illustration', request_schema: CANVAS_TOOL_CONTRACT.inputSchema, instructions: agentInstructions(documentState.complexity) } };
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
      await hikari.call('storage.set', { value: { version: 2, libraryPath: LIBRARY_PATH } });
    }
    publish(); onStatus('Saved');
  })();
  ready.catch(error => onStatus(`Could not open illustration: ${error.message}`));
  return { ready, request, history, getDocument: () => documentState, getLibrary: () => library && readLibrary(library), getView: readView,
    async manage(action, id, title) { return enqueue(async () => {
      try {
        const args = { action, ...(id ? { illustration_id: id } : {}), ...(title ? { title } : {}),
          expected_library_revision: library.revision, request_id: crypto.randomUUID() };
        validateLibraryRequest(args);
        return await libraryAction(args, Infinity);
      }
      catch (error) { onStatus(error.message); return failure('failed', error.message); }
    }); },
    async flush() { await tail; await ready; },
    async exportSvg(canvas) { await tail; await ready; return svgSource(documentState, canvas); } };
}
