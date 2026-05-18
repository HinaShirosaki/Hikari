import { asArray, trimText } from './shared.js';

export function createAgentChatSessionManager(deps = {}) {
  const {
    api,
    state,
    persist,
    safeText,
    sessionList,
    ensureAgentState,
    getStoragePath,
    renderProjectOptions,
    renderContextSummary,
    renderHistory,
    setStatus,
    setSessionStatus,
    isInteractionLocked
  } = deps;

  let sessionStoragePath = '';
  let sessionsLoaded = false;
  let sessionListPromise = null;
  let sessionLoadPromise = null;
  let activeSessionLoadId = '';
  let queuedSessionLoadId = '';

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
    const interactionLocked = typeof isInteractionLocked === 'function' && isInteractionLocked() === true;
    const storagePath = getStoragePath();
    const sessions = asArray(state.agentChat.sessions);
    if (!storagePath) {
      sessionList.innerHTML = '<p class="small-note">Set Storage Folder Path in Settings to save and reload chat sessions.</p>';
      return;
    }
    if (!api?.agentChatLogListSessions || !api?.agentChatLogGetSession) {
      sessionList.innerHTML = '<p class="small-note">Persistent chat sessions are unavailable in this build.</p>';
      return;
    }
    if (!sessions.length) {
      sessionList.innerHTML = '<p class="small-note">No saved chats yet. Start a new chat to create the first session.</p>';
      return;
    }

    const activeSessionId = trimText(state.agentChat.currentSessionId, 120);
    sessionList.innerHTML = sessions.map((session) => {
      const sessionId = trimText(session?.id, 120);
      const isActive = activeSessionId && sessionId === activeSessionId;
      const title = trimText(session?.title, 160) || 'New Chat';
      return `
        <button
          type="button"
          class="agent-session-card${isActive ? ' is-active' : ''}"
          data-session-id="${safeText(sessionId)}"
          title="${safeText(title)}"
          ${interactionLocked ? 'disabled' : ''}
        >
          <strong>${safeText(title)}</strong>
        </button>
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
      state.agentChat.projectId = trimText(result?.session?.project_id, 120);
      upsertSessionSummary(result.session);
      persist();
      renderProjectOptions();
      renderContextSummary();
      renderSessionList();
      renderHistory({ forceScroll: true });
      setSessionStatus('');
      if (options.silent !== true) {
        setStatus('Ready.');
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
    persist();
    renderSessionList();
    setSessionStatus('New chat session created.');
    return state.agentChat.currentSessionId;
  }

  async function startNewChatSession() {
    ensureAgentState();
    state.agentChat.messages = [];
    const storagePath = getStoragePath();
    if (!storagePath || !api?.agentChatLogCreateSession) {
      state.agentChat.currentSessionId = '';
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
      upsertSessionSummary(result.session);
      persist();
      renderSessionList();
      renderHistory({ forceScroll: true });
      setSessionStatus('New chat session created.');
      setStatus('New chat ready.');
    } catch (error) {
      setSessionStatus(`New chat failed: ${String(error?.message || error)}`);
      setStatus('Error.');
    }
  }

  return {
    findSessionCard,
    upsertSessionSummary,
    renderSessionList,
    loadChatSession,
    refreshPersistentSessions,
    ensureCurrentChatSession,
    startNewChatSession
  };
}
