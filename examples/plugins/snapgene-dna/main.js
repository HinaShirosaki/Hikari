// Service worker for the SnapGene .dna importer.
//
// A service plugin is headless: it has no view, no markup, and touches no DOM.
// It only listens for the host's convert request, runs the converter, and posts
// GenBank back. If you find yourself reaching for `document` here, the thing
// you are building is a view plugin, not a service.
//
// Classic script, not an ES module: this runs in an opaque-origin sandbox,
// where relative module fetches are CORS-blocked. dna-to-genbank.js is loaded
// as a classic script before this one and exposes window.SnapGeneDna.
//
// Wire protocol (see src/renderer/app/plugin-services.js):
//   host -> here: { hikari: 1, call: 'convert', id, from, to, filename, bytes }
//   here -> host: { hikari: 1, call: 'convert:result', id, ok, text | error }

(function () {
  'use strict';

  const PROTOCOL_MARKER = 1;

  function reply(id, payload) {
    window.parent.postMessage(Object.assign({ hikari: PROTOCOL_MARKER, call: 'convert:result', id }, payload), '*');
  }

  window.addEventListener('message', function (event) {
    const request = event.data;
    if (!request || typeof request !== 'object' || request.hikari !== PROTOCOL_MARKER || request.call !== 'convert') {
      return;
    }
    try {
      if (request.to !== 'gbk') {
        throw new Error('This service only produces gbk, not ' + request.to + '.');
      }
      // Drop the extension so the GenBank LOCUS name is clean.
      const name = String(request.filename || 'sequence').replace(/\.[^.]+$/, '');
      reply(request.id, { ok: true, text: window.SnapGeneDna.convertDnaToGenBank(request.bytes, { name: name }) });
    } catch (error) {
      reply(request.id, { ok: false, error: String((error && error.message) || error) });
    }
  });
}());
