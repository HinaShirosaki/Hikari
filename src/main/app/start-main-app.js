'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('node:fs/promises');

const { createMainWindow } = require('../windows/create-main-window');
const { createMainServices } = require('../core/main-services');
const { SYSTEM } = require('../../shared/ipc/channels');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function startMainApp() {
  let mainWindow = null;
  let allowWindowClose = false;
  let closeRequestPending = false;
  let appQuitPending = false;
  let closeResponseTimer = null;
  const mainServices = createMainServices({
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    shell,
    fs,
    path,
    processObject: process,
    projectRoot: PROJECT_ROOT,
    getMainWindow: () => mainWindow
  });

  function createWindow() {
    allowWindowClose = false;
    closeRequestPending = false;
    appQuitPending = false;
    closeResponseTimer = null;
    mainWindow = createMainWindow({
      BrowserWindow,
      shell,
      path,
      projectRoot: PROJECT_ROOT,
      appIconPath: mainServices.appIconPath,
      preloadPath: path.join(__dirname, '..', 'preload.js'),
      onCloseRequested: (event, window) => {
        if (allowWindowClose || window.webContents?.isDestroyed?.()) {
          allowWindowClose = true;
          return;
        }
        event.preventDefault();
        if (closeRequestPending) {
          return;
        }
        closeRequestPending = true;
        window.webContents.send(SYSTEM.APP_CLOSE_REQUESTED);
        closeResponseTimer = setTimeout(async () => {
          if (!closeRequestPending || !mainWindow) {
            return;
          }
          closeRequestPending = false;
          closeResponseTimer = null;
          let result = null;
          try {
            result = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Hikari',
              message: 'Hikari could not check for unsaved changes.',
              detail: 'The window is not responding. You can cancel and try again, or quit without saving.',
              buttons: ['Cancel', 'Quit Without Saving'],
              defaultId: 0,
              cancelId: 0,
              noLink: true
            });
          } catch (error) {
            console.error('Failed to show the close fallback dialog:', error);
          }
          if (result?.response !== 1) {
            appQuitPending = false;
            return;
          }
          allowWindowClose = true;
          // ponytail: destroy, not close — this path exists because the window
          // stopped answering, so a beforeunload handler in it (or in a plugin
          // frame) must not get another chance to veto the quit.
          mainWindow?.destroy();
          if (appQuitPending) {
            app.quit();
          }
        }, 3000);
      },
      onClosed: () => {
        if (closeResponseTimer) {
          clearTimeout(closeResponseTimer);
          closeResponseTimer = null;
        }
        mainWindow = null;
      }
    });
  }

  ipcMain.on(SYSTEM.APP_CLOSE_RESPONSE, (event, payload = {}) => {
    if (!mainWindow || !closeRequestPending || event.sender !== mainWindow.webContents) {
      return;
    }
    if (closeResponseTimer) {
      clearTimeout(closeResponseTimer);
      closeResponseTimer = null;
    }
    const action = String(payload?.action || '').trim().toLowerCase();
    closeRequestPending = false;
    if (action !== 'quit') {
      appQuitPending = false;
      return;
    }
    allowWindowClose = true;
    if (appQuitPending) {
      app.quit();
    } else {
      mainWindow.close();
    }
  });

  app.whenReady()
    .then(async () => {
      if (process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(mainServices.appIconPath);
      }

      createWindow();
      await mainServices.start();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    })
    .catch((error) => {
      console.error('Failed to start Hikari main services:', error);
      app.quit();
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (mainWindow && !allowWindowClose) {
      event.preventDefault();
      appQuitPending = true;
      mainWindow.close();
      return;
    }
    void mainServices.shutdown().catch((error) => {
      console.error('Failed to stop Hikari main services:', error);
    });
  });
}

module.exports = {
  startMainApp
};

// Electron entry point: boot only when launched directly, so requiring this
// module (tests, tooling) stays side-effect free.
if (require.main === module) {
  startMainApp();
}
