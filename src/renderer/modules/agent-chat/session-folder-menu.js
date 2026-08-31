import { asArray, trimText } from './shared.js';
import {
  GENERAL_CHAT_FOLDER_ID,
  buildCustomChatFolderId,
  buildDefaultChatFolderName,
  getAgentChatFolders,
  getFolderById
} from './session-folders.js';
import { showTransientNotice } from '../../lib/notify.js';
import { startInlineRename } from '../../lib/folder-tree.js';

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

  // The list re-renders before the input goes in, so the row has to be looked
  // up again rather than reusing the element the event came from.
  function findFolderMain(folderId) {
    return Array.from(sessionList?.querySelectorAll?.('[data-agent-folder-id]') || [])
      .find((item) => item?.dataset?.agentFolderId === folderId) || null;
  }

  function beginFolderRename(folderId) {
    const folder = getFolderById(state, folderId);
    if (folder?.type !== 'custom') {
      return;
    }
    hideContextMenu();
    selectFolder(folder.id, { persistState: false });
    renderSessionList();
    startInlineRename(findFolderMain(folder.id), {
      value: folder.name,
      label: 'Rename chat folder',
      onCommit: (nextName) => commitFolderRename(folder.id, nextName)
    });
  }

  function commitFolderRename(folderId, rawName) {
    const folder = getFolderById(state, folderId);
    const nextName = trimText(rawName, 220);
    if (folder?.type !== 'custom' || !nextName || nextName === folder.name) {
      return;
    }
    const duplicate = getAgentChatFolders(state).some((item) => (
      item.id !== folder.id && item.name.toLowerCase() === nextName.toLowerCase()
    ));
    if (duplicate) {
      showTransientNotice('A chat folder with this name already exists.', { type: 'error' });
      return;
    }
    const storedFolder = asArray(state.agentChat.folders)
      .find((item) => trimText(item?.id, 120) === folder.sourceId);
    if (storedFolder) {
      storedFolder.name = nextName;
    }
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
    beginFolderRename(folderId);
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
    getContextFolderId: () => contextFolderId,
    setDropTarget(target) {
      if (activeDropTarget === target) {
        return;
      }
      clearDropTarget();
      activeDropTarget = target;
      activeDropTarget?.classList?.add?.('is-chat-drop-target');
    },
    getActiveDropTarget: () => activeDropTarget,
    setActiveDropTarget(next) {
      activeDropTarget = next;
      return activeDropTarget;
    },
    hideContextMenu,
    findFolderTarget,
    onRailContextMenu,
    beginFolderRename,
    createFolder,
    deleteFolder,
    clearDropTarget,
    getDropTarget
  };
}

export { createSessionFolderMenu };
