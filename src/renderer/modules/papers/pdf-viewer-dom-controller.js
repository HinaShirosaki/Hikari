import { clamp } from './pdf-viewer-anchors.js';

export const installPdfViewerDomController = (ctx) => {
  const { elements, state } = ctx;
  const { shell, pageLayer, stage, title, meta, status } = elements;

  function getDocumentRef() {
    return stage?.ownerDocument || pageLayer?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  }

  function getWindowRef() {
    return stage?.ownerDocument?.defaultView || pageLayer?.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  }

  function hasActiveDocument() {
    return Boolean(state.pdfDocument);
  }

  function getSelectionRef() {
    return getDocumentRef()?.getSelection?.() || getWindowRef()?.getSelection?.() || null;
  }

  function getElementLayoutWidth(element) {
    if (!element) {
      return 0;
    }
    const clientWidth = Number(element.clientWidth) || 0;
    if (clientWidth > 0) {
      return clientWidth;
    }
    const rectWidth = Number(element.getBoundingClientRect?.().width) || 0;
    if (rectWidth > 0) {
      return rectWidth;
    }
    return Number(element.offsetWidth) || 0;
  }

  function setStatus(message, isError = false) {
    if (!status) {
      return;
    }
    status.textContent = String(message || '').trim();
    status.classList.toggle('is-error', Boolean(isError));
  }

  function emitBookmarksResolved() {
    if (typeof state.onBookmarksResolved !== 'function') {
      return;
    }
    state.onBookmarksResolved({
      paperId: state.paperId,
      bookmarks: state.bookmarks
    });
  }

  function clampShellPosition(left, top, element) {
    const shellRect = shell?.getBoundingClientRect?.();
    const width = Math.max(Number(element?.offsetWidth) || 0, 1);
    const height = Math.max(Number(element?.offsetHeight) || 0, 1);
    const maxLeft = Math.max((Number(shellRect?.width) || 0) - width - 8, 8);
    const maxTop = Math.max((Number(shellRect?.height) || 0) - height - 8, 8);
    return {
      left: clamp(left, 8, maxLeft),
      top: clamp(top, 8, maxTop)
    };
  }

  function positionFloatingElement(element, clientRect, { preferBelow = false } = {}) {
    if (!element || !shell || !clientRect) {
      return;
    }
    const shellRect = shell.getBoundingClientRect?.();
    if (!shellRect) {
      return;
    }
    const width = Math.max(Number(element.offsetWidth) || 0, 1);
    const height = Math.max(Number(element.offsetHeight) || 0, 1);
    const rawLeft = (Number(clientRect.left) || 0)
      + ((Number(clientRect.width) || 0) / 2)
      - Number(shellRect.left || 0)
      - (width / 2);
    const rawTop = preferBelow
      ? (Number(clientRect.top) || 0) + (Number(clientRect.height) || 0) - Number(shellRect.top || 0) + 8
      : (Number(clientRect.top) || 0) - Number(shellRect.top || 0) - height - 8;
    const next = clampShellPosition(rawLeft, rawTop, element);
    element.style.left = `${Math.round(next.left)}px`;
    element.style.top = `${Math.round(next.top)}px`;
  }

  function setTitle(text) {
    if (title) {
      title.textContent = text || 'No paper selected';
    }
  }

  function setMeta(text) {
    if (meta) {
      meta.textContent = text || '';
    }
  }

  Object.assign(ctx, {
    getDocumentRef,
    getWindowRef,
    hasActiveDocument,
    getSelectionRef,
    getElementLayoutWidth,
    setStatus,
    emitBookmarksResolved,
    clampShellPosition,
    positionFloatingElement,
    setTitle,
    setMeta
  });
};
