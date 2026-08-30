import { asArray, trimText } from './shared.js';
import {
  GENERAL_CHAT_FOLDER_ID,
  buildCustomChatFolderId,
  buildDefaultChatFolderName,
  getAgentChatFolders,
  getFolderById
} from './session-folders.js';
import { showTransientNotice } from '../../lib/notify.js';

// Right-click menu and inline rename for the agent chat session folders, plus
// the drop-target bookkeeping shared with the drag handlers.
function createSessionFolderMenu({
  state,
  persist,
  createId,
  ensureAgentState,
  sessionList,
  sessionContextMenu,
  contextRenameFolderBtn,
  contextDeleteFolderBtn,
  renderSessionList,
  selectFolder
} = {}) {
  let renamingFolderId = '';
  let renamingFolderName = '';
  let contextFolderId = '';
  let activeDropTarget = null;

  function hideContextMenu() {
    if (sessionContextMenu) {
      sessionContextMenu.hidden = true;
    }
    contextFolderId = '';
  }

  function findFolderTarget(target) {
    return target?.closest?.('[data-agent-folder-context]')
      || target?.closest?.('[data-agent-folder-id]')
      || null;
  }

  function onRailContextMenu(event) {
    if (!sessionContextMenu) {
      return;
    }
    event?.preventDefault?.();
    const folderTarget = findFolderTarget(event?.target);
    const folderId = trimText(
      folderTarget?.dataset?.agentFolderContext || folderTarget?.dataset?.agentFolderId,
      180
    );
    const folder = getFolderById(state, folderId);
    contextFolderId = folder?.id || '';
    if (contextRenameFolderBtn) {
      contextRenameFolderBtn.hidden = folder?.type !== 'custom';
    }
    if (contextDeleteFolderBtn) {
      contextDeleteFolderBtn.hidden = folder?.type !== 'custom';
    }
    sessionContextMenu.style.left = `${Math.max(0, Number(event?.clientX) || 0)}px`;
    sessionContextMenu.style.top = `${Math.max(0, Number(event?.clientY) || 0)}px`;
    sessionContextMenu.hidden = false;
  }

  function focusRenameInput() {
    const focus = () => {
      const input = sessionList?.querySelector?.('[data-agent-folder-rename-input]');
      input?.focus?.();
      const value = String(input?.value || '');
      input?.setSelectionRange?.(0, value.length);
    };
    const windowRef = sessionList?.ownerDocument?.defaultView;
    if (typeof windowRef?.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(focus);
    } else {
      focus();
    }
  }

  function beginFolderRename(folderId) {
    const folder = getFolderById(state, folderId);
    if (folder?.type !== 'custom') {
      return;
    }
    hideContextMenu();
    selectFolder(folder.id, { persistState: false });
    renamingFolderId = folder.id;
    renamingFolderName = folder.name;
    renderSessionList();
    focusRenameInput();
  }

  function cancelFolderRename() {
    renamingFolderId = '';
    renamingFolderName = '';
    renderSessionList();
  }

  function commitFolderRename(folderId = renamingFolderId) {
    const folder = getFolderById(state, folderId);
    const nextName = trimText(renamingFolderName, 220);
    if (folder?.type !== 'custom' || !nextName) {
      focusRenameInput();
      return;
    }
    const duplicate = getAgentChatFolders(state).some((item) => (
      item.id !== folder.id && item.name.toLowerCase() === nextName.toLowerCase()
    ));
    if (duplicate) {
      showTransientNotice('A chat folder with this name already exists.', { type: 'error' });
      focusRenameInput();
      return;
    }
    const storedFolder = asArray(state.agentChat.folders)
      .find((item) => trimText(item?.id, 120) === folder.sourceId);
    if (storedFolder) {
      storedFolder.name = nextName;
    }
    renamingFolderId = '';
    renamingFolderName = '';
    persist();
    renderSessionList();
  }

  function createFolder() {
    ensureAgentState();
    const folder = {
      id: trimText(typeof createId === 'function' ? createId() : `folder-${Date.now()}`, 120),
      name: buildDefaultChatFolderName(state),
      createdAt: new Date().toISOString()
    };
    state.agentChat.folders.push(folder);
    const folderId = buildCustomChatFolderId(folder.id);
    selectFolder(folderId, { persistState: false });
    persist();
    renamingFolderId = folderId;
    renamingFolderName = folder.name;
    hideContextMenu();
    renderSessionList();
    focusRenameInput();
    return folder;
  }

  function deleteFolder(folderId) {
    const folder = getFolderById(state, folderId);
    if (folder?.type !== 'custom') {
      return;
    }
    const windowRef = sessionList?.ownerDocument?.defaultView;
    if (typeof windowRef?.confirm === 'function' && !windowRef.confirm(`Delete the "${folder.name}" chat folder? Chats will move to General.`)) {
      return;
    }
    state.agentChat.folders = asArray(state.agentChat.folders)
      .filter((item) => trimText(item?.id, 120) !== folder.sourceId);
    Object.entries(state.agentChat.sessionFolderIds).forEach(([sessionId, assignedFolderId]) => {
      if (assignedFolderId === folder.id) {
        state.agentChat.sessionFolderIds[sessionId] = GENERAL_CHAT_FOLDER_ID;
      }
    });
    if (state.agentChat.selectedFolderId === folder.id) {
      state.agentChat.selectedFolderId = GENERAL_CHAT_FOLDER_ID;
    }
    hideContextMenu();
    persist();
    renderSessionList();
  }

  function clearDropTarget() {
    activeDropTarget?.classList?.remove?.('is-chat-drop-target');
    activeDropTarget = null;
  }

  function getDropTarget(event) {
    return event?.target?.closest?.('[data-agent-folder-drop]') || null;
  }


  return {
    getRenamingFolderId: () => renamingFolderId,
    getContextFolderId: () => contextFolderId,
    setDropTarget(target) {
      if (activeDropTarget === target) {
        return;
      }
      clearDropTarget();
      activeDropTarget = target;
      activeDropTarget?.classList?.add?.('is-chat-drop-target');
    },
    getRenamingFolderName: () => renamingFolderName,
    setRenamingFolderName(next) {
      renamingFolderName = next;
      return renamingFolderName;
    },
    getActiveDropTarget: () => activeDropTarget,
    setActiveDropTarget(next) {
      activeDropTarget = next;
      return activeDropTarget;
    },
    hideContextMenu,
    findFolderTarget,
    onRailContextMenu,
    focusRenameInput,
    beginFolderRename,
    cancelFolderRename,
    commitFolderRename,
    createFolder,
    deleteFolder,
    clearDropTarget,
    getDropTarget
  };
}

export { createSessionFolderMenu };
