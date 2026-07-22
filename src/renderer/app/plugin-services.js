// Runtime for "service" plugins: hidden sandboxed iframes that provide a
// capability instead of a workspace view. The only capability today is file
// conversion (e.g. SnapGene .dna -> GenBank .gbk), which lets a built-in
// feature open a file format it does not natively understand.
//
// The messaging mirrors plugin-bridge.js but reversed. There the plugin calls
// the host; here the host calls the service:
//
//   host -> service: { hikari: 1, call: 'convert', id, from, to, filename, bytes }
//   service -> host: { hikari: 1, call: 'convert:result', id, ok, text }
//                    { hikari: 1, call: 'convert:result', id, ok: false, error }
//
// The `call` discriminator keeps this off the plugin-bridge channel (which
// only processes messages carrying a `verb`), so a page can host both without
// crosstalk. A service frame is intentionally NOT registered with the bridge:
// a converter needs no host API, only bytes in and text out.

const PROTOCOL_MARKER = 1;
const CONVERT_TIMEOUT_MS = 15000;

function normalizeExtension(value) {
  return String(value || '').toLowerCase().trim().replace(/^\./, '');
}

export function createPluginServiceRegistry({ windowObject = globalThis.window } = {}) {
  // extension -> { pluginId, from, to, frame }. First registration wins, so a
  // later plugin cannot hijack an extension another service already claimed.
  const converters = new Map();
  const pending = new Map();
  let nextCallId = 0;

  function register(frame, plugin) {
    const conversions = Array.isArray(plugin?.service?.fileConversions)
      ? plugin.service.fileConversions
      : [];
    for (const conversion of conversions) {
      const from = normalizeExtension(conversion?.from);
      const to = normalizeExtension(conversion?.to);
      if (from && to && !converters.has(from)) {
        converters.set(from, { pluginId: plugin.id, from, to, frame });
      }
    }
  }

  function getConverter(extension) {
    return converters.get(normalizeExtension(extension)) || null;
  }

  // Extensions this registry can convert, as a dotted, comma-joined string
  // ready to append to a file input's `accept` attribute (e.g. ".dna,.ab1").
  function acceptExtensions() {
    return [...converters.keys()].map((ext) => `.${ext}`).join(',');
  }

  // Hands a file's bytes to the owning service frame and resolves with the
  // converted text. `bytes` should be a Uint8Array; it is cloned across the
  // postMessage boundary. Rejects on unknown extension, dead frame, timeout, or
  // a service-reported error — the caller decides how to surface it.
  function convert({ extension, filename, bytes }) {
    const converter = getConverter(extension);
    if (!converter) {
      return Promise.reject(new Error(`No installed service converts .${normalizeExtension(extension)} files.`));
    }
    const target = converter.frame?.contentWindow;
    if (!target) {
      return Promise.reject(new Error(`The "${converter.pluginId}" service is not running.`));
    }
    return new Promise((resolve, reject) => {
      const id = `svc_${nextCallId += 1}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Conversion of ${filename || 'the file'} timed out.`));
      }, CONVERT_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer, to: converter.to });
      target.postMessage({
        hikari: PROTOCOL_MARKER,
        call: 'convert',
        id,
        from: converter.from,
        to: converter.to,
        filename: String(filename || ''),
        bytes
      }, '*');
    });
  }

  function handleMessage(event) {
    const reply = event?.data;
    if (!reply || typeof reply !== 'object' || reply.hikari !== PROTOCOL_MARKER || reply.call !== 'convert:result') {
      return;
    }
    const settle = pending.get(reply.id);
    if (!settle) {
      return;
    }
    // Only the frame we posted to can answer this id: the service frame we
    // targeted is the one whose contentWindow re-posts here.
    pending.delete(reply.id);
    clearTimeout(settle.timer);
    if (reply.ok && typeof reply.text === 'string') {
      settle.resolve({ to: settle.to, text: reply.text });
    } else {
      settle.reject(new Error(String(reply.error || 'The service failed to convert the file.')));
    }
  }

  windowObject?.addEventListener?.('message', handleMessage);

  return { register, getConverter, acceptExtensions, convert, handleMessage };
}
