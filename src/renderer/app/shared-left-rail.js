import { setShellAttribute } from '../lib/i18n/shell.js';
const STORAGE_KEY = 'hikari_shared_left_rail_width_v2';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 240;
const MAX_WIDTH = 400;
const MOBILE_BREAKPOINT = 980;
const HANDLE_CLASS = 'app-left-rail-handle';
const HANDLE_ATTR = 'data-shared-left-rail-handle';
const FOLDABLE_ATTR = 'data-left-rail-foldable';
const FOLDED_CLASS = 'is-left-rail-folded';
export const SHARED_LEFT_RAIL_CHANGED_EVENT = 'hikari:left-rail-width-changed';

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
      syncWidth: () => {},
      syncToggle: () => {}
    };
  }

  const root = rootDocument.documentElement;
  const toggle = rootDocument.getElementById('topbar-left-rail-toggle');
  let activeResize = null;

  function getActiveRail() {
    const activeView = rootDocument.querySelector('.view.is-active');
    if (!activeView) return null;
    return [...activeView.querySelectorAll('[data-sync-left-rail]')].find((rail) => {
      const layout = rail.parentElement;
      return layout?.getAttribute(FOLDABLE_ATTR) === 'true'
        && !layout.closest('[hidden]') && layout.getClientRects().length > 0;
    }) || null;
  }

  function syncToggle() {
    const rail = getActiveRail();
    const layout = rail?.parentElement;
    const folded = Boolean(rail && (layout.classList.contains(FOLDED_CLASS)
      || windowObject.getComputedStyle(rail).display === 'none'));
    if (toggle) {
      toggle.hidden = !rail;
      toggle.setAttribute('aria-expanded', String(Boolean(rail) && !folded));
      if (rail) toggle.setAttribute('aria-controls', rail.id);
      else toggle.removeAttribute('aria-controls');
      const label = folded ? 'leftRail.show' : 'leftRail.hide';
      setShellAttribute(toggle, 'aria-label', label);
      setShellAttribute(toggle, 'title', label);
    }
    rootDocument.body?.classList?.toggle('has-folded-shared-left-rail', folded);
  }

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

  function syncFoldState(layout, rail, resizeHandle) {
    const folded = layout.classList.contains(FOLDED_CLASS);
    if (folded && rail.contains(rootDocument.activeElement)) {
      toggle?.focus({ preventScroll: true });
    }
    layout.dataset.leftRailState = folded ? 'folded' : 'expanded';
    rail.setAttribute('aria-hidden', folded ? 'true' : 'false');
    rail.inert = folded;
    if (resizeHandle) {
      resizeHandle.hidden = folded;
    }
  }

  function ensureFoldState(layout, rail, resizeHandle) {
    if (!layout.hasAttribute(FOLDABLE_ATTR)) layout.setAttribute(FOLDABLE_ATTR, 'true');
    const foldable = layout.getAttribute(FOLDABLE_ATTR) === 'true';
    layout.querySelectorAll('[data-left-rail-fold-toggle]').forEach((button) => button.remove());

    if (!foldable) {
      layout.classList.remove(FOLDED_CLASS);
      layout.removeAttribute('data-left-rail-state');
      rail.removeAttribute('aria-hidden');
      rail.inert = false;
      if (resizeHandle) {
        resizeHandle.hidden = false;
      }
      return;
    }

    syncFoldState(layout, rail, resizeHandle);
  }

  toggle?.addEventListener('click', () => {
    const rail = getActiveRail();
    if (!rail) return;
    finishResize();
    const layout = rail.parentElement;
    const folded = layout.classList.contains(FOLDED_CLASS)
      || windowObject.getComputedStyle(rail).display === 'none';
    layout.classList.toggle(FOLDED_CLASS, !folded);
    layout.classList.toggle('is-left-rail-expanded', folded);
    syncFoldState(layout, rail, layout.querySelector(`[${HANDLE_ATTR}="true"]`));
    syncToggle();
  });

  function ensureHandles() {
    const rails = [...rootDocument.querySelectorAll('[data-sync-left-rail]')];
    rails.forEach((rail, index) => {
      if (!(rail instanceof HTMLElement)) {
        return;
      }
      const layout = rail.parentElement;
      if (!(layout instanceof HTMLElement)) {
        return;
      }
      if (!rail.id) rail.id = `shared-left-rail-${index + 1}`;

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
      ensureFoldState(layout, rail, resizeHandle);
    });
    syncToggle();
  }

  applyWidth(readStoredWidth(windowObject));
  ensureHandles();

  return {
    ensureHandles,
    syncWidth,
    syncToggle
  };
}
