import { installPdfJsCompat } from './pdfjs-compat.js';
import {
  EMPTY_PAPER_PDF_METADATA,
  extractPaperPdfMetadata,
  getPaperDisplayTitle,
  hasPaperPdfMetadata
} from './pdf-metadata.js';

const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.2;

let pdfJsModulePromise = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function clampCommentAnchor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number.NaN;
  }
  return clamp(numeric, 0, 1);
}

export function computePdfAnchorFromClientPoint({ clientX, clientY, rect } = {}) {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    anchorX: clampCommentAnchor((Number(clientX) - Number(rect.left || 0)) / width),
    anchorY: clampCommentAnchor((Number(clientY) - Number(rect.top || 0)) / height)
  };
}

export function getPdfCommentPinPosition(anchorX, anchorY) {
  const left = clampCommentAnchor(anchorX);
  const top = clampCommentAnchor(anchorY);
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return {
      left: '0%',
      top: '0%'
    };
  }
  return {
    left: `${(left * 100).toFixed(3)}%`,
    top: `${(top * 100).toFixed(3)}%`
  };
}

function buildViewerAssetUrl(relativePath) {
  if (typeof window === 'undefined' || !window.location?.href) {
    return relativePath;
  }
  return new URL(relativePath, window.location.href).href;
}

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    installPdfJsCompat(globalThis);
    pdfJsModulePromise = import(buildViewerAssetUrl('./vendor/pdfjs/build/pdf.mjs'))
      .then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = buildViewerAssetUrl('./src/renderer/modules/papers-pdfjs-worker.js');
        return pdfjsLib;
      })
      .catch((error) => {
        pdfJsModulePromise = null;
        throw error;
      });
  }
  return pdfJsModulePromise;
}

function isRenderingCancelled(error) {
  const message = String(error?.message || error || '');
  return error?.name === 'RenderingCancelledException' || /cancelled/i.test(message);
}

function normalizeCommentList(comments) {
  return (Array.isArray(comments) ? comments : [])
    .map((comment) => {
      if (!comment || typeof comment !== 'object') {
        return null;
      }
      const id = String(comment.id || '').trim();
      const pageNumber = Math.round(Number(comment.pageNumber));
      const anchorX = clampCommentAnchor(comment.anchorX);
      const anchorY = clampCommentAnchor(comment.anchorY);
      if (!id || !Number.isFinite(pageNumber) || pageNumber < 1 || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
        return null;
      }
      return {
        ...comment,
        id,
        pageNumber,
        anchorX,
        anchorY,
        author: String(comment.author || 'Local user').trim() || 'Local user'
      };
    })
    .filter(Boolean);
}

function normalizeHighlightList(highlights) {
  return (Array.isArray(highlights) ? highlights : [])
    .map((highlight) => {
      if (!highlight || typeof highlight !== 'object') {
        return null;
      }
      const id = String(highlight.id || '').trim();
      const pageNumber = Math.round(Number(highlight.pageNumber));
      const text = String(highlight.text || '').trim();
      const boxes = (Array.isArray(highlight.boxes) ? highlight.boxes : [])
        .map((box) => {
          if (!box || typeof box !== 'object') {
            return null;
          }
          const left = clamp(Number(box.x) || 0, 0, 1);
          const top = clamp(Number(box.y) || 0, 0, 1);
          const width = clamp(Number(box.width) || 0, 0, 1);
          const height = clamp(Number(box.height) || 0, 0, 1);
          if (width <= 0 || height <= 0) {
            return null;
          }
          const right = clamp(left + width, 0, 1);
          const bottom = clamp(top + height, 0, 1);
          if (right <= left || bottom <= top) {
            return null;
          }
          return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top
          };
        })
        .filter(Boolean);
      if (!id || !Number.isFinite(pageNumber) || pageNumber < 1 || !text || !boxes.length) {
        return null;
      }
      return {
        ...highlight,
        id,
        pageNumber,
        text,
        boxes
      };
    })
    .filter(Boolean);
}

function getHighlightMarkerBox(box = {}) {
  const left = clamp(Number(box.x) || 0, 0, 1);
  const top = clamp(Number(box.y) || 0, 0, 1);
  const width = clamp(Number(box.width) || 0, 0, 1);
  const height = clamp(Number(box.height) || 0, 0, 1);
  if (width <= 0 || height <= 0) {
    return null;
  }

  // Render highlights like a marker stroke rather than a full line-height block.
  const adjustedTop = clamp(top + (height * 0.3), 0, 1);
  const adjustedBottom = clamp(top + (height * 1.02), 0, 1);
  if (adjustedBottom <= adjustedTop) {
    return null;
  }

  return {
    left,
    top: adjustedTop,
    width: Math.min(width, 1 - left),
    height: adjustedBottom - adjustedTop
  };
}

