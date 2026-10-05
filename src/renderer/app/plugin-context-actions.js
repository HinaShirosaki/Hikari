import { isAgentAvailable } from '../lib/agent-availability.js';
import { capturePluginActionContext } from './plugin-action-context.js';

export function normalizeContextActions(params) {
  if (!params || Object.keys(params).some(key => key !== 'actions') || !Array.isArray(params.actions) || params.actions.length > 8) throw new Error('Context actions require at most eight declarative actions.');
  const ids = new Set();
  return params.actions.map(action => {
    if (!action || Object.keys(action).some(key => !['id', 'label', 'contexts', 'requiresAgent'].includes(key))) throw new Error('Invalid context action fields.');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(action.id || '') || ids.has(action.id)) throw new Error('Context action IDs must be unique lowercase identifiers.');
    ids.add(action.id);
    if (typeof action.label !== 'string' || !action.label.trim() || action.label.length > 100) throw new Error('Context actions need a label of at most 100 characters.');
    if (!Array.isArray(action.contexts) || !action.contexts.length || action.contexts.length > 2 || new Set(action.contexts).size !== action.contexts.length
      || action.contexts.some(context => !['protocol', 'paper-selection'].includes(context))) throw new Error('Use protocol or paper-selection contexts.');
    if (action.requiresAgent !== undefined && typeof action.requiresAgent !== 'boolean') throw new Error('requiresAgent must be boolean.');
    return { ...action, contexts: [...action.contexts], label: action.label.trim(), requiresAgent: action.requiresAgent === true };
  });
}

export function createPluginContextActions({ state, windowObject, api, getRegistration, activate }) {
  const entries = new Map(), pending = new Map();
  let sequence = 0;
  const doc = windowObject?.document;
  const valid = (frame, entry) => getRegistration(frame) === entry.registration
    && entry.registration.plugin.enabled !== false && entry.registration.plugin.permissions?.includes('layout');
  function changed() {
    const Event = doc?.defaultView?.CustomEvent;
    if (Event) doc.dispatchEvent(new Event('hikari:context-actions-changed'));
  }
  function finish(id, result) {
    const entry = pending.get(id);
    if (!entry) return;
    windowObject.clearTimeout(entry.timer); pending.delete(id); entry.resolve(result);
  }
  function clear(frame) {
    const removed = entries.delete(frame);
    for (const [id, entry] of pending) if (entry.frame === frame) finish(id, { ok: false, error: 'The plugin workspace reloaded. Try again.' });
    if (removed) changed();
  }
  function set(params, frame) {
    const actions = normalizeContextActions(params), registration = getRegistration(frame);
    if (!registration) throw new Error('The plugin workspace is unavailable.');
    // A reloaded document can keep the same WindowProxy and loopback origin.
    // Registering its actions again withdraws the previous document's handoff.
    for (const [id, entry] of pending) if (entry.frame === frame) finish(id, { ok: false, error: 'The plugin actions changed. Try again.' });
    entries.set(frame, { registration, actions }); changed();
    return { registered: actions.length };
  }
  function list(context) {
    return [...entries].filter(([frame, entry]) => valid(frame, entry)).flatMap(([, entry]) => entry.actions
      .filter(action => action.contexts.includes(context)).map(action => ({ ...action, key: `${entry.registration.plugin.id}:${action.id}` })));
  }
  async function invoke(key, context) {
    const owner = [...entries].find(([frame, entry]) => valid(frame, entry) && entry.actions.some(action => `${entry.registration.plugin.id}:${action.id}` === key && action.contexts.includes(context?.kind)));
    if (!owner) return { ok: false, error: 'The plugin action is unavailable. Enable the plugin and reload Hikari.' };
    const [frame, entry] = owner, action = entry.actions.find(action => `${entry.registration.plugin.id}:${action.id}` === key);
    if (action.requiresAgent && !isAgentAvailable(doc)) return { ok: false, error: 'Sign in to Codex in Settings to generate an illustration.' };
    if ([...pending.values()].some(item => item.frame === frame)) return { ok: false, error: 'The plugin is already opening a source. Please wait.' };
    let read;
    try { read = capturePluginActionContext(state, context, api); }
    catch (error) { return { ok: false, error: error.message }; }
    const id = `context-${++sequence}`;
    return new Promise(resolve => {
      const request = { frame, registration: entry.registration, resolve, read, timer: windowObject.setTimeout(() => finish(id, { ok: false, error: 'The plugin did not accept the source. Try again.' }), 30000) };
      pending.set(id, request);
      try {
        activate?.(entry.registration.plugin);
        frame.postMessage({ hikari: 1, event: 'app.contextAction', payload: { id, actionId: action.id, context: { kind: context.kind } } }, entry.registration.origin);
      } catch (error) { finish(id, { ok: false, error: error.message }); }
    });
  }
  function requestFor(id, frame) {
    const request = pending.get(id);
    if (!request || request.frame !== frame || getRegistration(frame) !== request.registration) throw new Error('This source handoff has expired or belongs to another plugin.');
    return request;
  }
  async function read(params, frame) {
    const request = requestFor(params.id, frame);
    request.reading ||= request.read();
    const result = await request.reading;
    requestFor(params.id, frame);
    return result;
  }
  function respond(params, frame) {
    requestFor(params.id, frame);
    if (typeof params.result?.ok !== 'boolean') throw new Error('Context action responses require an ok boolean.');
    finish(params.id, { ok: params.result.ok, ...(typeof params.result.error === 'string' ? { error: params.result.error.slice(0, 1000) } : {}) });
    return { acknowledged: true };
  }
  return { set, list, invoke, read, respond, clear };
}
