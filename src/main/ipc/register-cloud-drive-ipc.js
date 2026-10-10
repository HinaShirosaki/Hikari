'use strict';

const { STORAGE } = require('../../shared/ipc/channels');
const { randomUUID } = require('node:crypto');

function registerCloudDriveIpc({ ipcMain, cloudDrive, getMainWindow }) {
  const handle = (channel, work) => ipcMain.handle(channel, async (event, payload = {}) => {
    if (event.sender !== getMainWindow()?.webContents) return { ok: false, error: 'Cloud drive access is limited to the Hikari window.' };
    try { return await work(payload); }
    catch (error) { return { ok: false, error: String(error.message || error) }; }
  });
  handle(STORAGE.CLOUD_STATUS, () => cloudDrive.status());
  handle(STORAGE.CLOUD_CONNECT, payload => cloudDrive.connect(payload.provider));
  handle(STORAGE.CLOUD_CANCEL_LOGIN, payload => cloudDrive.cancelLogin(payload.provider));
  handle(STORAGE.CLOUD_DISCONNECT, payload => cloudDrive.disconnect(payload.provider));
  handle(STORAGE.CLOUD_WORKSPACES, payload => cloudDrive.listWorkspaces(payload.provider));
  handle(STORAGE.CLOUD_LINK, payload => cloudDrive.linkWorkspace(payload));
  handle(STORAGE.CLOUD_UNLINK, payload => cloudDrive.unlinkWorkspace(payload.provider));
  ipcMain.handle(STORAGE.CLOUD_SYNC, async (event, payload = {}) => {
    if (event.sender !== getMainWindow()?.webContents) return { ok: false, error: 'Cloud drive access is limited to the Hikari window.' };
    const beforeApply = () => new Promise((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => { clearTimeout(timer); ipcMain.removeListener(STORAGE.CLOUD_CHECK_RESPONSE, listener); };
      const listener = (responseEvent, response) => {
        if (responseEvent.sender !== event.sender || response?.id !== id) return;
        cleanup();
        if (response.ready === true) resolve();
        else reject(new Error('New edits arrived while syncing. Local files were kept; please sync again.'));
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('The workspace could not confirm it is ready for cloud changes. Please try again.')); }, 5000);
      ipcMain.on(STORAGE.CLOUD_CHECK_RESPONSE, listener);
      event.sender.send(STORAGE.CLOUD_CHECK, { id });
    });
    try { return await cloudDrive.sync({ provider: payload.provider, resolution: payload.resolution, conflictId: payload.conflictId, beforeApply }); }
    catch (error) { return { ok: false, error: error.message }; }
  });
}

module.exports = { registerCloudDriveIpc };
