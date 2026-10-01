'use strict';

const { randomUUID } = require('node:crypto');
const { PLUGINS } = require('../../../shared/ipc/channels.js');

function createPluginCanvasBridge({ ipcMain, getMainWindow, timeoutMs = 30000 } = {}) {
  const pending = new Map();
  let closed = false;
  function onResponse(event, payload) {
    const entry = pending.get(payload?.id);
    if (!entry || event.sender !== entry.sender || event.senderFrame !== entry.sender.mainFrame) return;
    entry.finish(payload.result && typeof payload.result.ok === 'boolean' ? payload.result
      : { ok: false, status: 'invalid_response', error: 'Invalid plugin canvas acknowledgement.' });
  }
  ipcMain?.on(PLUGINS.CANVAS_RESPONSE, onResponse);
  async function run(args) {
    const sender = getMainWindow?.()?.webContents;
    if (closed || !ipcMain || !sender || sender.isDestroyed()) return { ok: false, status: 'unavailable', error: 'Open Hikari with the requested canvas plugin enabled.' };
    if (pending.size >= 16) return { ok: false, status: 'busy', error: 'Too many pending canvas requests.' };
    return new Promise(resolve => {
      const id = randomUUID(), deadline = Date.now() + timeoutMs;
      const finish = result => { clearTimeout(timer); pending.delete(id); resolve(result); };
      const timer = setTimeout(() => finish({ ok: false, status: 'acknowledgement_timeout', error: 'Canvas acknowledgement timed out. Read again or retry the same request_id and arguments before another edit.' }), timeoutMs);
      pending.set(id, { sender, finish });
      try { sender.send(PLUGINS.CANVAS_REQUEST, { id, deadline, ...args }); }
      catch (error) { finish({ ok: false, status: 'unavailable', error: error.message }); }
    });
  }
  function close() {
    closed = true; ipcMain?.removeListener(PLUGINS.CANVAS_RESPONSE, onResponse);
    for (const entry of pending.values()) entry.finish({ ok: false, status: 'unavailable', error: 'Hikari is closing.' });
  }
  return { run, close };
}
module.exports = { createPluginCanvasBridge };
