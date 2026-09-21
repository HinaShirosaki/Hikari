/**
 * Chat log helpers for creating and updating persisted agent chat sessions,
 * converting agent results into renderer-friendly assistant messages, and
 * maintaining a lightweight index of session summaries.
 */
'use strict';

// Node.js filesystem/path utilities used by the chat log runtime.
const fs = require('node:fs/promises');
const path = require('node:path');
const { asArray, cloneJson } = require('../../lib/normalize.js');
const { withFileLock, writeFileAtomic, parseJsonSalvagingTornTail } = require('../../lib/shared-json-file.js');
const {
  CHAT_LOG_FOLDER_NAME,
  CHAT_LOG_INDEX_FILE_NAME,
  CHAT_LOG_EVENT_TYPES
} = require('./chat-log/constants.js');
const {
  cleanText,
  sanitizeFileName,
  createDefaultId,
  deriveSessionTitle,
  normalizeSessionBrief
} = require('./chat-log/text-utils.js');
const {
  buildAssistantMetaFromResult,
  buildAssistantTextFromResult,
  buildAssistantMessageFromResult,
  buildAssistantMessageFromError,
  buildAssistantMessageFromCancellation
} = require('./chat-log/assistant-messages.js');
const {
  normalizeSessionSummary,
  normalizeTransformIndex,
  mergeTransformIndexes,
  normalizeIndexPayload,
  normalizeSessionRow,
  buildMessageRow,
  applyEntryToSummary,
  buildRendererMessages,
  sortSessions
} = require('./chat-log/session-index.js');

