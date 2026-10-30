import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("papers");
import { ensurePaperComments } from './model.js';
import { getPaperDetailsMetadata } from './pdf-metadata.js';
import { paperMessage } from './localization.js';

const PAPER_SUMMARY_FIELDS = ['title', 'author', 'year', 'journal', 'doi', 'url'];

export function createPapersCommentController(context) {
  const {
    safeText,
    paperViewer,
    commentState,
    uiState,
    elements
  } = context;

  function getActivePaper() {
    return context.getActivePaper?.() || null;
  }

  function clearCommentDraft() {
    commentState.selectedCommentId = '';
  }

  function syncViewerComments() {
    const activePaper = getActivePaper();
    paperViewer.setComments(activePaper ? ensurePaperComments(activePaper) : []);
    context.syncViewerHighlights?.();
    paperViewer.setSelectedCommentId(commentState.selectedCommentId);
    paperViewer.setPlacementMode(false);
  }

  function renderSummarySection() {
    const activePaper = getActivePaper();
    const summary = getPaperDetailsMetadata(activePaper);
    const collapsed = Boolean(uiState.summaryCollapsed);

    if (elements.paperSummarySection) {
      elements.paperSummarySection.classList.toggle('is-disabled', !activePaper);
    }
    if (elements.paperSummaryContent) {
      elements.paperSummaryContent.hidden = collapsed;
    }
    if (elements.paperSummaryToggleBtn) {
      const label = collapsed ? 'Show paper summary' : 'Hide paper summary';
      elements.paperSummaryToggleBtn.classList.toggle('is-collapsed', collapsed);
      elements.paperSummaryToggleBtn.setAttribute?.('aria-expanded', String(!collapsed));
      elements.paperSummaryToggleBtn.setAttribute?.('aria-label', label);
      i18nUi.setAttribute(elements.paperSummaryToggleBtn, "title", label);
    }
    if (!elements.paperSummaryList) {
      return;
    }

    if (!activePaper) {
      i18nUi.setHtml(elements.paperSummaryList, `<div class="papers-summary-row"><dt>${paperMessage('details.paper')}</dt><dd>${paperMessage('details.empty')}</dd></div>`);
      return;
    }

    i18nUi.setHtml(elements.paperSummaryList, PAPER_SUMMARY_FIELDS.map((key) => {
      const value = String(summary[key] || '').trim();
      return `
        <div class="papers-summary-row">
          <dt>${paperMessage(`details.${key}`)}</dt>
          <dd class="papers-summary-value${value ? '' : ' is-empty'}">${value ? safeText(value) : paperMessage('details.missing')}</dd>
        </div>
      `;
    }).join(''));
  }

  function renderBookmarkItem(bookmark, level = 0) {
    const pageNumber = Math.max(0, Math.round(Number(bookmark?.pageNumber) || 0));
    const url = String(bookmark?.url || '').trim();
    const title = String(bookmark?.title || '').trim();
    const children = Array.isArray(bookmark?.items) ? bookmark.items : [];
    const actionAttrs = pageNumber
      ? `data-paper-bookmark-page="${safeText(String(pageNumber))}"`
      : url
        ? `data-paper-bookmark-url="${safeText(url)}"`
        : 'disabled';
    return `
      <button
        type="button"
        class="papers-bookmark-item"
        style="padding-left: ${Math.min(Math.max(level, 0), 6) * 12 + 6}px"
        ${actionAttrs}
      >
        <span class="papers-bookmark-title">${title ? safeText(title) : paperMessage('bookmarks.untitled')}</span>
        <span class="papers-bookmark-page">${pageNumber ? paperMessage('bookmarks.page', { page: pageNumber }) : (url ? paperMessage('bookmarks.link') : '')}</span>
      </button>
      ${children.map((child) => renderBookmarkItem(child, level + 1)).join('')}
    `;
  }

  function renderBookmarkSection() {
    const activePaper = getActivePaper();
    const bookmarks = Array.isArray(activePaper?.pdfBookmarks) ? activePaper.pdfBookmarks : [];

    if (elements.paperBookmarkSection) {
      elements.paperBookmarkSection.classList.toggle('is-disabled', !activePaper);
    }
    if (!elements.paperBookmarkList) {
      return;
    }

    if (!activePaper) {
      i18nUi.setHtml(elements.paperBookmarkList, `<p class="papers-bookmark-empty">${paperMessage('bookmarks.empty')}</p>`);
      return;
    }
    if (!bookmarks.length) {
      i18nUi.setHtml(elements.paperBookmarkList, `<p class="papers-bookmark-empty">${paperMessage('bookmarks.none')}</p>`);
      return;
    }
    i18nUi.setHtml(elements.paperBookmarkList, bookmarks.map((bookmark) => renderBookmarkItem(bookmark)).join(''));
  }

  function renderCommentSidebar() {
    commentState.currentPageNumber = getActivePaper()
      ? Math.max(1, paperViewer.getCurrentPageNumber() || commentState.currentPageNumber || 1)
      : 1;
    elements.paperCommentSidebar?.classList?.toggle('is-disabled', !getActivePaper());
    renderBookmarkSection();
    renderSummarySection();
    context.renderResearchBrief?.();
  }

  function resetCommentComposer() {
    clearCommentDraft();
    syncViewerComments();
    renderCommentSidebar();
  }

  function onViewerClose() {
    commentState.currentPageNumber = 1;
    resetCommentComposer();
    context.renderLibrarySidebar?.(context.libraryState.selectedFolderKey);
  }

  function onViewerPageChange(pageNumber) {
    commentState.currentPageNumber = Math.max(1, Math.round(Number(pageNumber) || 1));
    renderCommentSidebar();
  }

  function onViewerPinSelect(comment) {
    commentState.selectedCommentId = String(comment?.id || '').trim();
    syncViewerComments();
  }

  function onBookmarkListClick(event) {
    const target = event?.target?.closest?.('[data-paper-bookmark-page], [data-paper-bookmark-url]');
    if (!target) {
      return;
    }
    const pageNumber = Math.max(0, Math.round(Number(target.dataset.paperBookmarkPage) || 0));
    const url = String(target.dataset.paperBookmarkUrl || '').trim();
    if (pageNumber) {
      paperViewer.goToPage?.(pageNumber, { behavior: 'smooth' });
    } else if (url) {
      void paperViewer.openExternalUrl?.(url);
    }
  }

  function primeForPaperOpen() {
    clearCommentDraft();
    commentState.currentPageNumber = 1;
  }

  function bindEvents() {
    elements.paperBookmarkList?.addEventListener('click', onBookmarkListClick);
    elements.paperSummaryToggleBtn?.addEventListener('click', () => {
      context.toggleSummaryCollapsed?.();
    });
  }

  return {
    bindEvents,
    onViewerClose,
    onViewerPageChange,
    onViewerPinSelect,
    renderCommentSidebar,
    renderBookmarkSection,
    resetCommentComposer,
    clearCommentDraft,
    syncViewerComments,
    primeForPaperOpen,
    renderSummarySection
  };
}
