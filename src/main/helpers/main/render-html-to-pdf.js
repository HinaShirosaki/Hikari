'use strict';

// Renders an HTML string to a PDF buffer using a hidden BrowserWindow +
// webContents.printToPDF. The HTML is delivered via a data: URL so the helper
// has no dependence on the renderer window, the user's current view, or any
// filesystem layout — callers just pass a fully-formed document (see
// src/renderer/modules/pdf-export/template.js).

const DEFAULT_PRINT_OPTIONS = Object.freeze({
  pageSize: 'Letter',
  printBackground: true,
  preferCSSPageSize: true
});

function encodeHtmlDataUrl(html) {
  const buffer = Buffer.from(String(html ?? ''), 'utf8');
  return `data:text/html;charset=utf-8;base64,${buffer.toString('base64')}`;
}

async function renderHtmlToPdf(html, options = {}) {
  const {
    BrowserWindow,
    fs,
    savePath = '',
    printOptions = {},
    waitForReadyMs = 250
  } = options || {};

  if (!BrowserWindow || typeof BrowserWindow !== 'function') {
    throw new Error('renderHtmlToPdf requires electron BrowserWindow');
  }
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('renderHtmlToPdf requires a non-empty HTML string');
  }

  const window = new BrowserWindow({
    show: false,
    width: 850,
    height: 1100,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      javascript: false,
      offscreen: true
    }
  });

  try {
    await window.loadURL(encodeHtmlDataUrl(html));
    // Give the layout engine a tick to settle for images / fonts / @page rules.
    if (waitForReadyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitForReadyMs));
    }

    const pdf = await window.webContents.printToPDF({
      ...DEFAULT_PRINT_OPTIONS,
      ...printOptions
    });

    if (savePath && fs && typeof fs.writeFile === 'function') {
      await fs.writeFile(savePath, pdf);
      return { ok: true, path: savePath, bytes: pdf.length };
    }
    return { ok: true, buffer: pdf, bytes: pdf.length };
  } finally {
    try {
      window.destroy();
    } catch {
      /* noop */
    }
  }
}

module.exports = {
  renderHtmlToPdf
};
