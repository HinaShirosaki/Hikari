import {
  buildFolderKey,
  getFolderPaperCount,
  getLibraryFolders,
  getVisiblePapersForFolder,
  formatRelativePaperTime
} from './model.js';
import { getPaperDisplayTitle } from './pdf-metadata.js';
import { bindFileDropTarget } from '../../lib/file-drop.js';

const PAPER_DRAG_MIME = 'application/x-hikari-paper-id';

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
  const paperDragState = {
    paperId: '',
    activeDropTarget: null
  };

  function getExpandedFolderKeys() {
    if (!(libraryState.expandedFolderKeys instanceof Set)) {
      const normalized = Array.isArray(libraryState.expandedFolderKeys)
        ? libraryState.expandedFolderKeys
        : [];
      libraryState.expandedFolderKeys = new Set(
        normalized
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      );
    }
    return libraryState.expandedFolderKeys;
  }

  function pruneExpandedFolderKeys(folders = []) {
    const validKeys = new Set(
      (Array.isArray(folders) ? folders : [])
        .map((folder) => String(folder?.key || '').trim())
        .filter(Boolean)
    );
    const expandedFolderKeys = getExpandedFolderKeys();
    [...expandedFolderKeys].forEach((key) => {
      if (!validKeys.has(key)) {
        expandedFolderKeys.delete(key);
      }
    });
  }

  function isFolderExpanded(folderKey = '') {
    return getExpandedFolderKeys().has(String(folderKey || '').trim());
  }

  function setFolderExpanded(folderKey = '', expanded = false) {
    const normalizedKey = String(folderKey || '').trim();
    if (!normalizedKey) {
      return;
    }
    const expandedFolderKeys = getExpandedFolderKeys();
    if (expanded) {
      expandedFolderKeys.add(normalizedKey);
      return;
    }
    expandedFolderKeys.delete(normalizedKey);
  }

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

  function clearFolderRenameState() {
    libraryState.renamingFolderKey = '';
    libraryState.renamingFolderName = '';
  }

  function getRenameableFolder(folderKey = '') {
    const normalizedKey = String(folderKey || '').trim();
    if (!normalizedKey) {
      return null;
    }
    const folder = getLibraryFolders(state).find((item) => item.key === normalizedKey) || null;
    if (!folder || folder.type !== 'journal-club') {
      return null;
    }
    return folder;
  }

  function findFolderTarget(target) {
    if (!target || typeof target.closest !== 'function') {
      return null;
    }
    return target.closest('[data-folder-context]') || target.closest('[data-folder-select]') || null;
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

  function getDraggedPaperId(event) {
    const fromTransfer = typeof event?.dataTransfer?.getData === 'function'
      ? String(event.dataTransfer.getData(PAPER_DRAG_MIME) || '').trim()
      : '';
    return fromTransfer || String(paperDragState.paperId || '').trim();
  }

  function getDropFolderTarget(event) {
    if (!event?.target || typeof event.target.closest !== 'function') {
      return null;
    }
    return event.target.closest('[data-folder-drop]');
  }

  function canDropPaperOnFolder(paperId = '', folderKey = '') {
    const paper = (state.papers || []).find((item) => String(item?.id || '') === String(paperId || '')) || null;
    if (!paper) {
      return false;
    }
    const folder = getLibraryFolders(state).find((item) => item.key === folderKey) || null;
    if (!folder) {
      return false;
    }
    return buildFolderKey(paper.linkedType, paper.linkedId) !== folder.key;
  }

  function clearPaperDropTarget() {
    paperDragState.activeDropTarget?.classList?.remove?.('is-paper-drop-target');
    paperDragState.activeDropTarget = null;
  }

  function setPaperDropTarget(target) {
    if (paperDragState.activeDropTarget === target) {
      return;
    }
    clearPaperDropTarget();
    paperDragState.activeDropTarget = target;
    target?.classList?.add?.('is-paper-drop-target');
  }

  function onGlobalKeydown(event) {
    if (event?.key === 'Escape') {
      if (libraryState.renamingFolderKey) {
        cancelFolderRename();
        return;
      }
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

    const folderTarget = findFolderTarget(event.target);
    const folderKey = String(
      folderTarget?.dataset?.folderContext
      || folderTarget?.dataset?.folderSelect
      || libraryState.selectedFolderKey
      || ''
    ).trim();
    const folder = getLibraryFolders(state).find((item) => item.key === folderKey) || null;

    libraryContextState.folderKey = folder?.key || '';
    libraryContextState.folderId = folder?.id || '';
    libraryContextState.folderType = folder?.type || '';
    libraryContextState.paperId = '';

    if (elements.papersContextRenameFolderBtn) {
      elements.papersContextRenameFolderBtn.hidden = !(folder && folder.type === 'journal-club');
    }
    if (elements.papersContextDeleteFolderBtn) {
      elements.papersContextDeleteFolderBtn.hidden = !(folder && folder.type === 'journal-club');
    }

    const clientX = Number(event?.clientX) || 0;
    const clientY = Number(event?.clientY) || 0;
    elements.papersLibraryContextMenu.style.left = `${clientX}px`;
    elements.papersLibraryContextMenu.style.top = `${clientY}px`;
    elements.papersLibraryContextMenu.hidden = false;
  }

  function buildDefaultFolderName() {
    const existingNames = new Set(
      (state.journalClubs || [])
        .map((club) => String(club?.name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    let suffix = 1;
    while (true) {
      const candidate = suffix === 1 ? 'New Folder' : `New Folder ${suffix}`;
      if (!existingNames.has(candidate.toLowerCase())) {
        return candidate;
      }
      suffix += 1;
    }
  }

  function createJournalClubFolder({ name, description = '' } = {}) {
    const fallbackName = buildDefaultFolderName();
    const normalizedName = String(name || fallbackName).trim() || fallbackName;
    if (!normalizedName) {
      return null;
    }
    if (!Array.isArray(state.journalClubs)) {
      state.journalClubs = [];
    }

    const journalClub = {
      id: createId(),
      name: normalizedName,
      description: String(description || '').trim()
    };
    state.journalClubs.push(journalClub);

    persist();
    libraryState.selectedFolderKey = buildFolderKey('journal-club', journalClub.id);
    setFolderExpanded(libraryState.selectedFolderKey, true);
    renderLibrarySidebar();
    return journalClub;
  }

  function onCreateJournalClubFromMenu() {
    hideLibraryContextMenu();
    createJournalClubFolder({ name: buildDefaultFolderName() });
  }

  function focusRenameInput() {
    if (typeof windowRef?.requestAnimationFrame !== 'function') {
      return;
    }
    windowRef.requestAnimationFrame(() => {
      const renameInput = elements.journalClubList?.querySelector?.('[data-folder-rename-input]');
      renameInput?.focus?.();
      const value = String(renameInput?.value || '');
      renameInput?.setSelectionRange?.(0, value.length);
    });
  }

  function beginFolderRename(folderKey = '') {
    const folder = getRenameableFolder(folderKey);
    if (!folder) {
      return;
    }

    hideLibraryContextMenu();
    libraryState.selectedFolderKey = folder.key;
    setFolderExpanded(folder.key, true);
    libraryState.renamingFolderKey = folder.key;
    libraryState.renamingFolderName = folder.name;
    renderLibrarySidebar(folder.key);
    focusRenameInput();
  }

  function validateRenamedFolderName(nextName = '', currentFolderId = '') {
    const normalizedName = String(nextName || '').trim();
    if (!normalizedName) {
      return {
        ok: false,
        error: 'Folder name cannot be empty.'
      };
    }
    const duplicate = (state.journalClubs || []).find((club) => (
      String(club?.id || '').trim() !== String(currentFolderId || '').trim()
      && String(club?.name || '').trim().toLowerCase() === normalizedName.toLowerCase()
    ));
    if (duplicate) {
      return {
        ok: false,
        error: 'A folder with this name already exists.'
      };
    }
    return {
      ok: true,
      name: normalizedName
    };
  }

  function commitFolderRename(folderKey = '') {
    const folder = getRenameableFolder(folderKey || libraryState.renamingFolderKey);
    if (!folder) {
      clearFolderRenameState();
      renderLibrarySidebar(libraryState.selectedFolderKey);
      return;
    }

    const validation = validateRenamedFolderName(libraryState.renamingFolderName, folder.id);
    if (!validation.ok) {
      windowRef?.alert?.(validation.error);
      focusRenameInput();
      return;
    }

    const journalClub = (state.journalClubs || []).find((club) => String(club?.id || '').trim() === String(folder.id || '').trim()) || null;
    if (!journalClub) {
      clearFolderRenameState();
      renderLibrarySidebar(libraryState.selectedFolderKey);
      return;
    }

    journalClub.name = validation.name;
    clearFolderRenameState();
    persist();
    renderLibrarySidebar(folder.key);
  }

  function cancelFolderRename() {
    if (!libraryState.renamingFolderKey) {
      return;
    }
    clearFolderRenameState();
    renderLibrarySidebar(libraryState.selectedFolderKey);
  }

  function onRenameJournalClubFromMenu() {
    beginFolderRename(libraryContextState.folderKey);
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

  function onRenameJournalClubFromMenuClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onRenameJournalClubFromMenu();
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
    pruneExpandedFolderKeys(folders);
    const previousSelectedKey = String(libraryState.selectedFolderKey || '').trim();
    const selectedFolder = folders.find((folder) => folder.key === preferredKey)
      || folders.find((folder) => folder.key === libraryState.selectedFolderKey)
      || folders.find((folder) => folder.key === buildFolderKey(elements.paperLinkTypeSelect?.value, elements.paperLinkTargetSelect?.value))
      || folders[0]
      || null;

    libraryState.selectedFolderKey = selectedFolder?.key || '';
    if (
      selectedFolder?.key
      && (
        libraryState.hasInitializedFolderExpansion !== true
        || previousSelectedKey !== selectedFolder.key
      )
    ) {
      setFolderExpanded(selectedFolder.key, true);
      libraryState.hasInitializedFolderExpansion = true;
    }

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
        data-paper-drag="${paper.id}"
        draggable="true"
      >
        <span class="papers-paper-title">${safeText(getPaperDisplayTitle(paper))}</span>
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
      <div class="papers-folder-group${folder.key === selectedFolder?.key ? ' is-active' : ''}${isFolderExpanded(folder.key) ? ' is-expanded' : ''}">
        ${libraryState.renamingFolderKey === folder.key ? `
          <div
            class="papers-folder-item papers-folder-item-editing${folder.key === selectedFolder?.key ? ' is-active' : ''}${isFolderExpanded(folder.key) ? ' is-expanded' : ''}"
            data-folder-context="${safeText(folder.key)}"
          >
            <span class="papers-folder-chevron" aria-hidden="true"></span>
            <span class="papers-folder-glyph" aria-hidden="true"></span>
            <div class="papers-folder-rename-wrap">
              <input
                type="text"
                class="papers-folder-rename-input"
                data-folder-rename-input="${safeText(folder.key)}"
                value="${safeText(libraryState.renamingFolderName || folder.name)}"
                aria-label="Rename folder"
              />
              <button
                type="button"
                class="papers-folder-rename-btn"
                data-folder-rename-save="${safeText(folder.key)}"
              >
                Save
              </button>
              <button
                type="button"
                class="papers-folder-rename-btn is-secondary"
                data-folder-rename-cancel="${safeText(folder.key)}"
              >
                Cancel
              </button>
            </div>
            <span class="papers-folder-count">${getFolderPaperCount(state, folder)}</span>
          </div>
        ` : `
          <button
            type="button"
            class="papers-folder-item${folder.key === selectedFolder?.key ? ' is-active' : ''}${isFolderExpanded(folder.key) ? ' is-expanded' : ''}"
            data-folder-select="${safeText(folder.key)}"
            data-folder-context="${safeText(folder.key)}"
            data-folder-drop="${safeText(folder.key)}"
            aria-expanded="${isFolderExpanded(folder.key) ? 'true' : 'false'}"
          >
            <span class="papers-folder-chevron" aria-hidden="true"></span>
            <span class="papers-folder-glyph" aria-hidden="true"></span>
            <span class="papers-folder-name">${safeText(folder.name)}</span>
            <span class="papers-folder-count">${getFolderPaperCount(state, folder)}</span>
          </button>
        `}
        ${isFolderExpanded(folder.key) ? `<div class="papers-folder-children">${buildPaperTreeListHtml(folder)}</div>` : ''}
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

  function renderLibrarySidebar(preferredFolderKey = '') {
    const selectedFolder = syncSelectedFolder(preferredFolderKey);
    hideLibraryContextMenu();
    renderUploadTargetSummary(selectedFolder);
    renderFolderList(selectedFolder);
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

  function onFolderListClick(event) {
    const renameSaveBtn = event.target?.closest?.('[data-folder-rename-save]');
    if (renameSaveBtn) {
      commitFolderRename(renameSaveBtn.dataset.folderRenameSave);
      return;
    }

    const renameCancelBtn = event.target?.closest?.('[data-folder-rename-cancel]');
    if (renameCancelBtn) {
      cancelFolderRename();
      return;
    }

    if (event.target?.closest?.('[data-folder-rename-input]')) {
      return;
    }

    const selectBtn = event.target?.closest?.('[data-folder-select]');
    if (!selectBtn) {
      return;
    }
    hideLibraryContextMenu();
    const folderKey = String(selectBtn.dataset.folderSelect || '').trim();
    const alreadySelected = folderKey && folderKey === libraryState.selectedFolderKey;
    libraryState.selectedFolderKey = folderKey;
    if (folderKey) {
      setFolderExpanded(folderKey, alreadySelected ? !isFolderExpanded(folderKey) : true);
    }
    renderLibrarySidebar(libraryState.selectedFolderKey);
  }

  function onPaperDragStart(event) {
    const paperTarget = event.target?.closest?.('[data-paper-drag]');
    const paperId = String(paperTarget?.dataset?.paperDrag || '').trim();
    if (!paperId) {
      return;
    }
    paperDragState.paperId = paperId;
    paperTarget?.classList?.add?.('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.dropEffect = 'move';
      event.dataTransfer.setData?.(PAPER_DRAG_MIME, paperId);
      event.dataTransfer.setData?.('text/plain', paperId);
    }
  }

  function onPaperDragEnd(event) {
    event.target?.closest?.('[data-paper-drag]')?.classList?.remove?.('is-dragging');
    paperDragState.paperId = '';
    clearPaperDropTarget();
  }

  function onPaperDragOver(event) {
    const folderTarget = getDropFolderTarget(event);
    const folderKey = String(folderTarget?.dataset?.folderDrop || '').trim();
    const paperId = getDraggedPaperId(event);
    if (!folderTarget || !canDropPaperOnFolder(paperId, folderKey)) {
      clearPaperDropTarget();
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setPaperDropTarget(folderTarget);
  }

  function onPaperDragLeave(event) {
    const folderTarget = getDropFolderTarget(event);
    if (folderTarget && folderTarget === paperDragState.activeDropTarget) {
      clearPaperDropTarget();
    }
  }

  function onPaperDrop(event) {
    const folderTarget = getDropFolderTarget(event);
    const folderKey = String(folderTarget?.dataset?.folderDrop || '').trim();
    const paperId = getDraggedPaperId(event);
    if (!folderTarget || !canDropPaperOnFolder(paperId, folderKey)) {
      clearPaperDropTarget();
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    clearPaperDropTarget();
    paperDragState.paperId = '';
    void context.actions?.movePaperToFolder?.(paperId, folderKey);
  }

  function onFolderListInput(event) {
    const renameInput = event.target?.closest?.('[data-folder-rename-input]');
    if (!renameInput) {
      return;
    }
    libraryState.renamingFolderName = String(event.target?.value || '');
  }

  function onFolderListKeydown(event) {
    const renameInput = event.target?.closest?.('[data-folder-rename-input]');
    if (!renameInput) {
      return;
    }

    if (event?.key === 'Enter') {
      event.preventDefault?.();
      event.stopPropagation?.();
      commitFolderRename(renameInput.dataset.folderRenameInput);
      return;
    }

    if (event?.key === 'Escape') {
      event.preventDefault?.();
      event.stopPropagation?.();
      cancelFolderRename();
    }
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
    elements.journalClubList?.addEventListener('input', onFolderListInput);
    elements.journalClubList?.addEventListener('keydown', onFolderListKeydown);
    elements.journalClubList?.addEventListener('dragstart', onPaperDragStart);
    elements.journalClubList?.addEventListener('dragend', onPaperDragEnd);
    elements.journalClubList?.addEventListener('dragover', onPaperDragOver);
    elements.journalClubList?.addEventListener('dragleave', onPaperDragLeave);
    elements.journalClubList?.addEventListener('drop', onPaperDrop);
    elements.journalClubList?.addEventListener('click', onPaperListClick);
    elements.papersLibraryRail?.addEventListener('contextmenu', onLibraryContextMenu);
    elements.papersLibraryContextMenu?.addEventListener('click', onLibraryContextMenuClick);
    elements.paperList?.addEventListener('click', onPaperListClick);
    elements.papersContextNewFolderBtn?.addEventListener('click', onCreateJournalClubFromMenuClick);
    elements.papersContextRenameFolderBtn?.addEventListener('click', onRenameJournalClubFromMenuClick);
    elements.papersContextDeleteFolderBtn?.addEventListener('click', onDeleteJournalClubFromMenuClick);
    bindFileDropTarget({
      target: elements.papersLibraryRail || elements.journalClubList,
      accept: elements.paperPdfInput?.getAttribute?.('accept') || 'application/pdf,.pdf',
      multiple: true,
      onFiles: async (files) => {
        const selectedFolder = getSelectedFolder();
        if (!selectedFolder) {
          windowRef?.alert?.('Create or select a folder before uploading a paper.');
          return;
        }
        await context.actions?.uploadPaperFiles?.(files);
      },
      onRejected: () => {
        windowRef?.alert?.('Drop PDF files to add them to the selected paper folder.');
      },
      onError: (error) => {
        windowRef?.alert?.(String(error?.message || error || 'Failed to upload dropped PDF files.'));
      }
    });
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
    ensureFolderExpanded(folderKey = '') {
      setFolderExpanded(folderKey, true);
    },
    getCurrentLinkOptions,
    getSelectedFolder,
    hideLibraryContextMenu,
    renderLinkTargets,
    renderLibrarySidebar,
    schedulePapersEdgeBleedSync
  };
}
