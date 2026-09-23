'use strict';

const { randomUUID } = require('node:crypto');
const { ASSAY } = require('../../../shared/ipc/channels.js');

// Acknowledgements come from the live main-window renderer, after application.
function createAssayPlotBridge({ ipcMain, getMainWindow, timeoutMs = 15000 } = {}) {
  const pending = new Map();
  let closed = false;
  function onResponse(event, payload) {
    const entry = pending.get(payload?.id);
    if (!entry || event.sender !== entry.sender || event.senderFrame !== entry.sender.mainFrame) return;
    entry.finish(payload.result && typeof payload.result.ok === 'boolean'
      ? payload.result : { ok: false, status: 'invalid_response', error: 'Invalid plot acknowledgement.' });
  }
  ipcMain?.on(ASSAY.PLOT_RESPONSE, onResponse);
  async function run(args) {
    try {
      const { validatePlotRequest } = await import('../../../shared/assay-plot.mjs');
      validatePlotRequest(args);
    } catch (error) {
      return { ok: false, status: 'invalid_arguments', error: error.message };
    }
    const sender = getMainWindow?.()?.webContents;
    if (closed || !ipcMain || !sender || sender.isDestroyed()) {
      return { ok: false, status: 'plot_unavailable', error: 'Open Hikari and select an assay in Analyze.' };
    }
    if (pending.size >= 16) return { ok: false, status: 'busy', error: 'Too many pending plot requests.' };
    return new Promise((resolve) => {
      const id = randomUUID();
      const finish = (result) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(result);
      };
      const timer = setTimeout(() => finish({
        ok: false, status: 'acknowledgement_timeout',
        error: 'Plot acknowledgement timed out; application is unconfirmed. Read the plot or retry the identical request_id before making another edit.'
      }), timeoutMs);
      pending.set(id, { sender, finish });
      try {
        sender.send(ASSAY.PLOT_REQUEST, { id, deadline: Date.now() + timeoutMs, args });
      } catch (error) {
        finish({ ok: false, status: 'plot_unavailable', error: error.message });
      }
    });
  }
  function close() {
    closed = true;
    ipcMain?.removeListener(ASSAY.PLOT_RESPONSE, onResponse);
    for (const entry of pending.values()) entry.finish({ ok: false, status: 'plot_unavailable', error: 'Hikari is closing.' });
  }
  return { run, close };
}

module.exports = { createAssayPlotBridge };
