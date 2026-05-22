import { createPapersPdfViewer } from './pdf-viewer.js';
import { createPapersActions } from './actions.js';
import { createPapersCommentController } from './comments.js';
import { createPapersLibraryController } from './library.js';
import { ensurePaperHighlights } from './model.js';
import { normalizePaperSummary } from './normalizers.js';
import {
  boxesToPdfQuadPoints,
  normalizeHighlightBoxes,
  normalizePageDimension
} from './pdf-viewer-geometry.js';
import {
  hasPaperPdfMetadata,
  normalizePaperPdfMetadata
} from './pdf-metadata.js';

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
    papersContextRenameFolderBtn: getById('papers-context-rename-folder'),
    papersContextDeleteFolderBtn: getById('papers-context-delete-folder'),
    paperCommentPanel: getById('paper-comment-panel'),
    paperCommentToggleBtn: getById('paper-comment-toggle-btn'),
    paperCommentSidebar: getById('paper-comment-sidebar'),
    paperSummarySection: getById('paper-summary-section'),
    paperSummaryToggleBtn: getById('paper-summary-toggle-btn'),
    paperSummaryContent: getById('paper-summary-content'),
    paperSummaryList: getById('paper-summary-list'),
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
    selectedFolderKey: '',
    expandedFolderKeys: new Set(),
    renamingFolderKey: '',
    renamingFolderName: ''
  };
  const libraryContextState = {
    folderKey: '',
    folderId: '',
    folderType: '',
    paperId: ''
  };
  const uiState = {
    commentsCollapsed: false,
    summaryCollapsed: false
  };
  const discoveryState = {
    inFlight: false,
    lastStoragePath: '',
    lastRunAt: 0
  };

  function normalizeExternalWebsiteUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return '';
      }
      return parsed.toString();
    } catch {
      return '';
    }
  }

  async function openPdfExternalWebsite(url) {
    const normalizedUrl = normalizeExternalWebsiteUrl(url);
    if (!normalizedUrl) {
      return { ok: false, error: 'A valid external website URL is required.' };
    }

    const shouldOpen = typeof windowRef?.confirm === 'function'
      ? windowRef.confirm(`This PDF link opens an external website:\n\n${normalizedUrl}\n\nOpen it in your browser?`)
      : true;
    if (!shouldOpen) {
      return { ok: false, cancelled: true, error: 'External website was not opened.' };
    }

    if (typeof windowRef?.enanaApi?.openExternalUrl !== 'function') {
      return { ok: false, error: 'External link opening is unavailable in this build.' };
    }
    return windowRef.enanaApi.openExternalUrl(normalizedUrl);
  }

  function mergeDiscoveredJournalClubs(discoveredClubs = []) {
    let changed = false;
    if (!Array.isArray(state.journalClubs)) {
      state.journalClubs = [];
      changed = true;
    }
    const existingById = new Map((state.journalClubs || []).map((club) => [String(club?.id || '').trim(), club]));
    discoveredClubs.forEach((club) => {
      const normalized = club && typeof club === 'object' ? club : {};
      const id = String(normalized.id || '').trim();
      if (!id) {
        return;
      }
      const existing = existingById.get(id);
      if (existing) {
        return;
      }
      state.journalClubs.push({
        id,
        name: String(normalized.name || 'Discovered folder').trim() || 'Discovered folder',
        description: String(normalized.description || '').trim()
      });
      changed = true;
    });
    return changed;
  }

  function mergeDiscoveredPapers(discoveredPapers = []) {
    let changed = false;
    if (!Array.isArray(state.papers)) {
      state.papers = [];
      changed = true;
    }
    const existingByRelativePath = new Map(
      (state.papers || []).map((paper) => [
        String(paper?.storedRelativePath || '').trim().toLowerCase(),
        paper
      ]).filter(([key]) => key)
    );
    discoveredPapers.forEach((paper) => {
      const normalized = paper && typeof paper === 'object' ? paper : {};
      const relativePath = String(normalized.storedRelativePath || '').trim();
      const lowerRelativePath = relativePath.toLowerCase();
      if (!lowerRelativePath) {
        return;
      }
      const existing = existingByRelativePath.get(lowerRelativePath);
      if (existing) {
        const merged = {
          ...existing,
          ...normalized,
          id: existing.id || normalized.id
        };
        const previousJson = JSON.stringify(existing);
        const nextJson = JSON.stringify(merged);
        if (previousJson !== nextJson) {
          Object.assign(existing, merged);
          changed = true;
        }
        return;
      }
      state.papers.push(normalized);
      existingByRelativePath.set(lowerRelativePath, normalized);
      changed = true;
    });
    return changed;
  }

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
    renderSummarySection() {},
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
    setSummaryCollapsed(collapsed) {
      const nextValue = Boolean(collapsed);
      if (uiState.summaryCollapsed === nextValue) {
        return;
      }
      uiState.summaryCollapsed = nextValue;
      context.renderSummarySection();
    },
    toggleSummaryCollapsed() {
      context.setSummaryCollapsed(!uiState.summaryCollapsed);
    },
    getPaperById(paperId) {
      return (state.papers || []).find((paper) => paper.id === paperId) || null;
    },
    getActivePaper() {
      const activePaperId = context.paperViewer.getActivePaperId();
      return (state.papers || []).find((paper) => paper.id === activePaperId) || null;
    },
    applyResolvedPdfMetadata({ paperId = '', metadata = null } = {}) {
      const paper = context.getPaperById(paperId);
      if (!paper) {
        return;
      }

      const normalized = normalizePaperPdfMetadata(metadata);
      if (!hasPaperPdfMetadata(normalized)) {
        context.renderSummarySection();
        return;
      }

      const current = normalizePaperPdfMetadata(paper.pdfMetadata);
      const metadataChanged = JSON.stringify(normalized) !== JSON.stringify(current);
      const titleChanged = Boolean(normalized.title) && normalized.title !== String(paper.title || '').trim();
      if (!metadataChanged && !titleChanged) {
        context.renderSummarySection();
        return;
      }

      paper.pdfMetadata = normalized;
      if (normalized.title) {
        paper.title = normalized.title;
      }

      persist();
      context.renderLibrarySidebar?.(libraryState.selectedFolderKey);
      context.renderSummarySection();
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
    onMetadataResolved: (...args) => context.applyResolvedPdfMetadata(...args),
    onPageChange: (...args) => context.comments?.onViewerPageChange(...args),
    onPlacement: (...args) => context.comments?.onViewerPlacement(...args),
    onPinSelect: (...args) => context.comments?.onViewerPinSelect(...args),
    onHighlightSelection: (...args) => context.createPaperHighlight?.(...args),
    onExternalLink: openPdfExternalWebsite,
    onClose: (...args) => context.comments?.onViewerClose(...args)
  });

  context.paperViewer = paperViewer;

  const comments = createPapersCommentController(context);
  context.comments = comments;

  const actions = createPapersActions(context);
  context.actions = actions;

  const library = createPapersLibraryController(context);
  context.library = library;

  async function maybeDiscoverStoredPapers() {
    const storagePath = String(state.settings?.storagePath || '').trim();
    if (!storagePath || !elements.papersView?.classList?.contains?.('is-active')) {
      return;
    }
    if (!windowRef?.enanaApi?.discoverStoredPapers || discoveryState.inFlight) {
      return;
    }
    const now = Date.now();
    if (discoveryState.lastStoragePath === storagePath && now - discoveryState.lastRunAt < 15_000) {
      return;
    }

    discoveryState.inFlight = true;
    try {
      const result = await windowRef.enanaApi.discoverStoredPapers({
        storagePath,
        knownPapers: state.papers || [],
        projects: state.projects || [],
        journalClubs: state.journalClubs || []
      });
      discoveryState.lastStoragePath = storagePath;
      discoveryState.lastRunAt = Date.now();
      if (!result?.ok) {
        return;
      }
      const changed = mergeDiscoveredJournalClubs(result.journalClubs)
        || mergeDiscoveredPapers(result.papers);
      if (changed) {
        persist();
        library.renderLinkTargets();
        library.renderLibrarySidebar();
        comments.renderCommentSidebar();
      }
    } finally {
      discoveryState.inFlight = false;
    }
  }

  context.renderLibrarySidebar = (...args) => library.renderLibrarySidebar(...args);
  context.renderCommentSidebar = (...args) => comments.renderCommentSidebar(...args);
  context.renderSummarySection = (...args) => comments.renderSummarySection(...args);
  context.syncViewerHighlights = () => {
    const activePaper = context.getActivePaper?.() || null;
    paperViewer.setHighlights(activePaper ? ensurePaperHighlights(activePaper) : []);
  };
  context.createPaperHighlight = ({ pageNumber, text, boxes, pageWidth, pageHeight } = {}) => {
    const activePaper = context.getActivePaper?.() || null;
    const normalizedText = String(text || '').trim();
    const normalizedPageNumber = Math.max(1, Math.round(Number(pageNumber) || 1));
    const normalizedBoxes = normalizeHighlightBoxes(boxes);
    const normalizedPageWidth = normalizePageDimension(pageWidth);
    const normalizedPageHeight = normalizePageDimension(pageHeight);
    const quadPoints = boxesToPdfQuadPoints(normalizedBoxes, {
      pageWidth: normalizedPageWidth,
      pageHeight: normalizedPageHeight
    });

    if (!activePaper || !normalizedText || !normalizedBoxes.length) {
      return false;
    }

    const now = new Date().toISOString();
    const highlightRecord = {
      id: createId(),
      pageNumber: normalizedPageNumber,
      text: normalizedText,
      boxes: normalizedBoxes,
      createdAt: now,
      updatedAt: now
    };
    if (normalizedPageWidth && normalizedPageHeight && quadPoints.length) {
      highlightRecord.pageWidth = normalizedPageWidth;
      highlightRecord.pageHeight = normalizedPageHeight;
      highlightRecord.quadPoints = quadPoints;
    }
    ensurePaperHighlights(activePaper).push(highlightRecord);
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
    void maybeDiscoverStoredPapers();
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
