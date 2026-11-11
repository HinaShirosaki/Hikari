'use strict';

const { buildPaperAutoDownloadScript } = require('./browser-auto-download-page.js');

// A browser-scoped helper, deliberately separate from Hikari's iframe plugins:
// installed workspace plugins do not receive publisher DOM or login cookies.
function attachPaperAutoDownload(webContents, { onAction = () => {}, intervalMs = 1000 } = {}) {
  let stopped = false;
  let scanning = false;
  let nextActionAt = 0;
  const attempted = new Set();

  async function scan() {
    if (stopped || scanning || attempted.size >= 12 || Date.now() < nextActionAt
      || webContents.isDestroyed?.() || webContents.isLoadingMainFrame?.()) return;
    scanning = true;
    try {
      const targets = [webContents];
      // Cross-origin publisher viewers may put the download toolbar in a frame.
      // Only inspect viewer frames, never arbitrary advertising/login frames.
      for (const frame of webContents.mainFrame?.framesInSubtree || []) {
        if (frame === webContents.mainFrame) continue;
        if (/^https?:\/\/[^/]+\/.*(?:pdf|viewer|reader)/i.test(frame.url)) targets.push(frame);
        if (targets.length >= 8) break;
      }
      for (const target of targets) {
        if (stopped || target.isDestroyed?.()) break;
        try {
          const result = await target.executeJavaScript(buildPaperAutoDownloadScript({ attempted: [...attempted] }));
          if (stopped || !result || typeof result.key !== 'string' || result.key.length > 8000
            || !['click', 'navigate'].includes(result.action) || attempted.has(result.key)) continue;
          // Reserve before activation: a navigation may reject the JS promise.
          attempted.add(result.key);
          nextActionAt = Date.now() + 2000;
          onAction(result);
          if (!stopped) await target.executeJavaScript(buildPaperAutoDownloadScript({ activateKey: result.key }), true);
          break;
        } catch {
          // Navigation, a closed popup, or a challenge can destroy the frame.
          // The next poll inspects the new document without repeating this key.
        }
      }
    } catch {
      // The frame tree can disappear while a publisher closes its opener.
    } finally { scanning = false; }
  }

  const onReady = () => { void scan(); };
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    for (const name of ['dom-ready', 'did-finish-load', 'did-navigate-in-page']) webContents.removeListener?.(name, onReady);
    webContents.removeListener?.('destroyed', stop);
  };
  const timer = setInterval(onReady, intervalMs);
  timer.unref?.();
  for (const name of ['dom-ready', 'did-finish-load', 'did-navigate-in-page']) webContents.on?.(name, onReady);
  webContents.on?.('destroyed', stop);
  onReady();
  return stop;
}

module.exports = { attachPaperAutoDownload };
