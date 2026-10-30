import { showTransientNotice } from '../../lib/notify.js';
import { escapeHtml } from '../../lib/html.js';

const PRINT_DOC_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #1f2933;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 12pt;
    line-height: 1.45;
  }
  body { padding: 24pt 28pt; }
  h1, h2, h3, h4, h5 { color: #111; margin: 0 0 6pt 0; }
  h1 { font-size: 20pt; margin-bottom: 10pt; }
  h2 { font-size: 15pt; margin-top: 14pt; }
  h3 { font-size: 13pt; margin-top: 12pt; }
  h4 { font-size: 12pt; margin-top: 10pt; }
  p { margin: 4pt 0; }
  ul, ol { margin: 4pt 0 8pt 18pt; padding: 0; }
  li { margin: 2pt 0; }
  section { margin-bottom: 10pt; page-break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0; }
  th, td { border: 1px solid #c0c6cf; padding: 4pt 6pt; text-align: left; font-size: 10pt; vertical-align: top; }
  th { background: #eef1f5; }
  img, canvas, svg { max-width: 100%; height: auto; }
  .placeholder-chip { display: inline; padding: 0 2pt; border-bottom: 1px dotted #555; }
  .small-note { color: #555; font-size: 10pt; }
  textarea, input, button, select { display: none !important; }
  [hidden] { display: none !important; }
  @page { margin: 0.6in; }
`;

function getDocumentRef() {
  return typeof document !== 'undefined' ? document : null;
}

function buildPrintHtmlDocument(bodyHtml, { title = 'Print', extraStyles = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>${PRINT_DOC_STYLES}${extraStyles}</style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

// Printing goes through a hidden iframe so only the document, not the app
// chrome, reaches the print dialog. The frame is removed a few seconds after
// print() returns, giving the dialog time to read it.
function createPrintFrame() {
  const doc = getDocumentRef();
  if (!doc || !doc.body) {
    return null;
  }
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  doc.body.appendChild(frame);
  return frame;
}

function disposePrintFrame(frame, blobUrl) {
  if (!frame) {
    return;
  }
  try {
    frame.parentNode?.removeChild(frame);
  } catch {
    /* noop */
  }
  if (blobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      /* noop */
    }
  }
}

function invokePrintOnFrame(frame) {
  const win = frame?.contentWindow;
  if (!win) {
    showTransientNotice('Could not open the print dialog.', { type: 'error' });
    return false;
  }
  try {
    win.focus();
    win.print();
    return true;
  } catch (error) {
    console.error('Failed to invoke print dialog:', error);
    showTransientNotice(String(error?.message || error || 'Could not open the print dialog.'), { type: 'error' });
    return false;
  }
}

export function printHtmlContent(bodyHtml, { title = 'Print', extraStyles = '' } = {}) {
  const doc = getDocumentRef();
  if (!doc) {
    return false;
  }
  const frame = createPrintFrame();
  if (!frame) {
    return false;
  }

  const html = buildPrintHtmlDocument(bodyHtml, { title, extraStyles });
  const cleanup = () => {
    // Allow the print dialog to read the document before removal.
    setTimeout(() => disposePrintFrame(frame), 1500);
  };

  frame.addEventListener('load', () => {
    const ok = invokePrintOnFrame(frame);
    if (!ok) {
      disposePrintFrame(frame);
      return;
    }
    cleanup();
  }, { once: true });

  try {
    frame.srcdoc = html;
  } catch (error) {
    console.error('Failed to set print frame content:', error);
    showTransientNotice('Could not prepare the document for printing.', { type: 'error' });
    disposePrintFrame(frame);
    return false;
  }
  return true;
}

export function printElement(element, { title = 'Print', extraStyles = '', omitSelectors = [] } = {}) {
  if (!element || typeof element.cloneNode !== 'function') {
    return false;
  }
  const clone = element.cloneNode(true);
  if (Array.isArray(omitSelectors) && omitSelectors.length && typeof clone.querySelectorAll === 'function') {
    omitSelectors.forEach((selector) => {
      const matches = clone.querySelectorAll(selector);
      matches.forEach((node) => node.parentNode?.removeChild(node));
    });
  }
  return printHtmlContent(clone.outerHTML, { title, extraStyles });
}

export function printPdfBlob(blob, { title = 'Print' } = {}) {
  const doc = getDocumentRef();
  if (!doc || !blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  const frame = createPrintFrame();
  if (!frame) {
    return false;
  }

  const blobUrl = URL.createObjectURL(blob);
  const cleanup = () => {
    setTimeout(() => disposePrintFrame(frame, blobUrl), 5000);
  };

  frame.addEventListener('load', () => {
    const ok = invokePrintOnFrame(frame);
    if (!ok) {
      disposePrintFrame(frame, blobUrl);
      return;
    }
    cleanup();
  }, { once: true });

  try {
    frame.title = title;
    frame.src = blobUrl;
  } catch (error) {
    console.error('Failed to load PDF for printing:', error);
    showTransientNotice('Could not load the PDF for printing.', { type: 'error' });
    disposePrintFrame(frame, blobUrl);
    return false;
  }
  return true;
}

export function printPdfBytes(bytes, { title = 'Print' } = {}) {
  if (!bytes) {
    return false;
  }
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const blob = new Blob([source], { type: 'application/pdf' });
  return printPdfBlob(blob, { title });
}
