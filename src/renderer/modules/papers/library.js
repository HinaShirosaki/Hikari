import {
  buildFolderKey,
  getFolderPaperCount,
  getLibraryFolders,
  getVisiblePapersForFolder,
  formatRelativePaperTime
} from './model.js';
import { getPaperDisplayTitle } from './pdf-metadata.js';
import { createLibraryFolderMenu } from './library-folder-menu.js';
import { createLibraryEvents } from './library-events.js';

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


  const folderMenu = createLibraryFolderMenu({
    state,
    persist,
    createId,
    windowRef,
    context,
    elements,
    libraryState,
    libraryContextState,
    paperDragState,
    PAPER_DRAG_MIME,
    setFolderExpanded,
    renderLibrarySidebar: (key) => renderLibrarySidebar(key)
  });

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
            <span class="left-rail-folder-glyph papers-folder-glyph" aria-hidden="true"></span>
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
            <span class="left-rail-folder-glyph papers-folder-glyph" aria-hidden="true"></span>
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
    folderMenu.hideLibraryContextMenu();
    renderUploadTargetSummary(selectedFolder);
    renderFolderList(selectedFolder);
    schedulePapersEdgeBleedSync();
  }

  const {
    renderLinkTargets,
    bindEvents,
    observeViewActivation
  } = createLibraryEvents({
    documentRef,
    windowRef,
    elements,
    context,
    libraryState,
    paperDragState,
    PAPER_DRAG_MIME,
    getSelectedFolder,
    isFolderExpanded,
    setFolderExpanded,
    renderLibrarySidebar,
    schedulePapersEdgeBleedSync,
    folderMenu
  });

  return {
    bindEvents,
    observeViewActivation,
    getCurrentLinkOptions,
    ensureFolderExpanded(folderKey = '') {
      setFolderExpanded(folderKey, true);
    },
    getSelectedFolder,
    hideLibraryContextMenu: folderMenu.hideLibraryContextMenu,
    renderLinkTargets,
    renderLibrarySidebar,
    schedulePapersEdgeBleedSync
  };
}
