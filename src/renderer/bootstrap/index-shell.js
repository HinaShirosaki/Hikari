import { applyAppearanceToDocument } from '../modules/app-state/appearance.js';

const DEFAULT_FONT_SIZE = 16;
const STORAGE_KEY = 'hikari_state_v1';
const APP_READY_EVENT = 'hikari:app-ready';
const MIN_LOADING_COVER_MS = 700;
const MAX_LOADING_COVER_MS = 8000;

function applyShellAppearance() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const appearance = parsed && parsed.settings ? parsed.settings.appearance || {} : {};
    applyAppearanceToDocument(appearance, document, DEFAULT_FONT_SIZE);
  } catch {}
}

// Self-contained on purpose: this file is its own <script type="module">, so it
// still runs when the renderer.js graph is the thing that broke. Importing the
// app's toast helper would couple the failure reporter to the graph that failed
// -- and that helper fades out, which is wrong for a state that does not heal.
function showBootFailure() {
  if (document.querySelector('[data-hikari-boot-failure]')) {
    return;
  }
  const banner = document.createElement('div');
  banner.setAttribute('data-hikari-boot-failure', 'true');
  banner.setAttribute('role', 'alert');
  Object.assign(banner.style, {
    position: 'fixed',
    top: '22px',
    right: '22px',
    zIndex: '1300',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    maxWidth: 'min(420px, calc(100vw - 32px))',
    padding: '12px 16px',
    borderRadius: '12px',
    boxShadow: '0 16px 32px rgba(23, 18, 14, 0.18)',
    background: 'rgba(156, 54, 48, 0.96)',
    color: '#ffffff',
    fontSize: '0.94rem',
    lineHeight: '1.35'
  });

  const text = document.createElement('span');
  text.textContent = 'Hikari did not finish loading. Parts of the app may be missing or unresponsive — reload to try again.';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  Object.assign(dismiss.style, {
    flex: '0 0 auto',
    padding: '4px 10px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.5)',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer'
  });
  dismiss.addEventListener('click', () => banner.remove());

  banner.append(text, dismiss);
  document.body.appendChild(banner);
}

function clearBootFailure() {
  document.querySelector('[data-hikari-boot-failure]')?.remove();
}

function initLoadingCover() {
  const root = document.documentElement;
  const body = document.body;
  const cover = document.getElementById('app-loading-cover');
  const startedAt = globalThis?.performance?.now?.() || Date.now();
  let hasFinished = false;

  root.classList.add('app-booting');
  body.classList.add('app-booting');

  function finishLoadingCover() {
    if (hasFinished) {
      return;
    }
    hasFinished = true;

    const hide = () => {
      root.classList.remove('app-booting');
      root.classList.add('app-ready');
      body.classList.remove('app-booting');
      if (!cover) {
        return;
      }
      cover.classList.add('is-hidden');
      const cleanup = () => cover.remove();
      cover.addEventListener('transitionend', cleanup, { once: true });
      globalThis.setTimeout(cleanup, 500);
    };

    globalThis.requestAnimationFrame(() => {
      globalThis.requestAnimationFrame(hide);
    });
  }

  let appReadySeen = false;

  globalThis.addEventListener(APP_READY_EVENT, (event) => {
    appReadySeen = true;
    // initApp caught something and finished partially: the app is usable but
    // incomplete, so lift the cover and say so rather than pretending.
    if (event?.detail?.error) {
      showBootFailure();
    } else {
      // A slow-but-healthy boot may land after the cap already warned. Take it back.
      clearBootFailure();
    }
    const elapsed = (globalThis?.performance?.now?.() || Date.now()) - startedAt;
    const remaining = Math.max(0, MIN_LOADING_COVER_MS - elapsed);
    globalThis.setTimeout(finishLoadingCover, remaining);
  }, { once: true });

  // The cap must never leave the cover up forever, but it must also not reveal a
  // shell that looks booted and is inert. No event by now means boot either threw
  // outside initApp (nothing is coming) or is pathologically slow; warn either
  // way, and let a late app-ready clear it.
  globalThis.setTimeout(() => {
    if (!appReadySeen) {
      showBootFailure();
    }
    finishLoadingCover();
  }, MAX_LOADING_COVER_MS);
}

// Only the native macOS window overlays its controls on the app header.
// Browser previews and other desktop platforms keep their normal chrome.
document.documentElement.dataset.windowChrome = globalThis.hikariApi?.platform === 'darwin' ? 'mac' : 'native';
applyShellAppearance();
initLoadingCover();
