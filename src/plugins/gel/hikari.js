// Hikari plugin client. Load this as a classic script before your plugin code:
//
//   <script src="./hikari.js"></script>
//   <script src="./main.js"></script>
//
// Then call `window.HikariPlugin.hikari.call(...)`. Keeping this file classic
// makes the same copy work in local opaque-origin plugins and served plugins.
(function installHikariPluginClient(root) {
  'use strict';

  if (root.HikariPlugin?.hikari) {
    return;
  }

  const PROTOCOL_MARKER = 1;
  const CALL_TIMEOUT_MS = 10000;
  // The timeout is here to catch "no host is listening", which is answered in
  // milliseconds or never. Verbs that wait on a person (a native save dialog),
  // on bulk file I/O, or on a subprocess legitimately take longer, and there is
  // no cancel message — so a short budget makes the client report failure for
  // work the host goes on to finish. They get a budget measured in minutes
  // instead. `python.run` alone can sit for the runner's full 15s ceiling.
  const SLOW_CALL_TIMEOUT_MS = 600000;
  const SLOW_VERBS = ['downloads.save', 'migration.importLegacyGel', 'python.run'];
  const parentWindow = root.parent;
  const pending = new Map();
  const eventListeners = new Map();
  let nextCallId = 0;

  root.addEventListener('message', (event) => {
    if (event.source !== parentWindow) {
      return;
    }
    const reply = event.data;
    if (!reply || typeof reply !== 'object' || reply.hikari !== PROTOCOL_MARKER) {
      return;
    }
    if (reply.event) {
      const listeners = eventListeners.get(String(reply.event)) || [];
      listeners.forEach((listener) => {
        try {
          listener(reply.payload && typeof reply.payload === 'object' ? reply.payload : {});
        } catch (error) {
          console.error(`Hikari event listener failed for "${reply.event}":`, error);
        }
      });
      return;
    }
    const settle = pending.get(reply.id);
    if (!settle) {
      return;
    }
    pending.delete(reply.id);
    root.clearTimeout(settle.timer);
    if (reply.ok) {
      settle.resolve(reply.result);
    } else {
      settle.reject(new Error(reply.error || 'Hikari call failed.'));
    }
  });

  const hikari = Object.freeze({
    call(rawVerb, params = {}) {
      const verb = String(rawVerb || '').trim();
      if (!verb) {
        return Promise.reject(new Error('Hikari calls need a non-empty verb.'));
      }
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return Promise.reject(new Error(`Hikari call "${verb}" needs an object for params.`));
      }
      if (!parentWindow || parentWindow === root) {
        return Promise.reject(new Error(`Hikari call "${verb}" is available only inside an installed Hikari plugin.`));
      }

      return new Promise((resolve, reject) => {
        const id = `call_${nextCallId += 1}`;
        const timer = root.setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Hikari call "${verb}" timed out. Is the plugin installed and enabled?`));
        }, SLOW_VERBS.indexOf(verb) >= 0 ? SLOW_CALL_TIMEOUT_MS : CALL_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        try {
          parentWindow.postMessage({ hikari: PROTOCOL_MARKER, id, verb, params }, '*');
        } catch (error) {
          pending.delete(id);
          root.clearTimeout(timer);
          reject(new Error(`Could not send Hikari call "${verb}": ${error?.message || error}`));
        }
      });
    },

    on(eventName, listener) {
      const event = String(eventName || '').trim();
      if (!event || typeof listener !== 'function') {
        return () => {};
      }
      const listeners = eventListeners.get(event) || [];
      listeners.push(listener);
      eventListeners.set(event, listeners);
      return () => {
        const next = (eventListeners.get(event) || []).filter((entry) => entry !== listener);
        if (next.length) {
          eventListeners.set(event, next);
        } else {
          eventListeners.delete(event);
        }
      };
    }
  });

  root.HikariPlugin = Object.freeze({ hikari });
}(window));
