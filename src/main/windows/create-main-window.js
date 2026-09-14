'use strict';

function safeProtocol(url) {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

// Popups the app opens for itself: printable/viewable PDFs it just generated.
// Anything else that wants a window is either sent to the system browser or dropped.
function isSelfIssuedDocument(url) {
  return url.startsWith('blob:') || /^data:application\/pdf[;,]/i.test(url);
}

function createMainWindow({
  BrowserWindow,
  shell,
  path,
  projectRoot,
  appIconPath,
  preloadPath,
  onCloseRequested,
  onClosed,
  platform = process.platform
}) {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    title: 'Hikari',
    icon: appIconPath,
    ...(platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 24 }
    } : {}),
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

  // The renderer displays untrusted material (downloaded papers, PDF text, LLM
  // output). Without these guards a stray link opens a window that still has the
  // preload bridge attached, so keep navigation pinned to the bundled app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSelfIssuedDocument(url)) {
      return {
        action: 'allow',
        // Popups inherit the parent's webPreferences, preload included, and
        // Electron gives no way to unset it here. sandbox:true is what actually
        // neuters the bridge: the preload's local require() calls fail under the
        // sandbox polyfill, so nothing is exposed to a PDF popup.
        // ponytail: good enough for a document viewer, use a dedicated
        // BrowserWindow if a popup ever needs to render real app UI.
        overrideBrowserWindowOptions: {
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    }
    if (/^https?:$/i.test(safeProtocol(url)) && shell?.openExternal) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow.webContents.getURL()) {
      return;
    }
    event.preventDefault();
    if (/^https?:$/i.test(safeProtocol(url)) && shell?.openExternal) {
      shell.openExternal(url);
    }
  });

  // Nothing in the app requests camera, mic, geolocation, or notifications.
  // navigator.clipboard.writeText (copy buttons) needs clipboard-sanitized-write.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
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
