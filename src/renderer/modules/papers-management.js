import { createPapersPdfViewer } from './papers-pdf-viewer.js';

export function initPapersManagement({
  state,
  persist,
  createId,
  safeText,
  onCreateProtocolDraft,
  createPdfViewer = createPapersPdfViewer
}) {
  const paperForm = document.getElementById('paper-form');
  const paperTitleInput = document.getElementById('paper-title');
  const paperPdfInput = document.getElementById('paper-pdf');
  const paperLinkTypeSelect = document.getElementById('paper-link-type');
  const paperLinkTargetSelect = document.getElementById('paper-link-target');
  const paperList = document.getElementById('paper-list');
  const papersView = document.getElementById('papers-view');
  const paperFolderSelection = document.getElementById('paper-folder-selection');
  const paperUploadTargetLabel = document.getElementById('paper-upload-target-label');
  const paperCommentSidebar = document.getElementById('paper-comment-sidebar');
  const paperCommentPage = document.getElementById('paper-comment-page');
  const paperCommentCount = document.getElementById('paper-comment-count');
  const paperCommentAddBtn = document.getElementById('paper-comment-add-btn');
  const paperCommentSaveBtn = document.getElementById('paper-comment-save-btn');
  const paperCommentCancelBtn = document.getElementById('paper-comment-cancel-btn');
  const paperCommentDeleteBtn = document.getElementById('paper-comment-delete-btn');
  const paperCommentText = document.getElementById('paper-comment-text');
  const paperCommentStatus = document.getElementById('paper-comment-status');
  const paperCommentList = document.getElementById('paper-comment-list');
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
  const paperViewer = createPdfViewer({
    shell: document.getElementById('paper-viewer-shell'),
    emptyState: document.getElementById('paper-viewer-empty'),
    workspace: document.getElementById('paper-viewer-workspace'),
    stage: document.getElementById('paper-viewer-stage'),
    pageLayer: document.getElementById('paper-viewer-page-layer'),
    canvas: document.getElementById('paper-viewer-canvas'),
    overlay: document.getElementById('paper-viewer-overlay'),
    title: document.getElementById('paper-viewer-title'),
    meta: document.getElementById('paper-viewer-meta'),
    status: document.getElementById('paper-viewer-status'),
    toolbar: document.getElementById('paper-viewer-toolbar'),
    prevBtn: document.getElementById('paper-viewer-prev-btn'),
    nextBtn: document.getElementById('paper-viewer-next-btn'),
    pageInput: document.getElementById('paper-viewer-page-input'),
    pageCount: document.getElementById('paper-viewer-page-count'),
    zoomOutBtn: document.getElementById('paper-viewer-zoom-out-btn'),
    zoomInBtn: document.getElementById('paper-viewer-zoom-in-btn'),
    zoomResetBtn: document.getElementById('paper-viewer-zoom-reset-btn'),
    fitWidthBtn: document.getElementById('paper-viewer-fit-width-btn'),
    zoomLabel: document.getElementById('paper-viewer-zoom-label'),
    openExternalBtn: document.getElementById('paper-viewer-open-btn'),
    closeBtn: document.getElementById('paper-viewer-close-btn'),
    onPageChange: onViewerPageChange,
    onPlacement: onViewerPlacement,
    onPinSelect: onViewerPinSelect,
    onClose: onViewerClose
  });

  const journalClubNameInput = document.getElementById('journal-club-name');
  const journalClubDescriptionInput = document.getElementById('journal-club-description');
  const journalClubAddBtn = document.getElementById('journal-club-add-btn');
  const journalClubList = document.getElementById('journal-club-list');

  paperForm.addEventListener('submit', onPaperSubmit);
  paperLinkTypeSelect.addEventListener('change', renderLinkTargets);
  journalClubAddBtn.addEventListener('click', onAddJournalClub);
  journalClubList?.addEventListener('click', onFolderListClick);
  paperList.addEventListener('click', onPaperListClick);
  paperCommentAddBtn?.addEventListener('click', beginCommentPlacement);
  paperCommentSaveBtn?.addEventListener('click', savePaperComment);
  paperCommentCancelBtn?.addEventListener('click', cancelPaperComment);
  paperCommentDeleteBtn?.addEventListener('click', deleteSelectedPaperComment);
  paperCommentText?.addEventListener('input', renderCommentSidebar);
  if (typeof window?.addEventListener === 'function') {
    window.addEventListener('resize', schedulePapersEdgeBleedSync);
  }
  if (papersView && typeof MutationObserver === 'function') {
    const papersViewObserver = new MutationObserver(() => {
      if (papersView.classList?.contains('is-active')) {
        schedulePapersEdgeBleedSync();
      }
    });
    papersViewObserver.observe(papersView, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  function getCurrentLinkOptions() {
    if (paperLinkTypeSelect.value === 'journal-club') {
      return (state.journalClubs || []).map((club) => ({
        id: club.id,
        name: club.name
      }));
    }

    return (state.projects || []).map((project) => ({
      id: project.id,
      name: project.name
    }));
  }

  function syncPapersEdgeBleed() {
    if (!papersView?.style || typeof papersView.getBoundingClientRect !== 'function') {
      return;
    }

    const rect = papersView.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      papersView.style.setProperty('--papers-edge-bleed-left', '0px');
      papersView.style.setProperty('--papers-edge-bleed-right', '0px');
      return;
    }

    const workspaceMain = typeof papersView.closest === 'function'
      ? papersView.closest('.workspace-main')
      : null;
    const workspaceRect = typeof workspaceMain?.getBoundingClientRect === 'function'
      ? workspaceMain.getBoundingClientRect()
      : null;
    const appSidebar = typeof document.querySelector === 'function'
      ? document.querySelector('.app-sidebar')
      : null;
    const sidebarRect = typeof appSidebar?.getBoundingClientRect === 'function'
      ? appSidebar.getBoundingClientRect()
      : null;
    const sidebarVisible = Boolean(
      appSidebar
      && sidebarRect
      && sidebarRect.width > 0
      && (typeof window?.getComputedStyle !== 'function' || window.getComputedStyle(appSidebar).display !== 'none')
    );

    const viewportWidth = Number(window?.innerWidth) || 0;
    const leftEdge = sidebarVisible && workspaceRect ? workspaceRect.left : 0;
    const rightEdge = sidebarVisible && workspaceRect
      ? workspaceRect.right
      : (viewportWidth > 0 ? viewportWidth : (workspaceRect?.right || rect.right));

    const leftBleed = Math.max(0, rect.left - leftEdge);
    const rightBleed = Math.max(0, rightEdge - rect.right);

    papersView.style.setProperty('--papers-edge-bleed-left', `${Math.round(leftBleed)}px`);
    papersView.style.setProperty('--papers-edge-bleed-right', `${Math.round(rightBleed)}px`);
  }

  function schedulePapersEdgeBleedSync() {
    syncPapersEdgeBleed();
    if (typeof window?.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        syncPapersEdgeBleed();
      });
    }
  }

  function buildFolderKey(type, id) {
    const normalizedType = type === 'journal-club' ? 'journal-club' : 'project';
    const normalizedId = String(id || '').trim();
    return normalizedId ? `${normalizedType}:${normalizedId}` : '';
  }

  function getLibraryFolders() {
    const projectFolders = (state.projects || [])
      .map((project) => ({
        key: buildFolderKey('project', project.id),
        id: project.id,
        type: 'project',
        name: String(project.name || 'Untitled project').trim() || 'Untitled project',
        description: '',
        removable: false
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    const journalClubFolders = (state.journalClubs || [])
      .map((club) => ({
        key: buildFolderKey('journal-club', club.id),
        id: club.id,
        type: 'journal-club',
        name: String(club.name || 'Untitled journal club').trim() || 'Untitled journal club',
        description: String(club.description || '').trim(),
        removable: true
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return [...projectFolders, ...journalClubFolders];
  }

  function getFolderForPaper(paper) {
    const folderKey = buildFolderKey(paper?.linkedType, paper?.linkedId);
    return getLibraryFolders().find((folder) => folder.key === folderKey) || null;
  }

  function syncSelectedFolder(preferredKey = '') {
    const folders = getLibraryFolders();
    const selectedFolder = folders.find((folder) => folder.key === preferredKey)
      || folders.find((folder) => folder.key === libraryState.selectedFolderKey)
      || folders.find((folder) => folder.key === buildFolderKey(paperLinkTypeSelect?.value, paperLinkTargetSelect?.value))
      || folders[0]
      || null;

    libraryState.selectedFolderKey = selectedFolder?.key || '';

    if (!selectedFolder) {
      if (paperLinkTargetSelect) {
        paperLinkTargetSelect.innerHTML = '<option value="">No target available</option>';
      }
      return null;
    }

    if (paperLinkTypeSelect) {
      paperLinkTypeSelect.value = selectedFolder.type;
    }

    const options = selectedFolder.type === 'journal-club'
      ? (state.journalClubs || []).map((club) => ({ id: club.id, name: club.name }))
      : (state.projects || []).map((project) => ({ id: project.id, name: project.name }));

    if (paperLinkTargetSelect) {
      paperLinkTargetSelect.innerHTML = options.length
        ? options.map((item) => `<option value="${item.id}">${safeText(item.name)}</option>`).join('')
        : '<option value="">No target available</option>';
      if (options.some((item) => item.id === selectedFolder.id)) {
        paperLinkTargetSelect.value = selectedFolder.id;
      }
    }

    return selectedFolder;
  }

  function getSelectedFolder() {
    return syncSelectedFolder();
  }

  function getActivePaper() {
    const activePaperId = paperViewer.getActivePaperId();
    return state.papers.find((paper) => paper.id === activePaperId) || null;
  }

  function getPaperById(paperId) {
    return state.papers.find((paper) => paper.id === paperId) || null;
  }

  function ensurePaperComments(paper) {
    if (!paper || typeof paper !== 'object') {
      return [];
    }
    if (!Array.isArray(paper.comments)) {
      paper.comments = [];
    }
    return paper.comments;
  }

  function getPaperCommentCount(paper) {
    return ensurePaperComments(paper).length;
  }

  function getFolderPaperCount(folder) {
    if (!folder) {
      return 0;
    }
    return (state.papers || []).filter((paper) => paper.linkedType === folder.type && paper.linkedId === folder.id).length;
  }

  function renderFolderList(selectedFolder = getSelectedFolder()) {
    if (!journalClubList) {
      return;
    }

    const folders = getLibraryFolders();
    if (paperFolderSelection) {
      paperFolderSelection.textContent = selectedFolder
        ? `${selectedFolder.type === 'journal-club' ? 'Journal Club' : 'Project'} folder`
        : 'No folder selected';
    }
    if (!folders.length) {
      journalClubList.innerHTML = '<p class="small-note">No project or journal club folders yet.</p>';
      return;
    }

    journalClubList.innerHTML = folders.map((folder) => {
      const paperCount = getFolderPaperCount(folder);
      return `
        <div class="papers-folder-row">
          <button
            type="button"
            class="papers-folder-item${folder.key === selectedFolder?.key ? ' is-active' : ''}"
            data-folder-select="${safeText(folder.key)}"
          >
            <span class="papers-folder-glyph" aria-hidden="true"></span>
            <span class="papers-folder-copy">
              <span class="papers-folder-name">${safeText(folder.name)}</span>
              <span class="papers-folder-kind">${folder.type === 'journal-club' ? 'Journal club' : 'Project'}</span>
            </span>
            <span class="papers-folder-meta">${safeText(String(paperCount))}</span>
          </button>
          ${folder.removable ? `<button type="button" class="ghost-btn papers-folder-delete" data-journal-club-delete="${safeText(folder.id)}">Delete</button>` : ''}
        </div>
      `;
    }).join('');
  }

  function renderUploadTargetSummary(selectedFolder = getSelectedFolder()) {
    if (!paperUploadTargetLabel) {
      return;
    }
    if (!selectedFolder) {
      paperUploadTargetLabel.textContent = 'Select a folder to file new papers.';
      return;
    }
    const prefix = selectedFolder.type === 'journal-club' ? 'Journal club' : 'Project';
    paperUploadTargetLabel.textContent = `New uploads go to ${prefix}: ${selectedFolder.name}`;
  }

  function renderLibrarySidebar(preferredFolderKey = '') {
    const selectedFolder = syncSelectedFolder(preferredFolderKey);
    renderFolderList(selectedFolder);
    renderUploadTargetSummary(selectedFolder);
    renderPaperList(selectedFolder);
    schedulePapersEdgeBleedSync();
  }

  function getCommentsForPage(paper, pageNumber) {
    return ensurePaperComments(paper)
      .filter((comment) => comment.pageNumber === pageNumber)
      .slice()
      .sort((left, right) => {
        const updatedLeft = Date.parse(left.updatedAt || left.createdAt || '');
        const updatedRight = Date.parse(right.updatedAt || right.createdAt || '');
        if (Number.isFinite(updatedLeft) && Number.isFinite(updatedRight) && updatedLeft !== updatedRight) {
          return updatedRight - updatedLeft;
        }
        return String(left.id || '').localeCompare(String(right.id || ''));
      });
  }

  function getCommentAuthorLabel() {
    return String(
      state.settings?.personalInfo?.name
      || state.settings?.personalInfo?.enanaEmail
      || 'Local user'
    ).trim() || 'Local user';
  }

  function clearCommentDraft({ keepText = false } = {}) {
    commentState.mode = 'idle';
    commentState.selectedCommentId = '';
    commentState.draftPageNumber = 0;
    commentState.draftAnchorX = Number.NaN;
    commentState.draftAnchorY = Number.NaN;
    if (!keepText && paperCommentText) {
      paperCommentText.value = '';
    }
  }

  function syncViewerComments() {
    const activePaper = getActivePaper();
    paperViewer.setComments(activePaper ? ensurePaperComments(activePaper) : []);
    paperViewer.setSelectedCommentId(commentState.selectedCommentId);
    paperViewer.setPlacementMode(commentState.mode === 'placing');
  }

  function setCommentStatus(message) {
    if (!paperCommentStatus) {
      return;
    }
    paperCommentStatus.textContent = String(message || '').trim();
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
      message: 'Open a paper to review or add page comments.'
    });
    renderPaperList(getSelectedFolder());
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
    if (paperCommentText) {
      paperCommentText.value = '';
      paperCommentText.disabled = false;
      paperCommentText.focus?.();
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
    if (paperCommentText) {
      paperCommentText.value = '';
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
    if (paperCommentText) {
      paperCommentText.value = String(comment.text || '');
      paperCommentText.disabled = false;
      paperCommentText.focus?.();
    }
    syncViewerComments();
    setCommentStatus(`Editing comment on page ${comment.pageNumber}.`);
    renderCommentSidebar();
  }

  function savePaperComment() {
    const activePaper = getActivePaper();
    const text = String(paperCommentText?.value || '').trim();
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
      savedComment.author = getCommentAuthorLabel();
      savedComment.updatedAt = now;
    } else {
      savedComment = {
        id: createId(),
        pageNumber: commentState.draftPageNumber,
        anchorX: commentState.draftAnchorX,
        anchorY: commentState.draftAnchorY,
        text,
        author: getCommentAuthorLabel(),
        createdAt: now,
        updatedAt: now
      };
      comments.push(savedComment);
    }

    activePaper.updatedAt = now;
    persist();
    renderLibrarySidebar();
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
        : 'Open a paper to review or add page comments.'
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
    renderLibrarySidebar();
    resetCommentComposer({
      message: `Deleted comment from page ${commentState.currentPageNumber}.`
    });
  }

  function renderCommentSidebar() {
    const activePaper = getActivePaper();
    const currentPageNumber = activePaper ? Math.max(1, paperViewer.getCurrentPageNumber() || commentState.currentPageNumber || 1) : 0;
    const currentPageComments = activePaper ? getCommentsForPage(activePaper, currentPageNumber) : [];
    commentState.currentPageNumber = currentPageNumber || 1;

    if (paperCommentSidebar) {
      paperCommentSidebar.classList.toggle('is-disabled', !activePaper);
    }
    if (paperCommentPage) {
      paperCommentPage.textContent = activePaper ? `Page ${currentPageNumber}` : 'Page 0';
    }
    if (paperCommentCount) {
      const count = currentPageComments.length;
      paperCommentCount.textContent = activePaper
        ? `${count} comment${count === 1 ? '' : 's'} on this page`
        : '0 comments on this page';
    }
    if (paperCommentAddBtn) {
      paperCommentAddBtn.disabled = !activePaper;
    }
    if (paperCommentSaveBtn) {
      const hasDraftLocation = Number.isFinite(commentState.draftAnchorX) && Number.isFinite(commentState.draftAnchorY) && commentState.draftPageNumber > 0;
      paperCommentSaveBtn.disabled = !activePaper || !hasDraftLocation || !String(paperCommentText?.value || '').trim();
    }
    if (paperCommentCancelBtn) {
      paperCommentCancelBtn.disabled = commentState.mode === 'idle';
    }
    if (paperCommentDeleteBtn) {
      paperCommentDeleteBtn.disabled = commentState.mode !== 'editing' || !commentState.selectedCommentId;
    }
    if (paperCommentText) {
      paperCommentText.disabled = !activePaper || commentState.mode === 'idle' || commentState.mode === 'placing';
    }

    if (!activePaper) {
      paperCommentList.innerHTML = '<p class="small-note">Open a paper to see page comments.</p>';
      if (!String(paperCommentStatus?.textContent || '').trim()) {
        setCommentStatus('Open a paper to review or add page comments.');
      }
      return;
    }

    if (!String(paperCommentStatus?.textContent || '').trim()) {
      setCommentStatus(`Viewing page ${currentPageNumber}. Select a comment or place a new pin.`);
    }

    if (!currentPageComments.length) {
      paperCommentList.innerHTML = `<p class="small-note">No comments on page ${safeText(String(currentPageNumber))} yet.</p>`;
      return;
    }

    paperCommentList.innerHTML = currentPageComments.map((comment) => `
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

    paperCommentList.querySelectorAll('[data-paper-comment-select]').forEach((button) => {
      button.addEventListener('click', () => {
        selectCommentForEdit(button.dataset.paperCommentSelect);
      });
    });
  }

  function normalizeKeyFigures(paper) {
    const source = paper && typeof paper === 'object' ? paper : {};
    const fromPaper = Array.isArray(source.keyFigures) ? source.keyFigures : [];
    const fromSummary = Array.isArray(source.summaryStructured?.important_figures_or_tables)
      ? source.summaryStructured.important_figures_or_tables
      : [];
    const merged = fromPaper.length ? fromPaper : fromSummary.map((item) => {
      if (typeof item === 'string') {
        return String(item || '').trim();
      }
      if (!item || typeof item !== 'object') {
        return '';
      }
      const label = String(item.item || item.label || item.figure || item.table || '').trim();
      const summary = String(item.summary || item.description || '').trim();
      return [label, summary].filter(Boolean).join(': ');
    });
    const seen = new Set();
    return merged
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  }

  function updatePaperAvailability(paper) {
    if (!paper || typeof paper !== 'object') {
      return;
    }
    const hasUploadedPdf = Boolean(String(paper.pdfDataUrl || '').trim())
      || Boolean(String(paper.storedFilePath || '').trim())
      || Boolean(String(paper.storedRelativePath || '').trim());
    const hasSummary = Boolean(String(paper.summary || '').trim())
      && !String(paper.summary || '').trim().startsWith('Failed to summarize');
    const methodCount = Array.isArray(paper.methodsExtract) ? paper.methodsExtract.length : 0;
    const reagentCount = Array.isArray(paper.keyReagents) ? paper.keyReagents.length : 0;
    paper.keyFigures = normalizeKeyFigures(paper);
    const figureCount = Array.isArray(paper.keyFigures) ? paper.keyFigures.length : 0;

    paper.deepReadReady = Boolean(hasUploadedPdf && (hasSummary || methodCount > 0 || reagentCount > 0 || figureCount > 0));
    if (paper.deepReadReady) {
      paper.availabilityStatus = 'deep_ready';
    } else if (hasUploadedPdf) {
      paper.availabilityStatus = 'uploaded_pdf';
    } else if (hasSummary) {
      paper.availabilityStatus = 'metadata_only';
    } else {
      paper.availabilityStatus = 'unavailable';
    }
  }

  async function startPaperAutoIngest(paperId) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper || paper.ingestionStatus === 'running') {
      return;
    }

    paper.ingestionStatus = 'running';
    paper.ingestionErrors = [];
    paper.ingestionUpdatedAt = new Date().toISOString();
    updatePaperAvailability(paper);
    persist();
    renderLibrarySidebar();

    await summarizePaper(paperId);
    await extractMethods(paperId);
    await extractReagents(paperId);

    const refreshed = state.papers.find((item) => item.id === paperId);
    if (!refreshed) {
      return;
    }

    const errors = [];
    if (refreshed.summaryStatus === 'error') {
      errors.push('summary_failed');
    }
    if (refreshed.methodsStatus === 'error') {
      errors.push('methods_failed');
    }
    if (refreshed.reagentsStatus === 'error') {
      errors.push('reagents_failed');
    }
    refreshed.ingestionErrors = errors;
    refreshed.ingestionStatus = errors.length ? 'error' : 'ready';
    refreshed.ingestionUpdatedAt = new Date().toISOString();
    updatePaperAvailability(refreshed);
    persist();
    renderLibrarySidebar();
  }

  async function onPaperSubmit(event) {
    event.preventDefault();
    const options = getCurrentLinkOptions();
    const file = paperPdfInput.files?.[0];
    const linkId = paperLinkTargetSelect.value;
    const linked = options.find((item) => item.id === linkId);

    if (!file || !linkId || !linked) {
      return;
    }

    const rootPath = String(state.settings.storagePath || '').trim();
    if (!rootPath) {
      window.alert('Set Storage Folder Path in Settings before uploading papers.');
      return;
    }

    const pdfDataUrl = await fileToDataUrl(file);
    const dataBase64 = extractBase64Payload(pdfDataUrl);
    if (!dataBase64) {
      window.alert('Cannot read the selected PDF.');
      return;
    }

    if (!window.enanaApi?.storeImportedFile) {
      window.alert('Imported file storage API is unavailable.');
      return;
    }

    let storedFile = null;
    try {
      const result = await window.enanaApi.storeImportedFile({
        storagePath: rootPath,
        targetFolder: buildPaperStorageFolder({
          rootPath,
          linkedType: paperLinkTypeSelect.value,
          linkedName: linked.name
        }),
        fileName: file.name,
        dataBase64
      });
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to store uploaded PDF.');
      }
      storedFile = result;
    } catch (error) {
      window.alert(String(error?.message || error || 'Failed to store uploaded PDF.'));
      return;
    }

    const paper = {
      id: createId(),
      title: paperTitleInput.value.trim() || file.name.replace(/\.pdf$/i, ''),
      fileName: storedFile.fileName || file.name,
      pdfDataUrl,
      storedFilePath: storedFile.filePath || '',
      storedRelativePath: storedFile.relativePath || '',
      linkedType: paperLinkTypeSelect.value,
      linkedId: linkId,
      linkedName: linked.name,
      summary: '',
      summaryStructured: null,
      summaryStatus: 'idle',
      methodsExtract: [],
      methodsStatus: 'idle',
      keyReagents: [],
      reagentsStatus: 'idle',
      keyFigures: [],
      comments: [],
      deepReadReady: false,
      availabilityStatus: 'uploaded_pdf',
      ingestionStatus: 'queued',
      ingestionUpdatedAt: new Date().toISOString(),
      ingestionErrors: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    updatePaperAvailability(paper);

    state.papers.push(paper);
    persist();
    paperForm.reset();
    libraryState.selectedFolderKey = buildFolderKey(paper.linkedType, paper.linkedId);
    render();
    void startPaperAutoIngest(paper.id);
  }

  function onAddJournalClub() {
    const name = journalClubNameInput.value.trim();
    if (!name) {
      return;
    }

    const journalClub = {
      id: createId(),
      name,
      description: journalClubDescriptionInput.value.trim()
    };
    state.journalClubs.push(journalClub);

    persist();
    journalClubNameInput.value = '';
    journalClubDescriptionInput.value = '';
    libraryState.selectedFolderKey = buildFolderKey('journal-club', journalClub.id);
    renderLibrarySidebar();
  }

  function deleteJournalClub(journalClubId) {
    state.journalClubs = state.journalClubs.filter((item) => item.id !== journalClubId);
    state.papers = state.papers.filter((paper) => !(paper.linkedType === 'journal-club' && paper.linkedId === journalClubId));
    if (paperViewer.getActivePaperId() && !getActivePaper()) {
      resetCommentComposer({
        message: 'Open a paper to review or add page comments.'
      });
      void paperViewer.resetViewer('The open paper was removed.');
    }
    persist();
    render();
  }

  function deletePaper(paperId) {
    state.papers = state.papers.filter((item) => item.id !== paperId);
    state.paperExperimentLinks = (state.paperExperimentLinks || []).filter((item) => item.paperId !== paperId);
    if (paperViewer.getActivePaperId() === paperId) {
      resetCommentComposer({
        message: 'Open a paper to review or add page comments.'
      });
      void paperViewer.resetViewer('The open paper was deleted.');
    }
    persist();
    renderLibrarySidebar();
    renderCommentSidebar();
  }

  async function summarizePaper(paperId) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper || paper.summaryStatus === 'running') {
      return;
    }

    paper.summaryStatus = 'running';
    paper.summary = 'Summarizing...';
    paper.summaryStructured = null;
    paper.updatedAt = new Date().toISOString();
    persist();
    renderLibrarySidebar();

    try {
      const summary = await requestSummary({
        llm: state.settings.llm,
        pdfDataUrl: paper.pdfDataUrl,
        fileName: paper.fileName,
        title: paper.title
      });
      const normalized = normalizePaperSummary(summary);
      paper.summary = normalized.summary;
      paper.summaryStructured = normalized.structured;
      paper.summaryStatus = 'idle';
    } catch (error) {
      paper.summary = `Failed to summarize: ${String(error.message || error)}`;
      paper.summaryStructured = null;
      paper.summaryStatus = 'error';
    }

    paper.updatedAt = new Date().toISOString();
    updatePaperAvailability(paper);
    persist();
    renderLibrarySidebar();
  }

  async function extractMethods(paperId) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper || paper.methodsStatus === 'running') {
      return;
    }

    paper.methodsStatus = 'running';
    paper.updatedAt = new Date().toISOString();
    persist();
    renderLibrarySidebar();

    try {
      const prompts = await getLlmPrompts();
      const result = await requestStructuredFromPaper({
        llm: state.settings.llm,
        pdfDataUrl: paper.pdfDataUrl,
        fileName: paper.fileName,
        title: paper.title,
        instruction: requirePrompt(prompts, 'extractMethods')
      });

      paper.methodsExtract = normalizeMethodsExtract(result);
      paper.methodsStatus = 'idle';
    } catch (error) {
      paper.methodsStatus = 'error';
      paper.methodsExtract = [];
    }

    paper.updatedAt = new Date().toISOString();
    updatePaperAvailability(paper);
    persist();
    renderLibrarySidebar();
  }

  async function extractReagents(paperId) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper || paper.reagentsStatus === 'running') {
      return;
    }

    paper.reagentsStatus = 'running';
    paper.updatedAt = new Date().toISOString();
    persist();
    renderLibrarySidebar();

    try {
      const prompts = await getLlmPrompts();
      const result = await requestStructuredFromPaper({
        llm: state.settings.llm,
        pdfDataUrl: paper.pdfDataUrl,
        fileName: paper.fileName,
        title: paper.title,
        instruction: requirePrompt(prompts, 'extractReagents')
      });

      const reagents = Array.isArray(result?.reagents) ? result.reagents : [];
      paper.keyReagents = reagents.map((item) => ({
        name: String(item?.name || '').trim(),
        type: String(item?.type || 'other').trim(),
        identifier: String(item?.identifier || '').trim(),
        notes: String(item?.notes || '').trim(),
        citation: String(item?.citation || '').trim()
      })).filter((item) => item.name);
      paper.reagentsStatus = 'idle';
    } catch (error) {
      paper.reagentsStatus = 'error';
      paper.keyReagents = [];
    }

    paper.updatedAt = new Date().toISOString();
    updatePaperAvailability(paper);
    persist();
    renderLibrarySidebar();
  }

  function linkExperimentToPaper(paperId, projectId, entryId, note) {
    if (!paperId || !projectId || !entryId) {
      return;
    }

    const entry = (state.notebookEntries || []).find((item) => item.id === entryId && item.projectId === projectId);
    if (!entry) {
      return;
    }

    state.paperExperimentLinks = Array.isArray(state.paperExperimentLinks) ? state.paperExperimentLinks : [];

    const existingIndex = state.paperExperimentLinks.findIndex(
      (item) => item.paperId === paperId && item.entryId === entryId
    );
    const record = {
      id: existingIndex >= 0 ? state.paperExperimentLinks[existingIndex].id : createId(),
      paperId,
      projectId,
      entryId,
      note: String(note || '').trim(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      state.paperExperimentLinks[existingIndex] = record;
    } else {
      state.paperExperimentLinks.push(record);
    }

    entry.references = entry.references || {};
    entry.references.paperIds = Array.isArray(entry.references.paperIds) ? entry.references.paperIds : [];
    if (!entry.references.paperIds.includes(paperId)) {
      entry.references.paperIds.push(paperId);
    }
    entry.references.paperInspiration = Array.isArray(entry.references.paperInspiration)
      ? entry.references.paperInspiration
      : [];
    const inspirationIndex = entry.references.paperInspiration.findIndex((item) => item.paperId === paperId);
    const inspiration = {
      paperId,
      note: String(note || '').trim(),
      updatedAt: new Date().toISOString()
    };
    if (inspirationIndex >= 0) {
      entry.references.paperInspiration[inspirationIndex] = inspiration;
    } else {
      entry.references.paperInspiration.push(inspiration);
    }

    entry.updatedAt = new Date().toISOString();
    persist();
    renderLibrarySidebar();
  }

  function resolveStoredPaperPath(paper) {
    const directPath = String(paper?.storedFilePath || '').trim();
    if (directPath) {
      return directPath;
    }

    const relativePath = String(paper?.storedRelativePath || '').trim();
    const storageRoot = String(state.settings?.storagePath || '').trim();
    if (!relativePath || !storageRoot) {
      return '';
    }

    const rootClean = storageRoot.replace(/[\\/]+$/, '');
    const relativeParts = relativePath.split(/[\\/]+/).filter(Boolean);
    if (!rootClean || !relativeParts.length) {
      return '';
    }
    const separator = rootClean.includes('\\') ? '\\' : '/';
    return [rootClean, ...relativeParts].join(separator);
  }

  function openPdfDataUrl(pdfDataUrl) {
    const source = String(pdfDataUrl || '').trim();
    if (!source) {
      return false;
    }

    const base64Match = source.match(/^data:application\/pdf(?:;charset=[^;,]+)?;base64,(.+)$/i);
    if (base64Match?.[1]) {
      try {
        const binary = atob(base64Match[1]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const popup = window.open(blobUrl, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
        }, 60_000);
        return Boolean(popup);
      } catch {
        // Fall through to direct window.open below.
      }
    }

    const popup = window.open(source, '_blank', 'noopener,noreferrer');
    return Boolean(popup);
  }

  async function openPaperPdf(paperId) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper) {
      return;
    }

    const candidatePath = resolveStoredPaperPath(paper);
    if (candidatePath && window.enanaApi?.openFilePath) {
      const result = await window.enanaApi.openFilePath(candidatePath);
      if (result?.ok) {
        return;
      }
    }

    if (openPdfDataUrl(paper.pdfDataUrl)) {
      return;
    }

    window.alert('Unable to open this PDF. Re-upload the paper to restore the local file path.');
  }

  async function resolvePaperPdfBytes(paper) {
    const embeddedBase64 = parsePdfDataUrl(paper?.pdfDataUrl);
    if (embeddedBase64) {
      return decodeBase64Pdf(embeddedBase64);
    }

    const candidatePath = resolveStoredPaperPath(paper);
    if (candidatePath && window.enanaApi?.readFileBase64) {
      const result = await window.enanaApi.readFileBase64(candidatePath);
      const dataBase64 = String(result?.dataBase64 || '').trim();
      if (result?.ok && dataBase64) {
        return decodeBase64Pdf(dataBase64);
      }
    }

    throw new Error('Unable to load this PDF from app storage.');
  }

  function buildPaperViewerSummary(paper) {
    const details = [
      String(paper?.fileName || '').trim(),
      formatLinkedTarget(paper),
      paper?.updatedAt ? `Updated ${new Date(paper.updatedAt).toLocaleString()}` : ''
    ].filter(Boolean);
    return details.join(' | ');
  }

  async function viewPaperPdf(paperId) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper) {
      return;
    }

    try {
      libraryState.selectedFolderKey = buildFolderKey(paper.linkedType, paper.linkedId);
      renderLibrarySidebar(libraryState.selectedFolderKey);
      clearCommentDraft();
      commentState.currentPageNumber = 1;
      if (paperCommentText) {
        paperCommentText.value = '';
      }
      const opened = await paperViewer.openPaper({
        paper,
        summary: buildPaperViewerSummary(paper),
        resolveBytes: resolvePaperPdfBytes,
        onOpenExternal: openPaperPdf
      });
      if (!opened) {
        return;
      }
      syncViewerComments();
      setCommentStatus('Viewing page 1. Select a comment or place a new pin.');
      renderPaperList(getSelectedFolder());
      renderCommentSidebar();
    } catch (error) {
      window.alert(String(error?.message || error || 'Failed to load the PDF viewer.'));
    }
  }

  function onFolderListClick(event) {
    const selectBtn = event.target.closest('[data-folder-select]');
    if (selectBtn) {
      libraryState.selectedFolderKey = selectBtn.dataset.folderSelect;
      renderLibrarySidebar(libraryState.selectedFolderKey);
      return;
    }

    const deleteBtn = event.target.closest('[data-journal-club-delete]');
    if (deleteBtn) {
      deleteJournalClub(deleteBtn.dataset.journalClubDelete);
    }
  }

  function onPaperListClick(event) {
    const viewBtn = event.target.closest('[data-paper-view]');
    if (viewBtn) {
      void viewPaperPdf(viewBtn.dataset.paperView);
      return;
    }

    const openBtn = event.target.closest('[data-paper-open]');
    if (openBtn) {
      void openPaperPdf(openBtn.dataset.paperOpen);
      return;
    }

    const summarizeBtn = event.target.closest('[data-paper-summarize]');
    if (summarizeBtn) {
      summarizePaper(summarizeBtn.dataset.paperSummarize);
      return;
    }

    const deleteBtn = event.target.closest('[data-paper-delete]');
    if (deleteBtn) {
      deletePaper(deleteBtn.dataset.paperDelete);
      return;
    }

    const extractMethodsBtn = event.target.closest('[data-paper-extract-methods]');
    if (extractMethodsBtn) {
      extractMethods(extractMethodsBtn.dataset.paperExtractMethods);
      return;
    }

    const extractReagentsBtn = event.target.closest('[data-paper-extract-reagents]');
    if (extractReagentsBtn) {
      extractReagents(extractReagentsBtn.dataset.paperExtractReagents);
      return;
    }

    const protocolBtn = event.target.closest('[data-paper-method-to-protocol]');
    if (protocolBtn) {
      const paper = state.papers.find((item) => item.id === protocolBtn.dataset.paperId);
      const index = Number(protocolBtn.dataset.methodIndex);
      const method = paper?.methodsExtract?.[index];
      if (paper && method && typeof onCreateProtocolDraft === 'function') {
        onCreateProtocolDraft({ method, paper });
      }
      return;
    }

    const linkBtn = event.target.closest('[data-paper-link-entry]');
    if (linkBtn) {
      const paperId = linkBtn.dataset.paperId;
      const card = linkBtn.closest('[data-paper-card]');
      if (!card) {
        return;
      }
      const projectId = card.querySelector('[data-link-project]')?.value || '';
      const entryId = card.querySelector('[data-link-entry]')?.value || '';
      const note = card.querySelector('[data-link-note]')?.value || '';
      linkExperimentToPaper(paperId, projectId, entryId, note);
      return;
    }

    const projectSelect = event.target.closest('[data-link-project]');
    if (projectSelect) {
      const card = projectSelect.closest('[data-paper-card]');
      const entrySelect = card?.querySelector('[data-link-entry]');
      if (entrySelect) {
        entrySelect.innerHTML = renderEntryOptionsForProject(projectSelect.value || '', '');
      }
    }
  }

  function renderLinkTargets() {
    renderLibrarySidebar(buildFolderKey(paperLinkTypeSelect?.value, paperLinkTargetSelect?.value));
  }

  function renderEntryOptionsForProject(projectId, selectedEntryId) {
    const entries = (state.notebookEntries || [])
      .filter((entry) => entry.projectId === projectId)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    if (!entries.length) {
      return '<option value="">No experiment entries</option>';
    }
    const options = ['<option value="">Select experiment entry</option>'];
    entries.forEach((entry) => {
      const isSelected = selectedEntryId === entry.id ? ' selected' : '';
      options.push(`<option value="${entry.id}"${isSelected}>${safeText(entry.protocolName || entry.id)} (${safeText(entry.updatedAt || '-')})</option>`);
    });
    return options.join('');
  }

  function renderProjectOptions(selectedProjectId) {
    const options = ['<option value="">Select project</option>'];
    (state.projects || []).forEach((project) => {
      const isSelected = selectedProjectId === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });
    return options.join('');
  }

  function renderPaperList(selectedFolder = getSelectedFolder()) {
    const visiblePapers = (state.papers || [])
      .filter((paper) => {
        if (!selectedFolder) {
          return true;
        }
        return paper.linkedType === selectedFolder.type && paper.linkedId === selectedFolder.id;
      })
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    if (!visiblePapers.length) {
      paperList.innerHTML = selectedFolder
        ? `<p class="small-note">No papers in ${safeText(selectedFolder.name)} yet.</p>`
        : '<p class="small-note">No papers uploaded yet.</p>';
      return;
    }

    const activePaperId = paperViewer.getActivePaperId();

    paperList.innerHTML = visiblePapers
      .map((paper) => {
        const isActive = activePaperId === paper.id;
        const commentCount = getPaperCommentCount(paper);
        const methodsHtml = (paper.methodsExtract || []).map((method, index) => `
          <article class="card">
            <p><strong>${safeText(method.title || `Method ${index + 1}`)}</strong></p>
            <p>${safeText(formatMethodStepTexts(method.steps).join(' | ') || '-')}</p>
            <p><strong>Citations:</strong> ${safeText((method.citations || []).join('; ') || '-')}</p>
            <button class="ghost-btn" data-paper-method-to-protocol data-paper-id="${paper.id}" data-method-index="${index}">Create Protocol Draft</button>
          </article>
        `).join('');

        const reagentsHtml = (paper.keyReagents || []).map((item) => `
          <article class="card">
            <p><strong>${safeText(item.name)}</strong> <span class="small-note">(${safeText(item.type)})</span></p>
            <p><strong>ID:</strong> ${safeText(item.identifier || '-')}</p>
            <p><strong>Notes:</strong> ${safeText(item.notes || '-')}</p>
            <p><strong>Citation:</strong> ${safeText(item.citation || '-')}</p>
          </article>
        `).join('');
        const keyFiguresHtml = (paper.keyFigures || []).map((item) => `
          <article class="card">
            <p>${safeText(item)}</p>
          </article>
        `).join('');
        const ingestionErrors = Array.isArray(paper.ingestionErrors) ? paper.ingestionErrors : [];

        const projectIdDefault = paper.linkedType === 'project' ? paper.linkedId : '';
        const links = (state.paperExperimentLinks || []).filter((item) => item.paperId === paper.id);
        const linksHtml = links.map((link) => `
          <p class="small-note">Experiment link: project=${safeText(link.projectId)} entry=${safeText(link.entryId)} note=${safeText(link.note || '-')}</p>
        `).join('');

        return `
          <article class="papers-paper-row${isActive ? ' is-active' : ''}" data-paper-card="${paper.id}">
            <button type="button" class="papers-paper-row-main" data-paper-view="${paper.id}">
              <span class="papers-paper-title">${safeText(paper.title)}</span>
              <span class="papers-paper-time">${safeText(formatRelativePaperTime(paper.updatedAt))}</span>
            </button>
            <div class="papers-paper-meta">
              <span>${safeText(paper.fileName)}</span>
              <span><strong>Comments:</strong> ${safeText(String(commentCount))}</span>
              <span><strong>Ingestion:</strong> ${safeText(statusLabel(paper.ingestionStatus || 'idle'))}</span>
            </div>
            ${isActive ? `
              <div class="papers-paper-detail">
                <p class="papers-paper-summary">${safeText(paper.summary || 'No summary yet.')}</p>
                <p class="small-note"><strong>Linked To:</strong> ${safeText(formatLinkedTarget(paper))}</p>
                <p class="small-note"><strong>Status:</strong> <span class="status-badge ${statusClass(paper.summaryStatus)}">${safeText(statusLabel(paper.summaryStatus))}</span></p>
                <p class="small-note"><strong>Availability:</strong> ${safeText(paper.availabilityStatus || 'unknown')} | deep-ready=${paper.deepReadReady === true ? 'yes' : 'no'}</p>
                <p class="small-note"><strong>Updated:</strong> ${safeText(paper.updatedAt ? new Date(paper.updatedAt).toLocaleString() : '-')}</p>
                ${ingestionErrors.length ? `<p class="small-note"><strong>Ingestion Errors:</strong> ${safeText(ingestionErrors.join(', '))}</p>` : ''}
                <div class="card-actions">
                  <button class="primary-btn" data-paper-view="${paper.id}">View PDF</button>
                  <button class="ghost-btn" data-paper-open="${paper.id}">Open Externally</button>
                  <button class="primary-btn" data-paper-summarize="${paper.id}" ${paper.summaryStatus === 'running' ? 'disabled' : ''}>
                    ${paper.summaryStatus === 'running' ? 'Summarizing...' : 'Summarize'}
                  </button>
                  <button class="ghost-btn" data-paper-extract-methods="${paper.id}" ${paper.methodsStatus === 'running' ? 'disabled' : ''}>
                    ${paper.methodsStatus === 'running' ? 'Extracting Methods...' : 'Extract Methods'}
                  </button>
                  <button class="ghost-btn" data-paper-extract-reagents="${paper.id}" ${paper.reagentsStatus === 'running' ? 'disabled' : ''}>
                    ${paper.reagentsStatus === 'running' ? 'Extracting Reagents...' : 'Extract Reagents'}
                  </button>
                  <button class="danger-btn" data-paper-delete="${paper.id}">Delete</button>
                </div>
                <div class="stack-form">
                  <p><strong>Methods Extraction</strong></p>
                  ${methodsHtml || '<p class="small-note">No methods extracted yet.</p>'}
                  <p><strong>Key Reagents</strong></p>
                  ${reagentsHtml || '<p class="small-note">No key reagents extracted yet.</p>'}
                  <p><strong>Key Figures</strong></p>
                  ${keyFiguresHtml || '<p class="small-note">No key figures extracted yet.</p>'}
                </div>
                <div class="stack-form">
                  <p><strong>Link to Experiment</strong></p>
                  <label>
                    Project
                    <select data-link-project>${renderProjectOptions(projectIdDefault)}</select>
                  </label>
                  <label>
                    Experiment Entry
                    <select data-link-entry>${renderEntryOptionsForProject(projectIdDefault, '')}</select>
                  </label>
                  <label>
                    Inspiration Note
                    <input data-link-note placeholder="e.g. Inspired by Fig 2 panel C" />
                  </label>
                  <button class="ghost-btn" data-paper-link-entry data-paper-id="${paper.id}">Save Paper-Experiment Link</button>
                  ${linksHtml || '<p class="small-note">No experiment links yet.</p>'}
                </div>
              </div>
            ` : ''}
          </article>
        `;
      })
      .join('');
  }

  function formatLinkedTarget(paper) {
    const prefix = paper.linkedType === 'journal-club' ? 'Journal Club' : 'Project';
    return `${prefix}: ${paper.linkedName || 'Unknown'}`;
  }

  function formatRelativePaperTime(timestamp) {
    const parsed = Date.parse(String(timestamp || ''));
    if (!Number.isFinite(parsed)) {
      return '-';
    }

    const elapsedMs = Math.max(Date.now() - parsed, 0);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;

    if (elapsedMs < hour) {
      return `${Math.max(1, Math.round(elapsedMs / minute))}m`;
    }
    if (elapsedMs < day) {
      return `${Math.max(1, Math.round(elapsedMs / hour))}h`;
    }
    if (elapsedMs < week) {
      return `${Math.max(1, Math.round(elapsedMs / day))}d`;
    }
    return `${Math.max(1, Math.round(elapsedMs / week))}w`;
  }

  function statusLabel(status) {
    if (status === 'queued') {
      return 'Queued';
    }
    if (status === 'running') {
      return 'Running';
    }
    if (status === 'error') {
      return 'Error';
    }
    if (status === 'ready') {
      return 'Ready';
    }
    if (status === 'uploaded') {
      return 'Uploaded';
    }
    return 'Idle';
  }

  function statusClass(status) {
    if (status === 'queued') {
      return 'status-running';
    }
    if (status === 'running') {
      return 'status-running';
    }
    if (status === 'error') {
      return 'status-error';
    }
    return 'status-idle';
  }

  function render() {
    renderLibrarySidebar();
    renderCommentSidebar();
    schedulePapersEdgeBleedSync();
  }

  return { render, renderLinkTargets };
}

function getMethodStepText(step) {
  if (typeof step === 'string') {
    return String(step || '').trim();
  }
  if (!step || typeof step !== 'object') {
    return '';
  }
  return String(
    step.action
    || step.text
    || step.instruction
    || step.description
    || step.step
    || step.content
    || ''
  ).trim();
}

function formatMethodStepTexts(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map((step) => getMethodStepText(step))
    .filter(Boolean);
}

function normalizeMethodSteps(rawSteps) {
  const source = Array.isArray(rawSteps) ? rawSteps : [];
  if (!source.length) {
    return [];
  }

  const sorted = source
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      const numberA = Number(a.step?.step_number ?? a.step?.number ?? a.step?.index);
      const numberB = Number(b.step?.step_number ?? b.step?.number ?? b.step?.index);
      const hasNumberA = Number.isFinite(numberA);
      const hasNumberB = Number.isFinite(numberB);
      if (hasNumberA && hasNumberB && numberA !== numberB) {
        return numberA - numberB;
      }
      if (hasNumberA !== hasNumberB) {
        return hasNumberA ? -1 : 1;
      }
      return a.index - b.index;
    });

  const rows = sorted
    .map(({ step }, index) => {
      const action = getMethodStepText(step);
      if (!action) {
        return null;
      }
      const rawNumber = Number(step?.step_number ?? step?.number ?? step?.index);
      return {
        step_number: Number.isFinite(rawNumber) && rawNumber > 0 ? Math.round(rawNumber) : index + 1,
        action
      };
    })
    .filter(Boolean);

  return rows.map((item, index) => ({
    step_number: index + 1,
    action: item.action
  }));
}

function normalizeMethodTroubleshooting(rawTroubleshooting) {
  if (!rawTroubleshooting) {
    return [];
  }
  if (typeof rawTroubleshooting === 'string') {
    return String(rawTroubleshooting || '')
      .split(/\r?\n+/)
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .map((problem) => ({
        problem,
        possible_cause: '',
        solution: ''
      }));
  }
  if (!Array.isArray(rawTroubleshooting)) {
    return [];
  }
  return rawTroubleshooting
    .map((item) => {
      if (typeof item === 'string') {
        const problem = String(item || '').trim();
        if (!problem) {
          return null;
        }
        return {
          problem,
          possible_cause: '',
          solution: ''
        };
      }
      if (!item || typeof item !== 'object') {
        return null;
      }
      const problem = String(item.problem || item.issue || '').trim();
      const possibleCause = String(item.possible_cause || item.possibleCause || item.cause || '').trim();
      const solution = String(item.solution || item.fix || '').trim();
      if (!problem && !possibleCause && !solution) {
        return null;
      }
      return {
        problem,
        possible_cause: possibleCause,
        solution
      };
    })
    .filter(Boolean);
}

function normalizeMethodsExtract(result) {
  let methods = [];
  if (Array.isArray(result?.methods)) {
    methods = result.methods;
  } else if (Array.isArray(result?.protocols)) {
    methods = result.protocols;
  } else if (Array.isArray(result)) {
    methods = result;
  } else if (result && typeof result === 'object') {
    methods = [result];
  }

  const normalizeMaterial = (material) => {
    if (typeof material === 'string') {
      return String(material || '').trim();
    }
    if (!material || typeof material !== 'object') {
      return '';
    }
    const fields = Object.entries(material)
      .map(([key, value]) => {
        if (value === null || value === undefined) {
          return '';
        }
        const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value).trim();
        if (!rendered || rendered === '{}' || rendered === '[]') {
          return '';
        }
        return `${key}: ${rendered}`;
      })
      .filter(Boolean);
    return fields.join('; ').trim();
  };

  return methods.map((item, index) => {
    const title = String(item?.title || item?.name || `Method ${index + 1}`).trim() || `Method ${index + 1}`;
    const rawSteps = Array.isArray(item?.steps)
      ? item.steps
      : (Array.isArray(item?.procedure) ? item.procedure : []);
    const steps = normalizeMethodSteps(rawSteps);
    const citations = Array.isArray(item?.citations)
      ? item.citations.map((cit) => String(cit || '').trim()).filter(Boolean)
      : (Array.isArray(item?.references) ? item.references.map((cit) => String(cit || '').trim()).filter(Boolean) : []);

    return {
      title,
      purpose: String(item?.purpose || item?.objective || '').trim(),
      materials: Array.isArray(item?.materials)
        ? item.materials.map((material) => normalizeMaterial(material)).filter(Boolean)
        : [],
      steps,
      troubleshooting: normalizeMethodTroubleshooting(item?.troubleshooting),
      citations
    };
  }).filter((item) => item.title || item.steps.length);
}

function normalizePaperSummary(rawSummary) {
  const raw = String(rawSummary || '').trim();
  if (!raw) {
    return {
      summary: 'No summary generated.',
      structured: null
    };
  }

  const parsed = parseJsonFromText(raw);
  const hasStructuredPayload = parsed
    && typeof parsed === 'object'
    && !Array.isArray(parsed)
    && Object.keys(parsed).length > 0;
  if (hasStructuredPayload) {
    const summaryFromFields = [
      parsed.plain_english_summary,
      parsed.plainEnglishSummary,
      parsed.summary,
      parsed.main_conclusion,
      parsed.mainConclusion,
      parsed.technical_summary,
      parsed.technicalSummary,
      parsed.background
    ]
      .map((value) => String(value || '').trim())
      .find(Boolean) || '';
    const keyFindingsSummary = Array.isArray(parsed.key_findings)
      ? parsed.key_findings
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' ')
      : '';
    return {
      summary: summaryFromFields || keyFindingsSummary || 'No plain-English summary generated.',
      structured: parsed
    };
  }

  return {
    summary: raw,
    structured: null
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read PDF file.'));
    reader.readAsDataURL(file);
  });
}

function extractBase64Payload(dataUrl) {
  const source = String(dataUrl || '');
  const commaIndex = source.indexOf(',');
  if (commaIndex < 0) {
    return '';
  }
  return source.slice(commaIndex + 1).trim();
}

function sanitizeFolderName(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildPaperStorageFolder({ rootPath, linkedType, linkedName }) {
  const category = linkedType === 'journal-club' ? 'JournalClub' : 'Project';
  const safeLinkedName = sanitizeFolderName(linkedName) || 'Uncategorized';
  return `${String(rootPath || '').trim()}/${category}/${safeLinkedName}/Papers`;
}

const LLM_PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/responses',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  claude: 'https://api.anthropic.com/v1/messages',
  codex: 'codex://cli'
};

function inferProviderFromEndpoint(endpoint) {
  const value = String(endpoint || '').trim().toLowerCase();
  if (!value) {
    return '';
  }
  if (value.startsWith('codex://') || value.includes('codex cli') || value.includes('openai-cli')) {
    return 'codex';
  }
  if (value.includes('anthropic.com')) {
    return 'claude';
  }
  if (value.includes('generativelanguage.googleapis.com') || value.includes('ai.google')) {
    return 'gemini';
  }
  if (value.includes('openai.com') || value.includes('/openai/')) {
    return 'openai';
  }
  return '';
}

function normalizeLlmProvider(provider, endpoint = '') {
  const clean = String(provider || '').trim().toLowerCase();
  if (clean === 'openai' || clean === 'gemini' || clean === 'claude' || clean === 'codex') {
    return clean;
  }
  return inferProviderFromEndpoint(endpoint) || 'openai';
}

function defaultEndpointForProvider(provider) {
  const resolved = normalizeLlmProvider(provider);
  return LLM_PROVIDER_ENDPOINTS[resolved] || LLM_PROVIDER_ENDPOINTS.openai;
}

function getLlmRequestConfig(llm) {
  const legacySetting = String(llm?.api || '').trim();
  const legacyLooksLikeEndpoint = /^[a-z]+:\/\//i.test(legacySetting);
  const endpointCandidate = String(llm?.apiEndpoint || '').trim() || (legacyLooksLikeEndpoint ? legacySetting : '');
  const provider = normalizeLlmProvider(llm?.provider, endpointCandidate);
  const endpoint = endpointCandidate || defaultEndpointForProvider(provider);
  const token = String(llm?.apiKey || '').trim() || (legacySetting && !legacyLooksLikeEndpoint ? legacySetting : '');

  if (provider !== 'codex' && !token) {
    throw new Error('Missing API key in Settings > LLM Model & API.');
  }

  return { provider, endpoint, token };
}

async function requestResponses({ llm, modelFallbackPrompt, fileName, pdfDataUrl, prompt }) {
  const { provider, endpoint, token } = getLlmRequestConfig(llm);
  const model = String(llm?.model || '').trim();
  if (!model && provider !== 'codex') {
    throw new Error('Missing model in Settings > LLM Model & API.');
  }

  if (provider === 'claude') {
    return requestClaude({
      endpoint,
      token,
      model,
      prompt: prompt || modelFallbackPrompt || '',
      pdfDataUrl
    });
  }
  if (provider === 'gemini') {
    return requestGemini({
      endpoint,
      token,
      model,
      prompt: prompt || modelFallbackPrompt || '',
      pdfDataUrl
    });
  }
  if (provider === 'codex') {
    return requestCodex({
      model,
      prompt: prompt || modelFallbackPrompt || '',
      fileName,
      pdfDataUrl
    });
  }
  return requestOpenAi({
    endpoint,
    token,
    model,
    prompt: prompt || modelFallbackPrompt || '',
    fileName,
    pdfDataUrl
  });
}

function parsePdfDataUrl(pdfDataUrl) {
  const value = String(pdfDataUrl || '').trim();
  const match = value.match(/^data:application\/pdf(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match?.[1]) {
    return '';
  }
  return match[1];
}

function decodeBase64Pdf(base64) {
  const binary = atob(String(base64 || '').trim());
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function requestOpenAi({ endpoint, token, model, prompt, fileName, pdfDataUrl }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: pdfDataUrl
            ? [
              { type: 'input_text', text: prompt },
              {
                type: 'input_file',
                filename: fileName || 'paper.pdf',
                file_data: pdfDataUrl
              }
            ]
            : [
              { type: 'input_text', text: prompt }
            ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  if (payload.output_text) {
    return payload.output_text;
  }

  const chunks = [];
  (payload.output || []).forEach((item) => {
    (item.content || []).forEach((content) => {
      if (content.type === 'output_text' && content.text) {
        chunks.push(content.text);
      }
    });
  });
  return chunks.join('\n').trim();
}

async function requestClaude({ endpoint, token, model, prompt, pdfDataUrl }) {
  const content = [{ type: 'text', text: prompt }];
  const pdfBase64 = parsePdfDataUrl(pdfDataUrl);
  if (pdfDataUrl && !pdfBase64) {
    throw new Error('Failed to parse PDF data for Claude request.');
  }
  if (pdfBase64) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdfBase64
      }
    });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': token,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      messages: [
        {
          role: 'user',
          content
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  return (payload?.content || [])
    .filter((item) => item?.type === 'text' && item.text)
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function buildGeminiGenerateContentUrl(endpoint, model, token) {
  const cleanEndpoint = String(endpoint || '').trim() || LLM_PROVIDER_ENDPOINTS.gemini;
  let url = cleanEndpoint.replace(/\/+$/, '');
  if (!url.includes(':generateContent')) {
    if (/\/models\/[^/?#]+$/i.test(url)) {
      url = `${url}:generateContent`;
    } else if (/\/models$/i.test(url)) {
      url = `${url}/${encodeURIComponent(model)}:generateContent`;
    } else {
      url = `${url}/models/${encodeURIComponent(model)}:generateContent`;
    }
  }
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(token)}`;
}

async function requestGemini({ endpoint, token, model, prompt, pdfDataUrl }) {
  const parts = [{ text: prompt }];
  const pdfBase64 = parsePdfDataUrl(pdfDataUrl);
  if (pdfDataUrl && !pdfBase64) {
    throw new Error('Failed to parse PDF data for Gemini request.');
  }
  if (pdfBase64) {
    parts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: pdfBase64
      }
    });
  }

  const response = await fetch(buildGeminiGenerateContentUrl(endpoint, model, token), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts
        }
      ],
      generationConfig: {
        maxOutputTokens: 1400
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  if (!candidate?.content?.parts) {
    return '';
  }
  return candidate.content.parts
    .filter((part) => typeof part?.text === 'string' && part.text.trim())
    .map((part) => part.text)
    .join('\n')
    .trim();
}

async function requestCodex({ model, prompt, fileName, pdfDataUrl }) {
  if (!window.enanaApi?.runCodexLlmPrompt) {
    throw new Error('Codex CLI bridge is unavailable in this build.');
  }
  const result = await window.enanaApi.runCodexLlmPrompt({
    model,
    prompt,
    fileName,
    pdfDataUrl
  });
  if (!result?.ok) {
    throw new Error(String(result?.error || 'Codex CLI request failed.'));
  }
  return String(result?.text || '').trim();
}

async function requestSummary({ llm, pdfDataUrl, fileName, title }) {
  const prompts = await getLlmPrompts();
  return requestResponses({
    llm,
    fileName,
    pdfDataUrl,
    prompt: renderPromptTemplate(requirePrompt(prompts, 'paperSummary'), {
      title: title || fileName
    })
  });
}

async function requestStructuredFromPaper({ llm, pdfDataUrl, fileName, title, instruction }) {
  const prompts = await getLlmPrompts();
  const raw = await requestResponses({
    llm,
    fileName,
    pdfDataUrl,
    prompt: `${instruction}\n\n${renderPromptTemplate(requirePrompt(prompts, 'paperTitleSuffix'), {
      title: title || fileName
    })}`
  });
  return parseJsonFromText(raw);
}

async function requestText({ llm, modelFallbackPrompt }) {
  return requestResponses({
    llm,
    modelFallbackPrompt
  });
}

function parseJsonFromText(raw) {
  const clean = String(raw || '').trim();
  if (!clean) {
    return {};
  }
  try {
    return JSON.parse(clean);
  } catch {
    const candidates = [];
    const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      candidates.push(fenced[1].trim());
    }

    const arrayStart = clean.indexOf('[');
    const arrayEnd = clean.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      candidates.push(clean.slice(arrayStart, arrayEnd + 1));
    }

    const objectStart = clean.indexOf('{');
    const objectEnd = clean.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      candidates.push(clean.slice(objectStart, objectEnd + 1));
    }

    const seen = new Set();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next extraction candidate.
      }
    }
    return {};
  }
}

const LLM_PROMPTS_PATH = './data/llm-prompts.json';
const DEFAULT_LLM_PROMPTS = {
  paperSummary: '',
  extractMethods: '',
  extractReagents: '',
  knowledgeQa: '',
  paperTitleSuffix: ''
};

function normalizePromptConfig(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const fromNested = source.papers && typeof source.papers === 'object' ? source.papers : {};
  const fromFlat = source;
  return {
    ...DEFAULT_LLM_PROMPTS,
    ...fromFlat,
    ...fromNested
  };
}

async function getLlmPrompts() {
  try {
    const response = await fetch(`${LLM_PROMPTS_PATH}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load prompts: ${response.status}`);
    }
    const parsed = await response.json();
    return normalizePromptConfig(parsed);
  } catch {
    return normalizePromptConfig({});
  }
}

function requirePrompt(prompts, key) {
  const value = String(prompts?.[key] || '').trim();
  if (!value) {
    throw new Error(`Missing LLM prompt "${key}" in ${LLM_PROMPTS_PATH}.`);
  }
  return value;
}

function renderPromptTemplate(template, vars = {}) {
  const source = String(template || '');
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return String(vars[key] ?? '');
  });
}
