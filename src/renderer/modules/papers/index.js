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
  getPaperDisplayTitle,
  hasPaperPdfMetadata,
  normalizePaperPdfMetadata
} from './pdf-metadata.js';

export function normalizePaperSelectionSearchText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pushPaperSearchValue(values, value, { label = '', weight = 1 } = {}) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return;
  }
  values.push({
    label,
    value: text,
    weight: Math.max(1, Number(weight) || 1)
  });
}

function collectStructuredPaperSearchValues(values, source, options = {}, depth = 0) {
  if (depth > 4 || source == null) {
    return;
  }
  if (typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean') {
    pushPaperSearchValue(values, source, options);
    return;
  }
  if (Array.isArray(source)) {
    source.forEach((item) => collectStructuredPaperSearchValues(values, item, options, depth + 1));
    return;
  }
  if (typeof source !== 'object') {
    return;
  }
  Object.entries(source).forEach(([key, value]) => {
    if (/^(?:pdfDataUrl|dataBase64|rawData|bytes|buffer)$/i.test(key)) {
      return;
    }
    collectStructuredPaperSearchValues(values, value, options, depth + 1);
  });
}

function collectPaperBookmarkSearchValues(values, bookmarks = []) {
  (Array.isArray(bookmarks) ? bookmarks : []).forEach((bookmark) => {
    pushPaperSearchValue(values, bookmark?.title, { label: 'Bookmark', weight: 2 });
    collectPaperBookmarkSearchValues(values, bookmark?.items);
  });
}

export function collectPaperDatabaseSearchValues(paper = {}) {
  const values = [];
  pushPaperSearchValue(values, paper.title, { label: 'Title', weight: 4 });
  pushPaperSearchValue(values, paper.fileName, { label: 'File', weight: 2 });
  pushPaperSearchValue(values, paper.linkedName, { label: 'Folder', weight: 2 });
  pushPaperSearchValue(values, paper.summary, { label: 'Summary', weight: 3 });

  const metadata = normalizePaperPdfMetadata(paper.pdfMetadata || null);
  Object.values(metadata).forEach((value) => {
    pushPaperSearchValue(values, value, { label: 'PDF metadata', weight: 3 });
  });
  collectStructuredPaperSearchValues(values, paper.summaryStructured, { label: 'Summary', weight: 3 });
  collectStructuredPaperSearchValues(values, paper.methodsExtract, { label: 'Methods', weight: 3 });
  collectStructuredPaperSearchValues(values, paper.keyFigures, { label: 'Figures', weight: 2 });
  collectStructuredPaperSearchValues(values, paper.keyReagents, { label: 'Reagents', weight: 2 });
  collectStructuredPaperSearchValues(values, paper.comments, { label: 'Comments', weight: 2 });
  collectStructuredPaperSearchValues(values, paper.highlights, { label: 'Highlights', weight: 2 });
  collectStructuredPaperSearchValues(values, paper.knowledgeDatabase, { label: 'Knowledge', weight: 1 });
  collectPaperBookmarkSearchValues(values, paper.pdfBookmarks);
  return values;
}

function countQueryTermHits(sourceText = '', terms = []) {
  if (!terms.length) {
    return 0;
  }
  const source = normalizePaperSelectionSearchText(sourceText);
  if (!source) {
    return 0;
  }
  return terms.reduce((count, term) => count + (source.includes(term) ? 1 : 0), 0);
}

