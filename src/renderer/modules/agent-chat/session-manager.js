import { asArray, trimText } from './shared.js';
import {
  GENERAL_CHAT_FOLDER_ID,
  buildCustomChatFolderId,
  buildDefaultChatFolderName,
  getAgentChatFolders,
  getFolderById,
  resolveSessionFolderId
} from './session-folders.js';

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
    onProjectScopeChanged = () => {}
  } = deps;

  let sessionStoragePath = '';
  let sessionsLoaded = false;
  let sessionListPromise = null;
  let sessionLoadPromise = null;
  let activeSessionLoadId = '';
  let queuedSessionLoadId = '';
  let renamingFolderId = '';
  let renamingFolderName = '';
  let contextFolderId = '';
  let draggedSessionId = '';
  let activeDropTarget = null;

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
      const folderHead = renamingFolderId === folder.id ? `
        <div class="agent-session-folder-row agent-session-folder-row-editing" data-agent-folder-context="${safeText(folder.id)}">
          <span class="agent-session-folder-chevron" aria-hidden="true"></span>
          <span class="left-rail-folder-glyph agent-session-folder-glyph" aria-hidden="true"></span>
          <input class="agent-session-folder-rename-input" data-agent-folder-rename-input="${safeText(folder.id)}" value="${safeText(renamingFolderName || folder.name)}" aria-label="Rename chat folder" />
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

  async function loadChatSession(sessionId, options = {}) {
    ensureAgentState();
    const targetSessionId = trimText(sessionId, 120);
    const storagePath = getStoragePath();
    if (!targetSessionId || !storagePath || !api?.agentChatLogGetSession) {
      return;
    }
    if (sessionLoadPromise) {
      if (targetSessionId !== activeSessionLoadId) {
        queuedSessionLoadId = targetSessionId;
      }
      return sessionLoadPromise;
    }
    activeSessionLoadId = targetSessionId;
    queuedSessionLoadId = '';
    if (options.silent !== true) {
      setStatus('Loading chat history...');
    }
    sessionLoadPromise = api.agentChatLogGetSession({
      storagePath,
      sessionId: targetSessionId
    }).then((result) => {
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to load chat session.');
      }
      const preserveLocalMessages = options.preserveLocalMessages === true
        && trimText(state.agentChat.currentSessionId, 120) === targetSessionId
        && asArray(state.agentChat.messages).length > 0;
      if (preserveLocalMessages) {
        upsertSessionSummary(result.session);
        renderSessionList();
        setSessionStatus('');
        if (options.silent !== true) {
          setStatus('Ready.');
        }
        return;
      }
      state.agentChat.currentSessionId = targetSessionId;
      state.agentChat.messages = asArray(result.messages);
      upsertSessionSummary(result.session);
      const sessionFolderId = resolveSessionFolderId(state, result.session);
      const sessionFolder = selectFolder(sessionFolderId, { persistState: false });
      state.agentChat.projectId = sessionFolder?.projectId
        || trimText(result?.session?.project_id, 120);
      persist();
      renderProjectOptions();
      renderContextSummary();
      onProjectScopeChanged(state.agentChat.projectId);
      onActiveSessionChanged(targetSessionId);
      renderSessionList();
      renderHistory({ forceScroll: true });
      setSessionStatus('');
      if (options.silent !== true) {
        setStatus(readRunningSessionIds().has(targetSessionId) ? 'Working on this...' : 'Ready.');
      }
    }).catch((error) => {
      setSessionStatus(`Chat load failed: ${String(error?.message || error)}`);
      if (options.silent !== true) {
        setStatus('Error.');
      }
    }).finally(() => {
      const nextSessionId = queuedSessionLoadId;
      sessionLoadPromise = null;
      activeSessionLoadId = '';
      queuedSessionLoadId = '';
      if (nextSessionId && nextSessionId !== targetSessionId) {
        void loadChatSession(nextSessionId, options);
      }
    });
    return sessionLoadPromise;
  }

  async function refreshPersistentSessions(options = {}) {
    ensureAgentState();
    const force = options.force === true;
    const storagePath = getStoragePath();
    if (storagePath !== sessionStoragePath) {
      sessionStoragePath = storagePath;
      sessionsLoaded = false;
      state.agentChat.sessions = [];
      if (!storagePath) {
        state.agentChat.currentSessionId = '';
      }
    }
    if (!storagePath) {
      renderSessionList();
      setSessionStatus('Set Storage Folder Path in Settings to save and browse agent chats.');
      return [];
    }
    if (!api?.agentChatLogListSessions || !api?.agentChatLogGetSession) {
      renderSessionList();
      setSessionStatus('Persistent chat sessions are unavailable in this build.');
      return [];
    }
    if (!force && sessionsLoaded) {
      renderSessionList();
      return asArray(state.agentChat.sessions);
    }
    if (sessionListPromise) {
      return sessionListPromise;
    }
    setSessionStatus('Loading saved chats...');
    sessionListPromise = api.agentChatLogListSessions({
      storagePath,
      limit: 200
    }).then(async (result) => {
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to load saved chats.');
      }
      state.agentChat.sessions = asArray(result.items);
      sessionsLoaded = true;
      renderSessionList();
      if (!state.agentChat.currentSessionId && state.agentChat.sessions.length) {
        await loadChatSession(state.agentChat.sessions[0].id, { silent: true, preserveLocalMessages: true });
      } else if (
        state.agentChat.currentSessionId
        && !state.agentChat.sessions.some((item) => trimText(item?.id, 120) === state.agentChat.currentSessionId)
      ) {
        state.agentChat.currentSessionId = '';
        state.agentChat.messages = [];
        onActiveSessionChanged('');
        persist();
        renderHistory({ forceScroll: true });
      } else if (state.agentChat.currentSessionId && options.loadCurrent !== false) {
        await loadChatSession(state.agentChat.currentSessionId, { silent: true, preserveLocalMessages: true });
      } else {
        setSessionStatus(state.agentChat.sessions.length ? 'Saved chats ready.' : 'No saved chats yet.');
      }
      return state.agentChat.sessions;
    }).catch((error) => {
      state.agentChat.sessions = [];
      renderSessionList();
      setSessionStatus(`Chat list failed: ${String(error?.message || error)}`);
      return [];
    }).finally(() => {
      sessionListPromise = null;
    });
    return sessionListPromise;
  }

  async function ensureCurrentChatSession(messageText = '') {
    ensureAgentState();
    if (trimText(state.agentChat.currentSessionId, 120)) {
      return state.agentChat.currentSessionId;
    }
    // First message with no session yet: if a project folder is selected, adopt its project
    // scope now so this new session and the pending agent request use the folder's project
    // rather than the previous/empty scope (the session is only moved into the folder after).
    const selectedFolder = getFolderById(state, state.agentChat.selectedFolderId)
      || getFolderById(state, GENERAL_CHAT_FOLDER_ID);
    if (selectedFolder?.projectId && selectedFolder.projectId !== state.agentChat.projectId) {
      state.agentChat.projectId = selectedFolder.projectId;
      renderProjectOptions();
      renderContextSummary();
      onProjectScopeChanged(selectedFolder.projectId);
    }
    const storagePath = getStoragePath();
    if (!storagePath || !api?.agentChatLogCreateSession) {
      return '';
    }
    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    const result = await api.agentChatLogCreateSession({
      storagePath,
      projectId,
      projectName,
      title: messageText
    });
    if (!result?.ok || !result?.session?.id) {
      throw new Error(result?.error || 'Failed to create chat session.');
    }
    state.agentChat.currentSessionId = trimText(result.session.id, 120);
    upsertSessionSummary(result.session);
    assignSessionToFolder(state.agentChat.currentSessionId, state.agentChat.selectedFolderId);
    renderSessionList();
    setSessionStatus('New chat session created.');
    return state.agentChat.currentSessionId;
  }

  async function startNewChatSession() {
    ensureAgentState();
    state.agentChat.messages = [];
    const selectedFolder = getFolderById(state, state.agentChat.selectedFolderId)
      || getFolderById(state, GENERAL_CHAT_FOLDER_ID);
    if (selectedFolder?.projectId) {
      state.agentChat.projectId = selectedFolder.projectId;
      renderProjectOptions();
      renderContextSummary();
      onProjectScopeChanged(selectedFolder.projectId);
    }
    const storagePath = getStoragePath();
    if (!storagePath || !api?.agentChatLogCreateSession) {
      state.agentChat.currentSessionId = '';
      onActiveSessionChanged('');
      persist();
      renderSessionList();
      renderHistory({ forceScroll: true });
      setSessionStatus(storagePath
        ? 'Persistent chat sessions are unavailable in this build.'
        : 'Started a new local chat draft. Set Storage Folder Path to persist it.');
      setStatus('New chat ready.');
      return;
    }
    try {
      const projectId = state.agentChat.projectId || '';
      const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
      const result = await api.agentChatLogCreateSession({
        storagePath,
        projectId,
        projectName,
        title: 'New Chat'
      });
      if (!result?.ok || !result?.session?.id) {
        throw new Error(result?.error || 'Failed to create chat session.');
      }
      state.agentChat.currentSessionId = trimText(result.session.id, 120);
      onActiveSessionChanged(state.agentChat.currentSessionId);
      upsertSessionSummary(result.session);
      assignSessionToFolder(state.agentChat.currentSessionId, selectedFolder?.id || GENERAL_CHAT_FOLDER_ID);
      renderSessionList();
      renderHistory({ forceScroll: true });
      setSessionStatus('New chat session created.');
      setStatus('New chat ready.');
    } catch (error) {
      setSessionStatus(`New chat failed: ${String(error?.message || error)}`);
      setStatus('Error.');
    }
  }

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
      sessionList?.ownerDocument?.defaultView?.alert?.('A chat folder with this name already exists.');
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
        renamingFolderName = String(event.target.value || '');
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
      if (activeDropTarget !== target) {
        clearDropTarget();
        activeDropTarget = target;
        activeDropTarget.classList?.add?.('is-chat-drop-target');
      }
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
    contextRenameFolderBtn?.addEventListener?.('click', () => beginFolderRename(contextFolderId));
    contextDeleteFolderBtn?.addEventListener?.('click', () => deleteFolder(contextFolderId));
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
