'use strict';

const { asArray, cloneJson } = require('../../../lib/normalize.js');
const { CHAT_LOG_EVENT_TYPES } = require('./constants.js');
const {
  cleanText,
  sanitizeFileName,
  createDefaultId,
  deriveSessionTitle
} = require('./text-utils.js');
const { extractCodexSessionId, mergeCodexSessionId } = require('./codex-session.js');
const { ensureThinkingTraceMeta } = require('./result-summaries.js');

// Normalize one chat-session summary entry as stored in the index file.
function normalizeSessionSummary(rawSummary = {}) {
  const source = rawSummary && typeof rawSummary === 'object' ? rawSummary : {};
  const id = cleanText(source.id || source.session_id || source.sessionId);
  if (!id) {
    return null;
  }
  return {
    id,
    title: cleanText(source.title) || 'New Chat',
    project_id: cleanText(source.project_id || source.projectId),
    project_name: cleanText(source.project_name || source.projectName),
    log_file: cleanText(source.log_file || source.logFile) || `${sanitizeFileName(id)}.log`,
    created_at: cleanText(source.created_at || source.createdAt),
    updated_at: cleanText(source.updated_at || source.updatedAt),
    codex_session_id: extractCodexSessionId(source),
    status: cleanText(source.status) || 'ready',
    message_count: Math.max(0, Number(source.message_count) || 0),
    request_count: Math.max(0, Number(source.request_count) || 0),
    last_message_preview: cleanText(source.last_message_preview),
    last_user_message_preview: cleanText(source.last_user_message_preview),
    response_type: cleanText(source.response_type),
    last_request_id: cleanText(source.last_request_id),
    last_error: cleanText(source.last_error)
  };
}

function normalizeTransformStatus(rawStatus = {}) {
  const source = rawStatus && typeof rawStatus === 'object' ? rawStatus : {};
  const sourceFile = cleanText(source.source_file || source.sourceFile);
  if (!sourceFile) {
    return null;
  }
  return {
    source_file: sourceFile,
    output_file: cleanText(source.output_file || source.outputFile),
    status: cleanText(source.status) || 'pending',
    source_mtime_ms: Number.isFinite(Number(source.source_mtime_ms ?? source.sourceMtimeMs))
      ? Number(source.source_mtime_ms ?? source.sourceMtimeMs)
      : 0,
    source_size: Math.max(0, Number(source.source_size ?? source.sourceSize) || 0),
    source_line_count: Math.max(0, Number(source.source_line_count ?? source.sourceLineCount) || 0),
    trace_count: Math.max(0, Number(source.trace_count ?? source.traceCount) || 0),
    transformed_at: cleanText(source.transformed_at || source.transformedAt),
    error: cleanText(source.error)
  };
}

function normalizeTransformIndex(rawTransforms = {}) {
  const source = rawTransforms && typeof rawTransforms === 'object' ? rawTransforms : {};
  const filesSource = source.files && typeof source.files === 'object' ? source.files : {};
  const files = {};
  Object.entries(filesSource).forEach(([key, value]) => {
    const normalized = normalizeTransformStatus({
      ...(value && typeof value === 'object' ? value : {}),
      source_file: cleanText(
        value?.source_file || value?.sourceFile || key)
    });
    if (normalized?.source_file) {
      files[normalized.source_file] = normalized;
    }
  });
  return {
    updated_at: cleanText(source.updated_at || source.updatedAt),
    output_folder: cleanText(source.output_folder || source.outputFolder) || 'transformed',
    files
  };
}

function mergeTransformIndexes(primaryTransforms = {}, fallbackTransforms = {}) {
  const primary = normalizeTransformIndex(primaryTransforms);
  const fallback = normalizeTransformIndex(fallbackTransforms);
  return normalizeTransformIndex({
    updated_at: primary.updated_at || fallback.updated_at,
    output_folder: primary.output_folder || fallback.output_folder,
    files: {
      ...fallback.files,
      ...primary.files
    }
  });
}

// Normalize the overall chat index payload loaded from disk.
function normalizeIndexPayload(rawIndex = {}) {
  const source = rawIndex && typeof rawIndex === 'object' ? rawIndex : {};
  return {
    version: 1,
    updated_at: cleanText(source.updated_at || source.updatedAt),
    sessions: asArray(source.sessions).map((item) => normalizeSessionSummary(item)).filter(Boolean),
    transforms: normalizeTransformIndex(source.transforms)
  };
}

// Normalize one log row so event processing can rely on consistent field names.
function normalizeSessionRow(rawRow = {}) {
  const source = rawRow && typeof rawRow === 'object' ? rawRow : {};
  const type = cleanText(source.type);
  const sessionId = cleanText(source.session_id || source.sessionId);
  const timestamp = cleanText(source.timestamp || source.createdAt || source.created_at) || new Date().toISOString();
  if (!type || !sessionId) {
    return null;
  }
  const row = {
    ...cloneJson(source, {}),
    type,
    session_id: sessionId,
    timestamp
  };
  delete row.sessionId;
  return row;
}

