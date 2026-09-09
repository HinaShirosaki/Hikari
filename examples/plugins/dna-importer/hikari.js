// Hikari plugin client. This service uses it only for the permission-gated
// python.run call, but keeps the normal client contract used by view plugins.
(function installHikariPluginClient(root) {
  'use strict';

  if (root.HikariPlugin && root.HikariPlugin.hikari) {
    return;
  }

  const PROTOCOL_MARKER = 1;
  const CALL_TIMEOUT_MS = 10000;
  const SLOW_CALL_TIMEOUT_MS = 600000;
  const SLOW_VERBS = ['downloads.save', 'migration.importLegacyGel', 'python.run'];
  const parentWindow = root.parent;
  const pending = new Map();
  const eventListeners = new Map();
  let nextCallId = 0;

  root.addEventListener('message', function (event) {
    if (event.source !== parentWindow) {
      return;
    }
    const reply = event.data;
    if (!reply || typeof reply !== 'object' || reply.hikari !== PROTOCOL_MARKER) {
      return;
    }
    if (reply.event) {
      const listeners = eventListeners.get(String(reply.event)) || [];
      listeners.forEach(function (listener) {
        try {
          listener(reply.payload && typeof reply.payload === 'object' ? reply.payload : {});
        } catch (error) {
          console.error('Hikari event listener failed for "' + reply.event + '":', error);
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
    call: function (rawVerb, params) {
      const verb = String(rawVerb || '').trim();
      const input = params === undefined ? {} : params;
      if (!verb) {
        return Promise.reject(new Error('Hikari calls need a non-empty verb.'));
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return Promise.reject(new Error('Hikari call "' + verb + '" needs an object for params.'));
      }
      if (!parentWindow || parentWindow === root) {
        return Promise.reject(new Error('Hikari call "' + verb + '" is available only inside an installed Hikari plugin.'));
      }

      return new Promise(function (resolve, reject) {
        const id = 'call_' + (nextCallId += 1);
        const timer = root.setTimeout(function () {
          pending.delete(id);
          reject(new Error('Hikari call "' + verb + '" timed out. Is the plugin installed and enabled?'));
        }, SLOW_VERBS.indexOf(verb) >= 0 ? SLOW_CALL_TIMEOUT_MS : CALL_TIMEOUT_MS);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try {
          parentWindow.postMessage({ hikari: PROTOCOL_MARKER, id: id, verb: verb, params: input }, '*');
        } catch (error) {
          pending.delete(id);
          root.clearTimeout(timer);
          reject(new Error('Could not send Hikari call "' + verb + '": ' + ((error && error.message) || error)));
        }
      });
    },

    on: function (eventName, listener) {
      const event = String(eventName || '').trim();
      if (!event || typeof listener !== 'function') {
        return function () {};
      }
      const listeners = eventListeners.get(event) || [];
      listeners.push(listener);
      eventListeners.set(event, listeners);
      return function () {
        const next = (eventListeners.get(event) || []).filter(function (entry) {
          return entry !== listener;
        });
        if (next.length) {
          eventListeners.set(event, next);
        } else {
          eventListeners.delete(event);
        }
      };
    }
  });

  root.HikariPlugin = Object.freeze({ hikari: hikari });
}(window));
