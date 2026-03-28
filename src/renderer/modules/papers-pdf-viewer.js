import { installPdfJsCompat } from './papers-pdfjs-compat.js';

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

export function createPapersPdfViewer(elements = {}) {
  const shell = elements.shell || null;
  const emptyState = elements.emptyState || null;
  const workspace = elements.workspace || null;
  const stage = elements.stage || null;
  const pageLayer = elements.pageLayer || null;
  const canvas = elements.canvas || null;
  const overlay = elements.overlay || null;
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

  const state = {
    paperId: '',
    paperTitle: '',
    paperMeta: '',
    pageNumber: 1,
    pageCount: 0,
    zoom: DEFAULT_ZOOM,
    fitWidth: true,
    loadToken: 0,
    renderToken: 0,
    pdfDocument: null,
    loadingTask: null,
    renderTask: null,
    openExternal: null,
    resolveBytes: null,
    comments: [],
    selectedCommentId: '',
    placementMode: false,
    onPageChange: typeof elements.onPageChange === 'function' ? elements.onPageChange : null,
    onPlacement: typeof elements.onPlacement === 'function' ? elements.onPlacement : null,
    onPinSelect: typeof elements.onPinSelect === 'function' ? elements.onPinSelect : null,
    onClose: typeof elements.onClose === 'function' ? elements.onClose : null
  };

  function hasActiveDocument() {
    return Boolean(state.pdfDocument);
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
      meta.textContent = text || 'Select a paper from the list to preview it here.';
    }
  }

  function syncPageLayerSize() {
    if (!pageLayer || !canvas) {
      return;
    }
    const width = String(canvas.style?.width || '').trim();
    const height = String(canvas.style?.height || '').trim();
    pageLayer.style.width = width || '0px';
    pageLayer.style.height = height || '0px';
  }

  function clearPins() {
    if (overlay) {
      overlay.innerHTML = '';
      overlay.style.cursor = state.placementMode ? 'crosshair' : 'default';
    }
  }

  function renderPins() {
    if (!overlay) {
      return;
    }

    clearPins();
    if (!hasActiveDocument()) {
      return;
    }

    const currentPageComments = state.comments.filter((comment) => comment.pageNumber === state.pageNumber);
    if (!currentPageComments.length) {
      return;
    }

    const doc = overlay.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc?.createElement) {
      return;
    }

    currentPageComments.forEach((comment) => {
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
  }

  function emitPageChange() {
    if (typeof state.onPageChange === 'function' && hasActiveDocument()) {
      state.onPageChange(state.pageNumber);
    }
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
    if (overlay) {
      overlay.style.cursor = active && state.placementMode ? 'crosshair' : 'default';
    }
  }

  function renderEmptyViewer(message = '') {
    state.paperId = '';
    state.paperTitle = '';
    state.paperMeta = '';
    state.pageNumber = 1;
    state.pageCount = 0;
    state.zoom = DEFAULT_ZOOM;
    state.fitWidth = true;
    state.comments = [];
    state.selectedCommentId = '';
    state.placementMode = false;
    setTitle('No paper selected');
    setMeta('Select a paper from the list to preview it here.');
    setStatus(message || 'Choose "View PDF" on a paper to open it here.', false);
    if (canvas && typeof canvas.getContext === 'function') {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
      }
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = '0px';
      canvas.style.height = '0px';
    }
    syncPageLayerSize();
    clearPins();
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

  async function cleanupDocument() {
    const currentDocument = state.pdfDocument;
    state.pdfDocument = null;
    if (!currentDocument || typeof currentDocument.destroy !== 'function') {
      return;
    }
    try {
      await currentDocument.destroy();
    } catch {}
  }

  function cancelRenderTask() {
    const currentTask = state.renderTask;
    state.renderTask = null;
    if (!currentTask || typeof currentTask.cancel !== 'function') {
      return;
    }
    try {
      currentTask.cancel();
    } catch {}
  }

  async function resetViewer(message = '') {
    state.loadToken += 1;
    state.renderToken += 1;
    cancelRenderTask();
    await cleanupLoadingTask();
    await cleanupDocument();
    renderEmptyViewer(message);
    if (typeof state.onClose === 'function') {
      state.onClose();
    }
  }

  async function renderCurrentPage() {
    if (!state.pdfDocument || !canvas || typeof canvas.getContext !== 'function') {
      refreshToolbar();
      renderPins();
      return;
    }

    const activeRenderToken = ++state.renderToken;
    cancelRenderTask();

    try {
      const page = await state.pdfDocument.getPage(state.pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const stageWidth = Math.max((stage?.clientWidth || 0) - 32, 320);
      const fitScale = clamp(stageWidth / Math.max(baseViewport.width, 1), MIN_ZOOM, MAX_ZOOM);
      const renderScale = state.fitWidth ? fitScale : clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
      const outputScale = Math.max(window.devicePixelRatio || 1, 1);
      const viewport = page.getViewport({ scale: renderScale });
      const context = canvas.getContext('2d', { alpha: false });

      if (!context) {
        throw new Error('Canvas context is unavailable.');
      }

      state.zoom = renderScale;
      canvas.width = Math.ceil(viewport.width * outputScale);
      canvas.height = Math.ceil(viewport.height * outputScale);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      syncPageLayerSize();
      clearPins();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
      });
      state.renderTask = renderTask;
      refreshToolbar();
      setStatus(`Rendering page ${state.pageNumber} of ${state.pageCount}...`);

      await renderTask.promise;
      if (activeRenderToken !== state.renderToken) {
        return;
      }

      if (state.renderTask === renderTask) {
        state.renderTask = null;
      }
      setTitle(state.paperTitle || 'Paper Viewer');
      setMeta(state.paperMeta || 'PDF preview');
      setStatus(`Viewing page ${state.pageNumber} of ${state.pageCount}.`);
      renderPins();
      refreshToolbar();
    } catch (error) {
      if (isRenderingCancelled(error)) {
        return;
      }
      if (state.renderTask) {
        state.renderTask = null;
      }
      setStatus(String(error?.message || error || 'Failed to render PDF page.'), true);
    }
  }

  async function goToPage(pageNumber) {
    if (!state.pdfDocument) {
      return;
    }
    const nextPage = clamp(Math.round(Number(pageNumber) || 1), 1, state.pageCount);
    if (nextPage === state.pageNumber && state.renderTask) {
      return;
    }
    state.pageNumber = nextPage;
    emitPageChange();
    await renderCurrentPage();
  }

  async function adjustZoom(delta) {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = false;
    state.zoom = clamp(state.zoom + delta, MIN_ZOOM, MAX_ZOOM);
    await renderCurrentPage();
  }

  async function resetZoom() {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = false;
    state.zoom = DEFAULT_ZOOM;
    await renderCurrentPage();
  }

  async function fitToWidth() {
    if (!state.pdfDocument) {
      return;
    }
    state.fitWidth = true;
    await renderCurrentPage();
  }

  async function openPaper({ paper, summary = '', resolveBytes, onOpenExternal }) {
    if (!paper?.id || typeof resolveBytes !== 'function') {
      return false;
    }

    state.loadToken += 1;
    const activeLoadToken = state.loadToken;
    state.resolveBytes = resolveBytes;
    state.openExternal = typeof onOpenExternal === 'function' ? onOpenExternal : null;
    state.paperId = String(paper.id || '');
    state.paperTitle = String(paper.title || paper.fileName || 'Untitled paper');
    state.paperMeta = summary || String(paper.fileName || '').trim() || 'PDF preview';
    state.pageNumber = 1;
    state.pageCount = 0;
    state.zoom = DEFAULT_ZOOM;
    state.fitWidth = true;
    state.comments = [];
    state.selectedCommentId = '';
    state.placementMode = false;
    cancelRenderTask();
    await cleanupLoadingTask();
    await cleanupDocument();
    clearPins();
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
      state.pdfDocument = pdfDocument;
      state.pageCount = Number(pdfDocument.numPages) || 1;
      state.pageNumber = 1;
      emitPageChange();
      refreshToolbar();
      await renderCurrentPage();
      return true;
    } catch (error) {
      if (activeLoadToken !== state.loadToken) {
        return false;
      }
      state.loadingTask = null;
      state.pdfDocument = null;
      refreshToolbar();
      setStatus(String(error?.message || error || 'Failed to load PDF.'), true);
      return false;
    }
  }

  function setComments(comments = []) {
    state.comments = normalizeCommentList(comments);
    renderPins();
  }

  function setSelectedCommentId(commentId = '') {
    state.selectedCommentId = String(commentId || '').trim();
    renderPins();
  }

  function setPlacementMode(enabled) {
    state.placementMode = Boolean(enabled) && hasActiveDocument();
    refreshToolbar();
    renderPins();
  }

  function handleOverlayClick(event) {
    if (!state.placementMode || !hasActiveDocument() || typeof state.onPlacement !== 'function') {
      return;
    }
    const boundsTarget = pageLayer && typeof pageLayer.getBoundingClientRect === 'function'
      ? pageLayer
      : canvas;
    const rect = boundsTarget?.getBoundingClientRect?.();
    const anchor = computePdfAnchorFromClientPoint({
      clientX: event?.clientX,
      clientY: event?.clientY,
      rect
    });
    if (!anchor) {
      return;
    }
    state.onPlacement({
      pageNumber: state.pageNumber,
      anchorX: anchor.anchorX,
      anchorY: anchor.anchorY
    });
  }

  function bindEvents() {
    prevBtn?.addEventListener('click', () => {
      void goToPage(state.pageNumber - 1);
    });
    nextBtn?.addEventListener('click', () => {
      void goToPage(state.pageNumber + 1);
    });
    pageInput?.addEventListener('change', () => {
      void goToPage(pageInput.value);
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
    openExternalBtn?.addEventListener('click', () => {
      if (!state.paperId || typeof state.openExternal !== 'function') {
        return;
      }
      void state.openExternal(state.paperId);
    });
    closeBtn?.addEventListener('click', () => {
      void resetViewer();
    });
    overlay?.addEventListener('click', handleOverlayClick);

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', () => {
        if (!state.pdfDocument || !state.fitWidth) {
          renderPins();
          return;
        }
        void renderCurrentPage();
      });
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
    setSelectedCommentId,
    setPlacementMode
  };
}
