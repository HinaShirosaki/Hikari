const MIN_DIALOG_TOP_CLEARANCE = 76;
const DIALOG_TOP_GAP = 12;

export function measureDialogTopClearance(topbar) {
  const topbarBottom = Number(topbar?.getBoundingClientRect?.().bottom);
  if (!Number.isFinite(topbarBottom)) {
    return MIN_DIALOG_TOP_CLEARANCE;
  }
  return Math.max(MIN_DIALOG_TOP_CLEARANCE, Math.ceil(topbarBottom) + DIALOG_TOP_GAP);
}

export function installDialogLayout({
  documentObject = globalThis.document,
  windowObject = globalThis.window
} = {}) {
  const root = documentObject?.documentElement;
  const topbar = documentObject?.querySelector?.('.topbar');
  if (!root || !topbar) {
    return () => {};
  }

  const syncTopClearance = () => {
    const clearance = measureDialogTopClearance(topbar);
    root.style.setProperty(
      '--app-dialog-safe-top',
      `max(${clearance}px, calc(env(safe-area-inset-top, 0px) + ${DIALOG_TOP_GAP}px))`
    );
  };

  syncTopClearance();
  windowObject?.addEventListener?.('resize', syncTopClearance);

  let topbarObserver = null;
  if (typeof windowObject?.ResizeObserver === 'function') {
    topbarObserver = new windowObject.ResizeObserver(syncTopClearance);
    topbarObserver.observe(topbar);
  }

  return () => {
    windowObject?.removeEventListener?.('resize', syncTopClearance);
    topbarObserver?.disconnect?.();
  };
}
