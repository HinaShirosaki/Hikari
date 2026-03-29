import { createPapersPdfViewer } from './pdf-viewer.js';
import { createPapersActions } from './actions.js';
import { createPapersCommentController } from './comments.js';
import { createPapersLibraryController } from './library.js';
import { normalizePaperSummary } from './normalizers.js';

function getPapersElements(doc = null) {
  const getById = (id) => doc?.getElementById?.(id) || null;
  return {
    paperForm: getById('paper-form'),
    paperTitleInput: getById('paper-title'),
    paperPdfInput: getById('paper-pdf'),
    paperLinkTypeSelect: getById('paper-link-type'),
    paperLinkTargetSelect: getById('paper-link-target'),
    paperList: getById('paper-list'),
    papersView: getById('papers-view'),
    papersLibraryRail: getById('papers-library-rail'),
    paperUploadTrigger: getById('paper-upload-trigger'),
    paperFolderSelection: getById('paper-folder-selection'),
    paperUploadTargetLabel: getById('paper-upload-target-label'),
    papersLibraryContextMenu: getById('papers-library-context-menu'),
    papersContextNewFolderBtn: getById('papers-context-new-folder'),
    papersContextDeleteFolderBtn: getById('papers-context-delete-folder'),
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
    comments: null,
    actions: null,
    library: null,
    renderLibrarySidebar() {},
    renderCommentSidebar() {},
    render() {},
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
    zoomLabel: elements.paperViewerZoomLabel,
    openExternalBtn: elements.paperViewerOpenExternalBtn,
    onPageChange: (...args) => context.comments?.onViewerPageChange(...args),
    onPlacement: (...args) => context.comments?.onViewerPlacement(...args),
    onPinSelect: (...args) => context.comments?.onViewerPinSelect(...args),
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
  context.render = () => {
    library.renderLibrarySidebar();
    comments.renderCommentSidebar();
    library.schedulePapersEdgeBleedSync();
  };

  actions.bindEvents();
  comments.bindEvents();
  library.bindEvents();
  library.observeViewActivation();

  return {
    render: context.render,
    renderLinkTargets: library.renderLinkTargets
  };
}

export { normalizePaperSummary };
