'use strict';

const { nativeText } = require('../lib/i18n.js');
const { AGENT, FILE_ACCESS } = require('../../shared/ipc/channels');
const { createCodexPermissionPrompts } = require('./codex-permission-prompts.js');

function registerAgentFileIpc({ ipcMain, fileAccess, getMainWindow, dialog }) {
  const permissions = createCodexPermissionPrompts({ getMainWindow, dialog });
  // Permissions and approvals are UI-only. Plugin frames and MCP cannot call these.
  function handle(channel, action) {
    ipcMain.handle(channel, async (event, input = {}) => {
      if (!permissions.isMainFrame(event)) {
        return { ok: false, status: 'unauthorized', error: 'File permissions can only be changed from the Hikari window.' };
      }
      try { return await action(input); }
      catch (error) { return { ok: false, error: error.message }; }
    });
  }
  handle(AGENT.CODEX_PERMISSION_GET, permissions.getPreset);
  handle(AGENT.CODEX_PERMISSION_SET, input => permissions.setPreset(input.preset));
  handle(FILE_ACCESS.STATUS, () => fileAccess.status());
  handle(FILE_ACCESS.SETTINGS, input => {
    if (!['mode', 'revoke'].includes(input.action)) return { ok: false, error: 'Unsupported setting.' };
    return fileAccess.settings(input);
  });
  handle(FILE_ACCESS.REVIEW, input => fileAccess.review(input));
  handle(FILE_ACCESS.UNDO, input => fileAccess.undo(input));
  handle(FILE_ACCESS.ADD_LOCATION, async input => {
    const selected = await dialog.showOpenDialog(getMainWindow(), { title: nativeText("Grant agent access to another folder"), properties: ['openDirectory'] });
    if (selected.canceled || !selected.filePaths?.[0]) return { ok: true, cancelled: true };
    return fileAccess.settings({ action: 'add-location', root_id: input.root_id, path: selected.filePaths[0] });
  });
  return permissions.forEvent;
}

module.exports = { registerAgentFileIpc };
