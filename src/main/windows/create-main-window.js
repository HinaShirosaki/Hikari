'use strict';

function createMainWindow({
  BrowserWindow,
  path,
  projectRoot,
  appIconPath,
  preloadPath,
  onCloseRequested,
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
      // The preload bridge is split across local CommonJS modules. Electron's
      // renderer sandbox only exposes a limited require(), so keep Node access
      // available to preload while the renderer itself remains isolated.
      sandbox: false,
      preload: preloadPath
    }
  });

  mainWindow.loadFile(path.join(projectRoot, 'index.html'));
  mainWindow.on('close', (event) => {
    if (typeof onCloseRequested === 'function') {
      onCloseRequested(event, mainWindow);
    }
  });
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