// Convert a renderer-style chat message object into a persisted session log row.
function buildMessageRow(message, sessionId) {
  const source = message && typeof message === 'object' ? message : {};
  const role = source.role === 'assistant' ? 'assistant' : 'user';
  return normalizeSessionRow({
    type: role === 'assistant' ? CHAT_LOG_EVENT_TYPES.ASSISTANT_MESSAGE : CHAT_LOG_EVENT_TYPES.USER_MESSAGE,
    session_id: sessionId,
    message_id: cleanText(source.id || source.message_id || source.messageId) || createDefaultId(),
    timestamp: cleanText(source.createdAt || source.timestamp) || new Date().toISOString(),
    text: cleanText(source.text),
    meta: role === 'assistant' ? cloneJson(source.meta, null) : undefined
  });
}

// Update an in-memory session summary using one appended log entry.
function applyEntryToSummary(summary, entry) {
  const next = normalizeSessionSummary(summary) || null;
  const row = normalizeSessionRow(entry);
  if (!next || !row) {
    return next;
  }
  next.updated_at = row.timestamp;
  // Session creation establishes the initial title/project metadata and resets the status.
  if (row.type === CHAT_LOG_EVENT_TYPES.SESSION_CREATED) {
    next.status = 'ready';
    next.project_id = cleanText(row.project_id || next.project_id) || next.project_id;
    next.project_name = cleanText(row.project_name || next.project_name) || next.project_name;
    next.title = cleanText(row.title) || next.title;
    next.codex_session_id = mergeCodexSessionId(next.codex_session_id, row);
    return next;
  }

  // User messages advance message counters and can rename untitled sessions.
  if (row.type === CHAT_LOG_EVENT_TYPES.USER_MESSAGE) {
    const text = cleanText(row.text);
    next.message_count += 1;
    next.last_message_preview = text;
    next.last_user_message_preview = text;
    next.status = 'active';
    if (!cleanText(next.title) || next.title === 'New Chat') {
      next.title = deriveSessionTitle(text, next.title || 'New Chat');
    }
    return next;
  }

  // Assistant replies update the latest preview and clear any previous error marker.
  if (row.type === CHAT_LOG_EVENT_TYPES.ASSISTANT_MESSAGE) {
    next.message_count += 1;
    next.last_message_preview = cleanText(row.text);
    next.status = 'active';
    next.last_error = '';
    next.codex_session_id = mergeCodexSessionId(next.codex_session_id, row);
    return next;
  }

  // Request events track how many agent calls were made and which project they belonged to.
  if (row.type === CHAT_LOG_EVENT_TYPES.AGENT_CHAT_REQUEST) {
    next.request_count += 1;
    next.last_request_id = cleanText(row.requestId) || next.last_request_id;
    next.project_id = cleanText(row.projectId || row.project_id || next.project_id) || next.project_id;
    next.project_name = cleanText(row.projectName || row.project_name || next.project_name) || next.project_name;
    return next;
  }

  // Result events record the latest response type and clear stale errors.
  if (row.type === CHAT_LOG_EVENT_TYPES.AGENT_CHAT_RESULT) {
    next.response_type = cleanText(row.response_type || row.responseType);
    next.codex_session_id = mergeCodexSessionId(next.codex_session_id, row);
    next.last_error = '';
    return next;
  }

  // Error events preserve the latest failure summary for the session list.
  if (row.type === CHAT_LOG_EVENT_TYPES.AGENT_CHAT_ERROR) {
    next.last_error = cleanText(row.error);
    return next;
  }

  return next;
}

// Reconstruct renderer-facing chat messages from persisted session log rows.
function buildRendererMessages(rows) {
  return asArray(rows).reduce((messages, row) => {
    const entry = normalizeSessionRow(row);
    if (!entry) {
      return messages;
    }
    if (entry.type === CHAT_LOG_EVENT_TYPES.USER_MESSAGE) {
      messages.push({
        id: cleanText(entry.message_id) || createDefaultId(),
        role: 'user',
        text: cleanText(entry.text),
        createdAt: entry.timestamp
      });
      return messages;
    }
    if (entry.type === CHAT_LOG_EVENT_TYPES.ASSISTANT_MESSAGE) {
      messages.push({
        id: cleanText(entry.message_id) || createDefaultId(),
        role: 'assistant',
        text: cleanText(entry.text),
        createdAt: entry.timestamp,
        meta: ensureThinkingTraceMeta(entry.meta)
      });
    }
    return messages;
  }, []);
}

// Sort sessions by most recently updated so the newest chats appear first.
function sortSessions(sessions) {
  return asArray(sessions)
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(left?.updated_at || left?.created_at || '') || 0;
      const rightTime = Date.parse(right?.updated_at || right?.created_at || '') || 0;
      return rightTime - leftTime;
    });
}

module.exports = {
  normalizeSessionSummary,
  normalizeTransformStatus,
  normalizeTransformIndex,
  mergeTransformIndexes,
  normalizeIndexPayload,
  normalizeSessionRow,
  buildMessageRow,
  applyEntryToSummary,
  buildRendererMessages,
  sortSessions
};
