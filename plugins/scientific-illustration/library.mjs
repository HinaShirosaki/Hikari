// The index is the commit point. Alternating scene files let an index-write
// failure preserve the prior scene without needing host transaction APIs.
import { applyOperations, createDocument, normalizeDocument, normalizeSourceContext, readDocument, validId } from './model.mjs';
import { validateSvg } from './artwork.mjs';

export const LIBRARY_PATH = 'library.json';
export const LIBRARY_ACTIONS = ['list', 'create', 'open', 'duplicate'];
export function normalizeLibrary(raw) {
  if (raw?.version !== 1 || !validId(raw.revision) || !Array.isArray(raw.illustrations)
    || !raw.illustrations.length || raw.illustrations.length > 100) throw new Error('Invalid illustration library.');
  const entries = raw.illustrations.map(entry => {
    if (!validId(entry.id) || typeof entry.title !== 'string' || entry.title.length > 200
      || !['workspace.json', `illustrations/${entry.id}/scene-a.json`, `illustrations/${entry.id}/scene-b.json`].includes(entry.path)) throw new Error('Invalid illustration entry.');
    return { id: entry.id, title: entry.title, path: entry.path, updatedAt: String(entry.updatedAt || '') };
  });
  if (new Set(entries.map(entry => entry.id)).size !== entries.length || !entries.some(entry => entry.id === raw.activeId)) throw new Error('Invalid illustration selection.');
  return { version: 1, revision: raw.revision, activeId: raw.activeId, illustrations: entries, receipts: Array.isArray(raw.receipts) ? raw.receipts.slice(-64) : [] };
}
export function readLibrary(library) {
  return { library_revision: library.revision, active_illustration_id: library.activeId,
    illustrations: library.illustrations.map(({ path: _path, ...entry }) => entry) };
}
export function nextScenePath(entry) {
  return `illustrations/${entry.id}/scene-${entry.path?.endsWith('/scene-a.json') ? 'b' : 'a'}.json`;
}
export function validateLibraryRequest(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !LIBRARY_ACTIONS.includes(args.action)) throw new Error('Invalid library action.');
  const allowed = ['action', 'illustration_id', 'title', 'source', 'expected_library_revision', 'request_id'];
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unknown library request field.');
  if (args.action === 'list') {
    if (Object.keys(args).length !== 1) throw new Error('List takes only action.');
    return;
  }
  if (!validId(args.expected_library_revision) || !validId(args.request_id)) throw new Error('Read the library first; supply expected_library_revision and a unique request_id.');
  if (['open', 'duplicate'].includes(args.action) && !validId(args.illustration_id)) throw new Error('Select an illustration_id from the library.');
  if (args.action === 'create' && args.illustration_id !== undefined) throw new Error('Create assigns a new illustration_id.');
  if (args.source !== undefined) {
    if (args.action !== 'create') throw new Error('Source context can only be attached to a new illustration.');
    normalizeSourceContext(args.source);
  }
  if (args.action === 'open' && args.title !== undefined) throw new Error('Use a title operation to rename an illustration.');
  if (args.title !== undefined && (typeof args.title !== 'string' || args.title.length > 200)) throw new Error('Title must be at most 200 characters.');
}

