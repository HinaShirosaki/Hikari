import { asArray, trimText } from './shared.js';
import {
  GENERAL_CHAT_FOLDER_ID,
  getAgentChatFolders,
  getFolderById,
  resolveSessionFolderId
} from './session-folders.js';
import { createSessionFolderMenu } from './session-folder-menu.js';
import { createSessionLoading } from './session-loading.js';

const CHAT_SESSION_DRAG_MIME = 'application/x-hikari-agent-chat-session-id';

export function createAgentChatSessionManager(deps = {}) {
  const {
    api,
    state,
    persist,
    createId,
    safeText,
    sessionRail,
    sessionList,
    sessionContextMenu,
    contextNewFolderBtn,
    contextRenameFolderBtn,
    contextDeleteFolderBtn,
    ensureAgentState,
    getStoragePath,
    renderProjectOptions,
    renderContextSummary,
    renderHistory,
    setStatus,
    setSessionStatus,
    getRunningSessionIds = () => new Set(),
    onActiveSessionChanged = () => {},
    onNewChatPendingChanged = () => {},
    onProjectScopeChanged = () => {}
  } = deps;

  let draggedSessionId = '';
  let newChatPromise = null;

  function readRunningSessionIds() {
    const value = getRunningSessionIds();
    return value instanceof Set ? value : new Set(asArray(value));
  }

  function getExpandedFolderIds() {
    ensureAgentState();
    return new Set(asArray(state.agentChat.expandedFolderIds));
  }

  function setExpandedFolderIds(folderIds) {
    state.agentChat.expandedFolderIds = [...folderIds];
  }

  function syncSelectedFolder() {
    ensureAgentState();
    const folders = getAgentChatFolders(state);
    const validFolderIds = new Set(folders.map((folder) => folder.id));
    if (!validFolderIds.has(state.agentChat.selectedFolderId)) {
      state.agentChat.selectedFolderId = GENERAL_CHAT_FOLDER_ID;
    }
    const expanded = getExpandedFolderIds();
    [...expanded].forEach((folderId) => {
      if (!validFolderIds.has(folderId)) {
        expanded.delete(folderId);
      }
    });
    if (!expanded.size) {
      folders.forEach((folder) => expanded.add(folder.id));
    }
    setExpandedFolderIds(expanded);
    return folders;
  }

  function selectFolder(folderId, { toggle = false, persistState = true } = {}) {
    const folder = getFolderById(state, folderId);
    if (!folder) {
      return null;
    }
    const alreadySelected = state.agentChat.selectedFolderId === folder.id;
    state.agentChat.selectedFolderId = folder.id;
    const expanded = getExpandedFolderIds();
    if (toggle && alreadySelected && expanded.has(folder.id)) {
      expanded.delete(folder.id);
    } else {
      expanded.add(folder.id);
    }
    setExpandedFolderIds(expanded);
    if (persistState) {
      persist();
    }
    return folder;
  }

  function assignSessionToFolder(sessionId, folderId) {
    ensureAgentState();
    const normalizedSessionId = trimText(sessionId, 120);
    const folder = getFolderById(state, folderId);
    if (!normalizedSessionId || !folder) {
      return false;
    }
    state.agentChat.sessionFolderIds[normalizedSessionId] = folder.id;
    selectFolder(folder.id, { persistState: false });
    if (state.agentChat.currentSessionId === normalizedSessionId && folder.projectId) {
      state.agentChat.projectId = folder.projectId;
      renderProjectOptions();
      renderContextSummary();
      onProjectScopeChanged(folder.projectId);
    }
    persist();
    return true;
  }

  function findSessionCard(target) {
    let current = target && typeof target === 'object' ? target : null;
    while (current) {
      const sessionId = trimText(current?.dataset?.sessionId, 120);
      if (sessionId) {
        return current;
      }
      current = current.parentElement || current.parentNode || null;
    }
    return null;
  }

  function upsertSessionSummary(summary) {
    const source = summary && typeof summary === 'object' ? summary : null;
    const sessionId = trimText(source?.id || source?.session_id, 120);
    if (!sessionId) {
      return;
    }
    const normalized = {
      id: sessionId,
      title: trimText(source?.title, 220) || 'New Chat',
      project_id: trimText(source?.project_id || source?.projectId, 120),
      project_name: trimText(source?.project_name || source?.projectName, 220),
      updated_at: trimText(source?.updated_at || source?.updatedAt, 80),
      created_at: trimText(source?.created_at || source?.createdAt, 80),
      message_count: Number(source?.message_count) || 0,
      last_message_preview: trimText(source?.last_message_preview, 320),
      response_type: trimText(source?.response_type, 80),
      last_error: trimText(source?.last_error, 320)
    };
    const nextSessions = asArray(state.agentChat.sessions)
      .filter((item) => trimText(item?.id, 120) !== sessionId);
    nextSessions.unshift(normalized);
    state.agentChat.sessions = nextSessions.sort((left, right) => {
      const leftTime = Date.parse(left?.updated_at || left?.created_at || '') || 0;
      const rightTime = Date.parse(right?.updated_at || right?.created_at || '') || 0;
      return rightTime - leftTime;
    });
  }

  function renderSessionList() {
    if (!sessionList) {
      return;
    }
    const sessions = asArray(state.agentChat.sessions);
    const runningSessionIds = readRunningSessionIds();
    const folders = syncSelectedFolder();
    const expandedFolderIds = getExpandedFolderIds();
    const activeSessionId = trimText(state.agentChat.currentSessionId, 120);
    sessionList.innerHTML = folders.map((folder) => {
      const folderSessions = sessions.filter((session) => resolveSessionFolderId(state, session) === folder.id);
      const isExpanded = expandedFolderIds.has(folder.id);
      const isSelected = state.agentChat.selectedFolderId === folder.id;
      const folderClasses = `agent-session-folder${isSelected ? ' is-active' : ''}${isExpanded ? ' is-expanded' : ''}`;
      const folderLabel = folder.type === 'project' ? `${folder.name} project chats` : `${folder.name} chats`;
      const folderHead = getRenamingFolderId() === folder.id ? `
        <div class="agent-session-folder-row agent-session-folder-row-editing" data-agent-folder-context="${safeText(folder.id)}">
          <span class="agent-session-folder-chevron" aria-hidden="true"></span>
          <span class="left-rail-folder-glyph agent-session-folder-glyph" aria-hidden="true"></span>
          <input class="agent-session-folder-rename-input" data-agent-folder-rename-input="${safeText(folder.id)}" value="${safeText(getRenamingFolderName() || folder.name)}" aria-label="Rename chat folder" />
          <button type="button" class="agent-session-folder-rename-btn" data-agent-folder-rename-save="${safeText(folder.id)}">Save</button>
          <button type="button" class="agent-session-folder-rename-btn is-secondary" data-agent-folder-rename-cancel="${safeText(folder.id)}">Cancel</button>
          <span class="agent-session-folder-count">${folderSessions.length}</span>
        </div>
      ` : `
        <button
          type="button"
          class="agent-session-folder-row${isSelected ? ' is-active' : ''}${isExpanded ? ' is-expanded' : ''}"
          data-agent-folder-id="${safeText(folder.id)}"
          data-agent-folder-context="${safeText(folder.id)}"
          data-agent-folder-drop="${safeText(folder.id)}"
          aria-expanded="${isExpanded ? 'true' : 'false'}"
          aria-label="${safeText(folderLabel)}"
        >
          <span class="agent-session-folder-chevron" aria-hidden="true"></span>
          <span class="left-rail-folder-glyph agent-session-folder-glyph" aria-hidden="true"></span>
          <span class="agent-session-folder-name">${safeText(folder.name)}</span>
          <span class="agent-session-folder-count">${folderSessions.length}</span>
        </button>
      `;
      const children = folderSessions.length
        ? folderSessions.map((session) => {
          const sessionId = trimText(session?.id, 120);
          const isActive = activeSessionId && sessionId === activeSessionId;
          const isRunning = runningSessionIds.has(sessionId);
          const title = trimText(session?.title, 160) || 'New Chat';
          return `
            <button
              type="button"
              class="agent-session-card${isActive ? ' is-active' : ''}${isRunning ? ' is-agent-running' : ''}"
              data-session-id="${safeText(sessionId)}"
              data-agent-session-drag="${safeText(sessionId)}"
              draggable="true"
              title="${safeText(title)}"
              ${isRunning ? 'aria-busy="true"' : ''}
            >
              <strong>${safeText(title)}</strong>
            </button>
          `;
        }).join('')
        : '<p class="agent-session-folder-empty">No chats yet.</p>';
      return `
        <div class="${folderClasses}">
          ${folderHead}
          ${isExpanded ? `<div class="agent-session-folder-children">${children}</div>` : ''}
        </div>
      `;
    }).join('');
  }


  const {
    loadChatSession,
    refreshPersistentSessions,
    ensureCurrentChatSession,
    createNewChatSession
  } = createSessionLoading({
    state,
    api,
    persist,
    ensureAgentState,
    getStoragePath,
    setStatus,
    setSessionStatus,
    renderHistory,
    renderContextSummary,
    renderProjectOptions,
    readRunningSessionIds,
    renderSessionList: () => renderSessionList(),
    selectFolder: (...args) => selectFolder(...args),
    upsertSessionSummary,
    assignSessionToFolder,
    onProjectScopeChanged,
    onActiveSessionChanged
  });

  function startNewChatSession() {
    if (newChatPromise) {
      return newChatPromise;
    }
    onNewChatPendingChanged(true);
    newChatPromise = createNewChatSession().finally(() => {
      newChatPromise = null;
      onNewChatPendingChanged(false);
    });
    return newChatPromise;
  }

  const {
    getRenamingFolderId,
    getContextFolderId,
    setDropTarget,
    getRenamingFolderName,
    setRenamingFolderName,
    hideContextMenu,
    onRailContextMenu,
    beginFolderRename,
    cancelFolderRename,
    commitFolderRename,
    createFolder,
    deleteFolder,
    clearDropTarget,
    getDropTarget
  } = createSessionFolderMenu({
    state,
    persist,
    createId,
    ensureAgentState,
    sessionList,
    sessionContextMenu,
    contextRenameFolderBtn,
    contextDeleteFolderBtn,
    renderSessionList: () => renderSessionList(),
    selectFolder: (...args) => selectFolder(...args)
  });

  function bindEvents() {
    sessionList?.addEventListener?.('click', (event) => {
      const saveButton = event?.target?.closest?.('[data-agent-folder-rename-save]');
      if (saveButton) {
        commitFolderRename(saveButton.dataset.agentFolderRenameSave);
        return;
      }
      if (event?.target?.closest?.('[data-agent-folder-rename-cancel]')) {
        cancelFolderRename();
        return;
      }
      if (event?.target?.closest?.('[data-agent-folder-rename-input]')) {
        return;
      }
      const folderButton = event?.target?.closest?.('[data-agent-folder-id]');
      if (folderButton) {
        selectFolder(folderButton.dataset.agentFolderId, { toggle: true });
        renderSessionList();
        return;
      }
      const sessionCard = findSessionCard(event?.target);
      const sessionId = trimText(sessionCard?.dataset?.sessionId, 120);
      if (sessionId) {
        void loadChatSession(sessionId);
      }
    });
    sessionList?.addEventListener?.('input', (event) => {
      if (event?.target?.closest?.('[data-agent-folder-rename-input]')) {
        setRenamingFolderName(String(event.target.value || ''));
      }
    });
    sessionList?.addEventListener?.('keydown', (event) => {
      if (!event?.target?.closest?.('[data-agent-folder-rename-input]')) {
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault?.();
        commitFolderRename(event.target.dataset.agentFolderRenameInput);
      } else if (event.key === 'Escape') {
        event.preventDefault?.();
        cancelFolderRename();
      }
    });
    sessionList?.addEventListener?.('dragstart', (event) => {
      const card = event?.target?.closest?.('[data-agent-session-drag]');
      draggedSessionId = trimText(card?.dataset?.agentSessionDrag, 120);
      if (!draggedSessionId) {
        return;
      }
      card?.classList?.add?.('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData?.(CHAT_SESSION_DRAG_MIME, draggedSessionId);
        event.dataTransfer.setData?.('text/plain', draggedSessionId);
      }
    });
    sessionList?.addEventListener?.('dragend', (event) => {
      event?.target?.closest?.('[data-agent-session-drag]')?.classList?.remove?.('is-dragging');
      draggedSessionId = '';
      clearDropTarget();
    });
    sessionList?.addEventListener?.('dragover', (event) => {
      const target = getDropTarget(event);
      if (!target || !draggedSessionId) {
        clearDropTarget();
        return;
      }
      event.preventDefault?.();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      setDropTarget(target);
    });
    sessionList?.addEventListener?.('drop', (event) => {
      const target = getDropTarget(event);
      const folderId = trimText(target?.dataset?.agentFolderDrop, 180);
      const sessionId = trimText(
        event?.dataTransfer?.getData?.(CHAT_SESSION_DRAG_MIME) || draggedSessionId,
        120
      );
      if (!target || !folderId || !sessionId) {
        clearDropTarget();
        return;
      }
      event.preventDefault?.();
      assignSessionToFolder(sessionId, folderId);
      draggedSessionId = '';
      clearDropTarget();
      renderSessionList();
    });
    sessionRail?.addEventListener?.('contextmenu', onRailContextMenu);
    sessionContextMenu?.addEventListener?.('click', (event) => event?.stopPropagation?.());
    contextNewFolderBtn?.addEventListener?.('click', createFolder);
    contextRenameFolderBtn?.addEventListener?.('click', () => beginFolderRename(getContextFolderId()));
    contextDeleteFolderBtn?.addEventListener?.('click', () => deleteFolder(getContextFolderId()));
    sessionList?.ownerDocument?.addEventListener?.('click', hideContextMenu);
    sessionList?.ownerDocument?.addEventListener?.('keydown', (event) => {
      if (event?.key === 'Escape') {
        hideContextMenu();
        cancelFolderRename();
      }
    });
  }

  return {
    findSessionCard,
    upsertSessionSummary,
    renderSessionList,
    loadChatSession,
    refreshPersistentSessions,
    ensureCurrentChatSession,
    startNewChatSession,
    bindEvents,
    createFolder,
    selectFolder,
    assignSessionToFolder
  };
}
