import { asArray, trimText } from './shared.js';
import {
  GENERAL_CHAT_FOLDER_ID,
  getFolderById,
  resolveSessionFolderId
} from './session-folders.js';
import { showTransientNotice } from '../../lib/notify.js';

// Reading chat sessions off disk and creating new ones. Owns the in-flight
// promises so a second click cannot start a duplicate load or session.
function createSessionLoading({
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
  renderSessionList,
  selectFolder,
  upsertSessionSummary,
  assignSessionToFolder,
  onProjectScopeChanged,
  onActiveSessionChanged
} = {}) {
  let sessionStoragePath = '';
  let sessionsLoaded = false;
  let sessionListPromise = null;
  let sessionLoadPromise = null;
  let activeSessionLoadId = '';
  let queuedSessionLoadId = '';

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
      showTransientNotice(`Chat load failed: ${String(error?.message || error)}`, { type: 'error' });
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
      showTransientNotice('Persistent chat sessions are unavailable in this build.', { type: 'error' });
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
      showTransientNotice(`Chat list failed: ${String(error?.message || error)}`, { type: 'error' });
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

  async function createNewChatSession() {
    ensureAgentState();
    const selectedFolder = getFolderById(state, state.agentChat.selectedFolderId)
      || getFolderById(state, GENERAL_CHAT_FOLDER_ID);
    const nextProjectId = selectedFolder?.projectId || state.agentChat.projectId || '';
    const applySelectedProjectScope = () => {
      if (!selectedFolder?.projectId || state.agentChat.projectId === selectedFolder.projectId) {
        return;
      }
      state.agentChat.projectId = selectedFolder.projectId;
      renderProjectOptions();
      renderContextSummary();
      onProjectScopeChanged(selectedFolder.projectId);
    };
    const storagePath = getStoragePath();
    if (!storagePath || !api?.agentChatLogCreateSession) {
      applySelectedProjectScope();
      state.agentChat.messages = [];
      state.agentChat.currentSessionId = '';
      onActiveSessionChanged('');
      persist();
      renderSessionList();
      renderHistory({ forceScroll: true });
      setSessionStatus(storagePath
        ? 'Persistent chat sessions are unavailable in this build.'
        : 'Started a new local chat draft. Set Storage Folder Path to persist it.');
      setStatus('New chat ready.');
      return true;
    }
    try {
      const projectName = asArray(state.projects).find((item) => item.id === nextProjectId)?.name || '';
      const result = await api.agentChatLogCreateSession({
        storagePath,
        projectId: nextProjectId,
        projectName,
        title: 'New Chat'
      });
      if (!result?.ok || !result?.session?.id) {
        throw new Error(result?.error || 'Failed to create chat session.');
      }
      // Do not discard the selected chat until the replacement session is durable.
      applySelectedProjectScope();
      state.agentChat.messages = [];
      state.agentChat.currentSessionId = trimText(result.session.id, 120);
      onActiveSessionChanged(state.agentChat.currentSessionId);
      upsertSessionSummary(result.session);
      assignSessionToFolder(state.agentChat.currentSessionId, selectedFolder?.id || GENERAL_CHAT_FOLDER_ID);
      renderSessionList();
      renderHistory({ forceScroll: true });
      setSessionStatus('New chat session created.');
      setStatus('New chat ready.');
      return true;
    } catch (error) {
      setSessionStatus(`New chat failed: ${String(error?.message || error)}`);
      showTransientNotice(`New chat failed: ${String(error?.message || error)}`, { type: 'error' });
      setStatus('Error.');
      return false;
    }
  }

  return {
    loadChatSession,
    refreshPersistentSessions,
    ensureCurrentChatSession,
    createNewChatSession
  };
}

export { createSessionLoading };
