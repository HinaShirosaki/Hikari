'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('node:fs/promises');

const { createMainWindow } = require('../windows/create-main-window');
const { createMainRuntime } = require('./main-runtime');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function startMainApp() {
  let mainWindow = null;
  const runtime = createMainRuntime({
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
      appIconPath: runtime.appIconPath,
      preloadPath: path.join(__dirname, '..', 'preload.js'),
      onClosed: () => {
        mainWindow = null;
      }
    });
  }

  runtime.registerIpcHandlers();

  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(runtime.appIconPath);
    }

    createWindow();
    await runtime.telegramRuntime.hydrateSavedTelegramToken();
    runtime.telegramRuntime.restartTelegramBot();
    void runtime.agentLogRuntime.ensureAgentChatLogFile(runtime.appPaths.getAgentChatLogPath());
    void runtime.llmPromptsRuntime.loadLlmPrompts();
    runtime.startChatLogTransformMonitor();

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
    runtime.chatLogTransformMonitor.stop();
    runtime.telegramRuntime.stopTelegramBot('app quit');
  });
}

module.exports = {
  startMainApp
};
