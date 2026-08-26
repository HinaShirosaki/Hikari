// Headless service worker for the SnapGene .dna importer. The host sends raw
// bytes; this frame hands them to the manifest-gated Python API, where
// Biopython performs the conversion, then returns GenBank text to the Sequence
// Viewer. It intentionally renders nothing and never touches the DOM.

(function () {
  'use strict';

  const PROTOCOL_MARKER = 1;

  function reply(id, payload) {
    window.parent.postMessage(Object.assign({ hikari: PROTOCOL_MARKER, call: 'convert:result', id }, payload), '*');
  }

  async function convert(request) {
    if (request.from !== 'dna' || request.to !== 'gbk') {
      throw new Error('This service only converts dna to gbk.');
    }
    const hikari = window.HikariPlugin && window.HikariPlugin.hikari;
    const converter = window.SnapGeneBiopython;
    if (!hikari || typeof hikari.call !== 'function') {
      throw new Error('The Hikari Python API is unavailable. Reload the app after enabling this plugin.');
    }
    if (!converter || typeof converter.convertWithPython !== 'function') {
      throw new Error('The Biopython converter failed to load.');
    }
    return converter.convertWithPython(hikari, request.bytes, {
      filename: request.filename || 'sequence.dna'
    });
  }

  window.addEventListener('message', function (event) {
    const request = event.data;
    if (!request || typeof request !== 'object' || request.hikari !== PROTOCOL_MARKER || request.call !== 'convert') {
      return;
    }
    void convert(request).then(
      function (text) {
        reply(request.id, { ok: true, text: text });
      },
      function (error) {
        reply(request.id, { ok: false, error: String((error && error.message) || error) });
      }
    );
  });
}());
