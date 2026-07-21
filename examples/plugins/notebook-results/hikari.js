// Hikari plugin client — copy this file verbatim into your plugin folder.
//
// It wraps the raw postMessage protocol (docs/plugins/plugin-api.md) in a
// promise API:
//
//   const protocols = await hikari.call('protocols.list');
//   await hikari.call('notebook.appendResult', { entryId, text: 'done' });
//
// Every verb your plugin calls must be declared in plugin.json "permissions",
// otherwise the host replies with a permission error.

const PROTOCOL_MARKER = 1;
const CALL_TIMEOUT_MS = 10000;

const pending = new Map();
let nextCallId = 0;

window.addEventListener('message', (event) => {
  const reply = event.data;
  if (!reply || typeof reply !== 'object' || reply.hikari !== PROTOCOL_MARKER) {
    return;
  }
  const settle = pending.get(reply.id);
  if (!settle) {
    return;
  }
  pending.delete(reply.id);
  clearTimeout(settle.timer);
  if (reply.ok) {
    settle.resolve(reply.result);
  } else {
    settle.reject(new Error(reply.error || 'Hikari call failed.'));
  }
});

export const hikari = {
  call(verb, params = {}) {
    return new Promise((resolve, reject) => {
      const id = `call_${nextCallId += 1}`;
      // The host never replies to an unregistered frame, so a call that gets
      // no answer would hang forever without this timeout.
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Hikari call "${verb}" timed out. Is the plugin installed and enabled?`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ hikari: PROTOCOL_MARKER, id, verb, params }, '*');
    });
  }
};
