// App-wide transient notice: a small flag in the top-right corner that fades
// out after a few seconds. Non-blocking, and the app's single reporting path
// for confirmations and recoverable errors — modules should not call
// window.alert. Reads the ambient document/window so any module can import it
// without being handed a window reference.

let activeToastTimer = 0;
let activeToastFadeTimer = 0;

// `typeof x` is the only safe probe here: this module is imported into sandboxes
// where `document`/`window` are not declared at all, and `document?.foo` still
// throws a ReferenceError on an undeclared name.
function getDocument() {
  return typeof document !== 'undefined' ? document : null;
}

function getWindow() {
  return typeof window !== 'undefined' ? window : null;
}

function ensureToastElement() {
  const doc = getDocument();
  if (typeof doc?.createElement !== 'function' || !doc?.body?.appendChild) {
    return null;
  }
  let toast = typeof doc.querySelector === 'function'
    ? doc.querySelector('[data-hikari-transient-toast]')
    : null;
  if (toast) {
    return toast;
  }
  toast = doc.createElement('div');
  toast.setAttribute('data-hikari-transient-toast', 'true');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '22px',
    right: '22px',
    zIndex: '1200',
    maxWidth: 'min(360px, calc(100vw - 32px))',
    padding: '12px 16px',
    borderRadius: '12px',
    boxShadow: '0 16px 32px rgba(27, 20, 14, 0.18)',
    color: '#ffffff',
    fontSize: '0.94rem',
    lineHeight: '1.35',
    whiteSpace: 'pre-line',
    opacity: '0',
    transform: 'translateY(-6px)',
    transition: 'opacity 180ms ease, transform 180ms ease',
    pointerEvents: 'none'
  });
  doc.body.appendChild(toast);
  return toast;
}

// ponytail: one shared toast element, newest message replaces the previous one.
// Stack them only if a real workflow needs two notices on screen at once.
export function showTransientNotice(message, { type = 'success', durationMs = 5000 } = {}) {
  const toast = ensureToastElement();
  if (!toast) {
    return;
  }
  const text = String(message || '').trim();
  // Status panels re-assert the same message on every render, so an unchanged
  // message that is already on screen must not restart the timer — otherwise a
  // re-rendering panel would pin the notice open indefinitely.
  if (!toast.hidden && toast.textContent === text) {
    return;
  }
  if (type === 'error') {
    // Every recoverable failure the user sees also lands in the error log.
    try {
      getWindow()?.hikariApi?.reportError?.({ source: 'renderer:notice', message: text });
    } catch {
      // No bridge here (tests, plugin sandboxes).
    }
  }
  toast.textContent = text;
  // The day theme's danger/success, fixed: a toast floats over every theme and
  // keeps white text, so it cannot follow night's light status colors.
  toast.style.background = type === 'error'
    ? 'rgba(167, 75, 58, 0.96)'
    : 'rgba(22, 101, 52, 0.96)';
  toast.hidden = false;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  const win = getWindow();
  const timerHost = typeof win?.setTimeout === 'function' && typeof win?.clearTimeout === 'function'
    ? win
    : globalThis;
  if (typeof timerHost?.setTimeout !== 'function' || typeof timerHost?.clearTimeout !== 'function') {
    // No usable timer pair here (test sandboxes ship partial globals): show the
    // notice and let the next one replace it rather than throwing.
    return;
  }
  timerHost.clearTimeout(activeToastTimer);
  timerHost.clearTimeout(activeToastFadeTimer);

  activeToastTimer = timerHost.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    activeToastFadeTimer = timerHost.setTimeout(() => {
      toast.hidden = true;
    }, 180);
    // Node timers only: keep a pending fade from holding the test run open.
    activeToastFadeTimer?.unref?.();
  }, Math.max(1000, Number(durationMs) || 5000));
  activeToastTimer?.unref?.();
}
