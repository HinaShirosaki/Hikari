import { asArray } from '../lib/normalize.js';
import { PLUGIN_SAVE_TIMEOUT_MS, PROTOCOL_MARKER, buildPluginAppContext, text } from './plugin-bridge/helpers.js';
import { VERBS } from './plugin-bridge/verbs.js';
import { pluginOrigin } from './plugin-origin.js';

export function createPluginBridge({
  state,
  persist,
  onNotebookEntriesChanged,
  onFrameHistoryChanged = null,
  onPluginPrompt = null,
  onPluginChatContext = null,
  notify = null,
  windowObject = globalThis.window,
  api = windowObject?.hikariApi || null
} = {}) {
  // WindowProxy identity survives navigation, so a grant also needs the
  // loopback origin assigned before the plugin document is loaded.
  const frames = new Map();
  const canvasRequests = new Map();
  function requestCanvas({ id, plugin_id: pluginId, request, assets, deadline, inspectionRunId }) {
    const target = [...frames.entries()].find(([, { plugin }]) => plugin.id === pluginId
      && plugin.enabled !== false && asArray(plugin.permissions).includes('agent:canvas'));
    if (!target) return Promise.resolve({ ok: false, status: 'unavailable', error: 'Enable the requested local plugin with agent:canvas permission and reload Hikari.' });
    const [frame, registration] = target;
    return new Promise(resolve => {
      const finish = result => { windowObject.clearTimeout(timer); canvasRequests.delete(id); resolve(result); };
      const timer = windowObject.setTimeout(() => finish({ ok: false, status: 'acknowledgement_timeout', error: 'The canvas frame did not acknowledge the request. Read again or retry identical arguments.' }), Math.max(1, deadline - Date.now()));
      canvasRequests.set(id, { frame, registration, finish });
      try { frame.postMessage({ hikari: PROTOCOL_MARKER, event: 'agent.canvas', payload: { id, request, assets, deadline, inspectionRunId } }, registration.origin); }
      catch (error) { finish({ ok: false, status: 'unavailable', error: error.message }); }
    });
  }
  function respondCanvas({ id, result }, frame) {
    const entry = canvasRequests.get(id);
    if (!entry || entry.frame !== frame || frames.get(frame) !== entry.registration) throw new Error('Unknown canvas request.');
    if (!result || typeof result.ok !== 'boolean') throw new Error('Invalid canvas response.');
    entry.finish(result);
    return { acknowledged: true };
  }
  // Notebook "Add gel" handoff, host side: queueNotebookGel remembers the page
  // and pings the bundled Gel frame; Gel then pulls it with the internal
  // gel.takeNotebookLink verb (takeNotebookGel). Pulling instead of pushing
  // keeps the entry off postMessage to any frame but the verified bundled Gel,
  // and clearing on take makes the link one-shot.
  let pendingNotebookGel = null;

  function queueNotebookGel({ notebookEntryId } = {}) {
    const entry = asArray(state.notebookEntries).find((item) => item.id === notebookEntryId);
    if (!entry) throw new Error('Open a saved notebook page before adding a gel.');
    const targets = [...frames.entries()].filter(([, { plugin }]) => (
      plugin.id === 'gel' && plugin.bundled === true && plugin.path === '@bundled/gel'
    ));
    if (!targets.length) throw new Error('Gel is still loading or unavailable. Try again after opening Gel.');
    pendingNotebookGel = entry.id;
    targets.forEach(([frame, { origin }]) => {
      frame.postMessage({ hikari: PROTOCOL_MARKER, event: 'gel.notebookLink', payload: {} }, origin);
    });
  }

  function takeNotebookGel() {
    const entry = asArray(state.notebookEntries).find((item) => item.id === pendingNotebookGel);
    pendingNotebookGel = null;
    if (!entry) return null;
    // Only the selected page's display/link metadata crosses the plugin boundary.
    return {
      id: entry.id,
      projectId: entry.projectId || '',
      projectName: entry.projectName || '',
      experimentName: entry.experimentName || '',
      protocolName: entry.protocolName || '',
      notebookType: entry.notebookType || 'biology'
    };
  }

  function register(frameWindow, plugin, baseUrl) {
    const origin = pluginOrigin(baseUrl);
    if (frameWindow && plugin && origin) {
      frames.set(frameWindow, { plugin, origin });
    }
  }

  function broadcast(eventName, payload = {}) {
    const event = text(eventName, 80);
    if (!event) {
      return;
    }
    frames.forEach(({ origin }, frameWindow) => {
      frameWindow?.postMessage?.({
        hikari: PROTOCOL_MARKER,
        event,
        payload
      }, origin);
    });
  }

  // Plugins that have reported unsaved work: id -> label. The host's quit guard
  // (unsavedChangesService) reads this so a frame's in-progress work blocks the
  // close the same way a built-in editor's does.
  const unsavedPlugins = new Map();
  const saveWaiters = new Map();
  // frameWindow -> { canUndo, canRedo } as last reported by that frame.
  const frameHistory = new Map();

  function pluginHistory(frameWindow, history) {
    if (!frameWindow) {
      return;
    }
    frameHistory.set(frameWindow, history);
    onFrameHistoryChanged?.(history);
  }

  // The history a frame reported, or null when that frame is not registered.
  function getFrameHistory(frameWindow) {
    if (!frameWindow || !frames.has(frameWindow)) {
      return null;
    }
    return frameHistory.get(frameWindow) || null;
  }

  // Host -> plugin history command. One frame, not a broadcast: undo belongs to
  // whichever frame the user is editing in.
  function sendFrameHistoryCommand(frameWindow, command) {
    const event = command === 'redo' ? 'app.redo' : 'app.undo';
    if (!frameWindow || !frames.has(frameWindow)) {
      return false;
    }
    frameWindow.postMessage?.({ hikari: PROTOCOL_MARKER, event, payload: {} }, frames.get(frameWindow).origin);
    return true;
  }

  function pluginUnsaved(plugin, unsaved) {
    const id = text(plugin?.id, 200);
    if (!id) {
      return;
    }
    if (unsaved) {
      unsavedPlugins.set(id, text(plugin.name, 200) || id);
      return;
    }
    unsavedPlugins.delete(id);
    (saveWaiters.get(id) || []).forEach((resolve) => resolve(true));
    saveWaiters.delete(id);
  }

  // Asking a frame to save is a broadcast plus a wait for its next
  // app.setUnsaved push — there is no request/reply in the host->plugin
  // direction. A frame that never answers resolves false and the guard reports
  // it, rather than hanging the quit.
  function requestPluginSave(id) {
    return new Promise((resolve) => {
      const waiters = saveWaiters.get(id) || [];
      waiters.push(resolve);
      saveWaiters.set(id, waiters);
      broadcast('app.save', { pluginId: id });
      windowObject?.setTimeout?.(() => resolve(!unsavedPlugins.has(id)), PLUGIN_SAVE_TIMEOUT_MS);
    });
  }

  function getUnsavedSources() {
    return Array.from(unsavedPlugins.entries()).map(([id, label]) => ({
      key: `plugin:${id}`,
      label,
      moduleApi: {
        hasUnsavedChanges: () => unsavedPlugins.has(id),
        saveUnsavedChanges: () => requestPluginSave(id)
      }
    }));
  }

  function broadcastAppContext(changed = '') {
    frames.forEach(({ plugin, origin }, frameWindow) => {
      frameWindow?.postMessage?.({ hikari: PROTOCOL_MARKER, event: 'app.context',
        payload: buildPluginAppContext(state, changed, windowObject, plugin.id) }, origin);
    });
  }

  function handleMessage(event) {
    const request = event?.data;
    if (!request
      || typeof request !== 'object'
      || request.hikari !== PROTOCOL_MARKER
      || request.call) {
      return;
    }
    const registration = frames.get(event.source);
    if (!registration) {
      return;
    }
    if (event.origin !== registration.origin) {
      frames.delete(event.source);
      frameHistory.delete(event.source);
      onFrameHistoryChanged?.();
      // The document that reported unsaved work is gone, so the host can no
      // longer ask it to save. Withdraw the quit-guard source instead of
      // blocking every future quit on a frame that can never answer.
      pluginUnsaved(registration.plugin, false);
      return;
    }
    const { plugin, origin } = registration;
    const reply = (payload) => {
      // An async read may finish after navigation or revocation. The browser
      // checks the target origin again at delivery, even if no new call arrived.
      if (frames.get(event.source) === registration) {
        event.source?.postMessage?.({ hikari: PROTOCOL_MARKER, id: request.id, ...payload }, origin);
      }
    };

    const verb = VERBS[text(request.verb, 80)];
    if (!verb) {
      reply({ ok: false, error: `Unknown verb "${text(request.verb, 80)}".` });
      return;
    }
    if (
      verb.internal
      && (plugin.bundled !== true || plugin.id !== verb.bundledPluginId || plugin.path !== `@bundled/${plugin.id}`)
    ) {
      reply({ ok: false, error: `Unknown verb "${text(request.verb, 80)}".` });
      return;
    }
    if (verb.permission && !asArray(plugin.permissions).includes(verb.permission)) {
      reply({
        ok: false,
        error: `Plugin "${plugin.id}" did not declare the "${verb.permission}" permission in plugin.json.`
      });
      return;
    }

    try {
      if (
        request.params !== undefined
        && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))
      ) {
        throw new Error(`Plugin call "${text(request.verb, 80)}" needs an object for params.`);
      }
      const params = request.params || {};
      const result = verb.handler(params, {
        state,
        persist,
        plugin,
        onNotebookEntriesChanged,
        api,
        pluginUnsaved,
        pluginHistory,
        takeNotebookGel,
        respondCanvas,
        onPluginPrompt,
        onPluginChatContext,
        notify,
        frameWindow: event.source,
        windowObject
      });
      // Filesystem verbs are async; the rest stay synchronous so a reply still
      // lands in the same turn as the request.
      if (result && typeof result.then === 'function') {
        result.then(
          (resolved) => reply({ ok: true, result: resolved }),
          (error) => reply({ ok: false, error: String(error?.message || error) })
        );
      } else {
        reply({ ok: true, result });
      }
    } catch (error) {
      reply({ ok: false, error: String(error?.message || error) });
    }
  }

  windowObject?.addEventListener?.('message', handleMessage);
  windowObject?.document?.addEventListener?.('hikari:agent-chat-rail-state', () => broadcastAppContext('layout'));
  return {
    register,
    requestCanvas,
    queueNotebookGel,
    handleMessage,
    broadcast,
    broadcastAppContext,
    getFrameHistory,
    getUnsavedSources,
    sendFrameHistoryCommand
  };
}

export const PLUGIN_BRIDGE_VERBS = Object.freeze(
  Object.fromEntries(
    Object.entries(VERBS)
      .filter(([, verb]) => !verb.internal)
      .map(([name, verb]) => [name, verb.permission])
  )
);
