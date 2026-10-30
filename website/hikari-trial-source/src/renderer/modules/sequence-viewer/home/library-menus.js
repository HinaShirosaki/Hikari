import { cleanText } from '../shared.js';
import { startInlineRename } from '../../../lib/folder-tree.js';

// Right-click menu, inline rename, and folder create/delete/move for the
// sequence library list on the home page.
function createLibraryMenus({
  rootDocument,
  elements,
  state,
  setHomeStatus,
  renderLibraryList,
  onRenameLibraryEntry,
  onCreateLibraryFolder,
  onRenameLibraryFolder,
  onDeleteLibraryFolder,
  onMoveLibraryEntry
} = {}) {
  let libraryContextType = '';
  let libraryContextId = '';

  function compactElementList(...items) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
  }

  function getLibraryListElements() {
    return compactElementList(elements.libraryList, elements.detailLibraryList);
  }

  function getLibrarySavedFilterButtons() {
    return compactElementList(elements.libraryFilterSavedBtn, elements.detailLibraryFilterSavedBtn);
  }

  function getLibraryTemporaryFilterButtons() {
    return compactElementList(elements.libraryFilterTemporaryBtn, elements.detailLibraryFilterTemporaryBtn);
  }

  function getLibraryContextMenus() {
    return compactElementList(elements.libraryContextMenu, elements.detailLibraryContextMenu);
  }

  function hideLibraryContextMenus() {
    getLibraryContextMenus().forEach((menu) => {
      menu.hidden = true;
    });
    libraryContextType = '';
    libraryContextId = '';
  }

  function showLibraryContextMenu(menu, contextType, contextId, event) {
    if (!menu) {
      return;
    }
    hideLibraryContextMenus();
    libraryContextType = contextType;
    libraryContextId = contextId;
    const visibleActions = contextType === 'entry'
      ? new Set(['new-folder', 'rename', 'move-entry'])
      : contextType === 'folder'
        ? new Set(['new-folder', 'rename-folder', 'delete-folder'])
        : new Set(['new-folder']);
    menu.querySelectorAll?.('[data-sequence-library-action]')?.forEach?.((button) => {
      button.hidden = !visibleActions.has(cleanText(button?.dataset?.sequenceLibraryAction, 40));
    });
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Number(event?.clientX) || 0)}px`;
    menu.style.top = `${Math.max(8, Number(event?.clientY) || 0)}px`;
  }

  function normalizePromptName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  }

  function getPromptFunction() {
    const windowRef = rootDocument?.defaultView;
    return windowRef?.prompt?.bind(windowRef) || globalThis.prompt?.bind(globalThis) || null;
  }

  function getLibraryRenameTarget(type, id) {
    const collection = type === 'folder' ? state.libraryFolders : state.libraryEntries;
    return (Array.isArray(collection) ? collection : [])
      .find((item) => cleanText(item?.id, 200) === cleanText(id, 200)) || null;
  }

  // The list re-renders before the input goes in, so the row has to be looked
  // up again rather than reusing the element the event came from.
  function findLibraryRow(type, id, libraryList) {
    const attribute = type === 'folder' ? 'data-sequence-folder-main' : 'data-sequence-entry-id';
    const key = type === 'folder' ? 'sequenceFolderMain' : 'sequenceEntryId';
    const lists = libraryList ? [libraryList] : getLibraryListElements();
    for (const list of lists) {
      const row = Array.from(list?.querySelectorAll?.(`[${attribute}]`) || [])
        .find((item) => cleanText(item?.dataset?.[key], 200) === cleanText(id, 200));
      if (row) {
        return row;
      }
    }
    return null;
  }

  function beginLibraryRename(type, id, libraryList) {
    const target = getLibraryRenameTarget(type, id);
    hideLibraryContextMenus();
    if (!target) {
      return;
    }
    renderLibraryList();
    startInlineRename(findLibraryRow(type, target.id, libraryList), {
      value: String(target.name || (type === 'folder' ? 'Folder' : 'sequence')),
      maxLength: 140,
      label: `Rename ${type === 'folder' ? 'folder' : 'sequence'}`,
      onCommit: (nextName) => {
        void commitLibraryRename(type, cleanText(target.id, 200), nextName);
      }
    });
  }

  // Folder names are unique in the store, so the placeholder has to be too.
  function buildDefaultLibraryFolderName() {
    const taken = new Set((Array.isArray(state.libraryFolders) ? state.libraryFolders : [])
      .map((folder) => normalizePromptName(folder?.name).toLowerCase()));
    let suffix = 1;
    while (taken.has((suffix === 1 ? 'new folder' : `new folder ${suffix}`))) {
      suffix += 1;
    }
    return suffix === 1 ? 'New Folder' : `New Folder ${suffix}`;
  }

  async function commitLibraryRename(type, id, rawName) {
    const nextName = normalizePromptName(rawName);
    const target = getLibraryRenameTarget(type, id);
    if (!type || !id || nextName === String(target?.name || '')) {
      return;
    }
    if (!nextName) {
      setHomeStatus(`Enter a ${type === 'folder' ? 'folder' : 'sequence'} name.`, true);
      return;
    }
    try {
      if (type === 'folder') {
        await onRenameLibraryFolder(id, nextName);
      } else {
        await onRenameLibraryEntry(id, nextName);
      }
      renderLibraryList();
    } catch (error) {
      setHomeStatus(error?.message || `Failed to rename sequence ${type}.`, true);
    }
  }

  async function createLibraryFolderFromContextMenu(libraryList) {
    hideLibraryContextMenus();
    const nextName = buildDefaultLibraryFolderName();
    try {
      const folder = await onCreateLibraryFolder(nextName);
      beginLibraryRename('folder', folder?.id, libraryList);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to create sequence folder.', true);
    }
  }

  async function deleteLibraryFolderFromContextMenu() {
    const folderId = libraryContextType === 'folder' ? cleanText(libraryContextId, 200) : '';
    const folder = (Array.isArray(state.libraryFolders) ? state.libraryFolders : [])
      .find((item) => cleanText(item?.id, 200) === folderId);
    hideLibraryContextMenus();
    if (!folder) {
      return;
    }
    const confirmFn = rootDocument?.defaultView?.confirm || globalThis?.confirm;
    if (typeof confirmFn === 'function' && !confirmFn(`Delete folder "${folder.name}"? Its sequences will become unfiled.`)) {
      return;
    }
    try {
      await onDeleteLibraryFolder(folderId);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to delete sequence folder.', true);
    }
  }

  async function moveLibraryEntryFromContextMenu() {
    const entryId = libraryContextType === 'entry' ? cleanText(libraryContextId, 200) : '';
    const entry = (Array.isArray(state.libraryEntries) ? state.libraryEntries : [])
      .find((item) => cleanText(item?.id, 200) === entryId);
    const folders = Array.isArray(state.libraryFolders) ? state.libraryFolders : [];
    hideLibraryContextMenus();
    if (!entry) {
      return;
    }
    if (!folders.length) {
      setHomeStatus('Create a folder before moving sequences.', true);
      return;
    }
    const promptFn = getPromptFunction();
    if (typeof promptFn !== 'function') {
      setHomeStatus('Folder prompt unavailable.', true);
      return;
    }
    const currentFolder = folders.find((folder) => cleanText(folder?.id, 200) === cleanText(entry.folderId, 200));
    const requestedName = promptFn(
      `Move "${entry.name || 'sequence'}" to folder (${folders.map((folder) => folder.name).join(', ')}). Leave blank to remove from its folder.`,
      currentFolder?.name || ''
    );
    if (requestedName === null) {
      return;
    }
    const normalizedName = normalizePromptName(requestedName).toLowerCase();
    const folder = normalizedName
      ? folders.find((item) => String(item?.name || '').trim().toLowerCase() === normalizedName)
      : null;
    if (normalizedName && !folder) {
      setHomeStatus(`Folder "${normalizePromptName(requestedName)}" was not found.`, true);
      return;
    }
    await moveLibraryEntry(entryId, folder?.id || '');
  }

  async function moveLibraryEntry(entryId, folderId) {
    try {
      await onMoveLibraryEntry(entryId, folderId);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to move sequence entry.', true);
    }
  }

  return {
    getLibraryListElements,
    getLibrarySavedFilterButtons,
    getLibraryTemporaryFilterButtons,
    getLibraryContextMenus,
    hideLibraryContextMenus,
    showLibraryContextMenu,
    getLibraryRenameTarget,
    beginLibraryRename,
    commitLibraryRename,
    createLibraryFolderFromContextMenu,
    deleteLibraryFolderFromContextMenu,
    moveLibraryEntryFromContextMenu,
    moveLibraryEntry,
    getLibraryContextId: () => libraryContextId
  };
}

export { createLibraryMenus };
