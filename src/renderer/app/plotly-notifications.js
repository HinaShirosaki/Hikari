import { showTransientNotice } from '../lib/notify.js';

const installations = new WeakMap();

// Plotly exposes no public notification callback. Watch its dedicated container
// so tips and export notices use the same reporting path as the rest of Hikari.
export function installPlotlyNotifications({
  documentObject = globalThis.document,
  windowObject = documentObject?.defaultView || globalThis.window,
  notify = showTransientNotice
} = {}) {
  if (!documentObject?.body || typeof windowObject?.MutationObserver !== 'function') return;
  if (installations.has(documentObject)) return installations.get(documentObject);

  const containers = new WeakSet();
  const forwarded = new WeakSet();

  function forward(container) {
    for (const note of container.querySelectorAll('.notifier-note')) {
      if (forwarded.has(note)) continue;
      const paragraph = note.querySelector('p');
      if (!paragraph) continue;
      // Plotly renders each line as a span separated by <br>. Read text only;
      // exclude the close button and retain line breaks without parsing HTML.
      const message = Array.from(paragraph.childNodes, node => node.nodeName === 'BR' ? '\n' : node.textContent).join('').trim();
      if (!message) continue;
      forwarded.add(note);
      const type = message === 'Sorry, there was a problem downloading your snapshot!' ? 'error' : 'success';
      notify(message, { type });
    }
  }

  function attach(container) {
    if (!containers.has(container)) {
      containers.add(container);
      // Observer callbacks run before paint, preventing a second popup from
      // flashing. Leave notes in place so Plotly can finish its timers and clear
      // its own duplicate-message bookkeeping.
      container.style.display = 'none';
      container.setAttribute('aria-hidden', 'true');
      observer.observe(container, { childList: true, subtree: true });
    }
    forward(container);
  }

  const observer = new windowObject.MutationObserver(records => {
    const changed = new Set();
    for (const record of records) {
      if (record.target === documentObject.body) {
        for (const node of record.addedNodes) {
          if (node.matches?.('.plotly-notifier')) attach(node);
        }
      } else {
        const container = record.target.closest?.('.plotly-notifier');
        if (container) changed.add(container);
      }
    }
    for (const container of changed) forward(container);
  });
  // Only observe direct body children and notifier contents: chart redraws can
  // change thousands of other DOM nodes and do not need notification scanning.
  observer.observe(documentObject.body, { childList: true });
  for (const container of documentObject.querySelectorAll('.plotly-notifier')) attach(container);

  const disconnect = () => {
    observer.disconnect();
    installations.delete(documentObject);
  };
  installations.set(documentObject, disconnect);
  return disconnect;
}
