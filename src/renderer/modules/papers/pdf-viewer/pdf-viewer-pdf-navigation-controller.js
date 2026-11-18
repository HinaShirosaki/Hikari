import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("papers");
import { clamp } from './pdf-viewer-anchors.js';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  ZOOM_WHEEL_SENSITIVITY
} from './pdf-viewer-constants.js';
import { paperFailure, paperUi } from '../localization.js';

export const installPdfViewerPdfNavigationController = (ctx) => {
  const { state } = ctx;
  let wheelFocus = null;
  const panRemainder = { x: 0, y: 0 };

  async function resolveDestinationPageNumber(destination) {
    if (!state.pdfDocument || !destination) {
      return 0;
    }

    let resolvedDestination = destination;
    if (typeof resolvedDestination === 'string' && typeof state.pdfDocument.getDestination === 'function') {
      try {
        resolvedDestination = await state.pdfDocument.getDestination(resolvedDestination);
      } catch {
        return 0;
      }
    }

    if (!Array.isArray(resolvedDestination) || !resolvedDestination.length) {
      return 0;
    }

    const pageRef = resolvedDestination[0];
    if (pageRef && typeof pageRef === 'object' && typeof state.pdfDocument.getPageIndex === 'function') {
      try {
        const pageIndex = await state.pdfDocument.getPageIndex(pageRef);
        return clamp(pageIndex + 1, 1, state.pageCount);
      } catch {
        return 0;
      }
    }

    const pageValue = Number(pageRef);
    if (!Number.isFinite(pageValue)) {
      return 0;
    }
    if (pageValue >= 0 && pageValue < state.pageCount) {
      return clamp(pageValue + 1, 1, state.pageCount);
    }
    return clamp(pageValue, 1, state.pageCount);
  }

  async function goToDestination(destination) {
    if (!state.pdfDocument) {
      return;
    }
    const pageNumber = await resolveDestinationPageNumber(destination);
    if (!pageNumber) {
      ctx.setStatus(paperUi('viewer.linkFailed'), true);
      return;
    }
    state.pendingNavigationPageNumber = pageNumber;
    ctx.goToPage(pageNumber, { behavior: 'smooth' });
  }

  function handleNamedPdfAction(action) {
    const normalizedAction = String(action || '').trim();
    if (!normalizedAction || !state.pdfDocument) {
      return;
    }
    if (normalizedAction === 'NextPage') {
      ctx.goToPage(state.pageNumber + 1, { behavior: 'smooth' });
    } else if (normalizedAction === 'PrevPage') {
      ctx.goToPage(state.pageNumber - 1, { behavior: 'smooth' });
    } else if (normalizedAction === 'FirstPage') {
      ctx.goToPage(1, { behavior: 'smooth' });
    } else if (normalizedAction === 'LastPage') {
      ctx.goToPage(state.pageCount, { behavior: 'smooth' });
    }
  }

  function getOutlineUrl(item) {
    const rawUrl = String(item?.url || item?.unsafeUrl || '').trim();
    if (!rawUrl) {
      return '';
    }
    try {
      const parsed = new URL(rawUrl);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
    } catch {
      return '';
    }
  }

  async function normalizeOutlineItems(items = [], prefix = '') {
    const normalized = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const title = String(item?.title || '').replace(/\s+/g, ' ').trim();
      const id = [prefix, String(index + 1)].filter(Boolean).join('.');
      const children = await normalizeOutlineItems(Array.isArray(item?.items) ? item.items : [], id);
      const pageNumber = await resolveDestinationPageNumber(item?.dest);
      const url = getOutlineUrl(item);
      if (!title && !children.length) {
        continue;
      }
      normalized.push({
        id,
        title: title || `Bookmark ${id}`,
        ...(pageNumber ? { pageNumber } : {}),
        ...(url ? { url } : {}),
        items: children
      });
    }
    return normalized;
  }

  async function loadPdfBookmarks(pdfDocument) {
    if (!pdfDocument || typeof pdfDocument.getOutline !== 'function') {
      return [];
    }
    try {
      const outline = await pdfDocument.getOutline();
      return normalizeOutlineItems(Array.isArray(outline) ? outline : []);
    } catch {
      return [];
    }
  }

  async function openExternalLink(url) {
    const externalUrl = String(url || '').trim();
    if (!externalUrl || typeof state.onExternalLink !== 'function') {
      ctx.setStatus(paperUi('viewer.externalUnavailable'), true);
      return;
    }
    ctx.setStatus(i18nUi.text("Opening external website..."));
    try {
      const result = await state.onExternalLink(externalUrl);
      if (result?.ok === true) {
        ctx.setStatus(i18nUi.text("Opened external website."));
      } else {
        const error = String(result?.error || '').trim();
        ctx.setStatus((((((error || i18nUi.text("External website was not opened.")))))));
      }
    } catch (error) {
      ctx.setStatus(paperFailure(error, 'viewer.externalFailed'), true);
    }
  }

  // focus: {clientX, clientY} that stays put on screen; null = stage center.
  function zoomTo(zoom, focus = null) {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = false;
    state.zoom = clamp(zoom(state.zoom), MIN_ZOOM, MAX_ZOOM);
    const rect = ctx.elements?.stage?.getBoundingClientRect?.();
    ctx.previewZoom(focus || (rect ? { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } : null));
  }

  function adjustZoom(delta) {
    zoomTo((zoom) => zoom + delta);
  }

  async function resetZoom() {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = false;
    state.zoom = DEFAULT_ZOOM;
    await ctx.renderDocumentPages({ preserveScroll: true });
  }

  async function fitToWidth() {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = true;
    await ctx.renderDocumentPages({ preserveScroll: true });
  }

  // macOS Chromium "rails" a trackpad scroll to one axis once the gesture leans
  // that way, but the DOM event keeps both deltas, so pan freely ourselves.
  // Only when the page also scrolls sideways; otherwise native scrolling is fine.
  function panStage(event) {
    const stage = ctx.elements?.stage;
    if (!stage || event.deltaMode !== 0 || stage.scrollWidth <= stage.clientWidth) {
      return;
    }
    event.preventDefault();
    const shiftOnly = event.shiftKey && !event.deltaX;
    // scrollTop may round, so carry the fractions trackpads send between events.
    panRemainder.x += Number(shiftOnly ? event.deltaY : event.deltaX) || 0;
    panRemainder.y += shiftOnly ? 0 : Number(event.deltaY) || 0;
    const x = Math.trunc(panRemainder.x);
    const y = Math.trunc(panRemainder.y);
    panRemainder.x -= x;
    panRemainder.y -= y;
    stage.scrollLeft += x;
    stage.scrollTop += y;
  }

  function handleZoomWheel(event) {
    if (!event || !state.pdfDocument) {
      return;
    }
    if (!event.ctrlKey) {
      panStage(event);
      return;
    }
    // Chromium delivers trackpad pinch as a ctrl+wheel event; ctrl+mouse-wheel lands here too.
    event.preventDefault();
    state.pendingZoomDelta -= (Number(event.deltaY) || 0) * ZOOM_WHEEL_SENSITIVITY;
    wheelFocus = { clientX: event.clientX, clientY: event.clientY };
    if (state.zoomWheelFrame) {
      return;
    }
    const win = ctx.getWindowRef();
    const schedule = typeof win?.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : (callback) => setTimeout(callback, 16);
    state.zoomWheelFrame = schedule(() => {
      state.zoomWheelFrame = 0;
      // ponytail: cap per-frame step so one mouse-wheel notch ≈ one button press; a pinch coalesces many small deltas
      const delta = clamp(state.pendingZoomDelta, -ZOOM_STEP, ZOOM_STEP);
      state.pendingZoomDelta = 0;
      // Multiplicative, so a pinch feels the same at 50% and 300%.
      if (delta) {
        zoomTo((zoom) => zoom * Math.exp(delta), Number.isFinite(wheelFocus?.clientX) ? wheelFocus : null);
      }
    });
  }

  Object.assign(ctx, {
    resolveDestinationPageNumber,
    goToDestination,
    handleNamedPdfAction,
    loadPdfBookmarks,
    openExternalLink,
    adjustZoom,
    resetZoom,
    fitToWidth,
    handleZoomWheel
  });
};
