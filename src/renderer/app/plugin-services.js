// Runtime for "service" plugins: hidden sandboxed iframes that provide a
// capability instead of a workspace view. The only capability today is file
// conversion (e.g. .dna -> GenBank .gbk), which lets a built-in
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
// crosstalk. Service frames are also registered with that permission bridge,
// allowing a converter to use a narrowly declared host capability such as
// `python` while remaining headless.

import { pluginOrigin } from './plugin-origin.js';

const PROTOCOL_MARKER = 1;
const CONVERT_TIMEOUT_MS = 15000;
const SERVICE_READY_TIMEOUT_MS = 10000;

function normalizeExtension(value) {
  return String(value || '').toLowerCase().trim().replace(/^\./, '');
}

export function createPluginServiceRegistry({ windowObject = globalThis.window } = {}) {
  // extension -> { pluginId, from, to, frame }. First registration wins, so a
  // later plugin cannot hijack an extension another service already claimed.
  const converters = new Map();
  // contentWindow -> shared runtime state for every conversion declared by one
  // service frame. The worker announces readiness only after its listener is
  // installed, so an early file-open request cannot disappear during startup.
  const runtimes = new Map();
  const pending = new Map();
  let nextCallId = 0;

  function settleRuntime(runtime, error = '') {
    if (!runtime || runtime.error || (!error && (runtime.ready || !runtime.origin))) {
      return;
    }
    runtime.ready = !error;
    runtime.error = String(error || '');
    for (const waiter of runtime.waiters) {
      clearTimeout(waiter.timer);
      if (runtime.ready) {
        waiter.resolve();
      } else {
        waiter.reject(new Error(runtime.error));
      }
    }
    runtime.waiters.clear();
    if (error) {
      for (const [id, call] of pending) {
        if (call.runtime === runtime) {
          clearTimeout(call.timer);
          pending.delete(id);
          call.reject(new Error(runtime.error));
        }
      }
    }
  }

  function waitUntilReady(runtime) {
    if (runtime?.ready) {
      return Promise.resolve();
    }
    if (runtime?.error) {
      return Promise.reject(new Error(runtime.error));
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        runtime?.waiters?.delete?.(waiter);
        reject(new Error(`The "${runtime?.pluginId || 'plugin'}" service did not start.`));
      }, SERVICE_READY_TIMEOUT_MS);
      runtime.waiters.add(waiter);
    });
  }

  function register(frame, plugin, baseUrl = '') {
    const runtime = {
      pluginId: String(plugin?.id || 'plugin'),
      frame,
      origin: pluginOrigin(baseUrl),
      ready: false,
      error: '',
      waiters: new Set()
    };
    if (frame?.contentWindow) {
      runtimes.set(frame.contentWindow, runtime);
    }
    const conversions = Array.isArray(plugin?.service?.fileConversions)
      ? plugin.service.fileConversions
      : [];
    for (const conversion of conversions) {
      const from = normalizeExtension(conversion?.from);
      const to = normalizeExtension(conversion?.to);
      if (from && to && !converters.has(from)) {
        converters.set(from, { pluginId: plugin.id, from, to, frame, runtime });
      }
    }
    return {
      setOrigin(value) {
        // Assigned by the loader once, before navigating the frame. An
        // untrusted document cannot move its grant to another origin.
        if (!runtime.origin && !runtime.error) {
          runtime.origin = pluginOrigin(value);
        }
      },
      ready() {
        settleRuntime(runtime);
      },
      fail(error) {
        settleRuntime(runtime, `The "${runtime.pluginId}" service could not start: ${String(error || 'unknown error')}`);
      }
    };
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
  function postConversion({ converter, filename, bytes }) {
    const target = converter.frame?.contentWindow;
    if (!target || !converter.runtime.origin || converter.runtime.error) {
      return Promise.reject(new Error(`The "${converter.pluginId}" service is not running.`));
    }
    return new Promise((resolve, reject) => {
      const id = `svc_${nextCallId += 1}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Conversion of ${filename || 'the file'} timed out.`));
      }, CONVERT_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer, to: converter.to, source: target, runtime: converter.runtime });
      try {
        target.postMessage({
          hikari: PROTOCOL_MARKER,
          call: 'convert',
          id,
          from: converter.from,
          to: converter.to,
          filename: String(filename || ''),
          bytes
        }, converter.runtime.origin);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function convert({ extension, filename, bytes }) {
    const converter = getConverter(extension);
    if (!converter) {
      return Promise.reject(new Error(`No installed service converts .${normalizeExtension(extension)} files.`));
    }
    if (!converter.runtime.ready) {
      return waitUntilReady(converter.runtime).then(() => postConversion({ converter, filename, bytes }));
    }
    return postConversion({ converter, filename, bytes });
  }

  function handleMessage(event) {
    const reply = event?.data;
    if (!reply || typeof reply !== 'object' || reply.hikari !== PROTOCOL_MARKER) {
      return;
    }
    const runtime = runtimes.get(event.source);
    if (!runtime?.origin || runtime.error) {
      return;
    }
    if (event.origin !== runtime.origin) {
      settleRuntime(runtime, `The "${runtime.pluginId}" service navigated away from its assigned origin.`);
      return;
    }
    if (reply.call === 'service:ready') {
      settleRuntime(runtime);
      return;
    }
    if (reply.call !== 'convert:result') {
      return;
    }
    const settle = pending.get(reply.id);
    if (!settle || event.source !== settle.source) {
      return;
    }
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
