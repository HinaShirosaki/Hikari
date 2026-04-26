import {
  ensurePaperComments,
  getPaperCommentCount,
  getCommentsForPage,
  getCommentAuthorLabel
} from './model.js';
import { normalizePaperPdfMetadata } from './pdf-metadata.js';

const PAPER_SUMMARY_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'year', label: 'Year' },
  { key: 'journal', label: 'Journal' },
  { key: 'doi', label: 'DOI' },
  { key: 'url', label: 'URL' }
];

export function createPapersCommentController(context) {
  const {
    state,
    persist,
    createId,
    safeText,
    paperViewer,
    commentState,
    uiState,
    elements
  } = context;

  function getActivePaper() {
    return context.getActivePaper?.() || null;
  }

  function clearCommentDraft({ keepText = false } = {}) {
    commentState.mode = 'idle';
    commentState.selectedCommentId = '';
    commentState.draftPageNumber = 0;
    commentState.draftAnchorX = Number.NaN;
    commentState.draftAnchorY = Number.NaN;
    if (!keepText && elements.paperCommentText) {
      elements.paperCommentText.value = '';
    }
  }

  function syncViewerComments() {
    const activePaper = getActivePaper();
    paperViewer.setComments(activePaper ? ensurePaperComments(activePaper) : []);
    context.syncViewerHighlights?.();
    paperViewer.setSelectedCommentId(commentState.selectedCommentId);
    paperViewer.setPlacementMode(commentState.mode === 'placing');
  }

  function setCommentStatus(message) {
    if (!elements.paperCommentStatus) {
      return;
    }
    elements.paperCommentStatus.textContent = String(message || '').trim();
  }

  function renderSummarySection() {
    const activePaper = getActivePaper();
    const summary = normalizePaperPdfMetadata(activePaper?.pdfMetadata || null);
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
      elements.paperSummaryToggleBtn.title = label;
    }
    if (!elements.paperSummaryList) {
      return;
    }

    elements.paperSummaryList.innerHTML = PAPER_SUMMARY_FIELDS.map(({ key, label }) => {
      const value = String(summary[key] || '').trim();
      return `
        <div class="papers-summary-row">
          <dt>${safeText(label)}</dt>
          <dd class="papers-summary-value${value ? '' : ' is-empty'}">${safeText(value)}</dd>
        </div>
      `;
    }).join('');
  }

  function renderCommentSidebar() {
    const activePaper = getActivePaper();
    const currentPageNumber = activePaper ? Math.max(1, paperViewer.getCurrentPageNumber() || commentState.currentPageNumber || 1) : 0;
    const currentPageComments = activePaper ? getCommentsForPage(activePaper, currentPageNumber) : [];
    commentState.currentPageNumber = currentPageNumber || 1;

    renderSummarySection();

    elements.paperCommentSidebar?.classList?.toggle('is-disabled', !activePaper);
    if (elements.paperCommentPage) {
      elements.paperCommentPage.textContent = activePaper ? `Page ${currentPageNumber}` : 'Page 0';
    }
    if (elements.paperCommentCount) {
      const count = currentPageComments.length;
      elements.paperCommentCount.textContent = activePaper
        ? `${count} comment${count === 1 ? '' : 's'} on this page`
        : '0 comments on this page';
    }
    if (elements.paperCommentAddBtn) {
      elements.paperCommentAddBtn.disabled = !activePaper;
    }
    if (elements.paperCommentSaveBtn) {
      const hasDraftLocation = Number.isFinite(commentState.draftAnchorX)
        && Number.isFinite(commentState.draftAnchorY)
        && commentState.draftPageNumber > 0;
      elements.paperCommentSaveBtn.disabled = !activePaper
        || !hasDraftLocation
        || !String(elements.paperCommentText?.value || '').trim();
    }
    if (elements.paperCommentCancelBtn) {
      elements.paperCommentCancelBtn.disabled = commentState.mode === 'idle';
    }
    if (elements.paperCommentDeleteBtn) {
      elements.paperCommentDeleteBtn.disabled = commentState.mode !== 'editing' || !commentState.selectedCommentId;
    }
    if (elements.paperCommentText) {
      elements.paperCommentText.disabled = !activePaper || commentState.mode === 'idle' || commentState.mode === 'placing';
    }

    if (!elements.paperCommentList) {
      return;
    }

    if (!activePaper) {
      elements.paperCommentList.innerHTML = '';
      if (!String(elements.paperCommentStatus?.textContent || '').trim()) {
        setCommentStatus('');
      }
      return;
    }

    if (!String(elements.paperCommentStatus?.textContent || '').trim()) {
      setCommentStatus(`Viewing page ${currentPageNumber}. Select a comment or place a new pin.`);
    }

    if (!currentPageComments.length) {
      elements.paperCommentList.innerHTML = `<p class="small-note">No comments on page ${safeText(String(currentPageNumber))} yet.</p>`;
      return;
    }

    elements.paperCommentList.innerHTML = currentPageComments.map((comment) => `
      <button
        type="button"
        class="papers-comment-card${comment.id === commentState.selectedCommentId ? ' is-active' : ''}"
        data-paper-comment-select="${safeText(comment.id)}"
      >
        <p><strong>${safeText(comment.author || 'Local user')}</strong></p>
        <p>${safeText(comment.text || '')}</p>
        <p class="small-note">${safeText(new Date(comment.updatedAt || comment.createdAt || '').toLocaleString() || 'Saved comment')}</p>
      </button>
    `).join('');

    elements.paperCommentList.querySelectorAll('[data-paper-comment-select]').forEach((button) => {
      button.addEventListener('click', () => {
        selectCommentForEdit(button.dataset.paperCommentSelect);
      });
    });
  }

  function resetCommentComposer(options = {}) {
    clearCommentDraft({ keepText: options.keepText === true });
    syncViewerComments();
    if (options.message) {
      setCommentStatus(options.message);
    }
    renderCommentSidebar();
  }

  function onViewerClose() {
    commentState.currentPageNumber = 1;
    resetCommentComposer({
      message: ''
    });
    context.renderLibrarySidebar?.(context.libraryState.selectedFolderKey);
  }

  function onViewerPageChange(pageNumber) {
    commentState.currentPageNumber = Math.max(1, Math.round(Number(pageNumber) || 1));
    if (
      (commentState.mode === 'editing' || commentState.mode === 'draft')
      && commentState.draftPageNumber
      && commentState.draftPageNumber !== commentState.currentPageNumber
    ) {
      resetCommentComposer({
        message: `Moved to page ${commentState.currentPageNumber}. Select a comment on this page or place a new pin.`
      });
      return;
    }
    if (commentState.mode === 'placing') {
      setCommentStatus(`Click page ${commentState.currentPageNumber} to place a comment pin.`);
    }
    renderCommentSidebar();
  }

  function onViewerPlacement({ pageNumber, anchorX, anchorY } = {}) {
    const activePaper = getActivePaper();
    if (!activePaper) {
      return;
    }
    commentState.mode = 'draft';
    commentState.selectedCommentId = '';
    commentState.draftPageNumber = Math.max(1, Math.round(Number(pageNumber) || commentState.currentPageNumber || 1));
    commentState.draftAnchorX = Number(anchorX);
    commentState.draftAnchorY = Number(anchorY);
    paperViewer.setPlacementMode(false);
    paperViewer.setSelectedCommentId('');
    if (elements.paperCommentText) {
      elements.paperCommentText.value = '';
      elements.paperCommentText.disabled = false;
      elements.paperCommentText.focus?.();
    }
    setCommentStatus(`Pin placed on page ${commentState.draftPageNumber}. Add your note and save it.`);
    renderCommentSidebar();
  }

  function onViewerPinSelect(comment) {
    selectCommentForEdit(comment?.id || '');
  }

  function beginCommentPlacement() {
    const activePaper = getActivePaper();
    if (!activePaper) {
      setCommentStatus('Open a paper before adding comments.');
      return;
    }
    commentState.mode = 'placing';
    commentState.selectedCommentId = '';
    commentState.draftPageNumber = 0;
    commentState.draftAnchorX = Number.NaN;
    commentState.draftAnchorY = Number.NaN;
    if (elements.paperCommentText) {
      elements.paperCommentText.value = '';
    }
    syncViewerComments();
    setCommentStatus(`Click page ${commentState.currentPageNumber} to place a comment pin.`);
    renderCommentSidebar();
  }

  function selectCommentForEdit(commentId) {
    const activePaper = getActivePaper();
    if (!activePaper) {
      return;
    }
    const comment = ensurePaperComments(activePaper).find((item) => item.id === commentId);
    if (!comment) {
      return;
    }
    commentState.mode = 'editing';
    commentState.selectedCommentId = comment.id;
    commentState.draftPageNumber = comment.pageNumber;
    commentState.draftAnchorX = Number(comment.anchorX);
    commentState.draftAnchorY = Number(comment.anchorY);
    if (elements.paperCommentText) {
      elements.paperCommentText.value = String(comment.text || '');
      elements.paperCommentText.disabled = false;
      elements.paperCommentText.focus?.();
    }
    syncViewerComments();
    setCommentStatus(`Editing comment on page ${comment.pageNumber}.`);
    renderCommentSidebar();
  }

  function savePaperComment() {
    const activePaper = getActivePaper();
    const text = String(elements.paperCommentText?.value || '').trim();
    if (!activePaper) {
      setCommentStatus('Open a paper before saving comments.');
      return;
    }
    if (!text) {
      setCommentStatus('Write a comment before saving.');
      renderCommentSidebar();
      return;
    }
    if (!Number.isFinite(commentState.draftAnchorX) || !Number.isFinite(commentState.draftAnchorY) || !commentState.draftPageNumber) {
      setCommentStatus('Place a comment pin before saving.');
      renderCommentSidebar();
      return;
    }

    const comments = ensurePaperComments(activePaper);
    const now = new Date().toISOString();
    let savedComment = null;
    if (commentState.mode === 'editing' && commentState.selectedCommentId) {
      savedComment = comments.find((comment) => comment.id === commentState.selectedCommentId) || null;
      if (!savedComment) {
        setCommentStatus('The selected comment no longer exists.');
        resetCommentComposer();
        return;
      }
      savedComment.pageNumber = commentState.draftPageNumber;
      savedComment.anchorX = commentState.draftAnchorX;
      savedComment.anchorY = commentState.draftAnchorY;
      savedComment.text = text;
      savedComment.author = getCommentAuthorLabel(state);
      savedComment.updatedAt = now;
    } else {
      savedComment = {
        id: createId(),
        pageNumber: commentState.draftPageNumber,
        anchorX: commentState.draftAnchorX,
        anchorY: commentState.draftAnchorY,
        text,
        author: getCommentAuthorLabel(state),
        createdAt: now,
        updatedAt: now
      };
      comments.push(savedComment);
    }

    activePaper.updatedAt = now;
    persist();
    context.renderLibrarySidebar?.();
    syncViewerComments();
    selectCommentForEdit(savedComment.id);
    setCommentStatus(`Saved comment on page ${savedComment.pageNumber}.`);
    renderCommentSidebar();
  }

  function cancelPaperComment() {
    const activePaper = getActivePaper();
    resetCommentComposer({
      message: activePaper
        ? `Viewing page ${commentState.currentPageNumber}. Select a comment or place a new pin.`
        : ''
    });
  }

  function deleteSelectedPaperComment() {
    const activePaper = getActivePaper();
    if (!activePaper || !commentState.selectedCommentId) {
      setCommentStatus('Select a saved comment before deleting.');
      renderCommentSidebar();
      return;
    }
    const previousCount = getPaperCommentCount(activePaper);
    activePaper.comments = ensurePaperComments(activePaper).filter((comment) => comment.id !== commentState.selectedCommentId);
    if (activePaper.comments.length === previousCount) {
      setCommentStatus('The selected comment no longer exists.');
      resetCommentComposer();
      return;
    }
    activePaper.updatedAt = new Date().toISOString();
    persist();
    context.renderLibrarySidebar?.();
    resetCommentComposer({
      message: `Deleted comment from page ${commentState.currentPageNumber}.`
    });
  }

  function primeForPaperOpen() {
    clearCommentDraft();
    commentState.currentPageNumber = 1;
    if (elements.paperCommentText) {
      elements.paperCommentText.value = '';
    }
  }

  function bindEvents() {
    elements.paperSummaryToggleBtn?.addEventListener('click', () => {
      context.toggleSummaryCollapsed?.();
    });
    elements.paperCommentAddBtn?.addEventListener('click', beginCommentPlacement);
    elements.paperCommentSaveBtn?.addEventListener('click', savePaperComment);
    elements.paperCommentCancelBtn?.addEventListener('click', cancelPaperComment);
    elements.paperCommentDeleteBtn?.addEventListener('click', deleteSelectedPaperComment);
    elements.paperCommentText?.addEventListener('input', renderCommentSidebar);
  }

  return {
    bindEvents,
    onViewerClose,
    onViewerPageChange,
    onViewerPlacement,
    onViewerPinSelect,
    beginCommentPlacement,
    savePaperComment,
    cancelPaperComment,
    deleteSelectedPaperComment,
    renderCommentSidebar,
    resetCommentComposer,
    clearCommentDraft,
    syncViewerComments,
    setCommentStatus,
    selectCommentForEdit,
    primeForPaperOpen,
    renderSummarySection
  };
}
