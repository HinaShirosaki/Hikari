import {
  getPaperDisplayTitle,
  hasPaperPdfMetadata
} from './pdf-metadata.js';
import {
  clamp,
  clampCommentAnchor,
  computePdfAnchorFromClientPoint,
  getPdfCommentPinPosition
} from './pdf-viewer-anchors.js';
import {
  buildViewerAssetUrl,
  isRenderingCancelled,
  loadPdfJsModule
} from './pdf-viewer-loader.js';
import {
  normalizeCommentList,
  normalizeHighlightList
} from './pdf-viewer-normalizers.js';
import {
  applyPageSizing,
  attachPageRecords,
  buildPageRecords,
  cancelAllRenderTasks,
  ensurePageRecords,
  releasePageRecords
} from './pdf-viewer-page-records.js';
import {
  renderHighlights,
  renderPins
} from './pdf-viewer-overlays.js';
import {
  commitOffscreenToVisibleCanvas,
  loadEmbeddedPdfMetadata,
  loadPageMetrics,
  renderPageCanvasToOffscreen,
  renderPageRecord
} from './pdf-viewer-rendering.js';
import { getSelectionInfo } from './pdf-viewer-selection.js';

export {
  clampCommentAnchor,
  computePdfAnchorFromClientPoint,
  getPdfCommentPinPosition
};

