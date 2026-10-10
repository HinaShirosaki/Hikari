import { resolveManifestViewIds } from './manifest-runtime.js';
import { showTransientNotice } from '../lib/notify.js';

// History follows the visible module, including the shared agent rail. The
// toolbar retains the editor it came from; switching views selects that view's
// history even when its stack is empty.
export function createModuleHistoryRuntime(manifests, context) {
  const { rootDocument: document, modules } = context;
  const ownerOf = manifest => manifest.historyOwner || manifest.key;
  const routes = new Map(manifests.flatMap(manifest =>
    resolveManifestViewIds(manifest, context).map(view => [view, ownerOf(manifest)])));
  let lastView = '';
  let lastOwner = '';
  let lastRail = null;
  const visibleRail = rail => rail && rail.isConnected !== false && rail.hidden !== true
    && rail.getAttribute?.('aria-hidden') !== 'true' && rail.dataset?.state !== 'collapsed';

  function getHistoryOwner() {
    const view = document?.body?.dataset?.activeView || '';
    const active = document?.activeElement;
    if (view !== lastView) { lastView = view; lastOwner = routes.get(view) || ''; }
    const rail = active?.closest?.('#universal-agent-chat-rail');
    if (visibleRail(rail)) { lastRail = rail; lastOwner = 'agentChatRail'; }
    else if (!active?.closest?.('.topbar-history-controls')) lastOwner = routes.get(view) || '';
    if (lastOwner === 'agentChatRail' && !visibleRail(lastRail)) lastOwner = routes.get(view) || '';
    return lastOwner;
  }

  function restoredModules({ owner, changes }) {
    const visible = routes.get(document?.body?.dataset?.activeView);
    const keys = new Set(changes.map(change => change.path[0]));
    return manifests.filter(manifest => ownerOf(manifest) === owner
      || (ownerOf(manifest) === visible && manifest.historyStateKeys?.some(key => keys.has(key))));
  }

  function beforeHistoryRestore(change) {
    if (restoredModules(change).some(manifest => modules[manifest.key]?.hasUnsavedChanges?.())) {
      showTransientNotice('Save or discard the open editor changes before undoing saved changes.', { type: 'error' });
      return false;
    }
    return true;
  }

  function restoreHistory(change) {
    for (const manifest of restoredModules(change)) {
      // This is independent of bootOrder. Modules can opt into a dedicated
      // restore hook when their editor keeps local derived state.
      const render = manifest.renderHistory || manifest.render || manifest.renderAll;
      try { render?.(context, { viewId: document?.body?.dataset?.activeView, history: change }); }
      catch (error) {
        console.error(`Module "${manifest.key}" failed to refresh history:`, error);
        showTransientNotice('The change was restored, but its view could not refresh. Reopen the module.', { type: 'error' });
      }
    }
  }

  return { getHistoryOwner, beforeHistoryRestore, restoreHistory };
}
