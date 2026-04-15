'use strict';

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function createProtocolNotebookContextControl(deps = {}) {
  const asArray = typeof deps.asArray === 'function'
    ? deps.asArray
    : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : defaultCleanText;
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => new Date().toISOString());
  const nowMs = typeof deps.nowMs === 'function'
    ? deps.nowMs
    : (() => Date.now());
  const sessionTtlMs = Number.isFinite(Number(deps.sessionTtlMs))
    ? Number(deps.sessionTtlMs)
    : (30 * 60 * 1000);
  const store = deps.store instanceof Map ? deps.store : new Map();

  function normalizeSessionKey(sessionKey) {
    return cleanText(sessionKey, 320);
  }

  function buildSessionKey({
    projectId = '',
    projectName = ''
  } = {}) {
    const keyProjectId = cleanText(projectId, 80).toLowerCase();
    const keyProjectName = cleanText(projectName, 180).toLowerCase();
    return [keyProjectId || '-', keyProjectName || '-'].join('::');
  }

  function getPendingSession(sessionKey) {
    const key = normalizeSessionKey(sessionKey);
    if (!key) {
      return null;
    }
    const existing = store.get(key);
    if (!existing || typeof existing !== 'object') {
      return null;
    }
    const createdAt = Date.parse(existing.updated_at || existing.created_at || '');
    if (!Number.isFinite(createdAt)) {
      store.delete(key);
      return null;
    }
    if ((nowMs() - createdAt) > sessionTtlMs) {
      store.delete(key);
      return null;
    }
    return cloneJson(existing, null);
  }

  function setPendingSession(sessionKey, session) {
    const key = normalizeSessionKey(sessionKey);
    if (!key || !session || typeof session !== 'object') {
      return null;
    }
    const normalized = {
      ...cloneJson(session, {}),
      created_at: cleanText(session.created_at, 80) || now(),
      updated_at: now()
    };
    store.set(key, normalized);
    return cloneJson(normalized, null);
  }

  function clearPendingSession(sessionKey) {
    const key = normalizeSessionKey(sessionKey);
    if (!key) {
      return false;
    }
    return store.delete(key);
  }

  function hasPendingSession(sessionKey) {
    return Boolean(getPendingSession(sessionKey));
  }

  function closeContext(sessionKey) {
    return clearPendingSession(sessionKey);
  }

  function syncActionContext(sessionKey, input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const status = cleanText(source.status, 40) || 'needs_more_info';
    if (status === 'completed') {
      closeContext(sessionKey);
      return {
        status,
        context_closed: true,
        pending_session: null
      };
    }
    const pendingSession = source.pendingSession && typeof source.pendingSession === 'object'
      ? source.pendingSession
      : null;
    const selectedProtocol = source.selectedProtocol && typeof source.selectedProtocol === 'object'
      ? cloneJson(source.selectedProtocol, null)
      : null;
    const project = source.project && typeof source.project === 'object'
      ? cloneJson(source.project, null)
      : null;
    const nextSession = setPendingSession(sessionKey, {
      created_at: cleanText(pendingSession?.created_at, 80) || now(),
      selected_protocol: selectedProtocol,
      project,
      candidate_matches: asArray(source.candidateMatches).map((item) => cloneJson(item, null)).filter(Boolean),
      known_values: source.knownValues && typeof source.knownValues === 'object'
        ? cloneJson(source.knownValues, {})
        : {},
      missing_placeholders: asArray(source.missingPlaceholders).map((item) => cloneJson(item, null)).filter(Boolean),
      follow_up_questions: asArray(source.followUpQuestions).map((item) => cleanText(item, 280)).filter(Boolean)
    });
    return {
      status,
      context_closed: false,
      pending_session: nextSession
    };
  }

  return {
    buildSessionKey,
    getPendingSession,
    setPendingSession,
    clearPendingSession,
    hasPendingSession,
    closeContext,
    syncActionContext
  };
}

module.exports = {
  createProtocolNotebookContextControl
};