const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.2;

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildHighlightCommentPopoverMarkup(comment = {}) {
  const author = String(comment.author || 'Local user').trim() || 'Local user';
  const text = String(comment.text || '').trim();
  return `
      <p><strong>${escapeHtml(author)}</strong></p>
      <p>${escapeHtml(text)}</p>
    `;
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
  const zoomLabel = elements.zoomLabel || null;
  const openExternalBtn = elements.openExternalBtn || null;
  const closeBtn = elements.closeBtn || null;
  const selectionMenu = elements.selectionMenu || null;
  const selectionCommentBtn = elements.selectionCommentBtn || null;
  const selectionHighlightBtn = elements.selectionHighlightBtn || null;
  const selectionUnderlineBtn = elements.selectionUnderlineBtn || null;
  const selectionCommentPopover = elements.selectionCommentPopover || null;
  const selectionCommentText = elements.selectionCommentText || null;
  const selectionCommentSaveBtn = elements.selectionCommentSaveBtn || null;
  const selectionCommentCancelBtn = elements.selectionCommentCancelBtn || null;
  const highlightCommentPopover = elements.highlightCommentPopover || null;

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
    selectionFrame: 0,
    pdfDocument: null,
    loadingTask: null,
    comments: [],
    highlights: [],
    bookmarks: [],
    selectedCommentId: '',
    pendingSelection: null,
    pendingCommentSelection: null,
    selectionPointerDown: false,
    placementMode: false,
    openExternal: null,
    resolveBytes: null,
    onMetadataResolved: typeof elements.onMetadataResolved === 'function' ? elements.onMetadataResolved : null,
    onPageChange: typeof elements.onPageChange === 'function' ? elements.onPageChange : null,
    onPlacement: typeof elements.onPlacement === 'function' ? elements.onPlacement : null,
    onPinSelect: typeof elements.onPinSelect === 'function' ? elements.onPinSelect : null,
    onHighlightSelection: typeof elements.onHighlightSelection === 'function' ? elements.onHighlightSelection : null,
    onSelectionComment: typeof elements.onSelectionComment === 'function' ? elements.onSelectionComment : null,
    onBookmarksResolved: typeof elements.onBookmarksResolved === 'function' ? elements.onBookmarksResolved : null,
    onExternalLink: typeof elements.onExternalLink === 'function' ? elements.onExternalLink : null,
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

  function clearSelection() {
    try {
      getSelectionRef()?.removeAllRanges?.();
    } catch {}
    state.selectionPointerDown = false;
    hideSelectionMenu();
    hideSelectionCommentPopover();
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
    const rawLeft = (Number(clientRect.left) || 0) + ((Number(clientRect.width) || 0) / 2) - Number(shellRect.left || 0) - (width / 2);
    const rawTop = preferBelow
      ? (Number(clientRect.top) || 0) + (Number(clientRect.height) || 0) - Number(shellRect.top || 0) + 8
      : (Number(clientRect.top) || 0) - Number(shellRect.top || 0) - height - 8;
    const next = clampShellPosition(rawLeft, rawTop, element);
    element.style.left = `${Math.round(next.left)}px`;
    element.style.top = `${Math.round(next.top)}px`;
  }

  function hideSelectionMenu() {
    if (selectionMenu) {
      selectionMenu.hidden = true;
    }
  }

  function showSelectionMenu() {
    if (!selectionMenu || !state.pendingSelection?.clientRect || selectionCommentPopover?.hidden === false) {
      return;
    }
    selectionMenu.hidden = false;
    positionFloatingElement(selectionMenu, state.pendingSelection.clientRect);
  }

  function hideSelectionCommentPopover() {
    state.pendingCommentSelection = null;
    if (selectionCommentPopover) {
      selectionCommentPopover.hidden = true;
    }
    if (selectionCommentText) {
      selectionCommentText.value = '';
    }
  }

  function hideHighlightCommentPopover() {
    if (highlightCommentPopover) {
      highlightCommentPopover.hidden = true;
      highlightCommentPopover.innerHTML = '';
    }
  }

  function showHighlightCommentPopover(comment, clientX, clientY) {
    if (!highlightCommentPopover || !comment || !shell) {
      return;
    }
    highlightCommentPopover.innerHTML = buildHighlightCommentPopoverMarkup(comment);
    highlightCommentPopover.hidden = false;
    const shellRect = shell.getBoundingClientRect?.();
    const rawLeft = (Number(clientX) || 0) - Number(shellRect?.left || 0) + 12;
    const rawTop = (Number(clientY) || 0) - Number(shellRect?.top || 0) + 12;
    const next = clampShellPosition(rawLeft, rawTop, highlightCommentPopover);
    highlightCommentPopover.style.left = `${Math.round(next.left)}px`;
    highlightCommentPopover.style.top = `${Math.round(next.top)}px`;
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

  function paintHighlights() {
    renderHighlights({
      pageRecords: state.pageRecords,
      highlights: state.highlights
    });
  }

  function paintPins() {
    renderPins({
      pageRecords: state.pageRecords,
      comments: state.comments,
      selectedCommentId: state.selectedCommentId,
      placementMode: state.placementMode,
      isActive: hasActiveDocument(),
      onPinSelect: state.onPinSelect
    });
  }

  function getCommentForHighlight(highlight) {
    const commentId = String(highlight?.commentId || '').trim();
    if (commentId) {
      return state.comments.find((comment) => comment.id === commentId) || null;
    }
    const highlightId = String(highlight?.id || '').trim();
    if (!highlightId) {
      return null;
    }
    return state.comments.find((comment) => String(comment.highlightId || '').trim() === highlightId) || null;
  }

  function findCommentAtClientPoint(clientX, clientY) {
    const targetElement = getDocumentRef()?.elementFromPoint?.(clientX, clientY) || null;
    const pageElement = targetElement?.closest?.('.papers-viewer-page') || null;
    if (!pageElement || !pageLayer?.contains?.(pageElement)) {
      return null;
    }
    const pageNumber = Math.max(1, Math.round(Number(pageElement.dataset.pageNumber) || 1));
    const rect = pageElement.getBoundingClientRect?.();
    const width = Number(rect?.width) || 0;
    const height = Number(rect?.height) || 0;
    if (width <= 0 || height <= 0) {
      return null;
    }
    const x = clamp((Number(clientX) - Number(rect.left || 0)) / width, 0, 1);
    const y = clamp((Number(clientY) - Number(rect.top || 0)) / height, 0, 1);
    const pageHighlights = state.highlights.filter((highlight) => highlight.pageNumber === pageNumber);
    for (let index = pageHighlights.length - 1; index >= 0; index -= 1) {
      const highlight = pageHighlights[index];
      const comment = getCommentForHighlight(highlight);
      if (!comment) {
        continue;
      }
      const boxes = Array.isArray(highlight.boxes) ? highlight.boxes : [];
      const matched = boxes.some((box) => {
        const left = Number(box.x) || 0;
        const top = Number(box.y) || 0;
        const right = left + (Number(box.width) || 0);
        const bottom = top + (Number(box.height) || 0);
        return x >= left && x <= right && y >= top && y <= bottom;
      });
      if (matched) {
        return comment;
      }
    }
    return null;
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
    const layoutWidth = [
      stage,
      workspace,
      shell
    ].reduce((width, element) => width || getElementLayoutWidth(element), 0);
    const viewportWidth = Math.max(layoutWidth - horizontalPadding, 320);
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
    releasePageRecords({ pageLayer, pageRecords: state.pageRecords });
    state.pageRecords = [];
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
    state.bookmarks = [];
    state.selectedCommentId = '';
    state.pendingSelection = null;
    state.pendingCommentSelection = null;
    state.placementMode = false;
    hideSelectionMenu();
    hideSelectionCommentPopover();
    hideHighlightCommentPopover();
    setStageScrollTop(0);
    setTitle('No paper selected');
    setMeta('');
    setStatus(message || '', false);
    refreshToolbar();
  }

  function updatePendingSelection() {
    state.selectionFrame = 0;
    if (selectionCommentPopover && selectionCommentPopover.hidden === false) {
      refreshToolbar();
      return;
    }
    if (!hasActiveDocument() || !pageLayer || state.placementMode) {
      state.pendingSelection = null;
    } else {
      state.pendingSelection = getSelectionInfo({
        selection: getSelectionRef(),
        pageLayer
      });
    }
    if (state.pendingSelection) {
      hideSelectionCommentPopover();
      showSelectionMenu();
    } else {
      hideSelectionMenu();
      hideSelectionCommentPopover();
    }
    refreshToolbar();
  }

  function schedulePendingSelectionUpdate() {
    if (state.selectionPointerDown) {
      return;
    }
    const win = getWindowRef();
    if (state.selectionFrame) {
      return;
    }
    const callback = () => updatePendingSelection();
    if (typeof win?.requestAnimationFrame === 'function') {
      state.selectionFrame = win.requestAnimationFrame(callback);
    } else {
      state.selectionFrame = 1;
      setTimeout(callback, 0);
    }
  }

  function handleTextSelectionPointerDown(event) {
    const textLayer = event?.target?.closest?.('.papers-viewer-text-layer') || null;
    if (!textLayer || !pageLayer?.contains?.(textLayer) || state.placementMode) {
      return;
    }
    state.selectionPointerDown = true;
  }

  function handleTextSelectionPointerUp() {
    if (!state.selectionPointerDown) {
      return;
    }
    state.selectionPointerDown = false;
    schedulePendingSelectionUpdate();
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
    cancelAllRenderTasks(state.pageRecords);
    await cleanupLoadingTask();
    await cleanupDocument();
    renderEmptyViewer(message);
    if (typeof state.onClose === 'function') {
      state.onClose();
    }
  }

  function applyDocumentScale(scale, { preserveScroll = false, resetScroll = false } = {}) {
    if (!pageLayer || !state.pageRecords.length) {
      return;
    }
    const anchor = preserveScroll ? getScrollAnchor() : null;
    state.zoom = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    applyPageSizing({ pageRecords: state.pageRecords, scale });
    if (resetScroll) {
      setStageScrollTop(0);
    } else if (anchor) {
      restoreScrollAnchor(anchor);
    }
  }

  async function renderDocumentPages({ preserveScroll = false, resetScroll = false } = {}) {
    if (!state.pdfDocument || !pageLayer) {
      refreshToolbar();
      paintHighlights();
      paintPins();
      return;
    }

    const activeRenderToken = ++state.renderToken;
    const isStale = () => activeRenderToken !== state.renderToken;
    cancelAllRenderTasks(state.pageRecords);
    const scale = getDocumentScale();

    applyDocumentScale(scale, { preserveScroll, resetScroll });
    refreshToolbar();
    paintHighlights();
    paintPins();
    updateCurrentPageFromScroll({ force: true });

    const outputScale = Math.max(getWindowRef()?.devicePixelRatio || 1, 1);

    try {
      for (const record of state.pageRecords) {
        if (isStale()) {
          return;
        }
        setStatus(`Rendering page ${record.pageNumber} of ${state.pageCount}...`);
        await renderPageRecord({
          pdfDocument: state.pdfDocument,
          record,
          scale,
          outputScale,
          isStale,
          onExternalLink: openExternalLink,
          onDestination: goToDestination,
          onNamedAction: handleNamedPdfAction,
          isLinkActivationEnabled: () => !state.placementMode
        });
      }
      if (isStale()) {
        return;
      }
      setTitle(state.paperTitle || 'Paper Viewer');
      setMeta(state.paperMeta || 'PDF preview');
      updateCurrentPageFromScroll({ force: true });
      setStatus(`Viewing page ${state.pageNumber} of ${state.pageCount}.`);
      refreshToolbar();
      paintHighlights();
      paintPins();
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
      setStatus('Unable to follow this PDF link.', true);
      return;
    }
    goToPage(pageNumber, { behavior: 'smooth' });
  }

  function handleNamedPdfAction(action) {
    const normalizedAction = String(action || '').trim();
    if (!normalizedAction || !state.pdfDocument) {
      return;
    }
    if (normalizedAction === 'NextPage') {
      goToPage(state.pageNumber + 1, { behavior: 'smooth' });
    } else if (normalizedAction === 'PrevPage') {
      goToPage(state.pageNumber - 1, { behavior: 'smooth' });
    } else if (normalizedAction === 'FirstPage') {
      goToPage(1, { behavior: 'smooth' });
    } else if (normalizedAction === 'LastPage') {
      goToPage(state.pageCount, { behavior: 'smooth' });
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
      setStatus('External link opening is unavailable in this build.', true);
      return;
    }
    setStatus('Opening external website...');
    try {
      const result = await state.onExternalLink(externalUrl);
      if (result?.ok === true) {
        setStatus('Opened external website.');
      } else {
        const error = String(result?.error || '').trim();
        setStatus(error || 'External website was not opened.');
      }
    } catch (error) {
      setStatus(String(error?.message || error || 'Failed to open external website.'), true);
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

  function createSelectionAnnotation(kind = 'highlight') {
    if (!state.pendingSelection || typeof state.onHighlightSelection !== 'function') {
      return false;
    }
    const selection = {
      pageNumber: state.pendingSelection.pageNumber,
      text: state.pendingSelection.text,
      boxes: state.pendingSelection.boxes,
      pageWidth: state.pendingSelection.pageWidth,
      pageHeight: state.pendingSelection.pageHeight,
      kind
    };
    const didCreateHighlight = state.onHighlightSelection(selection);
    if (didCreateHighlight === false) {
      return false;
    }
    clearSelection();
    state.pendingSelection = null;
    refreshToolbar();
    setStatus(`${kind === 'underline' ? 'Underlined' : 'Highlighted'} selection on page ${selection.pageNumber}.`);
    return true;
  }

  function openSelectionCommentPopover() {
    if (!state.pendingSelection || !selectionCommentPopover) {
      return;
    }
    state.pendingCommentSelection = { ...state.pendingSelection };
    hideSelectionMenu();
    selectionCommentPopover.hidden = false;
    if (selectionCommentText) {
      selectionCommentText.value = '';
    }
    positionFloatingElement(selectionCommentPopover, state.pendingSelection.clientRect, { preferBelow: true });
    selectionCommentText?.focus?.();
  }

  function saveSelectionComment() {
    const text = String(selectionCommentText?.value || '').trim();
    const selection = state.pendingCommentSelection || state.pendingSelection;
    if (!text || !selection || typeof state.onSelectionComment !== 'function') {
      return;
    }
    const didCreateComment = state.onSelectionComment({
      pageNumber: selection.pageNumber,
      text: selection.text,
      boxes: selection.boxes,
      pageWidth: selection.pageWidth,
      pageHeight: selection.pageHeight,
      commentText: text
    });
    if (didCreateComment === false) {
      return;
    }
    hideSelectionCommentPopover();
    clearSelection();
    state.pendingSelection = null;
    refreshToolbar();
    setStatus(`Saved comment on page ${selection.pageNumber}.`);
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
      bookmarks: state.bookmarks,
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
    state.bookmarks = [];
    state.selectedCommentId = '';
    state.pendingSelection = null;
    state.pendingCommentSelection = null;
    state.placementMode = false;
    hideSelectionMenu();
    hideSelectionCommentPopover();
    hideHighlightCommentPopover();
    emitBookmarksResolved();
    cancelScrollSync();
    cancelAllRenderTasks(state.pageRecords);
    await cleanupLoadingTask();
    if (activeLoadToken !== state.loadToken) {
      return false;
    }
    paintHighlights();
    paintPins();
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
      state.bookmarks = await loadPdfBookmarks(pdfDocument);
      if (activeLoadToken !== state.loadToken) {
        try {
          await pdfDocument.destroy();
        } catch {}
        return false;
      }
      emitBookmarksResolved();
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

      // Build new page records off-DOM and pre-render the first page's
      // canvas so the swap below is atomic — the previous paper stays visible
      // until the new first page is ready, then the layer is replaced in one
      // DOM op. The text layer is rendered post-swap by renderDocumentPages.
      const previousPageRecords = state.pageRecords;
      const ownerDoc = pageLayer?.ownerDocument
        || (typeof document !== 'undefined' ? document : null);
      const newPageRecords = buildPageRecords({
        doc: ownerDoc,
        pageMetrics: state.pageMetrics
      });
      const swapScale = (() => {
        const previousRecords = state.pageRecords;
        state.pageRecords = newPageRecords;
        try {
          return getDocumentScale();
        } finally {
          state.pageRecords = previousRecords;
        }
      })();
      state.zoom = clamp(swapScale, MIN_ZOOM, MAX_ZOOM);
      applyPageSizing({ pageRecords: newPageRecords, scale: swapScale });

      const isLoadStale = () => activeLoadToken !== state.loadToken;
      const outputScale = Math.max(getWindowRef()?.devicePixelRatio || 1, 1);
      const firstRecord = newPageRecords[0] || null;
      let prerenderedFirst = null;
      if (firstRecord) {
        try {
          prerenderedFirst = await renderPageCanvasToOffscreen({
            pdfDocument,
            record: firstRecord,
            scale: swapScale,
            outputScale,
            isStale: isLoadStale
          });
        } catch (prerenderError) {
          if (!isRenderingCancelled(prerenderError)) {
            // Fall back to the post-swap render path; we still want to swap.
          }
        }
        if (isLoadStale()) {
          try {
            await pdfDocument.destroy();
          } catch {}
          return false;
        }
        if (prerenderedFirst) {
          commitOffscreenToVisibleCanvas({
            record: firstRecord,
            offscreen: prerenderedFirst.offscreen,
            cssWidth: prerenderedFirst.cssWidth,
            cssHeight: prerenderedFirst.cssHeight,
            bitmapWidth: prerenderedFirst.bitmapWidth,
            bitmapHeight: prerenderedFirst.bitmapHeight
          });
          try {
            prerenderedFirst.page?.cleanup?.();
          } catch {}
        }
      }

      // Atomic swap: drop the old DOM and attach the pre-rendered records.
      releasePageRecords({ pageLayer, pageRecords: previousPageRecords });
      state.pageRecords = newPageRecords;
      attachPageRecords({ pageLayer, pageRecords: newPageRecords });
      setStageScrollTop(0);
      await renderDocumentPages({ resetScroll: false, preserveScroll: false });
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
        state.bookmarks = previousState.bookmarks;
        state.selectedCommentId = previousState.selectedCommentId;
        state.pendingSelection = previousState.pendingSelection;
        state.placementMode = previousState.placementMode;
        emitBookmarksResolved();
        setTitle(state.paperTitle);
        setMeta(state.paperMeta);
        paintHighlights();
        paintPins();
      } else {
        await cleanupDocument();
        releasePageRecords({ pageLayer, pageRecords: state.pageRecords });
        state.pageRecords = [];
      }
      refreshToolbar();
      setStatus(String(error?.message || error || 'Failed to load PDF.'), true);
      return false;
    }
  }

  function setComments(comments = []) {
    state.comments = normalizeCommentList(comments);
    hideHighlightCommentPopover();
    paintPins();
  }

  function setHighlights(highlights = []) {
    state.highlights = normalizeHighlightList(highlights);
    hideHighlightCommentPopover();
    paintHighlights();
  }

  function setSelectedCommentId(commentId = '') {
    state.selectedCommentId = String(commentId || '').trim();
    paintPins();
  }

  function setPlacementMode(enabled) {
    state.placementMode = Boolean(enabled) && hasActiveDocument();
    if (state.placementMode) {
      clearSelection();
      state.pendingSelection = null;
    }
    refreshToolbar();
    paintPins();
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
    hideSelectionMenu();
    hideSelectionCommentPopover();
    hideHighlightCommentPopover();
    if (!state.pdfDocument) {
      paintHighlights();
      paintPins();
      return;
    }
    if (state.fitWidth) {
      void renderDocumentPages({ preserveScroll: true });
      return;
    }
    paintPins();
    updateCurrentPageFromScroll({ force: true });
  }

  function handleStageScroll() {
    hideSelectionMenu();
    hideSelectionCommentPopover();
    hideHighlightCommentPopover();
    scheduleScrollSync();
  }

  function handleHighlightHover(event) {
    if (!hasActiveDocument() || selectionMenu?.hidden === false || selectionCommentPopover?.hidden === false) {
      hideHighlightCommentPopover();
      return;
    }
    const comment = findCommentAtClientPoint(event?.clientX, event?.clientY);
    if (!comment) {
      hideHighlightCommentPopover();
      return;
    }
    showHighlightCommentPopover(comment, event.clientX, event.clientY);
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
    selectionHighlightBtn?.addEventListener('click', () => {
      createSelectionAnnotation('highlight');
    });
    selectionUnderlineBtn?.addEventListener('click', () => {
      createSelectionAnnotation('underline');
    });
    selectionCommentBtn?.addEventListener('click', () => {
      openSelectionCommentPopover();
    });
    selectionCommentSaveBtn?.addEventListener('click', () => {
      saveSelectionComment();
    });
    selectionCommentCancelBtn?.addEventListener('click', () => {
      hideSelectionCommentPopover();
      showSelectionMenu();
    });
    selectionCommentText?.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        saveSelectionComment();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        hideSelectionCommentPopover();
        showSelectionMenu();
      }
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
    stage?.addEventListener('scroll', handleStageScroll, { passive: true });
    pageLayer?.addEventListener('click', handleOverlayClick);
    pageLayer?.addEventListener('pointerdown', handleTextSelectionPointerDown);
    pageLayer?.addEventListener('pointermove', handleHighlightHover, { passive: true });
    pageLayer?.addEventListener('pointerleave', hideHighlightCommentPopover);

    const win = getWindowRef();
    const doc = getDocumentRef();
    if (typeof win?.addEventListener === 'function') {
      win.addEventListener('resize', handleResize);
      win.addEventListener('pointerup', handleTextSelectionPointerUp);
      win.addEventListener('blur', handleTextSelectionPointerUp);
    }
    if (typeof doc?.addEventListener === 'function') {
      doc.addEventListener('selectionchange', schedulePendingSelectionUpdate);
      doc.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          hideSelectionMenu();
          hideSelectionCommentPopover();
          hideHighlightCommentPopover();
        }
      });
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
    goToPage,
    openExternalUrl: openExternalLink,
    setComments,
    setHighlights,
    setSelectedCommentId,
    setPlacementMode
  };
}
