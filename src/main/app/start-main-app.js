'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('node:fs/promises');

const { createMainWindow } = require('../windows/create-main-window');
const { createHikariMainCore } = require('../core/start-hikari-main-core');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function startMainApp() {
  let mainWindow = null;
  const mainCore = createHikariMainCore({
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
    mainWindow = createMainWindow({
      BrowserWindow,
      path,
      projectRoot: PROJECT_ROOT,
      appIconPath: mainCore.appIconPath,
      preloadPath: path.join(__dirname, '..', 'preload.js'),
      onClosed: () => {
        mainWindow = null;
      }
    });
  }

  mainCore.registerIpcHandlers();

  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(mainCore.appIconPath);
    }

    createWindow();
    await mainCore.onAppReady();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    void mainCore.shutdown();
  });
}

module.exports = {
  startMainApp
};
