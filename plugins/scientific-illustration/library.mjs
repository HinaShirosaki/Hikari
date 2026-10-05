// The index is the commit point. Alternating scene files let an index-write
// failure preserve the prior scene without needing host transaction APIs.
import { validId } from './model.mjs';
import { normalizeSourceContext } from './source-context.mjs';

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
