'use strict';
const { randomUUID } = require('node:crypto');
const { normalizeHtmlArtifact } = require('../runtime/tool-artifacts/html-output.js');
const { AGENT } = require('../../../shared/ipc/channels');

const HTML_PREVIEW_SCHEME = 'hikari-html';
const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

function registerHtmlPreviewScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: HTML_PREVIEW_SCHEME, privileges: { standard: true, secure: true } }]);
}

function isHtmlPreviewUrl(url) {
  return typeof url === 'string' && url.startsWith(`${HTML_PREVIEW_SCHEME}://`);
}

// CSP blocks subresources, but documents can otherwise navigate their own frame.
function guardHtmlPreviewNavigation(webContents) {
  webContents.on('will-frame-navigate', event => {
    if (isHtmlPreviewUrl(event.frame?.url) || isHtmlPreviewUrl(event.initiator?.url)) event.preventDefault();
  });
}

function installHtmlPreviewService({ protocol, ipcMain, getMainWindow }) {
  const documents = new Map();
  const owners = new Set();
  protocol.handle(HTML_PREVIEW_SCHEME, request => {
    const entry = documents.get(request.url);
    if (!entry || request.method !== 'GET') return new Response('Preview unavailable. Reopen this chat to reload it.', { status: 404 });
    return new Response(entry.html, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': HTML_PREVIEW_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()'
    } });
  });
  ipcMain.handle(AGENT.HTML_PREVIEW, (event, payload) => {
    const owner = getMainWindow()?.webContents;
    if (!owner || event.sender !== owner || event.senderFrame !== owner.mainFrame) {
      return { ok: false, error: 'HTML previews are available only to Hikari Agent Chat.' };
    }
    const artifact = normalizeHtmlArtifact(payload);
    if (!artifact) return { ok: false, error: 'The saved HTML output is invalid or exceeds 512 KiB.' };
    if (!owners.has(owner)) {
      owners.add(owner);
      owner.once('destroyed', () => {
        for (const [url, entry] of documents) if (entry.owner === owner) documents.delete(url);
        owners.delete(owner);
      });
    }
    const url = `${HTML_PREVIEW_SCHEME}://preview/${randomUUID()}`;
    documents.set(url, { owner, html: artifact.html });
    // Live documents have already loaded their source; bound retained response bodies.
    while (documents.size > 128) documents.delete(documents.keys().next().value);
    return { ok: true, url };
  });
}
module.exports = { HTML_PREVIEW_SCHEME, HTML_PREVIEW_CSP, registerHtmlPreviewScheme, installHtmlPreviewService, guardHtmlPreviewNavigation };
