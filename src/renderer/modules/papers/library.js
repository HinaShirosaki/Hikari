import {
  buildFolderKey,
  getFolderPaperCount,
  getLibraryFolders,
  getVisiblePapersForFolder,
  formatRelativePaperTime
} from './model.js';

export function createPapersLibraryController(context) {
  const {
    state,
    persist,
    createId,
    safeText,
    paperViewer,
    document: documentRef,
    window: windowRef,
    libraryState,
    libraryContextState,
    elements
  } = context;

  function getCurrentLinkOptions() {
    if (elements.paperLinkTypeSelect?.value === 'journal-club') {
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

  function hideLibraryContextMenu() {
    if (!elements.papersLibraryContextMenu) {
      return;
    }
    elements.papersLibraryContextMenu.hidden = true;
    libraryContextState.folderKey = '';
    libraryContextState.folderId = '';
    libraryContextState.folderType = '';
    libraryContextState.paperId = '';
  }

  function onGlobalKeydown(event) {
    if (event?.key === 'Escape') {
      hideLibraryContextMenu();
    }
  }

  function onLibraryContextMenuClick(event) {
    event?.stopPropagation?.();
  }

  function onLibraryContextMenu(event) {
    if (!elements.papersLibraryContextMenu) {
      return;
    }
    event.preventDefault?.();

    const folderTarget = event.target?.closest?.('[data-folder-select]');
    const folderKey = String(folderTarget?.dataset?.folderSelect || libraryState.selectedFolderKey || '').trim();
    const folder = getLibraryFolders(state).find((item) => item.key === folderKey) || null;

    libraryContextState.folderKey = folder?.key || '';
    libraryContextState.folderId = folder?.id || '';
    libraryContextState.folderType = folder?.type || '';
    libraryContextState.paperId = '';

    if (elements.papersContextDeleteFolderBtn) {
      elements.papersContextDeleteFolderBtn.hidden = !(folder && folder.type === 'journal-club');
    }

    const clientX = Number(event?.clientX) || 0;
    const clientY = Number(event?.clientY) || 0;
    elements.papersLibraryContextMenu.style.left = `${clientX}px`;
    elements.papersLibraryContextMenu.style.top = `${clientY}px`;
    elements.papersLibraryContextMenu.hidden = false;
  }

  function createJournalClubFolder({ name, description = '' } = {}) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      return false;
    }

    const journalClub = {
      id: createId(),
      name: normalizedName,
      description: String(description || '').trim()
    };
    state.journalClubs.push(journalClub);

    persist();
    libraryState.selectedFolderKey = buildFolderKey('journal-club', journalClub.id);
    renderLibrarySidebar();
    return true;
  }

  function onCreateJournalClubFromMenu() {
    hideLibraryContextMenu();
    const promptFn = typeof windowRef?.prompt === 'function' ? windowRef.prompt.bind(windowRef) : null;
    if (!promptFn) {
      windowRef?.alert?.('Folder naming prompt is unavailable.');
      return;
    }

    const name = String(promptFn('Journal club folder name') || '').trim();
    if (!name) {
      return;
    }
    createJournalClubFolder({ name });
  }

  function onDeleteJournalClubFromMenu() {
    const folderId = String(libraryContextState.folderId || '').trim();
    const folderType = String(libraryContextState.folderType || '').trim();
    hideLibraryContextMenu();
    if (!folderId || folderType !== 'journal-club') {
      return;
    }

    const canDelete = typeof windowRef?.confirm !== 'function'
      || windowRef.confirm('Delete this journal club folder and its papers?');
    if (!canDelete) {
      return;
    }

    context.actions?.deleteJournalClub(folderId);
  }

  function onCreateJournalClubFromMenuClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onCreateJournalClubFromMenu();
  }

  function onDeleteJournalClubFromMenuClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onDeleteJournalClubFromMenu();
  }

  function syncPapersEdgeBleed() {
    if (!elements.papersView?.style || typeof elements.papersView.getBoundingClientRect !== 'function') {
      return;
    }

    const rect = elements.papersView.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      elements.papersView.style.setProperty('--papers-edge-bleed-left', '0px');
      elements.papersView.style.setProperty('--papers-edge-bleed-right', '0px');
      return;
    }

    const workspaceMain = typeof elements.papersView.closest === 'function'
      ? elements.papersView.closest('.workspace-main')
      : null;
    const workspaceRect = typeof workspaceMain?.getBoundingClientRect === 'function'
      ? workspaceMain.getBoundingClientRect()
      : null;
    const appSidebar = typeof documentRef?.querySelector === 'function'
      ? documentRef.querySelector('.app-sidebar')
      : null;
    const sidebarRect = typeof appSidebar?.getBoundingClientRect === 'function'
      ? appSidebar.getBoundingClientRect()
      : null;
    const sidebarVisible = Boolean(
      appSidebar
      && sidebarRect
      && sidebarRect.width > 0
      && (typeof windowRef?.getComputedStyle !== 'function' || windowRef.getComputedStyle(appSidebar).display !== 'none')
    );

    const viewportWidth = Number(windowRef?.innerWidth) || 0;
    const leftEdge = sidebarVisible && workspaceRect ? workspaceRect.left : 0;
    const rightEdge = sidebarVisible && workspaceRect
      ? workspaceRect.right
      : (viewportWidth > 0 ? viewportWidth : (workspaceRect?.right || rect.right));

    const leftBleed = Math.max(0, rect.left - leftEdge);
    const rightBleed = Math.max(0, rightEdge - rect.right);

    elements.papersView.style.setProperty('--papers-edge-bleed-left', `${Math.round(leftBleed)}px`);
    elements.papersView.style.setProperty('--papers-edge-bleed-right', `${Math.round(rightBleed)}px`);
  }

  function schedulePapersEdgeBleedSync() {
    syncPapersEdgeBleed();
    if (typeof windowRef?.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(() => {
        syncPapersEdgeBleed();
      });
    }
  }

  function syncSelectedFolder(preferredKey = '') {
    const folders = getLibraryFolders(state);
    const selectedFolder = folders.find((folder) => folder.key === preferredKey)
      || folders.find((folder) => folder.key === libraryState.selectedFolderKey)
      || folders.find((folder) => folder.key === buildFolderKey(elements.paperLinkTypeSelect?.value, elements.paperLinkTargetSelect?.value))
      || folders[0]
      || null;

    libraryState.selectedFolderKey = selectedFolder?.key || '';

    if (!selectedFolder) {
      if (elements.paperLinkTargetSelect) {
        elements.paperLinkTargetSelect.innerHTML = '<option value="">No target available</option>';
      }
      return null;
    }

    if (elements.paperLinkTypeSelect) {
      elements.paperLinkTypeSelect.value = selectedFolder.type;
    }

    const options = selectedFolder.type === 'journal-club'
      ? (state.journalClubs || []).map((club) => ({ id: club.id, name: club.name }))
      : (state.projects || []).map((project) => ({ id: project.id, name: project.name }));

    if (elements.paperLinkTargetSelect) {
      elements.paperLinkTargetSelect.innerHTML = options.length
        ? options.map((item) => `<option value="${item.id}">${safeText(item.name)}</option>`).join('')
        : '<option value="">No target available</option>';
      if (options.some((item) => item.id === selectedFolder.id)) {
        elements.paperLinkTargetSelect.value = selectedFolder.id;
      }
    }

    return selectedFolder;
  }

  function getSelectedFolder() {
    return syncSelectedFolder();
  }

  function buildPaperTreeListHtml(selectedFolder = getSelectedFolder()) {
    const visiblePapers = getVisiblePapersForFolder(state, selectedFolder);
    if (!visiblePapers.length) {
      return selectedFolder
        ? `<p class="papers-library-empty">No papers in ${safeText(selectedFolder.name)} yet.</p>`
        : '<p class="papers-library-empty">No papers uploaded yet.</p>';
    }

    const activePaperId = paperViewer.getActivePaperId();
    return visiblePapers.map((paper) => `
      <button
        type="button"
        class="papers-paper-row${activePaperId === paper.id ? ' is-active' : ''}"
        data-paper-view="${paper.id}"
      >
        <span class="papers-paper-title">${safeText(paper.title)}</span>
        <span class="papers-paper-time">${safeText(formatRelativePaperTime(paper.updatedAt))}</span>
      </button>
    `).join('');
  }

  function renderFolderList(selectedFolder = getSelectedFolder()) {
    if (!elements.journalClubList) {
      return;
    }

    const folders = getLibraryFolders(state);
    const paperTreeHtml = buildPaperTreeListHtml(selectedFolder);
    if (elements.paperList) {
      elements.paperList.innerHTML = paperTreeHtml;
    }
    if (elements.paperFolderSelection) {
      elements.paperFolderSelection.textContent = selectedFolder
        ? `${selectedFolder.type === 'journal-club' ? 'Journal Club' : 'Project'} folder`
        : 'No folder selected';
    }
    if (!folders.length) {
      elements.journalClubList.innerHTML = '<p class="papers-library-empty">No project or journal club folders yet.</p>';
      return;
    }

    elements.journalClubList.innerHTML = folders.map((folder) => `
      <div class="papers-folder-group${folder.key === selectedFolder?.key ? ' is-active' : ''}">
        <button
          type="button"
          class="papers-folder-item${folder.key === selectedFolder?.key ? ' is-active' : ''}"
          data-folder-select="${safeText(folder.key)}"
        >
          <span class="papers-folder-glyph" aria-hidden="true"></span>
          <span class="papers-folder-name">${safeText(folder.name)}</span>
        </button>
        ${folder.key === selectedFolder?.key ? `<div class="papers-folder-children">${paperTreeHtml}</div>` : ''}
      </div>
    `).join('');
  }

  function renderUploadTargetSummary(selectedFolder = getSelectedFolder()) {
    if (elements.paperFolderSelection) {
      elements.paperFolderSelection.textContent = selectedFolder
        ? `${selectedFolder.type === 'journal-club' ? 'Journal club' : 'Project'}: ${selectedFolder.name}`
        : 'No folder selected';
    }
    if (!elements.paperUploadTargetLabel) {
      return;
    }
    if (!selectedFolder) {
      elements.paperUploadTargetLabel.textContent = 'Select a folder to file new papers.';
      if (elements.paperUploadTrigger) {
        elements.paperUploadTrigger.disabled = true;
      }
      return;
    }
    const prefix = selectedFolder.type === 'journal-club' ? 'Journal club' : 'Project';
    elements.paperUploadTargetLabel.textContent = `New uploads go to ${prefix}: ${selectedFolder.name}`;
    if (elements.paperUploadTrigger) {
      elements.paperUploadTrigger.disabled = false;
    }
  }

  function renderViewerToolbarState() {
    if (!elements.paperViewerSummarizeBtn) {
      return;
    }
    const activePaper = context.getActivePaper?.() || null;
    elements.paperViewerSummarizeBtn.disabled = !activePaper || activePaper.summaryStatus === 'running';
    elements.paperViewerSummarizeBtn.textContent = activePaper?.summaryStatus === 'running'
      ? 'Summarizing...'
      : 'Summarize';
  }

  function renderLibrarySidebar(preferredFolderKey = '') {
    const selectedFolder = syncSelectedFolder(preferredFolderKey);
    hideLibraryContextMenu();
    renderUploadTargetSummary(selectedFolder);
    renderFolderList(selectedFolder);
    renderViewerToolbarState();
    schedulePapersEdgeBleedSync();
  }

  function onUploadTriggerClick() {
    const selectedFolder = getSelectedFolder();
    if (!selectedFolder) {
      windowRef?.alert?.('Create or select a folder before uploading a paper.');
      return;
    }
    if (elements.paperTitleInput) {
      elements.paperTitleInput.value = '';
    }
    elements.paperPdfInput?.click?.();
  }

  function onPaperFileChange() {
    if (!elements.paperPdfInput?.files?.length) {
      return;
    }
    if (typeof elements.paperForm?.requestSubmit === 'function') {
      elements.paperForm.requestSubmit();
      return;
    }
    context.actions?.onPaperSubmit({
      preventDefault() {}
    });
  }

  function onViewerSummarizeClick() {
    const activePaper = context.getActivePaper?.() || null;
    if (!activePaper) {
      return;
    }
    context.actions?.summarizePaper(activePaper.id);
  }

  function onFolderListClick(event) {
    const selectBtn = event.target?.closest?.('[data-folder-select]');
    if (!selectBtn) {
      return;
    }
    hideLibraryContextMenu();
    libraryState.selectedFolderKey = selectBtn.dataset.folderSelect;
    renderLibrarySidebar(libraryState.selectedFolderKey);
  }

  function onPaperListClick(event) {
    const viewBtn = event.target?.closest?.('[data-paper-view]');
    if (viewBtn) {
      void context.actions?.viewPaperPdf(viewBtn.dataset.paperView);
      return;
    }

    const openBtn = event.target?.closest?.('[data-paper-open]');
    if (openBtn) {
      void context.actions?.openPaperPdf(openBtn.dataset.paperOpen);
      return;
    }

    const summarizeBtn = event.target?.closest?.('[data-paper-summarize]');
    if (summarizeBtn) {
      void context.actions?.summarizePaper(summarizeBtn.dataset.paperSummarize);
      return;
    }

    const deleteBtn = event.target?.closest?.('[data-paper-delete]');
    if (deleteBtn) {
      context.actions?.deletePaper(deleteBtn.dataset.paperDelete);
      return;
    }

    const extractMethodsBtn = event.target?.closest?.('[data-paper-extract-methods]');
    if (extractMethodsBtn) {
      void context.actions?.extractMethods(extractMethodsBtn.dataset.paperExtractMethods);
      return;
    }

    const extractReagentsBtn = event.target?.closest?.('[data-paper-extract-reagents]');
    if (extractReagentsBtn) {
      void context.actions?.extractReagents(extractReagentsBtn.dataset.paperExtractReagents);
      return;
    }

    const protocolBtn = event.target?.closest?.('[data-paper-method-to-protocol]');
    if (protocolBtn) {
      context.actions?.handleMethodToProtocol(protocolBtn.dataset.paperId, Number(protocolBtn.dataset.methodIndex));
    }
  }

  function renderLinkTargets() {
    renderLibrarySidebar(buildFolderKey(elements.paperLinkTypeSelect?.value, elements.paperLinkTargetSelect?.value));
  }

  function observeViewActivation() {
    if (!elements.papersView || typeof MutationObserver !== 'function') {
      return null;
    }
    const papersViewObserver = new MutationObserver(() => {
      if (elements.papersView.classList?.contains('is-active')) {
        schedulePapersEdgeBleedSync();
      }
    });
    papersViewObserver.observe(elements.papersView, {
      attributes: true,
      attributeFilter: ['class']
    });
    return papersViewObserver;
  }

  function bindEvents() {
    elements.paperLinkTypeSelect?.addEventListener('change', renderLinkTargets);
    elements.paperUploadTrigger?.addEventListener('click', onUploadTriggerClick);
    elements.paperPdfInput?.addEventListener('change', onPaperFileChange);
    elements.journalClubList?.addEventListener('click', onFolderListClick);
    elements.journalClubList?.addEventListener('click', onPaperListClick);
    elements.papersLibraryRail?.addEventListener('contextmenu', onLibraryContextMenu);
    elements.papersLibraryContextMenu?.addEventListener('click', onLibraryContextMenuClick);
    elements.paperList?.addEventListener('click', onPaperListClick);
    elements.paperViewerSummarizeBtn?.addEventListener('click', onViewerSummarizeClick);
    elements.papersContextNewFolderBtn?.addEventListener('click', onCreateJournalClubFromMenuClick);
    elements.papersContextDeleteFolderBtn?.addEventListener('click', onDeleteJournalClubFromMenuClick);
    if (typeof windowRef?.addEventListener === 'function') {
      windowRef.addEventListener('resize', schedulePapersEdgeBleedSync);
      windowRef.addEventListener('resize', hideLibraryContextMenu);
    }
    if (typeof documentRef?.addEventListener === 'function') {
      documentRef.addEventListener('click', hideLibraryContextMenu);
      documentRef.addEventListener('keydown', onGlobalKeydown);
    }
  }

  return {
    bindEvents,
    observeViewActivation,
    getCurrentLinkOptions,
    getSelectedFolder,
    hideLibraryContextMenu,
    renderLinkTargets,
    renderLibrarySidebar,
    renderViewerToolbarState,
    schedulePapersEdgeBleedSync
  };
}
