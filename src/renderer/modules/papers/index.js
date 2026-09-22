import { createPapersPdfViewer } from './pdf-viewer/index.js';
import { printPdfBytes } from '../print/index.js';
import { createPapersActions } from './actions.js';
import { createPapersCommentController } from './comments.js';
import { createPapersLibraryController } from './library.js';
import { ensurePaperHighlights } from './model.js';
import { normalizePaperSummary } from './normalizers.js';
import { bindFileDropTarget } from '../../lib/file-drop.js';
import { boxesToPdfQuadPoints, normalizeHighlightBoxes, normalizePageDimension } from './pdf-viewer/pdf-viewer-geometry.js';
import { getPaperDisplayTitle, hasPaperPdfMetadata, normalizePaperPdfMetadata } from './pdf-metadata.js';
import { showTransientNotice } from '../../lib/notify.js';
import { createDiscoveryMerge } from './management/discovery-merge.js';
import { createStoredPaperDiscovery } from './management/discover-stored.js';
import { createExternalLinkOpener } from './management/external-links.js';
import { getPapersElements } from './management/elements.js';
import { searchPaperDatabaseForSelectedText } from './management/paper-search-text.js';
import { createPaperResearchBrief } from './research-brief.js';
import { createPapersWorkspaceControls } from './workspace-controls.js';

