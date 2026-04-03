import { createPapersPdfViewer } from './pdf-viewer.js';
import { createPapersActions } from './actions.js';
import { createPapersCommentController } from './comments.js';
import { createPapersLibraryController } from './library.js';
import { ensurePaperHighlights } from './model.js';
import { normalizePaperSummary } from './normalizers.js';

function getPapersElements(doc = null) {
  const getById = (id) => doc?.getElementById?.(id) || null;
  return {
    paperForm: getById('paper-form'),
    paperTitleInput: getById('paper-title'),
    paperPdfInput: getById('paper-pdf'),
    paperLinkTypeSelect: getById('paper-link-type'),
    paperLinkTargetSelect: getById('paper-link-target'),
    papersLayout: getById('papers-layout'),
    papersRightColumn: getById('papers-right-column'),
    paperList: getById('paper-list'),
    papersView: getById('papers-view'),
    papersLibraryRail: getById('papers-library-rail'),
    paperUploadTrigger: getById('paper-upload-trigger'),
    paperFolderSelection: getById('paper-folder-selection'),
    paperUploadTargetLabel: getById('paper-upload-target-label'),
    papersLibraryContextMenu: getById('papers-library-context-menu'),
    papersContextNewFolderBtn: getById('papers-context-new-folder'),
    papersContextDeleteFolderBtn: getById('papers-context-delete-folder'),
    paperCommentPanel: getById('paper-comment-panel'),
    paperCommentToggleBtn: getById('paper-comment-toggle-btn'),
    paperCommentSidebar: getById('paper-comment-sidebar'),
    paperCommentPage: getById('paper-comment-page'),
    paperCommentCount: getById('paper-comment-count'),
    paperCommentAddBtn: getById('paper-comment-add-btn'),
    paperCommentSaveBtn: getById('paper-comment-save-btn'),
    paperCommentCancelBtn: getById('paper-comment-cancel-btn'),
    paperCommentDeleteBtn: getById('paper-comment-delete-btn'),
    paperCommentText: getById('paper-comment-text'),
    paperCommentStatus: getById('paper-comment-status'),
    paperCommentList: getById('paper-comment-list'),
    paperViewerSummarizeBtn: getById('paper-viewer-summarize-btn'),
    journalClubList: getById('journal-club-list'),
    paperViewerShell: getById('paper-viewer-shell'),
    paperViewerEmpty: getById('paper-viewer-empty'),
    paperViewerWorkspace: getById('paper-viewer-workspace'),
    paperViewerStage: getById('paper-viewer-stage'),
    paperViewerPageLayer: getById('paper-viewer-page-layer'),
    paperViewerCanvas: getById('paper-viewer-canvas'),
    paperViewerOverlay: getById('paper-viewer-overlay'),
    paperViewerTitle: getById('paper-viewer-title'),
    paperViewerMeta: getById('paper-viewer-meta'),
    paperViewerStatus: getById('paper-viewer-status'),
    paperViewerToolbar: getById('paper-viewer-toolbar'),
    paperViewerPrevBtn: getById('paper-viewer-prev-btn'),
    paperViewerNextBtn: getById('paper-viewer-next-btn'),
    paperViewerPageInput: getById('paper-viewer-page-input'),
    paperViewerPageCount: getById('paper-viewer-page-count'),
    paperViewerZoomOutBtn: getById('paper-viewer-zoom-out-btn'),
    paperViewerZoomInBtn: getById('paper-viewer-zoom-in-btn'),
    paperViewerZoomResetBtn: getById('paper-viewer-zoom-reset-btn'),
    paperViewerFitWidthBtn: getById('paper-viewer-fit-width-btn'),
    paperViewerHighlightBtn: getById('paper-viewer-highlight-btn'),
    paperViewerZoomLabel: getById('paper-viewer-zoom-label'),
    paperViewerOpenExternalBtn: getById('paper-viewer-open-btn')
  };
}

