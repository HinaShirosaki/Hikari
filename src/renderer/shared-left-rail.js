const STORAGE_KEY = 'enana_shared_left_rail_width_v2';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 240;
const MAX_WIDTH = 400;
const MOBILE_BREAKPOINT = 980;
const HANDLE_CLASS = 'app-left-rail-handle';
const HANDLE_ATTR = 'data-shared-left-rail-handle';

function clampWidth(width, windowObject) {
  const raw = Number(width);
  const viewportWidth = Number(windowObject?.innerWidth) || 0;
  const responsiveMax = viewportWidth > MOBILE_BREAKPOINT
    ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth * 0.38)))
    : MAX_WIDTH;
  if (!Number.isFinite(raw)) {
    return DEFAULT_WIDTH;
  }
  return Math.max(MIN_WIDTH, Math.min(responsiveMax, Math.round(raw)));
}

function readStoredWidth(windowObject) {
  try {
    const stored = windowObject?.localStorage?.getItem?.(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_WIDTH;
    }
    return Number.parseInt(stored, 10) || DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function writeStoredWidth(width, windowObject) {
  try {
    windowObject?.localStorage?.setItem?.(STORAGE_KEY, String(Math.round(width)));
  } catch {}
}

export function initSharedLeftRailResizers({
  document: rootDocument = globalThis?.document || null,
  windowObject = globalThis?.window || null
} = {}) {
  if (!rootDocument?.documentElement || !windowObject?.getComputedStyle) {
    return {
      ensureHandles: () => {},
      syncWidth: () => {}
    };
  }

  const root = rootDocument.documentElement;
  let activeResize = null;

  function applyWidth(width) {
    const nextWidth = clampWidth(width, windowObject);
    root.style.setProperty('--shared-left-rail-width', `${nextWidth}px`);
    return nextWidth;
  }

  function syncWidth() {
    const computedWidth = Number.parseFloat(
      windowObject.getComputedStyle(root).getPropertyValue('--shared-left-rail-width')
    );
    return applyWidth(computedWidth || readStoredWidth(windowObject));
  }

  function finishResize() {
    if (!activeResize) {
      return;
    }
    const { rail } = activeResize;
    rail?.classList?.remove('is-resizing');
    rootDocument.body?.classList?.remove('shared-left-rail-resizing');
    writeStoredWidth(activeResize.currentWidth, windowObject);
    activeResize = null;
    rootDocument.removeEventListener('pointermove', onPointerMove);
    rootDocument.removeEventListener('pointerup', onPointerUp);
    rootDocument.removeEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(event) {
    if (!activeResize) {
      return;
    }
    const delta = event.clientX - activeResize.startX;
    activeResize.currentWidth = applyWidth(activeResize.startWidth + delta);
  }

  function onPointerUp() {
    finishResize();
  }

  function onPointerDown(event, railOverride = null) {
    if (windowObject.innerWidth <= MOBILE_BREAKPOINT) {
      return;
    }
    const rail = railOverride instanceof HTMLElement
      ? railOverride
      : (event.currentTarget instanceof HTMLElement
        ? event.currentTarget.closest('[data-sync-left-rail]')
        : null);
    if (!(rail instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    activeResize = {
      rail,
      startX: event.clientX,
      startWidth: rail.getBoundingClientRect().width,
      currentWidth: rail.getBoundingClientRect().width
    };
    rail.classList.add('is-resizing');
    rootDocument.body?.classList?.add('shared-left-rail-resizing');
    rootDocument.addEventListener('pointermove', onPointerMove);
    rootDocument.addEventListener('pointerup', onPointerUp);
    rootDocument.addEventListener('pointercancel', onPointerUp);
  }

  function ensureHandles() {
    const rails = [...rootDocument.querySelectorAll('[data-sync-left-rail]')];
    rails.forEach((rail) => {
      if (!(rail instanceof HTMLElement)) {
        return;
      }
      const layout = rail.parentElement;
      if (!(layout instanceof HTMLElement)) {
        return;
      }

      [...rail.querySelectorAll(`.${HANDLE_CLASS}`)].forEach((node) => node.remove());

      const existingHandle = layout.querySelector(`[${HANDLE_ATTR}="true"]`);
      if (existingHandle) {
        return;
      }

      const handle = rootDocument.createElement('button');
      handle.type = 'button';
      handle.className = HANDLE_CLASS;
      handle.tabIndex = -1;
      handle.setAttribute('aria-hidden', 'true');
      handle.setAttribute(HANDLE_ATTR, 'true');
      handle.addEventListener('pointerdown', (event) => onPointerDown(event, rail));
      layout.append(handle);
    });
  }

  applyWidth(readStoredWidth(windowObject));
  ensureHandles();

  return {
    ensureHandles,
    syncWidth
  };
}