export function initPapersManagement({
  state,
  persist,
  createId,
  safeText,
  onCreateProtocolDraft,
  onActivePaperChanged = () => {},
  onAskSelectedText = () => {},
  document: providedDocument = null,
  window: providedWindow = null,
  createPdfViewer = createPapersPdfViewer
}) {
  const documentRef = providedDocument || (typeof document !== 'undefined' ? document : null);
  const windowRef = providedWindow || (typeof window !== 'undefined' ? window : null);
  const elements = getPapersElements(documentRef);
  const commentState = {
    currentPageNumber: 1,
    selectedCommentId: ''
  };
  const libraryState = {
    selectedFolderKey: '',
    expandedFolderKeys: new Set()
  };
  const libraryContextState = {
    folderKey: '',
    folderId: '',
    folderType: '',
    paperId: ''
  };
  const uiState = {
    commentsCollapsed: true,
    contextPanel: 'outline',
    summaryCollapsed: false
  };

  // Intake only ever runs inside a session, so a paper still marked 'running' at
  // boot is left over from a quit or a crash. Clearing it keeps the Processing
  // badge from sticking on a row nothing is working on.
  (state.papers || []).forEach((paper) => {
    if (paper?.ingestionStatus === 'running') {
      paper.ingestionStatus = 'uploaded';
    }
  });



  const { openPdfExternalWebsite } = createExternalLinkOpener({ windowRef });

  const {
    mergeDiscoveredJournalClubs,
    mergeDiscoveredPapers
  } = createDiscoveryMerge({ state });

  const context = {
    state,
    persist,
    createId,
    safeText,
    onCreateProtocolDraft,
    onActivePaperChanged,
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
    askAgentAboutSelection(selection = {}) {
      const selectedText = String(selection?.text || '').replace(/\s+/g, ' ').trim();
      if (!selectedText || typeof onAskSelectedText !== 'function') {
        return false;
      }
      const activePaper = context.getActivePaper?.() || context.getPaperById?.(selection?.paperId) || null;
      const didOpen = onAskSelectedText({
        text: selectedText,
        pageNumber: Math.max(1, Math.round(Number(selection?.pageNumber) || 1)),
        paperId: String(selection?.paperId || activePaper?.id || '').trim(),
        paperTitle: getPaperDisplayTitle(activePaper || {
          title: selection?.paperTitle,
          fileName: selection?.paperTitle
        }),
        selection
      });
      return didOpen !== false;
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
    printBtn: elements.paperViewerPrintBtn,
    saveFormBtn: elements.paperViewerSaveFormBtn,
    selectionMenu: elements.paperSelectionMenu,
    selectionCommentBtn: elements.paperSelectionCommentBtn,
    selectionHighlightBtn: elements.paperSelectionHighlightBtn,
    selectionUnderlineBtn: elements.paperSelectionUnderlineBtn,
    selectionSearchBtn: elements.paperSelectionSearchBtn,
    selectionAskBtn: elements.paperSelectionAskBtn,
    selectionCopyBtn: elements.paperSelectionCopyBtn,
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
    onPinSelect: (...args) => context.comments?.onViewerPinSelect(...args),
    onHighlightSelection: (...args) => context.createPaperHighlight?.(...args),
    onSelectionComment: (...args) => context.createPaperTextComment?.(...args),
    onSelectionSearch: (...args) => context.searchSelectedTextInPapers?.(...args),
    onSelectionAsk: (...args) => context.askAgentAboutSelection?.(...args),
    onExternalLink: openPdfExternalWebsite,
    onClose: (...args) => {
      context.comments?.onViewerClose(...args);
      context.onActivePaperChanged?.(null);
    }
  });

  context.paperViewer = paperViewer;

  const comments = createPapersCommentController(context);
  context.comments = comments;

  const actions = createPapersActions(context);
  context.actions = actions;

  const library = createPapersLibraryController(context);
  context.library = library;

  const { maybeDiscoverStoredPapers } = createStoredPaperDiscovery({
    state,
    elements,
    windowRef,
    library,
    comments,
    mergeDiscoveredJournalClubs,
    mergeDiscoveredPapers,
    persist
  });


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
        || state.settings?.personalInfo?.hikariEmail
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
    const briefOpen = !collapsed && uiState.contextPanel === 'brief';
    const detailsOpen = !collapsed && uiState.contextPanel === 'details';
    const outlineOpen = !collapsed && (uiState.contextPanel || 'outline') === 'outline';
    elements.papersLayout?.classList?.toggle('is-comments-collapsed', collapsed);
    elements.papersRightColumn?.classList?.toggle('is-collapsed', collapsed);
    if (elements.paperCommentSidebar) {
      elements.paperCommentSidebar.hidden = !outlineOpen;
    }
    if (elements.paperCommentToggleBtn) {
      const label = !outlineOpen
        ? 'Open outline & bookmarks'
        : 'Close outline & bookmarks';
      elements.paperCommentToggleBtn.classList?.toggle('is-collapsed', !outlineOpen);
      elements.paperCommentToggleBtn.setAttribute?.('aria-expanded', String(outlineOpen));
      elements.paperCommentToggleBtn.setAttribute?.('aria-label', label);
      elements.paperCommentToggleBtn.title = label;
    }
    if (elements.paperDetailsSidebar) elements.paperDetailsSidebar.hidden = !detailsOpen;
    if (elements.paperDetailsToggleBtn) {
      const label = detailsOpen ? 'Close paper details' : 'Open paper details';
      elements.paperDetailsToggleBtn.setAttribute('aria-expanded', String(detailsOpen));
      elements.paperDetailsToggleBtn.setAttribute('aria-label', label);
      elements.paperDetailsToggleBtn.title = label;
    }
    if (detailsOpen) context.renderSummarySection();
    if (elements.paperResearchBrief) elements.paperResearchBrief.hidden = !briefOpen;
    if (elements.paperBriefToggleBtn) {
      const label = briefOpen ? 'Close research brief' : 'Open research brief';
      elements.paperBriefToggleBtn.setAttribute('aria-expanded', String(briefOpen));
      elements.paperBriefToggleBtn.setAttribute('aria-label', label);
      elements.paperBriefToggleBtn.title = label;
    }
    context.renderResearchBrief?.();
    context.syncWorkspaceControls?.();
  };
  context.render = () => {
    context.renderCommentPanelState();
    library.renderLibrarySidebar();
    context.syncViewerHighlights();
    comments.renderCommentSidebar();
    library.schedulePapersEdgeBleedSync();
    void maybeDiscoverStoredPapers();
  };

  context.renderResearchBrief = createPaperResearchBrief(context).render;
  createPapersWorkspaceControls(context);

  elements.paperViewerPrintBtn?.addEventListener('click', async () => {
    const activePaper = context.getActivePaper?.() || null;
    if (!activePaper) {
      return;
    }
    try {
      const bytes = await actions.resolvePaperPdfBytes(activePaper);
      if (!bytes) {
        return;
      }
      printPdfBytes(bytes, { title: getPaperDisplayTitle(activePaper) || 'Paper' });
    } catch (error) {
      showTransientNotice(String(error?.message || error || 'Failed to open the PDF for printing.'), { type: 'error' });
    }
  });

  elements.paperViewerSaveFormBtn?.addEventListener('click', async () => {
    const activePaper = context.getActivePaper?.() || null;
    if (!activePaper) {
      return;
    }
    await actions.saveFilledPaperPdf(activePaper);
  });

  bindFileDropTarget({
    target: elements.paperViewerShell,
    accept: elements.paperPdfInput?.getAttribute?.('accept') || 'application/pdf,.pdf',
    multiple: false,
    onFiles: async (files) => {
      await actions.uploadAndViewPaperFile(files[0]);
    },
    onRejected: () => {
      showTransientNotice('Drop one PDF file to import and view it.', { type: 'error' });
    },
    onError: (error) => {
      showTransientNotice(String(error?.message || error || 'Failed to open dropped PDF.'), { type: 'error' });
    }
  });

  actions.bindEvents();
  comments.bindEvents();
  library.bindEvents();
  library.observeViewActivation();
  context.renderCommentPanelState();

  return {
    getActivePaperId: () => paperViewer.getActivePaperId(),
    startPaperScreenshotSelection: () => paperViewer.startPaperScreenshotSelection?.(),
    render: context.render,
    renderLinkTargets: library.renderLinkTargets
  };
}

export { normalizePaperSummary };

export {
  normalizePaperSelectionSearchText,
  collectPaperDatabaseSearchValues,
  searchPaperDatabaseForSelectedText
} from './management/paper-search-text.js';
