// Service worker for the SnapGene .dna importer.
//
// A service plugin has no visible UI — this page runs hidden. It waits for the
// host to post a convert request, runs the pure converter, and posts the
// GenBank text back. Wire protocol (see src/renderer/app/plugin-services.js):
//
//   host -> here: { hikari: 1, call: 'convert', id, from, to, filename, bytes }
//   here -> host: { hikari: 1, call: 'convert:result', id, ok, text | error }

import { convertDnaToGenBank } from './dna-to-genbank.js';

const PROTOCOL_MARKER = 1;

function reply(id, payload) {
  window.parent.postMessage({ hikari: PROTOCOL_MARKER, call: 'convert:result', id, ...payload }, '*');
}

window.addEventListener('message', (event) => {
  const request = event.data;
  if (!request || typeof request !== 'object' || request.hikari !== PROTOCOL_MARKER || request.call !== 'convert') {
    return;
  }
  const status = document.getElementById('status');
  try {
    if (request.to !== 'gbk') {
      throw new Error(`This service only produces gbk, not ${request.to}.`);
    }
    // Drop the extension from the filename so the GenBank LOCUS name is clean.
    const name = String(request.filename || 'sequence').replace(/\.[^.]+$/, '');
    const text = convertDnaToGenBank(request.bytes, { name });
    if (status) {
      status.textContent = `Converted ${request.filename}`;
    }
    reply(request.id, { ok: true, text });
  } catch (error) {
    if (status) {
      status.textContent = `Failed: ${error.message}`;
    }
    reply(request.id, { ok: false, error: String(error?.message || error) });
  }
});
