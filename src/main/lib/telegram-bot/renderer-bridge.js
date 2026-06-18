'use strict';

// Bridges Telegram commands to the renderer over IPC, plus small helpers for
// inspecting the main window state.

const { TELEGRAM_COMMAND_EVENT } = require('../../../shared/ipc/channels');

function getMainWindowSafe(getMainWindow) {
  const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow;
}

function sendTelegramCommandToRenderer(getMainWindow, payload) {
  const mainWindow = getMainWindowSafe(getMainWindow);
  if (!mainWindow) {
    return false;
  }
  mainWindow.webContents.send(TELEGRAM_COMMAND_EVENT, payload);
  return true;
}

function sendSearchCommand(getMainWindow, target, query) {
  return sendTelegramCommandToRenderer(getMainWindow, {
    type: target.type,
    query: String(query || '').trim()
  });
}

function sendGlobalSearchCommand(getMainWindow, query, scope = '') {
  return sendTelegramCommandToRenderer(getMainWindow, {
    type: 'global-search',
    query: String(query || '').trim(),
    scope: String(scope || '').trim()
  });
}

function createStatusMessage(mainWindow) {
  if (!mainWindow) {
    return [
      'Hikari app is running.',
      'Window: not available'
    ].join('\n');
  }

  return [
    'Hikari app is running.',
    'Window: available',
    `Visible: ${mainWindow.isVisible() ? 'yes' : 'no'}`,
    `Minimized: ${mainWindow.isMinimized() ? 'yes' : 'no'}`,
    `Maximized: ${mainWindow.isMaximized() ? 'yes' : 'no'}`
  ].join('\n');
}

module.exports = {
  getMainWindowSafe,
  sendTelegramCommandToRenderer,
  sendSearchCommand,
  sendGlobalSearchCommand,
  createStatusMessage
};
