'use strict';

const { nativeText } = require('../lib/i18n.js');
const { getCodexPermissionPreset } = require('../lib/codex-cli-provider/permissions.js');
const { getAgentRequestAbortSignal } = require('../lib/llm/request-context.js');

function createCodexPermissionPrompts({ getMainWindow, dialog }) {
  let preset = 'read-only';
  let selecting = false;

  function isMainFrame(event) {
    const contents = getMainWindow()?.webContents;
    return contents && event.sender === contents && event.senderFrame === contents.mainFrame;
  }

  async function setPreset(next) {
    if (!getCodexPermissionPreset(next)) return { ok: false, preset };
    if (selecting || next === preset) return { ok: true, preset };
    const window = getMainWindow();
    if (next === 'full-access') {
      selecting = true;
      try {
        const { response } = await dialog.showMessageBox(window, {
          type: 'warning',
          message: nativeText('Enable Full Access for Agent chat?'),
          detail: nativeText('Codex can run commands, access the network, and change files outside your workspace without asking.'),
          buttons: [nativeText('Cancel'), nativeText('Enable Full Access')],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        });
        if (response !== 1 || window !== getMainWindow()) return { ok: true, preset };
      } finally { selecting = false; }
    }
    preset = next;
    return { ok: true, preset };
  }

  function forEvent(event) {
    if (!isMainFrame(event)) return null;
    const window = getMainWindow();
    return {
      preset,
      async approve({ message, detail, signal = getAgentRequestAbortSignal() }) {
        if (window !== getMainWindow() || window.isDestroyed() || signal?.aborted) return false;
        const { response } = await dialog.showMessageBox(window, {
          type: 'question', message: nativeText(message), detail, signal,
          buttons: [nativeText('Deny'), nativeText('Allow once')],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        });
        return response === 1 && !signal?.aborted && window === getMainWindow() && !window.isDestroyed();
      }
    };
  }

  return { isMainFrame, forEvent, getPreset: () => ({ ok: true, preset }), setPreset };
}

module.exports = { createCodexPermissionPrompts };
