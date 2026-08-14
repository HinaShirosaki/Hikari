const DEFAULT_WIDTH = 280;
const DEFAULT_MIN = 240;
const DEFAULT_MAX = 400;
const DEFAULT_MOBILE_BREAKPOINT = 980;
const HANDLE_CLASS = 'app-left-rail-handle';

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function initPluginLeftRailResizer({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  initialLayout = null,
  commitWidth = async () => null,
  onCommitError = () => {}
} = {}) {
  const root = documentObject?.documentElement;
  if (!root?.style || !documentObject?.querySelector || !windowObject?.addEventListener) {
    return {
      applyContext: () => DEFAULT_WIDTH,
      ensureHandle: () => null,
      destroy: () => {}
    };
  }

  let rail = null;
  let layout = null;
  let handle = null;
  let activeResize = null;
  let destroyed = false;
  let commitVersion = 0;
  let constraints = {
    width: DEFAULT_WIDTH,
    min: DEFAULT_MIN,
    max: DEFAULT_MAX,
    mobileBreakpoint: DEFAULT_MOBILE_BREAKPOINT
  };

  function clampWidth(width) {
    const responsiveMax = windowObject.innerWidth > constraints.mobileBreakpoint
      ? Math.max(constraints.min, Math.min(constraints.max, Math.floor(windowObject.innerWidth * 0.38)))
      : constraints.max;
    return Math.max(
      constraints.min,
      Math.min(responsiveMax, Math.round(finiteNumber(width, constraints.width)))
    );
  }

  function applyWidth(width) {
    const nextWidth = clampWidth(width);
    constraints.width = nextWidth;
    root.style.setProperty('--shared-left-rail-min', `${constraints.min}px`);
    root.style.setProperty('--shared-left-rail-max', `${constraints.max}px`);
    root.style.setProperty('--shared-left-rail-width', `${nextWidth}px`);
    return nextWidth;
  }

  function applyContext(context = {}) {
    const leftRail = context?.leftRail && typeof context.leftRail === 'object'
      ? context.leftRail
      : context;
    constraints = {
      width: finiteNumber(leftRail?.width, constraints.width),
      min: Math.max(1, finiteNumber(leftRail?.min, constraints.min)),
      max: Math.max(1, finiteNumber(leftRail?.max, constraints.max)),
      mobileBreakpoint: Math.max(
        1,
        finiteNumber(leftRail?.mobileBreakpoint, constraints.mobileBreakpoint)
      )
    };
    if (constraints.max < constraints.min) {
      constraints.max = constraints.min;
    }
    if (activeResize) {
      return activeResize.currentWidth;
    }
    return applyWidth(constraints.width);
  }

  function removeDocumentListeners() {
    documentObject.removeEventListener?.('pointermove', onPointerMove);
    documentObject.removeEventListener?.('pointerup', onPointerUp);
    documentObject.removeEventListener?.('pointercancel', onPointerUp);
  }

  function commit(nextWidth) {
    const request = commitVersion += 1;
    Promise.resolve(commitWidth(nextWidth)).then((result) => {
      if (destroyed || request !== commitVersion) {
        return;
      }
      if (result?.leftRail) {
        applyContext(result.leftRail);
      }
    }).catch((error) => {
      if (!destroyed && request === commitVersion) {
        onCommitError(error, nextWidth);
      }
    });
  }

  function finishResize({ shouldCommit = true } = {}) {
    if (!activeResize) {
      return;
    }
    const nextWidth = activeResize.currentWidth;
    activeResize = null;
    rail?.classList?.remove('is-resizing');
    documentObject.body?.classList?.remove('shared-left-rail-resizing');
    removeDocumentListeners();
    if (shouldCommit) {
      commit(nextWidth);
    }
  }

  function onPointerMove(event) {
    if (!activeResize) {
      return;
    }
    activeResize.currentWidth = applyWidth(
      activeResize.startWidth + (finiteNumber(event?.clientX, activeResize.startX) - activeResize.startX)
    );
  }

  function onPointerUp() {
    finishResize();
  }

  function onPointerDown(event) {
    if (windowObject.innerWidth <= constraints.mobileBreakpoint || !rail) {
      return;
    }
    event?.preventDefault?.();
    const measuredWidth = finiteNumber(rail.getBoundingClientRect?.().width, constraints.width);
    activeResize = {
      startX: finiteNumber(event?.clientX, 0),
      startWidth: measuredWidth,
      currentWidth: measuredWidth
    };
    rail.classList?.add('is-resizing');
    documentObject.body?.classList?.add('shared-left-rail-resizing');
    documentObject.addEventListener?.('pointermove', onPointerMove);
    documentObject.addEventListener?.('pointerup', onPointerUp);
    documentObject.addEventListener?.('pointercancel', onPointerUp);
  }

  function ensureHandle() {
    layout = documentObject.querySelector('.gel-workspace.left-rail-template');
    rail = layout?.querySelector?.('[data-sync-left-rail]') || null;
    if (!layout || !rail) {
      return null;
    }
    layout.querySelectorAll?.(`.${HANDLE_CLASS}`)?.forEach?.((node) => node.remove?.());
    handle = documentObject.createElement('button');
    handle.type = 'button';
    handle.className = HANDLE_CLASS;
    handle.tabIndex = -1;
    handle.setAttribute('aria-hidden', 'true');
    handle.setAttribute('data-shared-left-rail-handle', 'true');
    handle.addEventListener('pointerdown', onPointerDown);
    layout.append(handle);
    return handle;
  }

  function onResize() {
    if (activeResize && windowObject.innerWidth <= constraints.mobileBreakpoint) {
      finishResize({ shouldCommit: false });
    }
    applyWidth(constraints.width);
  }

  function destroy() {
    destroyed = true;
    commitVersion += 1;
    finishResize({ shouldCommit: false });
    windowObject.removeEventListener?.('resize', onResize);
    handle?.removeEventListener?.('pointerdown', onPointerDown);
    handle?.remove?.();
    handle = null;
    rail = null;
    layout = null;
  }

  applyContext(initialLayout || {});
  ensureHandle();
  windowObject.addEventListener('resize', onResize);

  return {
    applyContext,
    ensureHandle,
    destroy
  };
}