export function searchPaperDatabaseForSelectedText(papers = [], rawText = '', options = {}) {
  const query = normalizePaperSelectionSearchText(rawText);
  if (!query) {
    return [];
  }
  const terms = [...new Set(query.split(/\s+/).filter((term) => term.length > 2))].slice(0, 12);
  const requiredTermHits = terms.length <= 6
    ? terms.length
    : Math.max(6, Math.ceil(terms.length * 0.75));
  const activePaperId = String(options.activePaperId || '').trim();
  const limit = Math.max(1, Math.min(50, Math.round(Number(options.limit) || 10)));

  return (Array.isArray(papers) ? papers : [])
    .map((paper) => {
      const paperId = String(paper?.id || '').trim();
      if (!paperId) {
        return null;
      }
      const values = collectPaperDatabaseSearchValues(paper);
      let score = 0;
      const matchedLabels = new Set();
      values.forEach((entry) => {
        const source = normalizePaperSelectionSearchText(entry.value);
        if (!source) {
          return;
        }
        const exactMatch = source.includes(query);
        const termHits = exactMatch ? terms.length : countQueryTermHits(source, terms);
        const enoughTermHits = terms.length > 0 && termHits >= requiredTermHits;
        if (!exactMatch && !enoughTermHits) {
          return;
        }
        score += (exactMatch ? 10 : termHits) * entry.weight;
        matchedLabels.add(entry.label || 'Paper');
      });
      if (score <= 0) {
        return null;
      }
      return {
        paperId,
        title: getPaperDisplayTitle(paper),
        folderLabel: String(paper?.linkedName || paper?.linkedType || '').trim(),
        matchCount: matchedLabels.size,
        isActive: paperId === activePaperId,
        score
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit)
    .map(({ score, ...match }) => match);
}

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
    paperBookmarkSection: getById('paper-bookmark-section'),
    paperBookmarkToggleBtn: getById('paper-bookmark-toggle-btn'),
    paperBookmarkContent: getById('paper-bookmark-content'),
    paperBookmarkList: getById('paper-bookmark-list'),
    paperSummarySection: getById('paper-summary-section'),
    paperSummaryToggleBtn: getById('paper-summary-toggle-btn'),
    paperSummaryContent: getById('paper-summary-content'),
    paperSummaryList: getById('paper-summary-list'),
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
    paperViewerOpenExternalBtn: getById('paper-viewer-open-btn'),
    paperSelectionMenu: getById('paper-selection-menu'),
    paperSelectionCommentBtn: getById('paper-selection-comment-btn'),
    paperSelectionHighlightBtn: getById('paper-selection-highlight-btn'),
    paperSelectionUnderlineBtn: getById('paper-selection-underline-btn'),
    paperSelectionSearchBtn: getById('paper-selection-search-btn'),
    paperSelectionSearchPopover: getById('paper-selection-search-popover'),
    paperSelectionSearchPdfBtn: getById('paper-selection-search-pdf-btn'),
    paperSelectionSearchLibraryBtn: getById('paper-selection-search-library-btn'),
    paperSelectionSearchNav: getById('paper-selection-search-nav'),
    paperSelectionSearchPrevBtn: getById('paper-selection-search-prev-btn'),
    paperSelectionSearchNextBtn: getById('paper-selection-search-next-btn'),
    paperSelectionSearchCount: getById('paper-selection-search-count'),
    paperSelectionSearchResults: getById('paper-selection-search-results'),
    paperSelectionCommentPopover: getById('paper-selection-comment-popover'),
    paperSelectionCommentText: getById('paper-selection-comment-text'),
    paperSelectionCommentSaveBtn: getById('paper-selection-comment-save-btn'),
    paperSelectionCommentCancelBtn: getById('paper-selection-comment-cancel-btn'),
    paperHighlightCommentPopover: getById('paper-highlight-comment-popover')
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
    bookmarksCollapsed: false,
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
    setBookmarksCollapsed(collapsed) {
      const nextValue = Boolean(collapsed);
      if (uiState.bookmarksCollapsed === nextValue) {
        return;
      }
      uiState.bookmarksCollapsed = nextValue;
      context.comments?.renderBookmarkSection?.();
    },
    toggleBookmarksCollapsed() {
      context.setBookmarksCollapsed(!uiState.bookmarksCollapsed);
    },
    getPaperById(paperId) {
      return (state.papers || []).find((paper) => paper.id === paperId) || null;
    },
    getActivePaper() {
      const activePaperId = context.paperViewer.getActivePaperId();
      return (state.papers || []).find((paper) => paper.id === activePaperId) || null;
    },
    async searchSelectedTextInPapers({ scope = 'library', text = '', paperId = '' } = {}) {
      const normalizedScope = String(scope || 'library').trim();
      if (normalizedScope === 'open-paper') {
        const targetPaperId = String(paperId || '').trim();
        if (!targetPaperId || !context.getPaperById(targetPaperId)) {
          return { ok: false, error: 'Paper was not found.' };
        }
        await context.actions?.viewPaperPdf?.(targetPaperId);
        return { ok: true };
      }
      const activePaperId = context.paperViewer?.getActivePaperId?.() || '';
      const matches = searchPaperDatabaseForSelectedText(state.papers || [], text, {
        activePaperId
      });
      return {
        ok: true,
        matches,
        total: matches.length
      };
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
    },
    applyResolvedPdfBookmarks({ paperId = '', bookmarks = [] } = {}) {
      const paper = context.getPaperById(paperId);
      if (!paper) {
        return;
      }
      paper.pdfBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
      context.comments?.renderBookmarkSection?.();
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
    selectionMenu: elements.paperSelectionMenu,
    selectionCommentBtn: elements.paperSelectionCommentBtn,
    selectionHighlightBtn: elements.paperSelectionHighlightBtn,
    selectionUnderlineBtn: elements.paperSelectionUnderlineBtn,
    selectionSearchBtn: elements.paperSelectionSearchBtn,
    selectionSearchPopover: elements.paperSelectionSearchPopover,
    selectionSearchPdfBtn: elements.paperSelectionSearchPdfBtn,
    selectionSearchLibraryBtn: elements.paperSelectionSearchLibraryBtn,
    selectionSearchNav: elements.paperSelectionSearchNav,
    selectionSearchPrevBtn: elements.paperSelectionSearchPrevBtn,
    selectionSearchNextBtn: elements.paperSelectionSearchNextBtn,
    selectionSearchCount: elements.paperSelectionSearchCount,
    selectionSearchResults: elements.paperSelectionSearchResults,
    selectionCommentPopover: elements.paperSelectionCommentPopover,
    selectionCommentText: elements.paperSelectionCommentText,
    selectionCommentSaveBtn: elements.paperSelectionCommentSaveBtn,
    selectionCommentCancelBtn: elements.paperSelectionCommentCancelBtn,
    highlightCommentPopover: elements.paperHighlightCommentPopover,
    onMetadataResolved: (...args) => context.applyResolvedPdfMetadata(...args),
    onBookmarksResolved: (...args) => context.applyResolvedPdfBookmarks(...args),
    onPageChange: (...args) => context.comments?.onViewerPageChange(...args),
    onPlacement: (...args) => context.comments?.onViewerPlacement(...args),
    onPinSelect: (...args) => context.comments?.onViewerPinSelect(...args),
    onHighlightSelection: (...args) => context.createPaperHighlight?.(...args),
    onSelectionComment: (...args) => context.createPaperTextComment?.(...args),
    onSelectionSearch: (...args) => context.searchSelectedTextInPapers?.(...args),
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
  context.createPaperHighlight = ({ pageNumber, text, boxes, pageWidth, pageHeight, kind = 'highlight', commentId = '' } = {}) => {
    const activePaper = context.getActivePaper?.() || null;
    const normalizedText = String(text || '').trim();
    const normalizedPageNumber = Math.max(1, Math.round(Number(pageNumber) || 1));
    const normalizedBoxes = normalizeHighlightBoxes(boxes);
    const normalizedPageWidth = normalizePageDimension(pageWidth);
    const normalizedPageHeight = normalizePageDimension(pageHeight);
    const normalizedKind = String(kind || '').trim().toLowerCase() === 'underline' ? 'underline' : 'highlight';
    const normalizedCommentId = String(commentId || '').trim();
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
      kind: normalizedKind,
      boxes: normalizedBoxes,
      createdAt: now,
      updatedAt: now
    };
    if (normalizedCommentId) {
      highlightRecord.commentId = normalizedCommentId;
    }
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
  context.createPaperTextComment = ({ pageNumber, text, boxes, pageWidth, pageHeight, commentText } = {}) => {
    const activePaper = context.getActivePaper?.() || null;
    const normalizedCommentText = String(commentText || '').trim();
    const normalizedSelectedText = String(text || '').trim();
    const normalizedPageNumber = Math.max(1, Math.round(Number(pageNumber) || 1));
    const normalizedBoxes = normalizeHighlightBoxes(boxes);
    const normalizedPageWidth = normalizePageDimension(pageWidth);
    const normalizedPageHeight = normalizePageDimension(pageHeight);
    const quadPoints = boxesToPdfQuadPoints(normalizedBoxes, {
      pageWidth: normalizedPageWidth,
      pageHeight: normalizedPageHeight
    });

    if (!activePaper || !normalizedCommentText || !normalizedSelectedText || !normalizedBoxes.length) {
      return false;
    }

    const now = new Date().toISOString();
    const commentId = createId();
    const highlightId = createId();
    const commentRecord = {
      id: commentId,
      pageNumber: normalizedPageNumber,
      highlightId,
      text: normalizedCommentText,
      selectedText: normalizedSelectedText,
      author: String(
        state.settings?.personalInfo?.name
        || state.settings?.personalInfo?.enanaEmail
        || 'Local user'
      ).trim() || 'Local user',
      createdAt: now,
      updatedAt: now
    };
    const highlightRecord = {
      id: highlightId,
      pageNumber: normalizedPageNumber,
      text: normalizedSelectedText,
      kind: 'highlight',
      commentId,
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
    if (!Array.isArray(activePaper.comments)) {
      activePaper.comments = [];
    }
    activePaper.comments.push(commentRecord);
    activePaper.updatedAt = now;
    persist();
    context.comments?.syncViewerComments?.();
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
        ? 'Unfold paper details panel from the right'
        : 'Fold paper details panel to the right';
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
