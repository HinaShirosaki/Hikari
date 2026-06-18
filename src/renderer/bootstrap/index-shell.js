const DEFAULT_FONT_SIZE = 16;
const FIXED_ACCENT = '#647255';
const FIXED_FOCUS = '#7a8a69';
const STORAGE_KEY = 'hikari_state_v1';
const APP_READY_EVENT = 'hikari:app-ready';
const MIN_LOADING_COVER_MS = 700;
const MAX_LOADING_COVER_MS = 8000;

function applyShellAppearance() {
  const root = document.documentElement;
  const body = document.body;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const appearance = parsed && parsed.settings ? parsed.settings.appearance || {} : {};
    const fontSize = Number(appearance.fontSize) || DEFAULT_FONT_SIZE;
    const mode = appearance.mode === 'night' ? 'night' : 'day';

    root.style.setProperty('--accent', FIXED_ACCENT);
    root.style.setProperty('--focus', FIXED_FOCUS);
    root.style.setProperty('--app-font-size', `${fontSize}px`);
    root.style.setProperty('font-size', `${fontSize}px`);
    body.classList.toggle('theme-night', mode === 'night');
    body.classList.add('ui-neutral-compact');
  } catch {}
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

  globalThis.addEventListener(APP_READY_EVENT, () => {
    const elapsed = (globalThis?.performance?.now?.() || Date.now()) - startedAt;
    const remaining = Math.max(0, MIN_LOADING_COVER_MS - elapsed);
    globalThis.setTimeout(finishLoadingCover, remaining);
  }, { once: true });

  globalThis.setTimeout(finishLoadingCover, MAX_LOADING_COVER_MS);
}

applyShellAppearance();
initLoadingCover();
