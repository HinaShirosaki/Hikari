import { clamp } from './pdf-viewer-anchors.js';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM
} from './pdf-viewer-constants.js';

export const installPdfViewerPdfNavigationController = (ctx) => {
  const { state } = ctx;

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
      ctx.setStatus('Unable to follow this PDF link.', true);
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
      ctx.setStatus('External link opening is unavailable in this build.', true);
      return;
    }
    ctx.setStatus('Opening external website...');
    try {
      const result = await state.onExternalLink(externalUrl);
      if (result?.ok === true) {
        ctx.setStatus('Opened external website.');
      } else {
        const error = String(result?.error || '').trim();
        ctx.setStatus(error || 'External website was not opened.');
      }
    } catch (error) {
      ctx.setStatus(String(error?.message || error || 'Failed to open external website.'), true);
    }
  }

  async function adjustZoom(delta) {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = false;
    state.zoom = clamp(state.zoom + delta, MIN_ZOOM, MAX_ZOOM);
    await ctx.renderDocumentPages({ preserveScroll: true });
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

  Object.assign(ctx, {
    resolveDestinationPageNumber,
    goToDestination,
    handleNamedPdfAction,
    loadPdfBookmarks,
    openExternalLink,
    adjustZoom,
    resetZoom,
    fitToWidth
  });
};
