'use strict';

function createMainWindow({
  BrowserWindow,
  path,
  projectRoot,
  appIconPath,
  preloadPath,
  onClosed
}) {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    title: 'Hikari',
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  });

  mainWindow.loadFile(path.join(projectRoot, 'index.html'));
  mainWindow.on('closed', () => {
    if (typeof onClosed === 'function') {
      onClosed();
    }
  });

  return mainWindow;
}

module.exports = {
  createMainWindow
};
