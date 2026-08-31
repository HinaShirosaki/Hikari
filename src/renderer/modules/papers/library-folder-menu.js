import { buildFolderKey, getLibraryFolders } from './model.js';
import { showTransientNotice } from '../../lib/notify.js';
import { startInlineRename } from '../../lib/folder-tree.js';

// The journal-club folder rail's context menu and drag-and-drop: create,
// rename, delete a folder, and validate a paper drop onto one.
function createLibraryFolderMenu({
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
  renderLibrarySidebar
} = {}) {
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

  // The rail re-renders before the input goes in, so the row has to be looked
  // up again rather than reusing the element the event came from.
  function findFolderMain(folderKey) {
    return Array.from(elements.journalClubList?.querySelectorAll?.('[data-folder-select]') || [])
      .find((item) => item?.dataset?.folderSelect === folderKey) || null;
  }

  function beginFolderRename(folderKey = '') {
    const folder = getRenameableFolder(folderKey);
    if (!folder) {
      return;
    }

    hideLibraryContextMenu();
    libraryState.selectedFolderKey = folder.key;
    setFolderExpanded(folder.key, true);
    renderLibrarySidebar(folder.key);
    startInlineRename(findFolderMain(folder.key), {
      value: folder.name,
      label: 'Rename folder',
      onCommit: (nextName) => commitFolderRename(folder.key, nextName)
    });
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

  function commitFolderRename(folderKey = '', rawName = '') {
    const folder = getRenameableFolder(folderKey);
    if (!folder || String(rawName || '').trim() === folder.name) {
      return;
    }

    const validation = validateRenamedFolderName(rawName, folder.id);
    if (!validation.ok) {
      showTransientNotice(validation.error, { type: 'error' });
      return;
    }

    const journalClub = (state.journalClubs || []).find((club) => String(club?.id || '').trim() === String(folder.id || '').trim()) || null;
    if (!journalClub) {
      return;
    }

    journalClub.name = validation.name;
    persist();
    renderLibrarySidebar(folder.key);
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

  return {
    getRenameableFolder,
    findFolderTarget,
    hideLibraryContextMenu,
    getDraggedPaperId,
    getDropFolderTarget,
    canDropPaperOnFolder,
    clearPaperDropTarget,
    setPaperDropTarget,
    onGlobalKeydown,
    onLibraryContextMenuClick,
    onLibraryContextMenu,
    buildDefaultFolderName,
    createJournalClubFolder,
    onCreateJournalClubFromMenu,
    beginFolderRename,
    validateRenamedFolderName,
    onRenameJournalClubFromMenu,
    onDeleteJournalClubFromMenu,
    onCreateJournalClubFromMenuClick,
    onRenameJournalClubFromMenuClick,
    onDeleteJournalClubFromMenuClick
  };
}

export { createLibraryFolderMenu };
