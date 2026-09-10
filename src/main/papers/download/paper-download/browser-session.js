'use strict';

const path = require('node:path');

const { createDownloadError } = require('./http-response.js');
const { buildRelativePath } = require('./storage-paths.js');
const { attachPaperDownloadNotice } = require('./browser-notice.js');

// Electron-driven fallback: drive a real BrowserWindow when a publisher blocks
// the direct fetch. Injected so tests can swap in their own session starter.
function createBrowserDownloadSession({
  BrowserWindow = null,
  cleanText,
  providedBrowserSession = null,
  terminateBrowserDownloadSession = null
} = {}) {
  async function startDefaultBrowserDownloadSession(options = {}) {
    if (providedBrowserSession) {
      return providedBrowserSession(options);
    }
    if (!BrowserWindow) {
      throw createDownloadError('Automated download was blocked and no browser download session is configured.', {
        retry_with_browser: true,
        browser_required: true
      });
    }

    const {
      downloadId,
      browserEntryUrl,
      selectedPdfUrl,
      targetFilePath,
      storagePath,
      simulateOneClick,
      timeoutMs,
      updateProgress
    } = options;

    const sessionId = `paper-browser-${downloadId}`;
    // One shared persistent partition: publisher logins and paywall cookies
    // survive between downloads, and nothing accumulates on disk. A partition
    // per download persisted a directory per download that no one reused.
    const partition = 'persist:paper-browser';
    const browserWindow = new BrowserWindow({
      width: 1220,
      height: 900,
      autoHideMenuBar: true,
      show: true,
      title: 'Paper Download',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true,
        partition
      }
    });

    return new Promise(async (resolve) => {
      let settled = false;
      let parentWindowClosed = false;
      const webContents = browserWindow.webContents;
      const sessionObject = webContents?.session;
      const childWindows = new Set();

      attachPaperDownloadNotice(webContents);

      function hasOpenChildWindow() {
        return Array.from(childWindows).some((childWindow) => !childWindow?.isDestroyed?.());
      }

      function closeWindow(targetWindow) {
        try {
          if (targetWindow && !targetWindow.isDestroyed?.()) {
            targetWindow.close?.();
          }
        } catch {
          // Ignore window cleanup errors.
        }
      }

      function failIfAllBrowserWindowsClosed() {
        if (!settled && parentWindowClosed && !hasOpenChildWindow()) {
          void finalize({
            ok: false,
            session_id: sessionId,
            error: 'Browser session closed before download completed.'
          });
        }
      }

      async function finalize(result) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          if (sessionObject?.removeListener && willDownloadListener) {
            sessionObject.removeListener('will-download', willDownloadListener);
          }
        } catch {
          // Ignore listener cleanup errors.
        }
        childWindows.forEach((childWindow) => closeWindow(childWindow));
        childWindows.clear();
        closeWindow(browserWindow);
        if (sessionId && terminateBrowserDownloadSession) {
          await Promise.resolve(terminateBrowserDownloadSession({
            session_id: sessionId,
            download_id: downloadId
          })).catch(() => {});
        }
        resolve(result);
      }

      const timer = setTimeout(() => {
        finalize({
          ok: false,
          session_id: sessionId,
          error: 'Browser download timed out before completion.'
        });
      }, Math.max(5000, Number(timeoutMs) || 60000));

      let willDownloadListener = null;
      willDownloadListener = (_event, item) => {
        try {
          if (typeof item?.setSavePath === 'function') {
            item.setSavePath(targetFilePath);
          }
        } catch {
          // Ignore save-path assignment failure.
        }
        updateProgress({
          status: 'browser_downloading',
          method: 'browser',
          browser_session_active: true,
          browser_session_id: sessionId,
          total_bytes: Number(item?.getTotalBytes?.()) || 0,
          received_bytes: Number(item?.getReceivedBytes?.()) || 0
        });

        item?.on?.('updated', () => {
          updateProgress({
            status: 'browser_downloading',
            method: 'browser',
            browser_session_active: true,
            browser_session_id: sessionId,
            total_bytes: Number(item?.getTotalBytes?.()) || 0,
            received_bytes: Number(item?.getReceivedBytes?.()) || 0
          });
        });

        item?.once?.('done', async (_doneEvent, state) => {
          if (state === 'completed') {
            const receivedBytes = Number(item?.getReceivedBytes?.()) || 0;
            const totalBytes = Number(item?.getTotalBytes?.()) || receivedBytes;
            await finalize({
              ok: true,
              session_id: sessionId,
              file_path: targetFilePath,
              file_name: path.basename(targetFilePath),
              relative_path: buildRelativePath(storagePath, targetFilePath),
              received_bytes: receivedBytes,
              total_bytes: totalBytes,
              summary: 'Paper downloaded through the browser session.'
            });
            return;
          }
          await finalize({
            ok: false,
            session_id: sessionId,
            error: `Browser download ${state || 'failed'}.`
          });
        });
      };

      sessionObject?.on?.('will-download', willDownloadListener);
      webContents?.setWindowOpenHandler?.((details = {}) => {
        const popupUrl = cleanText(details.url, 4000);
        if (popupUrl && !/^(?:https?:|blob:)/i.test(popupUrl)) {
          return { action: 'deny' };
        }
        return { action: 'allow' };
      });
      webContents?.on?.('did-create-window', (childWindow) => {
        if (!childWindow) {
          return;
        }
        childWindows.add(childWindow);
        attachPaperDownloadNotice(childWindow.webContents);
        childWindow.show?.();
        childWindow.on?.('closed', () => {
          childWindows.delete(childWindow);
          failIfAllBrowserWindowsClosed();
        });
        updateProgress({
          status: 'awaiting_browser_click',
          method: 'browser',
          browser_session_active: true,
          browser_session_id: sessionId,
          browser_viewer_open: true
        });
      });
      browserWindow.on('closed', () => {
        parentWindowClosed = true;
        failIfAllBrowserWindowsClosed();
      });

      try {
        const navigationUrl = selectedPdfUrl || browserEntryUrl || 'about:blank';
        await browserWindow.loadURL(navigationUrl);
        updateProgress({
          status: 'awaiting_browser_click',
          method: 'browser',
          browser_session_active: true,
          browser_session_id: sessionId
        });
        if (
          simulateOneClick
          && selectedPdfUrl
          && selectedPdfUrl !== navigationUrl
          && typeof webContents?.downloadURL === 'function'
        ) {
          webContents.downloadURL(selectedPdfUrl);
        }
      } catch (error) {
        await finalize({
          ok: false,
          session_id: sessionId,
          error: cleanText(error?.message, 600) || 'Failed to open browser session for paper download.'
        });
      }
    });
  }

  return { startDefaultBrowserDownloadSession };
}

module.exports = { createBrowserDownloadSession };
