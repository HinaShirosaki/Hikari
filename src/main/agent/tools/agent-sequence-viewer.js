'use strict';

const { SEQUENCE_AGENT } = require('../../../shared/ipc/channels');

// Main->renderer round-trip for the sequence_viewer / sequence_edit MCP tools.
// The tested compute core (createSequenceViewerAgentApi) is a renderer module
// bound to live viewer state, so main forwards each action to the renderer and
// awaits the reply. Mirrors the SYSTEM.APP_CLOSE_REQUESTED/RESPONSE two-channel
// pattern; the reply is matched by requestId.
function createSequenceAgentRuntime(deps = {}) {
  const BrowserWindow = deps.BrowserWindow || null;
  const ipcMain = deps.ipcMain || null;
  const timeoutMs = Number.isFinite(Number(deps.timeoutMs)) ? Number(deps.timeoutMs) : 15000;
  const pending = new Map();
  let counter = 0;

  function handleResponse(payload = {}) {
    const requestId = String(payload?.requestId || '');
    const entry = pending.get(requestId);
    if (!entry) {
      return;
    }
    pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve(payload?.result);
  }

  if (ipcMain && typeof ipcMain.on === 'function') {
    ipcMain.on(SEQUENCE_AGENT.RESPONSE, (_event, payload = {}) => handleResponse(payload));
  }

  function targetWebContents() {
    if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') {
      return null;
    }
    const focused = typeof BrowserWindow.getFocusedWindow === 'function'
      ? BrowserWindow.getFocusedWindow()
      : null;
    const window = focused || BrowserWindow.getAllWindows()[0] || null;
    const webContents = window?.webContents;
    if (!webContents || webContents.isDestroyed?.() || typeof webContents.send !== 'function') {
      return null;
    }
    return webContents;
  }

  function invoke(action, args = {}) {
    const webContents = targetWebContents();
    if (!webContents) {
      return Promise.resolve({
        error: { code: 'NO_WINDOW', message: 'No Hikari window is available to run the sequence-viewer action.' }
      });
    }
    counter += 1;
    const requestId = `seqagent_${Date.now().toString(36)}_${counter}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve({ error: { code: 'TIMEOUT', message: 'The sequence-viewer renderer did not respond in time.' } });
      }, timeoutMs);
      pending.set(requestId, { resolve, timer });
      webContents.send(SEQUENCE_AGENT.REQUEST, { requestId, action: String(action || ''), args });
    });
  }

  return { invoke, handleResponse };
}

module.exports = {
  createSequenceAgentRuntime
};