export function encodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function decodeText(encoded) {
  return new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
}
export async function signature(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export const failure = (status, error) => ({ ok: false, status, error });

export function createFileStore(hikari) {
  async function writeJson(path, value) {
    const dataBase64 = encodeText(JSON.stringify(value));
    if (dataBase64.length > 24000000) throw new Error('The illustration exceeds the file storage size limit. Use smaller assets.');
    await hikari.call('files.write', { path, dataBase64 });
  }
  async function readJson(path) {
    return JSON.parse(decodeText((await hikari.call('files.read', { path })).dataBase64));
  }
  // The host drops the storage blob on a root switch or a fresh profile, so a
  // missing pointer is not a first run. A file that exists but does not parse
  // still throws: overwriting it would orphan every scene it indexes.
  async function readExistingJson(path) {
    let dataBase64;
    try { ({ dataBase64 } = await hikari.call('files.read', { path })); } catch (error) {
      if (/\bENOENT\b|^Plugin file not found\.?$/.test(error.message)) return null;
      throw error;
    }
    return JSON.parse(decodeText(dataBase64));
  }
  return { writeJson, readJson, readExistingJson };
}

// Only persisted scenes pass through this compatibility adapter. New edits
// still validate against the single-canvas model and cannot add scratch data.
function migrateStoredDocument(raw) {
  if (raw?.version !== 1 || !raw.canvases?.scratch) return raw;
  return { ...raw,
    canvases: { main: raw.canvases.main },
    objects: Array.isArray(raw.objects) ? raw.objects.map(object => object.canvas === 'scratch' ? { ...object, canvas: 'main' } : object) : raw.objects,
    groups: Array.isArray(raw.groups) ? raw.groups.map(group => group.canvas === 'scratch' ? { ...group, canvas: 'main' } : group) : raw.groups
  };
}

export function createIllustrationLibrary({ hikari, files, onChange, onLibraryChange, onPublish, onResetHistory, onStatus, recordUndo }) {
  const { readJson, readExistingJson, writeJson } = files;
  let library, documentState;

  function publish() {
    onChange(documentState, library.activeId);
    onLibraryChange(readLibrary(library));
    onPublish();
  }
  async function loadScene(path) {
    const raw = await readJson(path), migrated = migrateStoredDocument(raw);
    return { document: normalizeDocument(migrated, validateSvg), migrated: migrated !== raw };
  }

  async function commitLibrary(nextLibrary, { path, scene, active = false, resetHistory = false } = {}) {
    await hikari.call('app.setUnsaved', { unsaved: true });
    try {
      if (path) await writeJson(path, scene);
      await writeJson(LIBRARY_PATH, nextLibrary);
      library = nextLibrary;
      if (active) {
        documentState = scene;
        if (resetHistory) onResetHistory();
        publish();
      } else onLibraryChange(readLibrary(library));
      onStatus('');
    } finally { await hikari.call('app.setUnsaved', { unsaved: false }); }
  }
  async function save(next, entry = library.illustrations.find(item => item.id === library.activeId)) {
    const path = nextScenePath(entry);
    const nextLibrary = { ...library, revision: crypto.randomUUID(), illustrations: library.illustrations.map(item => item.id === entry.id
      ? { ...item, path, title: next.title, updatedAt: new Date().toISOString() } : item) };
    await commitLibrary(nextLibrary, { path, scene: next, active: entry.id === library.activeId });
  }

  async function sceneFor(entry) {
    return entry.id === library.activeId ? documentState : (await loadScene(entry.path)).document;
  }
  async function renameIllustration(entry, title) {
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('Enter an illustration name.');
    title = title.trim();
    const previous = await sceneFor(entry);
    if (previous.title === title) return { ok: true };
    await save(applyOperations(previous, [{ op: 'title', title }], validateSvg), entry);
    if (entry.id === library.activeId) recordUndo(previous);
    return { ok: true };
  }
  async function deleteIllustration(entry) {
    const index = library.illustrations.indexOf(entry);
    const illustrations = library.illustrations.filter(item => item.id !== entry.id);
    const nextLibrary = { ...library, revision: crypto.randomUUID(), illustrations };
    if (entry.id === library.activeId) {
      let replacement = illustrations[Math.min(index, illustrations.length - 1)];
      let path, scene;
      if (replacement) {
        const loaded = await loadScene(replacement.path);
        scene = loaded.document;
        if (loaded.migrated) {
          path = nextScenePath(replacement);
          illustrations[illustrations.indexOf(replacement)] = { ...replacement, path };
        }
      } else {
        const id = crypto.randomUUID();
        path = `illustrations/${id}/scene-a.json`;
        scene = createDocument();
        replacement = { id, path, title: scene.title, updatedAt: new Date().toISOString() };
        illustrations.push(replacement);
      }
      nextLibrary.activeId = replacement.id;
      await commitLibrary(nextLibrary, { path, scene, active: true, resetHistory: true });
    } else await commitLibrary(nextLibrary);
    // The index commits first. The host only supports overwriting scene files.
    const paths = [`illustrations/${entry.id}/scene-a.json`, `illustrations/${entry.id}/scene-b.json`];
    if (entry.path === 'workspace.json' && !illustrations.some(item => item.path === entry.path)) paths.push(entry.path);
    await Promise.all(paths.map(path => writeJson(path, { deleted: true }).catch(() => {})));
    return { ok: true };
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
    const loaded = args.action === 'create' ? null : await loadScene(original.path);
    const next = loaded ? loaded.document : createDocument();
    const migrating = args.action === 'open' && loaded.migrated;
    if (args.action !== 'open') {
      next.title = args.title?.trim() || (args.action === 'duplicate' ? `${next.title} copy`.slice(0, 200) : 'Untitled figure');
      next.revision = crypto.randomUUID(); next.receipts = [];
      if (args.action === 'create' && args.source !== undefined) next.source = normalizeSourceContext(args.source);
    }
    const entry = { id, title: next.title, path: args.action === 'open' ? migrating ? nextScenePath(original) : original.path : `illustrations/${id}/scene-a.json`, updatedAt: new Date().toISOString() };
    const nextLibrary = { ...library, revision: crypto.randomUUID(), activeId: id,
      illustrations: args.action === 'open' ? library.illustrations.map(item => item.id === id && migrating ? entry : item) : [...library.illustrations, entry],
      receipts: [...library.receipts, { id: args.request_id, hash, illustrationId: id }].slice(-64) };
    if (Date.now() >= deadline) return failure('expired', 'The request expired before selection.');
    await commitLibrary(nextLibrary, { path: args.action !== 'open' || migrating ? entry.path : undefined,
      scene: next, active: true, resetHistory: true });
    return { ok: true, status: args.action === 'open' ? 'opened' : 'created', illustration_id: id, ...readLibrary(library), ...readDocument(documentState) };
  }

  async function load(stored) {
    const indexed = stored?.version === 2 && stored.libraryPath;
    const foundLibrary = indexed ? null : await readExistingJson(LIBRARY_PATH);
    if (indexed || foundLibrary) {
      if (indexed && stored.libraryPath !== LIBRARY_PATH) throw new Error('Invalid library path.');
      library = normalizeLibrary(foundLibrary || await readJson(LIBRARY_PATH));
      const entry = library.illustrations.find(item => item.id === library.activeId);
      const loaded = await loadScene(entry.path);
      documentState = loaded.document;
      if (loaded.migrated) {
        const path = nextScenePath(entry);
        const nextLibrary = { ...library, revision: crypto.randomUUID(), illustrations: library.illustrations.map(item => item.id === entry.id ? { ...item, path } : item) };
        await writeJson(path, documentState);
        await writeJson(LIBRARY_PATH, nextLibrary);
        library = nextLibrary;
      }
    } else {
      const id = crypto.randomUUID();
      const legacyPath = stored?.workspacePath || 'workspace.json';
      const legacy = stored?.workspacePath ? await readJson(legacyPath) : await readExistingJson(legacyPath);
      const migrated = migrateStoredDocument(legacy);
      documentState = legacy ? normalizeDocument(migrated, validateSvg) : createDocument();
      const path = legacy && migrated === legacy ? legacyPath : `illustrations/${id}/scene-a.json`;
      library = normalizeLibrary({ version: 1, revision: crypto.randomUUID(), activeId: id, receipts: [],
        illustrations: [{ id, title: documentState.title, path, updatedAt: new Date().toISOString() }] });
      if (path !== legacyPath) await writeJson(path, documentState);
      await writeJson(LIBRARY_PATH, library);
    }
  }

  async function manage(action, id, title, source) {
    try {
      if (action === 'rename' || action === 'delete') {
        const entry = library.illustrations.find(item => item.id === id);
        if (!entry) return failure('not_found', 'This illustration does not exist.');
        return action === 'rename' ? await renameIllustration(entry, title) : await deleteIllustration(entry);
      }
      const args = {
        action,
        ...(id ? { illustration_id: id } : {}),
        ...(title ? { title } : {}),
        ...(source !== undefined ? { source } : {}),
        expected_library_revision: library.revision,
        request_id: crypto.randomUUID()
      };
      validateLibraryRequest(args);
      return await libraryAction(args, Infinity);
    } catch (error) {
      onStatus(error.message);
      return failure('failed', error.message);
    }
  }

  async function getExportDocument(id) {
    const entry = library.illustrations.find(item => item.id === (id || library.activeId));
    if (!entry) throw new Error('This illustration does not exist.');
    return sceneFor(entry);
  }

  return {
    load, publish, save, manage, getExportDocument, request: libraryAction,
    getIndex: () => library,
    getDocument: () => documentState,
    read: () => library && readLibrary(library)
  };
}