export function initPapersManagement({
  state,
  persist,
  createId,
  safeText,
  onCreateProtocolDraft,
  document: providedDocument = null,
  window: providedWindow = null,
  createPdfViewer = createPapersPdfViewer
}) {
  const documentRef = providedDocument || (typeof document !== 'undefined' ? document : null);
  const windowRef = providedWindow || (typeof window !== 'undefined' ? window : null);
  const elements = getPapersElements(documentRef);
  const commentState = {
    currentPageNumber: 1,
    mode: 'idle',
    selectedCommentId: '',
    draftPageNumber: 0,
    draftAnchorX: Number.NaN,
    draftAnchorY: Number.NaN
  };
  const libraryState = {
    selectedFolderKey: ''
  };
  const libraryContextState = {
    folderKey: '',
    folderId: '',
    folderType: '',
    paperId: ''
  };
  const uiState = {
    commentsCollapsed: false
  };

  const context = {
    state,
    persist,
    createId,
    safeText,
    onCreateProtocolDraft,
    document: documentRef,
    window: windowRef,
    elements,
    commentState,
    libraryState,
    libraryContextState,
    uiState,
    comments: null,
    actions: null,
    library: null,
    renderLibrarySidebar() {},
    renderCommentSidebar() {},
    renderCommentPanelState() {},
    syncViewerHighlights() {},
    render() {},
    setCommentsCollapsed(collapsed) {
      const nextValue = Boolean(collapsed);
      if (uiState.commentsCollapsed === nextValue) {
        return;
      }
      uiState.commentsCollapsed = nextValue;
      context.renderCommentPanelState();
      context.library?.schedulePapersEdgeBleedSync?.();
    },
    toggleCommentsCollapsed() {
      context.setCommentsCollapsed(!uiState.commentsCollapsed);
    },
    getPaperById(paperId) {
      return (state.papers || []).find((paper) => paper.id === paperId) || null;
    },
    getActivePaper() {
      const activePaperId = context.paperViewer.getActivePaperId();
      return (state.papers || []).find((paper) => paper.id === activePaperId) || null;
    }
  };

  const paperViewer = createPdfViewer({
    shell: elements.paperViewerShell,
    emptyState: elements.paperViewerEmpty,
    workspace: elements.paperViewerWorkspace,
    stage: elements.paperViewerStage,
    pageLayer: elements.paperViewerPageLayer,
    canvas: elements.paperViewerCanvas,
    overlay: elements.paperViewerOverlay,
    title: elements.paperViewerTitle,
    meta: elements.paperViewerMeta,
    status: elements.paperViewerStatus,
    toolbar: elements.paperViewerToolbar,
    prevBtn: elements.paperViewerPrevBtn,
    nextBtn: elements.paperViewerNextBtn,
    pageInput: elements.paperViewerPageInput,
    pageCount: elements.paperViewerPageCount,
    zoomOutBtn: elements.paperViewerZoomOutBtn,
    zoomInBtn: elements.paperViewerZoomInBtn,
    zoomResetBtn: elements.paperViewerZoomResetBtn,
    fitWidthBtn: elements.paperViewerFitWidthBtn,
    highlightBtn: elements.paperViewerHighlightBtn,
    zoomLabel: elements.paperViewerZoomLabel,
    openExternalBtn: elements.paperViewerOpenExternalBtn,
    onPageChange: (...args) => context.comments?.onViewerPageChange(...args),
    onPlacement: (...args) => context.comments?.onViewerPlacement(...args),
    onPinSelect: (...args) => context.comments?.onViewerPinSelect(...args),
    onHighlightSelection: (...args) => context.createPaperHighlight?.(...args),
    onClose: (...args) => context.comments?.onViewerClose(...args)
  });

  context.paperViewer = paperViewer;

  const comments = createPapersCommentController(context);
  context.comments = comments;

  const actions = createPapersActions(context);
  context.actions = actions;

  const library = createPapersLibraryController(context);
  context.library = library;

  context.renderLibrarySidebar = (...args) => library.renderLibrarySidebar(...args);
  context.renderCommentSidebar = (...args) => comments.renderCommentSidebar(...args);
  context.syncViewerHighlights = () => {
    const activePaper = context.getActivePaper?.() || null;
    paperViewer.setHighlights(activePaper ? ensurePaperHighlights(activePaper) : []);
  };
  context.createPaperHighlight = ({ pageNumber, text, boxes } = {}) => {
    const activePaper = context.getActivePaper?.() || null;
    const normalizedText = String(text || '').trim();
    const normalizedPageNumber = Math.max(1, Math.round(Number(pageNumber) || 1));
    const normalizedBoxes = (Array.isArray(boxes) ? boxes : [])
      .map((box) => {
        if (!box || typeof box !== 'object') {
          return null;
        }
        const x = Number(box.x);
        const y = Number(box.y);
        const width = Number(box.width);
        const height = Number(box.height);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          return null;
        }
        return { x, y, width, height };
      })
      .filter(Boolean);

    if (!activePaper || !normalizedText || !normalizedBoxes.length) {
      return false;
    }

    const now = new Date().toISOString();
    ensurePaperHighlights(activePaper).push({
      id: createId(),
      pageNumber: normalizedPageNumber,
      text: normalizedText,
      boxes: normalizedBoxes,
      createdAt: now,
      updatedAt: now
    });
    activePaper.updatedAt = now;
    persist();
    context.syncViewerHighlights();
    context.renderLibrarySidebar?.(libraryState.selectedFolderKey);
    return true;
  };
  context.renderCommentPanelState = () => {
    const collapsed = Boolean(uiState.commentsCollapsed);
    elements.papersLayout?.classList?.toggle('is-comments-collapsed', collapsed);
    elements.papersRightColumn?.classList?.toggle('is-collapsed', collapsed);
    if (elements.paperCommentSidebar) {
      elements.paperCommentSidebar.hidden = collapsed;
    }
    if (elements.paperCommentToggleBtn) {
      const label = collapsed
        ? 'Unfold comments panel from the right'
        : 'Fold comments panel to the right';
      elements.paperCommentToggleBtn.classList?.toggle('is-collapsed', collapsed);
      elements.paperCommentToggleBtn.setAttribute?.('aria-expanded', String(!collapsed));
      elements.paperCommentToggleBtn.setAttribute?.('aria-label', label);
      elements.paperCommentToggleBtn.title = label;
    }
  };
  context.render = () => {
    context.renderCommentPanelState();
    library.renderLibrarySidebar();
    context.syncViewerHighlights();
    comments.renderCommentSidebar();
    library.schedulePapersEdgeBleedSync();
  };

  elements.paperCommentToggleBtn?.addEventListener('click', () => {
    context.toggleCommentsCollapsed();
  });

  actions.bindEvents();
  comments.bindEvents();
  library.bindEvents();
  library.observeViewActivation();
  context.renderCommentPanelState();

  return {
    render: context.render,
    renderLinkTargets: library.renderLinkTargets
  };
}

export { normalizePaperSummary };