// Create a filesystem-backed runtime for chat session creation, reads, and appends.
function createAgentChatLogRuntime(deps = {}) {
  // Allow filesystem utilities and clock/id helpers to be injected for testing.
  const runtimeFs = deps.fs || fs;
  const runtimePath = deps.path || path;
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => new Date().toISOString());
  const createId = typeof deps.createId === 'function'
    ? deps.createId
    : createDefaultId;
  const requestAssistantText = typeof deps.requestAssistantText === 'function'
    ? deps.requestAssistantText
    : null;

  async function summarizeFirstUserMessageAsTitle({
    message = '',
    llm = {},
    projectId = '',
    projectName = ''
  } = {}) {
    const prompt = cleanText(message);
    const fallback = deriveSessionTitle(prompt, 'New Chat');
    if (!prompt || !requestAssistantText) {
      return fallback;
    }
    const provider = cleanText(llm?.provider);
    const endpoint = cleanText(llm?.apiEndpoint || llm?.endpoint);
    const apiKey = cleanText(llm?.apiKey);
    const model = cleanText(llm?.model);
    if ((!provider && !endpoint) || !model || !apiKey) {
      return fallback;
    }
    const result = await requestAssistantText({
      source: { provider, endpoint, apiKey, model },
      stage: 'agent_chat_session_brief',
      defaultError: 'Session brief provider is not configured.',
      systemPrompt: [
        'You create short chat sidebar labels.',
        'Summarize the first user message into one brief plain-text label.',
        'Use 3 to 8 words when possible.',
        'Keep concrete nouns and task intent.',
        'No quotes, no markdown, no ending punctuation.'
      ].join(' '),
      userPrompt: [
        projectName ? `Project: ${cleanText(projectName)}` : '',
        projectId && !projectName ? `Project ID: ${cleanText(projectId)}` : '',
        `First user message: ${prompt}`,
        'Return only the label.'
      ].filter(Boolean).join('\n')
    });
    if (result?.ok !== true) {
      return fallback;
    }
    return normalizeSessionBrief(result.text, fallback);
  }

  // Resolve the base storage path plus the chat-log folder and index file locations.
  function resolvePaths(storagePath) {
    const resolvedStoragePath = runtimePath.resolve(cleanText(storagePath));
    if (!resolvedStoragePath) {
      throw new Error('Missing storage path.');
    }
    const chatLogPath = runtimePath.join(resolvedStoragePath, CHAT_LOG_FOLDER_NAME);
    return {
      storagePath: resolvedStoragePath,
      chatLogPath,
      indexPath: runtimePath.join(chatLogPath, CHAT_LOG_INDEX_FILE_NAME)
    };
  }

  // Create the chat-log folder on demand before any reads or writes.
  async function ensureChatLogRoot(storagePath) {
    const paths = resolvePaths(storagePath);
    await runtimeFs.mkdir(paths.chatLogPath, { recursive: true });
    return paths;
  }

  // Read and normalize the session index, treating a missing file as an empty index.
  async function readIndex(storagePath) {
    const paths = await ensureChatLogRoot(storagePath);
    try {
      const raw = await runtimeFs.readFile(paths.indexPath, 'utf8');
      return {
        paths,
        index: normalizeIndexPayload(parseJsonSalvagingTornTail(raw))
      };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          paths,
          index: normalizeIndexPayload({})
        };
      }
      throw error;
    }
  }

  // Persist the normalized index back to disk after session metadata changes.
  function writeIndex(paths, index) {
    return withFileLock(paths.indexPath, async () => {
      let existingTransforms = normalizeTransformIndex({});
      try {
        const existingRaw = await runtimeFs.readFile(paths.indexPath, 'utf8');
        existingTransforms = normalizeIndexPayload(parseJsonSalvagingTornTail(existingRaw)).transforms;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
      const normalized = normalizeIndexPayload({
        ...index,
        transforms: mergeTransformIndexes(index?.transforms, existingTransforms)
      });
      normalized.updated_at = cleanText(normalized.updated_at) || now();
      await runtimeFs.mkdir(paths.chatLogPath, { recursive: true });
      await writeFileAtomic(runtimeFs, paths.indexPath, JSON.stringify(normalized, null, 2));
      return normalized;
    });
  }

  // Append one or more normalized rows to a session log and refresh the summary index.
  async function appendRows(storagePath, sessionId, rows = [], options = {}) {
    const filteredRows = asArray(rows).map((row) => normalizeSessionRow(row)).filter(Boolean);
    if (!filteredRows.length) {
      const existing = await getSession({ storagePath, sessionId });
      return {
        ok: true,
        session: existing.session,
        appended_count: 0
      };
    }
    const { paths, index } = await readIndex(storagePath);
    const normalizedSessionId = cleanText(sessionId);
    if (!normalizedSessionId) {
      throw new Error('sessionId is required.');
    }
    let session = index.sessions.find((item) => item.id === normalizedSessionId) || null;
    if (!session) {
      session = normalizeSessionSummary({
        id: normalizedSessionId,
        title: 'New Chat',
        project_id: cleanText(filteredRows[0]?.project_id || filteredRows[0]?.projectId),
        project_name: cleanText(filteredRows[0]?.project_name || filteredRows[0]?.projectName),
        created_at: filteredRows[0]?.timestamp || now(),
        updated_at: filteredRows[0]?.timestamp || now(),
        log_file: `${sanitizeFileName(normalizedSessionId)}.log`
      });
      index.sessions.push(session);
    }

    const logPath = runtimePath.join(paths.chatLogPath, session.log_file);
    const titleWasUntitled = !cleanText(session?.title) || session.title === 'New Chat';
    const payload = filteredRows.map((row) => JSON.stringify(row)).join('\n');
    await runtimeFs.appendFile(logPath, `${payload}\n`, 'utf8');
    filteredRows.forEach((row) => {
      session = applyEntryToSummary(session, row);
    });
    if (titleWasUntitled) {
      const firstUserRow = filteredRows.find((row) => row.type === CHAT_LOG_EVENT_TYPES.USER_MESSAGE && cleanText(row.text));
      if (firstUserRow) {
        session.title = await summarizeFirstUserMessageAsTitle({
          message: firstUserRow.text,
          llm: options?.llm && typeof options.llm === 'object' ? options.llm : {},
          projectId: cleanText(options?.projectId || firstUserRow?.project_id || firstUserRow?.projectId),
          projectName: cleanText(options?.projectName || firstUserRow?.project_name || firstUserRow?.projectName)
        });
      }
    }
    index.sessions = sortSessions(index.sessions.map((item) => item.id === session.id ? session : item));
    await writeIndex(paths, index);
    return {
      ok: true,
      session
    };
  }

  // Create a brand-new session summary and seed its log with a creation event.
  async function createSession(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path);
    const title = cleanText(input.title) || 'New Chat';
    const projectId = cleanText(input.projectId || input.project_id);
    const projectName = cleanText(input.projectName || input.project_name);
    const sessionId = cleanText(input.sessionId || input.session_id) || createId();
    const timestamp = cleanText(input.created_at || input.createdAt) || now();
    const { paths, index } = await readIndex(storagePath);
    const existing = index.sessions.find((item) => item.id === sessionId);
    if (existing) {
      return {
        ok: true,
        session: existing
      };
    }
    const session = normalizeSessionSummary({
      id: sessionId,
      title,
      project_id: projectId,
      project_name: projectName,
      codex_session_id: input.codex_session_id || input.codexSessionId,
      log_file: `${sanitizeFileName(sessionId)}.log`,
      created_at: timestamp,
      updated_at: timestamp,
      status: 'ready',
      message_count: 0,
      request_count: 0
    });
    index.sessions = sortSessions([session, ...index.sessions]);
    await writeIndex(paths, index);
    await appendRows(storagePath, session.id, [{
      type: CHAT_LOG_EVENT_TYPES.SESSION_CREATED,
      session_id: session.id,
      timestamp,
      title: session.title,
      project_id: session.project_id,
      project_name: session.project_name
    }]);
    return {
      ok: true,
      session
    };
  }

  // Reuse an existing session when possible, otherwise create one from the provided input.
  async function ensureSession(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path);
    const sessionId = cleanText(input.sessionId || input.session_id);
    if (!sessionId) {
      return createSession(input);
    }
    const { index } = await readIndex(storagePath);
    const existing = index.sessions.find((item) => item.id === sessionId);
    if (existing) {
      return {
        ok: true,
        session: existing
      };
    }
    return createSession({
      ...input,
      sessionId
    });
  }

  // Return the most recent chat sessions for sidebar or picker views.
  async function listSessions(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path);
    const limit = Math.max(1, Number(input.limit) || 100);
    const { index } = await readIndex(storagePath);
    return {
      ok: true,
      items: sortSessions(index.sessions).slice(0, limit)
    };
  }

  // Load and normalize all persisted rows for a single session log file.
  async function readSessionRows(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path);
    const sessionId = cleanText(input.sessionId || input.session_id);
    if (!sessionId) {
      throw new Error('sessionId is required.');
    }
    const { paths, index } = await readIndex(storagePath);
    const session = index.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return {
        session: null,
        rows: []
      };
    }
    const logPath = runtimePath.join(paths.chatLogPath, session.log_file);
    try {
      const raw = await runtimeFs.readFile(logPath, 'utf8');
      const rows = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return normalizeSessionRow(JSON.parse(line));
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return {
        session,
        rows
      };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          session,
          rows: []
        };
      }
      throw error;
    }
  }

  // Return one session summary together with its reconstructed chat messages.
  async function getSession(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path);
    const sessionId = cleanText(input.sessionId || input.session_id);
    if (!sessionId) {
      throw new Error('sessionId is required.');
    }
    const includeRows = input.include_rows === true || input.includeRows === true;
    const { session, rows } = await readSessionRows({
      storagePath,
      sessionId
    });
    if (!session) {
      return {
        ok: false,
        error: 'Chat session not found.'
      };
    }
    return {
      ok: true,
      session,
      messages: buildRendererMessages(rows),
      rows: includeRows ? rows : undefined
    };
  }

  // Normalize and append a user-authored chat message into the session log.
  async function appendUserMessage(input = {}) {
    const sessionId = cleanText(input.sessionId || input.session_id);
    const message = {
      id: cleanText(input.messageId || input.message_id) || createId(),
      role: 'user',
      text: cleanText(input.text || input.message),
      createdAt: cleanText(input.createdAt || input.timestamp) || now()
    };
    const row = buildMessageRow(message, sessionId);
    if (row) {
      row.project_id = cleanText(input.projectId || input.project_id);
      row.project_name = cleanText(input.projectName || input.project_name);
    }
    return appendRows(input.storagePath || input.storage_path, sessionId, [row], {
      llm: input?.llm && typeof input.llm === 'object' ? input.llm : {},
      projectId: cleanText(input.projectId || input.project_id),
      projectName: cleanText(input.projectName || input.project_name)
    });
  }

  // Normalize and append an assistant-authored chat message into the session log.
  async function appendAssistantMessage(input = {}) {
    const sessionId = cleanText(input.sessionId || input.session_id);
    const message = input.message && typeof input.message === 'object'
      ? input.message
      : {
        id: cleanText(input.messageId || input.message_id) || createId(),
        role: 'assistant',
        text: cleanText(input.text || input.message_text),
        createdAt: cleanText(input.createdAt || input.timestamp) || now(),
        meta: cloneJson(input.meta, {})
      };
    return appendRows(input.storagePath || input.storage_path, sessionId, [buildMessageRow(message, sessionId)]);
  }

  // Expose the runtime helpers used by the rest of the agent/chat layer.
  return {
    CHAT_LOG_FOLDER_NAME,
    CHAT_LOG_INDEX_FILE_NAME,
    CHAT_LOG_EVENT_TYPES,
    buildAssistantMetaFromResult,
    buildAssistantTextFromResult,
    buildAssistantMessageFromResult,
    buildAssistantMessageFromCancellation,
    buildAssistantMessageFromError,
    buildRendererMessages,
    ensureChatLogRoot,
    createSession,
    ensureSession,
    listSessions,
    getSession,
    readSessionRows,
    appendRows,
    appendUserMessage,
    appendAssistantMessage
  };
}

// Public module export exposing constants plus the chat-log runtime factory.
module.exports = {
  CHAT_LOG_FOLDER_NAME,
  CHAT_LOG_INDEX_FILE_NAME,
  CHAT_LOG_EVENT_TYPES,
  createAgentChatLogRuntime
};
