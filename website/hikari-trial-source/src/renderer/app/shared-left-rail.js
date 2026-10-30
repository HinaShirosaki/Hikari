const STORAGE_KEY = 'hikari_shared_left_rail_width_v2';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 240;
const MAX_WIDTH = 400;
const MOBILE_BREAKPOINT = 980;
const HANDLE_CLASS = 'app-left-rail-handle';
const HANDLE_ATTR = 'data-shared-left-rail-handle';
const FOLDABLE_ATTR = 'data-left-rail-foldable';
const FOLD_TOGGLE_CLASS = 'app-left-rail-fold-toggle';
const FOLDED_CLASS = 'is-left-rail-folded';
export const SHARED_LEFT_RAIL_CHANGED_EVENT = 'hikari:left-rail-width-changed';

function foldToggleIconMarkup() {
  return `
    <svg class="app-left-rail-fold-toggle__icon" viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
      <path class="app-left-rail-fold-toggle__chevron" d="m16 4-8 8 8 8"></path>
    </svg>
  `;
}

function getResponsiveMaxWidth(windowObject) {
  const viewportWidth = Number(windowObject?.innerWidth) || 0;
  return viewportWidth > MOBILE_BREAKPOINT
    ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth * 0.38)))
    : MAX_WIDTH;
}

function clampWidth(width, windowObject) {
  const raw = Number(width);
  const responsiveMax = getResponsiveMaxWidth(windowObject);
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

export function getSharedLeftRailLayout({
  document: rootDocument = globalThis?.document || null,
  windowObject = globalThis?.window || null
} = {}) {
  const root = rootDocument?.documentElement || null;
  let computedWidth = 0;
  try {
    computedWidth = Number.parseFloat(
      windowObject?.getComputedStyle?.(root)?.getPropertyValue?.('--shared-left-rail-width') || ''
    );
  } catch {}
  return {
    width: clampWidth(computedWidth || readStoredWidth(windowObject), windowObject),
    min: MIN_WIDTH,
    max: getResponsiveMaxWidth(windowObject),
    mobileBreakpoint: MOBILE_BREAKPOINT
  };
}

function announceSharedLeftRailWidth(layout, windowObject) {
  if (typeof windowObject?.dispatchEvent !== 'function') {
    return;
  }
  const detail = { ...layout };
  if (typeof windowObject.CustomEvent === 'function') {
    windowObject.dispatchEvent(new windowObject.CustomEvent(
      SHARED_LEFT_RAIL_CHANGED_EVENT,
      { detail }
    ));
    return;
  }
  windowObject.dispatchEvent({ type: SHARED_LEFT_RAIL_CHANGED_EVENT, detail });
}

export function setSharedLeftRailWidth(width, {
  document: rootDocument = globalThis?.document || null,
  windowObject = globalThis?.window || null,
  persist = true,
  notify = true
} = {}) {
  const nextWidth = clampWidth(width, windowObject);
  rootDocument?.documentElement?.style?.setProperty?.('--shared-left-rail-width', `${nextWidth}px`);
  if (persist) {
    writeStoredWidth(nextWidth, windowObject);
  }
  const layout = {
    width: nextWidth,
    min: MIN_WIDTH,
    max: getResponsiveMaxWidth(windowObject),
    mobileBreakpoint: MOBILE_BREAKPOINT
  };
  if (notify) {
    announceSharedLeftRailWidth(layout, windowObject);
  }
  return layout;
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
    return setSharedLeftRailWidth(width, {
      document: rootDocument,
      windowObject,
      persist: false,
      notify: false
    }).width;
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
    setSharedLeftRailWidth(activeResize.currentWidth, {
      document: rootDocument,
      windowObject
    });
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

  function syncFoldState(layout, rail, toggle, resizeHandle) {
    const folded = layout.classList.contains(FOLDED_CLASS);
    layout.dataset.leftRailState = folded ? 'folded' : 'expanded';
    rail.setAttribute('aria-hidden', folded ? 'true' : 'false');
    rail.inert = folded;
    if (resizeHandle) {
      resizeHandle.hidden = folded;
    }
    toggle.classList.toggle('is-folded', folded);
    toggle.setAttribute('aria-expanded', String(!folded));
    toggle.setAttribute('aria-label', folded ? 'Open left rail' : 'Fold left rail');
    toggle.title = folded ? 'Open left rail' : 'Fold left rail';

    const closestView = layout.closest?.('.view');
    if (!closestView || closestView.classList?.contains('is-active')) {
      rootDocument.body?.classList?.toggle('has-folded-shared-left-rail', folded);
    }
  }

  function ensureFoldToggle(layout, rail, resizeHandle) {
    const foldable = layout.getAttribute(FOLDABLE_ATTR) === 'true';
    const existingToggles = [...layout.querySelectorAll(`.${FOLD_TOGGLE_CLASS}`)];

    if (!foldable) {
      existingToggles.forEach((toggle) => toggle.remove());
      layout.classList.remove(FOLDED_CLASS);
      layout.removeAttribute('data-left-rail-state');
      rail.removeAttribute('aria-hidden');
      rail.inert = false;
      if (resizeHandle) {
        resizeHandle.hidden = false;
      }
      const closestView = layout.closest?.('.view');
      if (!closestView || closestView.classList?.contains('is-active')) {
        rootDocument.body?.classList?.remove('has-folded-shared-left-rail');
      }
      return;
    }

    if (windowObject.innerWidth <= MOBILE_BREAKPOINT) {
      layout.classList.remove(FOLDED_CLASS);
    }

    const toggle = existingToggles.shift() || rootDocument.createElement('button');
    existingToggles.forEach((extraToggle) => extraToggle.remove());
    if (!toggle.isConnected) {
      toggle.type = 'button';
      toggle.className = FOLD_TOGGLE_CLASS;
      toggle.innerHTML = foldToggleIconMarkup();
      toggle.setAttribute('data-left-rail-fold-toggle', 'true');
      toggle.addEventListener('click', () => {
        layout.classList.toggle(FOLDED_CLASS);
        syncFoldState(layout, rail, toggle, resizeHandle);
      });
      layout.append(toggle);
    }
    if (rail.id) {
      toggle.setAttribute('aria-controls', rail.id);
    }
    syncFoldState(layout, rail, toggle, resizeHandle);
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

      let resizeHandle = layout.querySelector(`[${HANDLE_ATTR}="true"]`);
      if (!resizeHandle) {
        resizeHandle = rootDocument.createElement('button');
        resizeHandle.type = 'button';
        resizeHandle.className = HANDLE_CLASS;
        resizeHandle.tabIndex = -1;
        resizeHandle.setAttribute('aria-hidden', 'true');
        resizeHandle.setAttribute(HANDLE_ATTR, 'true');
        resizeHandle.addEventListener('pointerdown', (event) => onPointerDown(event, rail));
        layout.append(resizeHandle);
      }
      ensureFoldToggle(layout, rail, resizeHandle);
    });
  }

  applyWidth(readStoredWidth(windowObject));
  ensureHandles();

  return {
    ensureHandles,
    syncWidth
  };
}
