'use strict';

const path = require('node:path');

const { createDownloadError } = require('./http-response.js');
const { buildRelativePath } = require('./storage-paths.js');
const { attachPaperDownloadNotice } = require('./browser-notice.js');
const { attachPaperAutoDownload } = require('./browser-auto-download.js');

// PMC, Springer and others serve PDFs `inline`; Chromium's built-in viewer then
// shows the file and never emits will-download, so nothing is saved. Forcing
// `attachment` on PDF pages turns them into downloads (plugins: false does not
// disable the viewer in Electron 40).
function forcePdfDownloads(details = {}, callback) {
  const headers = { ...details.responseHeaders };
  const names = Object.keys(headers);
  const typeName = names.find((name) => name.toLowerCase() === 'content-type');
  const isPage = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
  if (!isPage || !typeName || !/\bpdf\b/i.test(String(headers[typeName]))) {
    callback({});
    return;
  }
  names.filter((name) => name.toLowerCase() === 'content-disposition').forEach((name) => delete headers[name]);
  headers['Content-Disposition'] = ['attachment'];
  callback({ responseHeaders: headers });
}

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
      const ownedContents = new Set([webContents]);
      const cleanup = [];
      const automationStops = [];
      let downloadStarted = false;
      let activeDownloadItem = null;

      function attachBrowserHelpers(contents) {
        cleanup.push(attachPaperDownloadNotice(contents, { automatic: simulateOneClick !== false }));
        if (simulateOneClick !== false && !downloadStarted) {
          const stop = attachPaperAutoDownload(contents, {
            onAction: () => {
              if (settled || downloadStarted) return;
              updateProgress({
                status: 'resolving_browser_pdf',
                method: 'browser',
                browser_session_active: true,
                browser_session_id: sessionId,
                summary: 'Automatically opening the paper PDF in the browser.'
              });
            }
          });
          automationStops.push(stop);
          cleanup.push(stop);
        }
      }

      function reportBrowserReady(extra = {}) {
        if (settled || downloadStarted) return;
        updateProgress({
          status: simulateOneClick === false ? 'awaiting_browser_click' : 'resolving_browser_pdf',
          method: 'browser',
          browser_session_active: true,
          browser_session_id: sessionId,
          summary: simulateOneClick === false
            ? 'Click Download PDF in the browser to save this paper.'
            : 'Looking for the paper PDF automatically. Complete sign-in or verification in the browser if needed.',
          ...extra
        });
      }

      attachBrowserHelpers(webContents);
      // One listener per session; re-registering on the shared partition just replaces it.
      sessionObject?.webRequest?.onHeadersReceived?.(forcePdfDownloads);

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
        if (!result.ok) {
          try { activeDownloadItem?.cancel?.(); } catch { /* The download may already be gone. */ }
        }
        cleanup.forEach((dispose) => dispose?.());
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

      // Bounds the wait for a download, then any stall once bytes are flowing:
      // a slow transfer that still makes progress must not be canceled.
      let timer = null;
      function armTimeout() {
        clearTimeout(timer);
        timer = setTimeout(() => {
          finalize({
            ok: false,
            session_id: sessionId,
            error: 'Browser download timed out before completion.'
          });
        }, Math.max(5000, Number(timeoutMs) || 60000));
      }
      armTimeout();

      let willDownloadListener = null;
      function ownsDownload(contents) {
        // Chromium PDF/viewer guests emit downloads from their own contents.
        // Follow their host chain while preserving isolation between paper jobs.
        const seen = new Set();
        try {
          for (let current = contents; current && !seen.has(current) && seen.size < 8; current = current.hostWebContents) {
            if (ownedContents.has(current)) return true;
            seen.add(current);
          }
        } catch { /* A viewer may have been destroyed during navigation. */ }
        return false;
      }
      willDownloadListener = (event, item, sourceContents) => {
        // The login partition is shared, but each download belongs only to its
        // own browser and popups. Concurrent paper jobs must not claim it.
        if (settled || (sourceContents && !ownsDownload(sourceContents))) return;
        if (downloadStarted) { event.preventDefault?.(); return; }
        const mime = String(item?.getMimeType?.() || '').toLowerCase();
        // Publishers also label PDFs with generic download types such as
        // application/force-download. transfer.js verifies the saved header.
        if (mime && !/pdf|octet-stream|download|binary|unknown/.test(mime)) {
          event.preventDefault?.();
          reportBrowserReady();
          return;
        }
        try {
          if (typeof item?.setSavePath === 'function') {
            item.setSavePath(targetFilePath);
          }
        } catch (error) {
          event.preventDefault?.();
          void finalize({ ok: false, session_id: sessionId, error: cleanText(error?.message, 600) || 'Could not save the paper PDF.' });
          return;
        }
        downloadStarted = true;
        activeDownloadItem = item;
        automationStops.forEach((stop) => stop());
        armTimeout();
        let lastReceivedBytes = 0;
        updateProgress({
          status: 'browser_downloading',
          method: 'browser',
          browser_session_active: true,
          browser_session_id: sessionId,
          total_bytes: Number(item?.getTotalBytes?.()) || 0,
          received_bytes: Number(item?.getReceivedBytes?.()) || 0
        });

        item?.on?.('updated', () => {
          if (settled) return;
          const receivedBytes = Number(item?.getReceivedBytes?.()) || 0;
          if (receivedBytes !== lastReceivedBytes) {
            lastReceivedBytes = receivedBytes;
            armTimeout();
          }
          updateProgress({
            status: 'browser_downloading',
            method: 'browser',
            browser_session_active: true,
            browser_session_id: sessionId,
            total_bytes: Number(item?.getTotalBytes?.()) || 0,
            received_bytes: receivedBytes
          });
        });

        item?.once?.('done', async (_doneEvent, state) => {
          if (settled) return;
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
      function handleWindowOpen(details = {}) {
        const popupUrl = cleanText(details.url, 4000);
        if (popupUrl && !/^(?:https?:|blob:)/i.test(popupUrl)) {
          return { action: 'deny' };
        }
        return { action: 'allow', outlivesOpener: true };
      }
      function handleChildWindow(childWindow) {
        if (!childWindow) {
          return;
        }
        // The webContents getter throws once the window has closed.
        const childContents = childWindow.webContents;
        childWindows.add(childWindow);
        ownedContents.add(childContents);
        attachBrowserHelpers(childContents);
        childContents?.setWindowOpenHandler?.(handleWindowOpen);
        childContents?.on?.('did-create-window', handleChildWindow);
        childWindow.show?.();
        childWindow.on?.('closed', () => {
          childWindows.delete(childWindow);
          ownedContents.delete(childContents);
          failIfAllBrowserWindowsClosed();
        });
        reportBrowserReady({ browser_viewer_open: true });
      }
      webContents?.setWindowOpenHandler?.(handleWindowOpen);
      webContents?.on?.('did-create-window', handleChildWindow);
      browserWindow.on('closed', () => {
        parentWindowClosed = true;
        failIfAllBrowserWindowsClosed();
      });

      try {
        const navigationUrl = browserEntryUrl || selectedPdfUrl || 'about:blank';
        await browserWindow.loadURL(navigationUrl);
        reportBrowserReady();
      } catch (error) {
        // Turning a PDF navigation into an attachment aborts loadURL normally.
        // The will-download handler owns completion once the transfer starts.
        if (settled || downloadStarted || error?.code === 'ERR_ABORTED') return;
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

module.exports = { createBrowserDownloadSession, forcePdfDownloads };
