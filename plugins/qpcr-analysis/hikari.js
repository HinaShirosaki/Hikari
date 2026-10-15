// Implements docs/plugins/plugin-api.md §1.1; no renderer or preload access.
(function createDocumentedClient(root) {
  'use strict';
  const pending = new Map();
  const listeners = new Map();
  let sequence = 0;
  let disposed = false;
  const prefix = Math.random().toString(36).slice(2);

  function receive(event) {
    if (event.source !== root.parent || disposed) return;
    const message = event.data;
    if (!message || message.hikari !== 1) return;
    if (typeof message.event === 'string') {
      for (const listener of listeners.get(message.event) || []) {
        try { listener(message.payload); } catch (error) { root.console.error(error); }
      }
      return;
    }
    const call = pending.get(message.id);
    if (!call || typeof message.ok !== 'boolean') return;
    pending.delete(message.id);
    root.clearTimeout(call.timer);
    if (message.ok) call.resolve(message.result);
    else call.reject(new Error(typeof message.error === 'string' ? message.error : 'Hikari rejected the request.'));
  }

  function call(verb, params = {}) {
    if (disposed || !root.parent || root.parent === root) return Promise.reject(new Error('Open this tool from Hikari → Tools to use saved inputs, notebook pages, and exports.'));
    if (typeof verb !== 'string' || !verb.trim() || !params || typeof params !== 'object' || Array.isArray(params)) return Promise.reject(new Error('A plugin call needs a verb and an object of parameters.'));
    const id = `${prefix}_${++sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = verb === 'downloads.save' ? 600000 : 10000;
      const timer = root.setTimeout(() => {
        pending.delete(id);
        reject(new Error('Hikari did not answer. Reload the installed tool or try connecting again.'));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { root.parent.postMessage({ hikari: 1, id, verb, params }, '*'); }
      catch (error) { root.clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }

  function on(event, listener) {
    if (typeof listener !== 'function') throw new Error('A host event needs a listener.');
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
    return () => listeners.get(event)?.delete(listener);
  }

  function dispose() {
    disposed = true;
    root.removeEventListener('message', receive);
    for (const entry of pending.values()) {
      root.clearTimeout(entry.timer);
      entry.reject(new Error('The tool closed before Hikari answered.'));
    }
    pending.clear();
    listeners.clear();
  }
  root.addEventListener('message', receive);
  root.addEventListener('pagehide', dispose, { once: true });
  root.HikariPlugin = Object.freeze({ hikari: Object.freeze({ call, on }) });
}(window));