export function createPapersPdfViewer(elements = {}) {
  const shell = elements.shell || null;
  const emptyState = elements.emptyState || null;
  const workspace = elements.workspace || null;
  const stage = elements.stage || null;
  const pageLayer = elements.pageLayer || null;
  const title = elements.title || null;
  const meta = elements.meta || null;
  const status = elements.status || null;
  const toolbar = elements.toolbar || null;
  const prevBtn = elements.prevBtn || null;
  const nextBtn = elements.nextBtn || null;
  const pageInput = elements.pageInput || null;
  const pageCount = elements.pageCount || null;
  const zoomOutBtn = elements.zoomOutBtn || null;
  const zoomInBtn = elements.zoomInBtn || null;
  const zoomResetBtn = elements.zoomResetBtn || null;
  const fitWidthBtn = elements.fitWidthBtn || null;
  const highlightBtn = elements.highlightBtn || null;
  const zoomLabel = elements.zoomLabel || null;
  const openExternalBtn = elements.openExternalBtn || null;
  const closeBtn = elements.closeBtn || null;

  const state = {
    paperId: '',
    paperTitle: '',
    paperMeta: '',
    pageNumber: 1,
    pageCount: 0,
    pageMetrics: [],
    pageRecords: [],
    maxBasePageWidth: 0,
    zoom: DEFAULT_ZOOM,
    fitWidth: true,
    loadToken: 0,
    renderToken: 0,
    scrollFrame: 0,
    pdfDocument: null,
    loadingTask: null,
    comments: [],
    highlights: [],
    selectedCommentId: '',
    pendingSelection: null,
    placementMode: false,
    openExternal: null,
    resolveBytes: null,
    onMetadataResolved: typeof elements.onMetadataResolved === 'function' ? elements.onMetadataResolved : null,
    onPageChange: typeof elements.onPageChange === 'function' ? elements.onPageChange : null,
    onPlacement: typeof elements.onPlacement === 'function' ? elements.onPlacement : null,
    onPinSelect: typeof elements.onPinSelect === 'function' ? elements.onPinSelect : null,
    onHighlightSelection: typeof elements.onHighlightSelection === 'function' ? elements.onHighlightSelection : null,
    onClose: typeof elements.onClose === 'function' ? elements.onClose : null
  };

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

  function clearSelection() {
    try {
      getSelectionRef()?.removeAllRanges?.();
    } catch {}
  }

  function setStatus(message, isError = false) {
    if (!status) {
      return;
    }
    status.textContent = String(message || '').trim();
    status.classList.toggle('is-error', Boolean(isError));
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

  function getDocumentScale() {
    if (!state.fitWidth) {
      return clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
    }

    const baseWidth = Math.max(state.maxBasePageWidth || state.pageMetrics[0]?.width || 0, 1);
    const win = getWindowRef();
    const computedStyle = typeof win?.getComputedStyle === 'function' && stage
      ? win.getComputedStyle(stage)
      : null;
    const horizontalPadding = (Number.parseFloat(computedStyle?.paddingLeft || '0') || 0)
      + (Number.parseFloat(computedStyle?.paddingRight || '0') || 0);
    const viewportWidth = Math.max((stage?.clientWidth || 0) - horizontalPadding, 320);
    return clamp(viewportWidth / baseWidth, MIN_ZOOM, MAX_ZOOM);
  }

  function getScrollAnchor() {
    if (!stage || !state.pageRecords.length) {
      return null;
    }
    const currentRecord = state.pageRecords.find((record) => record.pageNumber === state.pageNumber)
      || state.pageRecords[0]
      || null;
    if (!currentRecord?.element) {
      return null;
    }
    const pageHeight = Math.max(currentRecord.element.offsetHeight || 0, 1);
    const offsetWithinPage = (stage.scrollTop || 0) - currentRecord.element.offsetTop;
    return {
      pageNumber: currentRecord.pageNumber,
      offsetRatio: clamp(offsetWithinPage / pageHeight, 0, 1)
    };
  }

  function restoreScrollAnchor(anchor) {
    if (!stage || !anchor) {
      return;
    }
    const targetRecord = state.pageRecords.find((record) => record.pageNumber === anchor.pageNumber);
    if (!targetRecord?.element) {
      return;
    }
    const targetTop = targetRecord.element.offsetTop + ((targetRecord.element.offsetHeight || 0) * anchor.offsetRatio);
    stage.scrollTop = Math.max(Math.round(targetTop), 0);
  }

  function setStageScrollTop(top) {
    if (!stage) {
      return;
    }
    const nextTop = Math.max(Math.round(Number(top) || 0), 0);
    if (typeof stage.scrollTo === 'function') {
      try {
        stage.scrollTo({ top: nextTop, behavior: 'auto' });
        return;
      } catch {}
    }
    stage.scrollTop = nextTop;
  }

  function cancelScrollSync() {
    const win = getWindowRef();
    if (!state.scrollFrame || typeof win?.cancelAnimationFrame !== 'function') {
      state.scrollFrame = 0;
      return;
    }
    win.cancelAnimationFrame(state.scrollFrame);
    state.scrollFrame = 0;
  }

  function emitPageChange() {
    if (typeof state.onPageChange === 'function' && hasActiveDocument()) {
      state.onPageChange(state.pageNumber);
    }
  }

  function updateCurrentPageFromScroll({ force = false } = {}) {
    if (!hasActiveDocument() || !stage || !state.pageRecords.length) {
      return;
    }

    const scrollAnchor = (stage.scrollTop || 0) + Math.max((stage.clientHeight || 0) * 0.35, 1);
    let nextPageNumber = state.pageRecords[0]?.pageNumber || 1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    state.pageRecords.forEach((record) => {
      const pageTop = record.element?.offsetTop || 0;
      const pageHeight = record.element?.offsetHeight || 0;
      const pageBottom = pageTop + pageHeight;
      if (scrollAnchor >= pageTop && scrollAnchor <= pageBottom) {
        nextPageNumber = record.pageNumber;
        nearestDistance = -1;
        return;
      }
      if (nearestDistance < 0) {
        return;
      }
      const pageCenter = pageTop + (pageHeight / 2);
      const distance = Math.abs(pageCenter - scrollAnchor);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nextPageNumber = record.pageNumber;
      }
    });

    if (!force && nextPageNumber === state.pageNumber) {
      return;
    }

    state.pageNumber = nextPageNumber;
    refreshToolbar();
    emitPageChange();
  }

  function scheduleScrollSync() {
    if (state.scrollFrame) {
      return;
    }
    const win = getWindowRef();
    const schedule = typeof win?.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : (callback) => setTimeout(callback, 0);
    state.scrollFrame = schedule(() => {
      state.scrollFrame = 0;
      updateCurrentPageFromScroll();
    });
  }

  function cancelAllRenderTasks() {
    state.pageRecords.forEach((record) => {
      if (!record?.renderTask || typeof record.renderTask.cancel !== 'function') {
        record.renderTask = null;
      } else {
        try {
          record.renderTask.cancel();
        } catch {}
        record.renderTask = null;
      }
      if (!record?.textLayerBuilder || typeof record.textLayerBuilder.cancel !== 'function') {
        record.textLayerBuilder = null;
        return;
      }
      try {
        record.textLayerBuilder.cancel();
      } catch {}
      record.textLayerBuilder = null;
    });
  }

  function releasePageRecords() {
    cancelAllRenderTasks();
    if (pageLayer) {
      pageLayer.innerHTML = '';
    }
    state.pageRecords = [];
  }

  function ensurePageRecords() {
    if (!pageLayer) {
      state.pageRecords = [];
      return;
    }

    const doc = pageLayer.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc?.createElement) {
      state.pageRecords = [];
      return;
    }

    pageLayer.innerHTML = '';
    const fragment = doc.createDocumentFragment();
    state.pageRecords = state.pageMetrics.map((metric, index) => {
      const pageNumber = index + 1;
      const pageElement = doc.createElement('div');
      pageElement.className = 'papers-viewer-page';
      pageElement.dataset.pageNumber = String(pageNumber);

      const canvas = doc.createElement('canvas');
      canvas.className = 'papers-viewer-canvas';
      canvas.setAttribute('aria-hidden', 'true');

      const highlightLayer = doc.createElement('div');
      highlightLayer.className = 'papers-viewer-highlight-layer';
      highlightLayer.dataset.pageNumber = String(pageNumber);
      highlightLayer.setAttribute('aria-hidden', 'true');

      const textLayer = doc.createElement('div');
      textLayer.className = 'papers-viewer-text-layer';
      textLayer.dataset.pageNumber = String(pageNumber);

      const overlay = doc.createElement('div');
      overlay.className = 'papers-viewer-overlay';
      overlay.dataset.pageNumber = String(pageNumber);
      overlay.setAttribute('aria-label', `Paper page ${pageNumber} comment pins`);

      pageElement.append(canvas, highlightLayer, textLayer, overlay);
      fragment.appendChild(pageElement);

      return {
        pageNumber,
        metric,
        element: pageElement,
        canvas,
        highlightLayer,
        textLayer,
        overlay,
        renderTask: null,
        textLayerBuilder: null,
        renderedScale: 0
      };
    });
    pageLayer.appendChild(fragment);
  }

  function applyPageSizing(scale, { preserveScroll = false, resetScroll = false } = {}) {
    if (!pageLayer || !state.pageRecords.length) {
      return;
    }

    const anchor = preserveScroll ? getScrollAnchor() : null;
    state.zoom = clamp(scale, MIN_ZOOM, MAX_ZOOM);

    state.pageRecords.forEach((record) => {
      const width = Math.max(Math.ceil((record.metric?.width || 1) * scale), 1);
      const height = Math.max(Math.ceil((record.metric?.height || 1) * scale), 1);
      record.element.style.setProperty('--total-scale-factor', String(scale));
      record.element.style.setProperty('--scale-round-x', '1px');
      record.element.style.setProperty('--scale-round-y', '1px');
      record.element.style.width = `${width}px`;
      record.element.style.height = `${height}px`;
      record.canvas.style.width = `${width}px`;
      record.canvas.style.height = `${height}px`;
      if (record.textLayer) {
        record.textLayer.style.setProperty('--total-scale-factor', String(scale));
      }
    });

    if (resetScroll) {
      setStageScrollTop(0);
    } else if (anchor) {
      restoreScrollAnchor(anchor);
    }
  }

  function clearPins() {
    state.pageRecords.forEach((record) => {
      if (!record?.overlay) {
        return;
      }
      record.overlay.innerHTML = '';
      record.overlay.style.cursor = state.placementMode ? 'crosshair' : 'default';
      record.overlay.style.pointerEvents = state.placementMode ? 'auto' : 'none';
    });
  }

  function renderHighlights() {
    const highlightsByPage = new Map();
    state.highlights.forEach((highlight) => {
      if (!highlightsByPage.has(highlight.pageNumber)) {
        highlightsByPage.set(highlight.pageNumber, []);
      }
      highlightsByPage.get(highlight.pageNumber).push(highlight);
    });

    state.pageRecords.forEach((record) => {
      const highlightLayer = record?.highlightLayer;
      if (!highlightLayer) {
        return;
      }
      highlightLayer.innerHTML = '';
      const pageHighlights = highlightsByPage.get(record.pageNumber) || [];
      if (!pageHighlights.length) {
        return;
      }
      const doc = highlightLayer.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (!doc?.createElement) {
        return;
      }
      pageHighlights.forEach((highlight) => {
        highlight.boxes.forEach((box) => {
          const markerBox = getHighlightMarkerBox(box);
          if (!markerBox) {
            return;
          }
          const mark = doc.createElement('div');
          mark.className = 'papers-viewer-highlight';
          mark.dataset.highlightId = highlight.id;
          mark.style.left = `${(markerBox.left * 100).toFixed(3)}%`;
          mark.style.top = `${(markerBox.top * 100).toFixed(3)}%`;
          mark.style.width = `${(markerBox.width * 100).toFixed(3)}%`;
          mark.style.height = `${(markerBox.height * 100).toFixed(3)}%`;
          mark.title = highlight.text;
          highlightLayer.appendChild(mark);
        });
      });
    });
  }

  function renderPins() {
    clearPins();
    if (!hasActiveDocument()) {
      return;
    }

    const commentsByPage = new Map();
    state.comments.forEach((comment) => {
      const pageNumber = Math.max(1, Math.round(Number(comment.pageNumber) || 1));
      if (!commentsByPage.has(pageNumber)) {
        commentsByPage.set(pageNumber, []);
      }
      commentsByPage.get(pageNumber).push(comment);
    });

    state.pageRecords.forEach((record) => {
      const overlay = record.overlay;
      if (!overlay) {
        return;
      }
      const pageComments = commentsByPage.get(record.pageNumber) || [];
      if (!pageComments.length) {
        return;
      }
      const doc = overlay.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (!doc?.createElement) {
        return;
      }
      pageComments.forEach((comment) => {
        const pin = doc.createElement('button');
        pin.type = 'button';
        pin.className = 'papers-viewer-pin';
        pin.dataset.commentId = comment.id;
        if (comment.id === state.selectedCommentId) {
          pin.classList.add('is-active');
        }
        const position = getPdfCommentPinPosition(comment.anchorX, comment.anchorY);
        pin.style.left = position.left;
        pin.style.top = position.top;
        pin.setAttribute('aria-label', `Comment by ${comment.author || 'Local user'}`);
        pin.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof state.onPinSelect === 'function') {
            state.onPinSelect(comment);
          }
        });
        overlay.appendChild(pin);
      });
    });
  }

  function refreshToolbar() {
    const active = hasActiveDocument();
    if (toolbar) {
      toolbar.hidden = !active;
    }
    if (emptyState) {
      emptyState.hidden = active;
    }
    if (workspace) {
      workspace.hidden = !active;
    }
    if (stage) {
      stage.hidden = !active;
    }
    if (shell) {
      shell.classList.toggle('is-empty', !active);
    }
    if (prevBtn) {
      prevBtn.disabled = !active || state.pageNumber <= 1;
    }
    if (nextBtn) {
      nextBtn.disabled = !active || state.pageNumber >= state.pageCount;
    }
    if (pageInput) {
      pageInput.disabled = !active;
      pageInput.value = active ? String(state.pageNumber) : '1';
      pageInput.min = '1';
      pageInput.max = String(Math.max(state.pageCount, 1));
    }
    if (pageCount) {
      pageCount.textContent = active ? `/ ${state.pageCount}` : '/ 0';
    }
    if (zoomOutBtn) {
      zoomOutBtn.disabled = !active;
    }
    if (zoomInBtn) {
      zoomInBtn.disabled = !active;
    }
    if (zoomResetBtn) {
      zoomResetBtn.disabled = !active;
    }
    if (fitWidthBtn) {
      fitWidthBtn.disabled = !active;
    }
    if (highlightBtn) {
      highlightBtn.disabled = !active || state.placementMode || !state.pendingSelection;
    }
    if (openExternalBtn) {
      openExternalBtn.disabled = !active;
    }
    if (closeBtn) {
      closeBtn.disabled = !active;
    }
    if (zoomLabel) {
      const percent = Math.round((state.fitWidth && !active ? DEFAULT_ZOOM : state.zoom) * 100);
      zoomLabel.textContent = active
        ? `${Math.round(state.zoom * 100)}%${state.fitWidth ? ' fit' : ''}`
        : `${percent}%`;
    }
  }

  function renderEmptyViewer(message = '') {
    cancelScrollSync();
    releasePageRecords();
    state.paperId = '';
    state.paperTitle = '';
    state.paperMeta = '';
    state.pageNumber = 1;
    state.pageCount = 0;
    state.pageMetrics = [];
    state.maxBasePageWidth = 0;
    state.zoom = DEFAULT_ZOOM;
    state.fitWidth = true;
    state.comments = [];
    state.highlights = [];
    state.selectedCommentId = '';
    state.pendingSelection = null;
    state.placementMode = false;
    setStageScrollTop(0);
    setTitle('No paper selected');
    setMeta('');
    setStatus(message || '', false);
    refreshToolbar();
  }

  function getSelectionInfo() {
    if (!hasActiveDocument() || !pageLayer || state.placementMode) {
      return null;
    }

    const selection = getSelectionRef();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    let textLayer = null;
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (!range || range.collapsed) {
        continue;
      }
      const ancestor = range.commonAncestorContainer;
      const layer = (ancestor?.nodeType === 1 ? ancestor : ancestor?.parentElement)?.closest?.('.papers-viewer-text-layer') || null;
      if (!layer || !pageLayer.contains(layer) || !layer.contains(ancestor)) {
        return null;
      }
      if (textLayer && textLayer !== layer) {
        return null;
      }
      textLayer = layer;
    }

    if (!textLayer) {
      return null;
    }

    const layerRect = textLayer.getBoundingClientRect?.();
    const layerLeft = Number(layerRect?.x ?? layerRect?.left);
    const layerTop = Number(layerRect?.y ?? layerRect?.top);
    const parentWidth = Number(layerRect?.width);
    const parentHeight = Number(layerRect?.height);
    if (!Number.isFinite(parentWidth) || !Number.isFinite(parentHeight) || parentWidth <= 0 || parentHeight <= 0) {
      return null;
    }

    let rotator;
    switch (textLayer.getAttribute('data-main-rotation')) {
      case '90':
        rotator = (x, y, width, height) => ({
          x: (y - layerTop) / parentHeight,
          y: 1 - ((x + width - layerLeft) / parentWidth),
          width: height / parentHeight,
          height: width / parentWidth
        });
        break;
      case '180':
        rotator = (x, y, width, height) => ({
          x: 1 - ((x + width - layerLeft) / parentWidth),
          y: 1 - ((y + height - layerTop) / parentHeight),
          width: width / parentWidth,
          height: height / parentHeight
        });
        break;
      case '270':
        rotator = (x, y, width, height) => ({
          x: 1 - ((y + height - layerTop) / parentHeight),
          y: (x - layerLeft) / parentWidth,
          width: height / parentHeight,
          height: width / parentWidth
        });
        break;
      default:
        rotator = (x, y, width, height) => ({
          x: (x - layerLeft) / parentWidth,
          y: (y - layerTop) / parentHeight,
          width: width / parentWidth,
          height: height / parentHeight
        });
        break;
    }

    const boxes = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (!range || range.collapsed || !textLayer.contains(range.commonAncestorContainer)) {
        continue;
      }
      for (const rect of range.getClientRects()) {
        const width = Number(rect?.width);
        const height = Number(rect?.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          continue;
        }
        const normalized = rotator(
          Number(rect.x ?? rect.left),
          Number(rect.y ?? rect.top),
          width,
          height
        );
        const left = clamp(normalized.x, 0, 1);
        const top = clamp(normalized.y, 0, 1);
        const right = clamp(normalized.x + normalized.width, 0, 1);
        const bottom = clamp(normalized.y + normalized.height, 0, 1);
        if (right <= left || bottom <= top) {
          continue;
        }
        boxes.push({
          x: left,
          y: top,
          width: right - left,
          height: bottom - top
        });
      }
    }

    const text = String(selection.toString() || '').replace(/\s+/g, ' ').trim();
    const pageNumber = Math.max(1, Math.round(Number(textLayer.dataset.pageNumber) || 1));
    if (!text || !boxes.length) {
      return null;
    }
    return {
      pageNumber,
      text,
      boxes
    };
  }

  function updatePendingSelection() {
    state.pendingSelection = getSelectionInfo();
    refreshToolbar();
  }

  async function cleanupLoadingTask() {
    const currentTask = state.loadingTask;
    state.loadingTask = null;
    if (!currentTask || typeof currentTask.destroy !== 'function') {
      return;
    }
    try {
      await currentTask.destroy();
    } catch {}
  }

  async function destroyPdfDocument(pdfDocument) {
    if (!pdfDocument || typeof pdfDocument.destroy !== 'function') {
      return;
    }
    try {
      await pdfDocument.destroy();
    } catch {}
  }

  async function cleanupDocument() {
    const currentDocument = state.pdfDocument;
    state.pdfDocument = null;
    await destroyPdfDocument(currentDocument);
  }

  async function resetViewer(message = '') {
    state.loadToken += 1;
    state.renderToken += 1;
    cancelAllRenderTasks();
    await cleanupLoadingTask();
    await cleanupDocument();
    renderEmptyViewer(message);
    if (typeof state.onClose === 'function') {
      state.onClose();
    }
  }

  async function loadPageMetrics(pdfDocument) {
    const metrics = [];
    let maxBasePageWidth = 0;
    for (let pageNumber = 1; pageNumber <= (Number(pdfDocument?.numPages) || 0); pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const width = Math.max(Math.ceil(viewport.width || 0), 1);
      const height = Math.max(Math.ceil(viewport.height || 0), 1);
      metrics.push({ width, height });
      maxBasePageWidth = Math.max(maxBasePageWidth, width);
      if (typeof page.cleanup === 'function') {
        try {
          page.cleanup();
        } catch {}
      }
    }
    return {
      metrics,
      maxBasePageWidth
    };
  }

  async function loadEmbeddedPdfMetadata(pdfDocument) {
    if (!pdfDocument || typeof pdfDocument.getMetadata !== 'function') {
      return EMPTY_PAPER_PDF_METADATA;
    }

    try {
      const metadata = await pdfDocument.getMetadata();
      return extractPaperPdfMetadata(metadata);
    } catch {
      return EMPTY_PAPER_PDF_METADATA;
    }
  }

  async function renderPageRecord(record, scale, activeRenderToken) {
    if (!state.pdfDocument || !record?.canvas || !record?.element) {
      return;
    }

    const page = await state.pdfDocument.getPage(record.pageNumber);
    if (activeRenderToken !== state.renderToken) {
      if (typeof page.cleanup === 'function') {
        try {
          page.cleanup();
        } catch {}
      }
      return;
    }

    const viewport = page.getViewport({ scale });
    const outputScale = Math.max(getWindowRef()?.devicePixelRatio || 1, 1);
    const context = typeof record.canvas.getContext === 'function'
      ? record.canvas.getContext('2d', { alpha: false })
      : null;
    if (!context) {
      throw new Error('Canvas context is unavailable.');
    }

    const cssWidth = Math.max(Math.ceil(viewport.width), 1);
    const cssHeight = Math.max(Math.ceil(viewport.height), 1);
    if (record.textLayerBuilder && typeof record.textLayerBuilder.cancel === 'function') {
      try {
        record.textLayerBuilder.cancel();
      } catch {}
      record.textLayerBuilder = null;
    }
    if (record.textLayer) {
      record.textLayer.innerHTML = '';
      record.textLayer.style.width = `${cssWidth}px`;
      record.textLayer.style.height = `${cssHeight}px`;
    }
    record.canvas.width = Math.ceil(viewport.width * outputScale);
    record.canvas.height = Math.ceil(viewport.height * outputScale);
    record.canvas.style.width = `${cssWidth}px`;
    record.canvas.style.height = `${cssHeight}px`;
    record.element.style.width = `${cssWidth}px`;
    record.element.style.height = `${cssHeight}px`;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, record.canvas.width, record.canvas.height);

    const renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
    });
    record.renderTask = renderTask;
    await renderTask.promise;
    if (record.renderTask === renderTask) {
      record.renderTask = null;
    }

    if (activeRenderToken !== state.renderToken) {
      if (typeof page.cleanup === 'function') {
        try {
          page.cleanup();
        } catch {}
      }
      return;
    }
    if (record.textLayer) {
      const pdfjsLib = await loadPdfJsModule();
      const textContent = await page.getTextContent();
      if (activeRenderToken !== state.renderToken) {
        if (typeof page.cleanup === 'function') {
          try {
            page.cleanup();
          } catch {}
        }
        return;
      }
      const textLayerBuilder = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: record.textLayer,
        viewport
      });
      record.textLayerBuilder = textLayerBuilder;
      await textLayerBuilder.render();
      if (record.textLayerBuilder === textLayerBuilder) {
        record.textLayerBuilder = null;
      }
    }
    record.renderedScale = scale;
    if (typeof page.cleanup === 'function') {
      try {
        page.cleanup();
      } catch {}
    }
  }

  async function renderDocumentPages({ preserveScroll = false, resetScroll = false } = {}) {
    if (!state.pdfDocument || !pageLayer) {
      refreshToolbar();
      renderHighlights();
      renderPins();
      return;
    }

    const activeRenderToken = ++state.renderToken;
    cancelAllRenderTasks();
    const scale = getDocumentScale();

    applyPageSizing(scale, {
      preserveScroll,
      resetScroll
    });
    refreshToolbar();
    renderHighlights();
    renderPins();
    updateCurrentPageFromScroll({ force: true });

    try {
      for (const record of state.pageRecords) {
        if (activeRenderToken !== state.renderToken) {
          return;
        }
        setStatus(`Rendering page ${record.pageNumber} of ${state.pageCount}...`);
        await renderPageRecord(record, scale, activeRenderToken);
      }
      if (activeRenderToken !== state.renderToken) {
        return;
      }
      setTitle(state.paperTitle || 'Paper Viewer');
      setMeta(state.paperMeta || 'PDF preview');
      updateCurrentPageFromScroll({ force: true });
      setStatus(`Viewing page ${state.pageNumber} of ${state.pageCount}.`);
      refreshToolbar();
      renderHighlights();
      renderPins();
    } catch (error) {
      if (isRenderingCancelled(error)) {
        return;
      }
      setStatus(String(error?.message || error || 'Failed to render PDF.'), true);
    }
  }

  function goToPage(pageNumber, options = {}) {
    if (!state.pdfDocument || !stage) {
      return;
    }

    const nextPage = clamp(Math.round(Number(pageNumber) || 1), 1, state.pageCount);
    const targetRecord = state.pageRecords.find((record) => record.pageNumber === nextPage) || null;
    state.pageNumber = nextPage;
    refreshToolbar();
    emitPageChange();

    if (!targetRecord?.element) {
      return;
    }

    const targetTop = Math.max(targetRecord.element.offsetTop - 8, 0);
    const behavior = options.behavior === 'smooth' ? 'smooth' : 'auto';
    if (typeof stage.scrollTo === 'function') {
      try {
        stage.scrollTo({ top: targetTop, behavior });
      } catch {
        stage.scrollTop = targetTop;
      }
    } else {
      stage.scrollTop = targetTop;
    }
    if (behavior === 'auto') {
      updateCurrentPageFromScroll({ force: true });
    } else {
      scheduleScrollSync();
    }
  }

  async function adjustZoom(delta) {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = false;
    state.zoom = clamp(state.zoom + delta, MIN_ZOOM, MAX_ZOOM);
    await renderDocumentPages({ preserveScroll: true });
  }

  async function resetZoom() {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = false;
    state.zoom = DEFAULT_ZOOM;
    await renderDocumentPages({ preserveScroll: true });
  }

  async function fitToWidth() {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = true;
    await renderDocumentPages({ preserveScroll: true });
  }

  async function openPaper({ paper, summary = '', resolveBytes, onOpenExternal }) {
    if (!paper?.id || typeof resolveBytes !== 'function') {
      return false;
    }

    const previousState = {
      paperId: state.paperId,
      paperTitle: state.paperTitle,
      paperMeta: state.paperMeta,
      pageNumber: state.pageNumber,
      pageCount: state.pageCount,
      pageMetrics: state.pageMetrics,
      maxBasePageWidth: state.maxBasePageWidth,
      zoom: state.zoom,
      fitWidth: state.fitWidth,
      comments: state.comments,
      highlights: state.highlights,
      selectedCommentId: state.selectedCommentId,
      pendingSelection: state.pendingSelection,
      placementMode: state.placementMode,
      pdfDocument: state.pdfDocument
    };
    state.loadToken += 1;
    const activeLoadToken = state.loadToken;
    state.resolveBytes = resolveBytes;
    state.openExternal = typeof onOpenExternal === 'function' ? onOpenExternal : null;
    state.paperId = String(paper.id || '');
    state.paperTitle = getPaperDisplayTitle(paper);
    state.paperMeta = summary || String(paper.fileName || '').trim() || 'PDF preview';
    state.comments = [];
    state.highlights = [];
    state.selectedCommentId = '';
    state.pendingSelection = null;
    state.placementMode = false;
    cancelScrollSync();
    cancelAllRenderTasks();
    await cleanupLoadingTask();
    if (activeLoadToken !== state.loadToken) {
      return false;
    }
    renderHighlights();
    renderPins();
    refreshToolbar();
    setTitle(state.paperTitle);
    setMeta(state.paperMeta);
    setStatus('Loading PDF...');

    try {
      const [pdfjsLib, pdfBytes] = await Promise.all([
        loadPdfJsModule(),
        resolveBytes(paper)
      ]);
      if (activeLoadToken !== state.loadToken) {
        return false;
      }

      const loadingTask = pdfjsLib.getDocument({
        data: pdfBytes,
        cMapUrl: buildViewerAssetUrl('./vendor/pdfjs/web/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: buildViewerAssetUrl('./vendor/pdfjs/web/standard_fonts/'),
        wasmUrl: buildViewerAssetUrl('./vendor/pdfjs/web/wasm/'),
        iccUrl: buildViewerAssetUrl('./vendor/pdfjs/web/iccs/'),
        useWorkerFetch: false
      });
      state.loadingTask = loadingTask;
      loadingTask.onProgress = ({ loaded = 0, total = 0 } = {}) => {
        if (activeLoadToken !== state.loadToken || !total) {
          return;
        }
        const percent = Math.round((loaded / total) * 100);
        setStatus(`Loading PDF... ${percent}%`);
      };

      const pdfDocument = await loadingTask.promise;
      if (activeLoadToken !== state.loadToken) {
        try {
          await pdfDocument.destroy();
        } catch {}
        return false;
      }

      state.loadingTask = null;
      setStatus('Preparing pages...');

      const [embeddedMetadata, pageMetrics] = await Promise.all([
        loadEmbeddedPdfMetadata(pdfDocument),
        loadPageMetrics(pdfDocument)
      ]);
      if (activeLoadToken !== state.loadToken) {
        try {
          await pdfDocument.destroy();
        } catch {}
        return false;
      }

      state.pdfDocument = pdfDocument;
      state.pageNumber = 1;
      state.pageCount = Number(pdfDocument.numPages) || 1;
      state.pageMetrics = pageMetrics.metrics;
      state.maxBasePageWidth = pageMetrics.maxBasePageWidth;
      state.zoom = DEFAULT_ZOOM;
      state.fitWidth = true;
      if (previousState.pdfDocument && previousState.pdfDocument !== pdfDocument) {
        Promise.resolve(destroyPdfDocument(previousState.pdfDocument)).catch(() => {});
      }

      if (hasPaperPdfMetadata(embeddedMetadata)) {
        if (embeddedMetadata.title) {
          state.paperTitle = embeddedMetadata.title;
          setTitle(state.paperTitle);
        }
        Promise.resolve(state.onMetadataResolved?.({
          paperId: state.paperId,
          metadata: embeddedMetadata
        })).catch(() => {});
      }

      releasePageRecords();
      ensurePageRecords();
      await renderDocumentPages({ resetScroll: true });
      return true;
    } catch (error) {
      if (activeLoadToken !== state.loadToken) {
        return false;
      }
      state.loadingTask = null;
      if (state.pdfDocument === previousState.pdfDocument) {
        state.paperId = previousState.paperId;
        state.paperTitle = previousState.paperTitle;
        state.paperMeta = previousState.paperMeta;
        state.pageNumber = previousState.pageNumber;
        state.pageCount = previousState.pageCount;
        state.pageMetrics = previousState.pageMetrics;
        state.maxBasePageWidth = previousState.maxBasePageWidth;
        state.zoom = previousState.zoom;
        state.fitWidth = previousState.fitWidth;
        state.comments = previousState.comments;
        state.highlights = previousState.highlights;
        state.selectedCommentId = previousState.selectedCommentId;
        state.pendingSelection = previousState.pendingSelection;
        state.placementMode = previousState.placementMode;
        setTitle(state.paperTitle);
        setMeta(state.paperMeta);
        renderHighlights();
        renderPins();
      } else {
        await cleanupDocument();
        releasePageRecords();
      }
      refreshToolbar();
      setStatus(String(error?.message || error || 'Failed to load PDF.'), true);
      return false;
    }
  }

  function setComments(comments = []) {
    state.comments = normalizeCommentList(comments);
    renderPins();
  }

  function setHighlights(highlights = []) {
    state.highlights = normalizeHighlightList(highlights);
    renderHighlights();
  }

  function setSelectedCommentId(commentId = '') {
    state.selectedCommentId = String(commentId || '').trim();
    renderPins();
  }

  function setPlacementMode(enabled) {
    state.placementMode = Boolean(enabled) && hasActiveDocument();
    if (state.placementMode) {
      clearSelection();
      state.pendingSelection = null;
    }
    refreshToolbar();
    renderPins();
  }

  function handleOverlayClick(event) {
    if (!state.placementMode || !hasActiveDocument() || typeof state.onPlacement !== 'function') {
      return;
    }

    const overlayElement = event?.target?.closest?.('.papers-viewer-overlay');
    if (!overlayElement || !pageLayer?.contains?.(overlayElement)) {
      return;
    }

    const rect = overlayElement.getBoundingClientRect?.();
    const anchor = computePdfAnchorFromClientPoint({
      clientX: event?.clientX,
      clientY: event?.clientY,
      rect
    });
    if (!anchor) {
      return;
    }

    const pageNumber = Math.max(1, Math.round(Number(overlayElement.dataset.pageNumber) || state.pageNumber || 1));
    state.onPlacement({
      pageNumber,
      anchorX: anchor.anchorX,
      anchorY: anchor.anchorY
    });
  }

  function handleResize() {
    if (!state.pdfDocument) {
      renderHighlights();
      renderPins();
      return;
    }
    if (state.fitWidth) {
      void renderDocumentPages({ preserveScroll: true });
      return;
    }
    renderPins();
    updateCurrentPageFromScroll({ force: true });
  }

  function bindEvents() {
    prevBtn?.addEventListener('click', () => {
      goToPage(state.pageNumber - 1, { behavior: 'smooth' });
    });
    nextBtn?.addEventListener('click', () => {
      goToPage(state.pageNumber + 1, { behavior: 'smooth' });
    });
    pageInput?.addEventListener('change', () => {
      goToPage(pageInput.value, { behavior: 'auto' });
    });
    zoomOutBtn?.addEventListener('click', () => {
      void adjustZoom(-ZOOM_STEP);
    });
    zoomInBtn?.addEventListener('click', () => {
      void adjustZoom(ZOOM_STEP);
    });
    zoomResetBtn?.addEventListener('click', () => {
      void resetZoom();
    });
    fitWidthBtn?.addEventListener('click', () => {
      void fitToWidth();
    });
    highlightBtn?.addEventListener('click', () => {
      if (!state.pendingSelection || typeof state.onHighlightSelection !== 'function') {
        return;
      }
      const selection = {
        pageNumber: state.pendingSelection.pageNumber,
        text: state.pendingSelection.text,
        boxes: state.pendingSelection.boxes
      };
      const didCreateHighlight = state.onHighlightSelection(selection);
      if (didCreateHighlight === false) {
        return;
      }
      clearSelection();
      state.pendingSelection = null;
      refreshToolbar();
      setStatus(`Highlighted selection on page ${selection.pageNumber}.`);
    });
    openExternalBtn?.addEventListener('click', () => {
      if (!state.paperId || typeof state.openExternal !== 'function') {
        return;
      }
      void state.openExternal(state.paperId);
    });
    closeBtn?.addEventListener('click', () => {
      void resetViewer();
    });
    stage?.addEventListener('scroll', scheduleScrollSync, { passive: true });
    pageLayer?.addEventListener('click', handleOverlayClick);

    const win = getWindowRef();
    const doc = getDocumentRef();
    if (typeof win?.addEventListener === 'function') {
      win.addEventListener('resize', handleResize);
    }
    if (typeof doc?.addEventListener === 'function') {
      doc.addEventListener('selectionchange', updatePendingSelection);
    }

    if (stage && typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        handleResize();
      });
      observer.observe(stage);
    }
  }

  bindEvents();
  renderEmptyViewer();

  return {
    openPaper,
    resetViewer,
    getActivePaperId() {
      return state.paperId;
    },
    getCurrentPageNumber() {
      return state.pageNumber;
    },
    hasActiveDocument,
    setComments,
    setHighlights,
    setSelectedCommentId,
    setPlacementMode
  };
}
