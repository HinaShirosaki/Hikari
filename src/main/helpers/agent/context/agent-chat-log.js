/**
 * Chat log helpers for creating and updating persisted agent chat sessions,
 * converting agent results into renderer-friendly assistant messages, and
 * maintaining a lightweight index of session summaries.
 */
'use strict';

// Node.js filesystem/path utilities used by the chat log runtime.
const fs = require('node:fs/promises');
const path = require('node:path');

// Storage constants shared by the index file and per-session log files.
const CHAT_LOG_FOLDER_NAME = 'chat_log';
const CHAT_LOG_INDEX_FILE_NAME = 'index.json';
const CHAT_LOG_EVENT_TYPES = Object.freeze({
  SESSION_CREATED: 'session-created',
  USER_MESSAGE: 'user-message',
  ASSISTANT_MESSAGE: 'assistant-message',
  AGENT_CHAT_REQUEST: 'agent-chat-request',
  AGENT_CHAT_RESULT: 'agent-chat-result',
  AGENT_CHAT_ERROR: 'agent-chat-error',
  AGENT_LIFECYCLE: 'agent-lifecycle',
  AGENT_LLM_TRACE: 'agent-llm-trace'
});

// Return the input only when it is already an array; otherwise fall back to an empty array.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Normalize unknown input into trimmed text and cap it to a safe maximum length.
function cleanText(value, maxLength = 4000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

// Deep-clone JSON-safe values so stored payloads are detached from live objects.
function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

// Convert arbitrary session identifiers into safe file-name fragments.
function sanitizeFileName(value, fallback = 'chat-session') {
  const clean = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return clean || fallback;
}

// Generate a lightweight unique identifier for chat sessions and messages.
function createDefaultId() {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Use the first non-empty line of user text as a human-friendly session title.
function deriveSessionTitle(text, fallback = 'New Chat') {
  const firstLine = cleanText(String(text || '').split('\n').find((line) => String(line || '').trim()) || '', 120);
  return firstLine || fallback;
}

// Build a concise assistant-facing summary from inventory lookup results.
function summarizeInventoryLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = cleanText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more details to run inventory lookup.';
  }
  const query = cleanText(payload.query, 220);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const names = items
      .slice(0, 3)
      .map((item) => cleanText(item?.name || item?.id, 140))
      .filter(Boolean);
    const preview = names.length ? ` Top matches: ${names.join(', ')}.` : '';
    return `Found ${items.length} inventory match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}.${preview}`;
  }
  if (status === 'no_match') {
    return `No inventory matches found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

// Build a concise assistant-facing summary from record lookup results.
function summarizeRecordLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = cleanText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more details to run record lookup.';
  }
  const query = cleanText(payload.query, 220);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const names = items
      .slice(0, 3)
      .map((item) => cleanText(item?.title || item?.id, 140))
      .filter(Boolean);
    const preview = names.length ? ` Top hits: ${names.join(', ')}.` : '';
    return `Found ${items.length} record match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}.${preview}`;
  }
  if (status === 'no_match') {
    return `No record matches found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

// Extract the main answer or follow-up prompt from a science-question result payload.
function summarizeScienceResult(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const status = cleanText(source.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can continue.';
  }
  const answer = cleanText(source.answer, 12000);
  if (answer) {
    return answer;
  }
  return asArray(source.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ');
}

// Build a concise assistant-facing summary from notebook draft proposal results.
function summarizeNotebookDraft(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const status = cleanText(source.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can plan the next notebook page.';
  }
  const proposal = source.proposal && typeof source.proposal === 'object' ? source.proposal : {};
  const title = cleanText(proposal.title, 220);
  const purpose = cleanText(proposal.purpose, 320);
  const protocolName = cleanText(source?.selected_protocol?.name, 220);
  if (status === 'proposal_ready') {
    return title && purpose
      ? `Planned notebook draft ready: ${title}. ${purpose}`
      : `Planned notebook draft ready${protocolName ? ` using protocol ${protocolName}` : ''}.`;
  }
  return '';
}

// Preserve structured agent output in assistant message metadata for later UI use.
function buildAssistantMetaFromResult(result, requestText = '') {
  const payload = result && typeof result === 'object' ? result : {};
  const protocolWorkflow = payload.protocol_to_notebook && typeof payload.protocol_to_notebook === 'object'
    ? payload.protocol_to_notebook
    : null;
  const notebookDraftWorkflow = payload.notebook_draft && typeof payload.notebook_draft === 'object'
    ? payload.notebook_draft
    : null;
  const notebookPayload = protocolWorkflow?.notebook && typeof protocolWorkflow.notebook === 'object'
    ? protocolWorkflow.notebook
    : (payload.notebookDraft && typeof payload.notebookDraft === 'object' ? payload.notebookDraft : null);
  return {
    parser: payload.parser && typeof payload.parser === 'object' ? cloneJson(payload.parser, {}) : {},
    protocol_to_notebook: protocolWorkflow ? cloneJson(protocolWorkflow, null) : null,
    notebook_draft: notebookDraftWorkflow ? cloneJson(notebookDraftWorkflow, null) : null,
    inventory_lookup: payload.inventory_lookup && typeof payload.inventory_lookup === 'object'
      ? cloneJson(payload.inventory_lookup, null)
      : null,
    record_lookup: payload.record_lookup && typeof payload.record_lookup === 'object'
      ? cloneJson(payload.record_lookup, null)
      : null,
    general_science_question: payload.general_science_question && typeof payload.general_science_question === 'object'
      ? cloneJson(payload.general_science_question, null)
      : null,
    project_science_question: payload.project_science_question && typeof payload.project_science_question === 'object'
      ? cloneJson(payload.project_science_question, null)
      : null,
    result_analysis: payload.result_analysis && typeof payload.result_analysis === 'object'
      ? cloneJson(payload.result_analysis, null)
      : null,
    notebookDraft: notebookPayload ? cloneJson(notebookPayload, null) : null,
    developer_trace: cloneJson(asArray(payload.developer_trace), []),
    requestText: cleanText(requestText, 3000)
  };
}

// Convert the agent's structured result into the plain assistant text shown in chat.
function buildAssistantTextFromResult(result) {
  const payload = result && typeof result === 'object' ? result : {};
  // Pull the major optional result sections into local variables for easier branching below.
  const protocolWorkflow = payload.protocol_to_notebook && typeof payload.protocol_to_notebook === 'object'
    ? payload.protocol_to_notebook
    : null;
  const notebookDraftWorkflow = payload.notebook_draft && typeof payload.notebook_draft === 'object'
    ? payload.notebook_draft
    : null;
  const parser = payload.parser && typeof payload.parser === 'object' ? payload.parser : {};
  const inventoryLookup = payload.inventory_lookup && typeof payload.inventory_lookup === 'object'
    ? payload.inventory_lookup
    : null;
  const recordLookup = payload.record_lookup && typeof payload.record_lookup === 'object'
    ? payload.record_lookup
    : null;
  const generalScienceQuestion = payload.general_science_question && typeof payload.general_science_question === 'object'
    ? payload.general_science_question
    : null;
  const projectScienceQuestion = payload.project_science_question && typeof payload.project_science_question === 'object'
    ? payload.project_science_question
    : null;
  const resultAnalysis = payload.result_analysis && typeof payload.result_analysis === 'object'
    ? payload.result_analysis
    : null;
  const protocolStatus = cleanText(protocolWorkflow?.status, 40);
  const followUpQuestions = asArray(protocolWorkflow?.follow_up_questions).map((item) => cleanText(item, 320)).filter(Boolean);
  const completedNotebookText = cleanText(
    protocolWorkflow?.notebook?.entry_template?.result
      || protocolWorkflow?.notebook?.save?.reason
      || '',
    12000
  );
  const inventorySummaryText = summarizeInventoryLookup(inventoryLookup);
  const recordSummaryText = summarizeRecordLookup(recordLookup);
  const notebookDraftText = summarizeNotebookDraft(notebookDraftWorkflow);
  const scienceAnswerText = summarizeScienceResult(generalScienceQuestion)
    || summarizeScienceResult(projectScienceQuestion)
    || summarizeScienceResult(resultAnalysis);
  if (notebookDraftText) {
    return notebookDraftText;
  }
  // Prefer notebook completion text when a protocol-to-notebook workflow succeeded.
  if (protocolStatus === 'completed') {
    return completedNotebookText
      || `Notebook draft completed using protocol ${cleanText(protocolWorkflow?.selected_protocol?.name, 220) || 'selection'}.`;
  }
  // Surface follow-up questions when the workflow cannot continue without more user input.
  if (protocolStatus === 'needs_more_info') {
    return followUpQuestions.join(' ') || 'More details are needed to fill the remaining notebook placeholders.';
  }
  // Otherwise fall back through science answers, lookup summaries, parser reasoning, and a generic default.
  return scienceAnswerText
    || inventorySummaryText
    || recordSummaryText
    || cleanText(parser.reasoning_summary, 12000)
    || 'Intent parsing completed.';
}

// Create a normalized assistant chat message from a successful agent response payload.
function buildAssistantMessageFromResult({ result, requestText = '', messageId = '', timestamp = '' } = {}) {
  const createdAt = cleanText(timestamp, 80) || new Date().toISOString();
  return {
    id: cleanText(messageId, 120) || createDefaultId(),
    role: 'assistant',
    text: buildAssistantTextFromResult(result),
    createdAt,
    meta: buildAssistantMetaFromResult(result, requestText)
  };
}

// Create a normalized assistant chat message representing an agent failure.
function buildAssistantMessageFromError({ errorMessage = '', requestText = '', messageId = '', timestamp = '' } = {}) {
  const createdAt = cleanText(timestamp, 80) || new Date().toISOString();
  const message = cleanText(errorMessage, 1200) || 'Unknown error';
  return {
    id: cleanText(messageId, 120) || createDefaultId(),
    role: 'assistant',
    text: `Agent failed: ${message}`,
    createdAt,
    meta: {
      parser: {
        primary_intent: 'unclear',
        reasoning_effort: 0,
        direct_answer: null,
        needs_clarification: true,
        clarification_reason: 'agent_error',
        entities: {},
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: [],
        reasoning_summary: `Agent failed: ${message}`
      },
      protocol_to_notebook: null,
      notebook_draft: null,
      inventory_lookup: null,
      record_lookup: null,
      general_science_question: null,
      project_science_question: null,
      result_analysis: null,
      notebookDraft: null,
      developer_trace: [],
      requestText: cleanText(requestText, 3000)
    }
  };
}

// Normalize one chat-session summary entry as stored in the index file.
function normalizeSessionSummary(rawSummary = {}) {
  const source = rawSummary && typeof rawSummary === 'object' ? rawSummary : {};
  const id = cleanText(source.id || source.session_id || source.sessionId, 120);
  if (!id) {
    return null;
  }
  return {
    id,
    title: cleanText(source.title, 220) || 'New Chat',
    project_id: cleanText(source.project_id || source.projectId, 120),
    project_name: cleanText(source.project_name || source.projectName, 220),
    log_file: cleanText(source.log_file || source.logFile, 240) || `${sanitizeFileName(id)}.log`,
    created_at: cleanText(source.created_at || source.createdAt, 80),
    updated_at: cleanText(source.updated_at || source.updatedAt, 80),
    status: cleanText(source.status, 40) || 'ready',
    message_count: Math.max(0, Number(source.message_count) || 0),
    request_count: Math.max(0, Number(source.request_count) || 0),
    last_message_preview: cleanText(source.last_message_preview, 320),
    last_user_message_preview: cleanText(source.last_user_message_preview, 320),
    response_type: cleanText(source.response_type, 80),
    last_request_id: cleanText(source.last_request_id, 120),
    last_error: cleanText(source.last_error, 400)
  };
}

// Normalize the overall chat index payload loaded from disk.
function normalizeIndexPayload(rawIndex = {}) {
  const source = rawIndex && typeof rawIndex === 'object' ? rawIndex : {};
  return {
    version: 1,
    updated_at: cleanText(source.updated_at || source.updatedAt, 80),
    sessions: asArray(source.sessions).map((item) => normalizeSessionSummary(item)).filter(Boolean)
  };
}

// Normalize one log row so event processing can rely on consistent field names.
function normalizeSessionRow(rawRow = {}) {
  const source = rawRow && typeof rawRow === 'object' ? rawRow : {};
  const type = cleanText(source.type, 80);
  const sessionId = cleanText(source.session_id || source.sessionId, 120);
  const timestamp = cleanText(source.timestamp || source.createdAt || source.created_at, 80) || new Date().toISOString();
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
    message_id: cleanText(source.id || source.message_id || source.messageId, 120) || createDefaultId(),
    timestamp: cleanText(source.createdAt || source.timestamp, 80) || new Date().toISOString(),
    text: cleanText(source.text, 24000),
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
    next.project_id = cleanText(row.project_id || next.project_id, 120) || next.project_id;
    next.project_name = cleanText(row.project_name || next.project_name, 220) || next.project_name;
    next.title = cleanText(row.title, 220) || next.title;
    return next;
  }

  // User messages advance message counters and can rename untitled sessions.
  if (row.type === CHAT_LOG_EVENT_TYPES.USER_MESSAGE) {
    const text = cleanText(row.text, 320);
    next.message_count += 1;
    next.last_message_preview = text;
    next.last_user_message_preview = text;
    next.status = 'active';
    if (!cleanText(next.title, 40) || next.title === 'New Chat') {
      next.title = deriveSessionTitle(text, next.title || 'New Chat');
    }
    return next;
  }

  // Assistant replies update the latest preview and clear any previous error marker.
  if (row.type === CHAT_LOG_EVENT_TYPES.ASSISTANT_MESSAGE) {
    next.message_count += 1;
    next.last_message_preview = cleanText(row.text, 320);
    next.status = 'active';
    next.last_error = '';
    return next;
  }

  // Request events track how many agent calls were made and which project they belonged to.
  if (row.type === CHAT_LOG_EVENT_TYPES.AGENT_CHAT_REQUEST) {
    next.request_count += 1;
    next.last_request_id = cleanText(row.requestId, 120) || next.last_request_id;
    next.project_id = cleanText(row.projectId || row.project_id || next.project_id, 120) || next.project_id;
    next.project_name = cleanText(row.projectName || row.project_name || next.project_name, 220) || next.project_name;
    return next;
  }

  // Result events record the latest response type and clear stale errors.
  if (row.type === CHAT_LOG_EVENT_TYPES.AGENT_CHAT_RESULT) {
    next.response_type = cleanText(row.response_type || row.responseType, 80);
    next.last_error = '';
    return next;
  }

  // Error events preserve the latest failure summary for the session list.
  if (row.type === CHAT_LOG_EVENT_TYPES.AGENT_CHAT_ERROR) {
    next.last_error = cleanText(row.error, 400);
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
        id: cleanText(entry.message_id, 120) || createDefaultId(),
        role: 'user',
        text: cleanText(entry.text, 24000),
        createdAt: entry.timestamp
      });
      return messages;
    }
    if (entry.type === CHAT_LOG_EVENT_TYPES.ASSISTANT_MESSAGE) {
      messages.push({
        id: cleanText(entry.message_id, 120) || createDefaultId(),
        role: 'assistant',
        text: cleanText(entry.text, 24000),
        createdAt: entry.timestamp,
        meta: cloneJson(entry.meta, {})
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

  // Resolve the base storage path plus the chat-log folder and index file locations.
  function resolvePaths(storagePath) {
    const resolvedStoragePath = runtimePath.resolve(cleanText(storagePath, 2400));
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
        index: normalizeIndexPayload(JSON.parse(raw))
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
  async function writeIndex(paths, index) {
    const normalized = normalizeIndexPayload(index);
    normalized.updated_at = cleanText(normalized.updated_at, 80) || now();
    await runtimeFs.mkdir(paths.chatLogPath, { recursive: true });
    await runtimeFs.writeFile(paths.indexPath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
  }

  // Append one or more normalized rows to a session log and refresh the summary index.
  async function appendRows(storagePath, sessionId, rows = []) {
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
    const normalizedSessionId = cleanText(sessionId, 120);
    if (!normalizedSessionId) {
      throw new Error('sessionId is required.');
    }
    let session = index.sessions.find((item) => item.id === normalizedSessionId) || null;
    if (!session) {
      session = normalizeSessionSummary({
        id: normalizedSessionId,
        title: 'New Chat',
        project_id: cleanText(filteredRows[0]?.project_id || filteredRows[0]?.projectId, 120),
        project_name: cleanText(filteredRows[0]?.project_name || filteredRows[0]?.projectName, 220),
        created_at: filteredRows[0]?.timestamp || now(),
        updated_at: filteredRows[0]?.timestamp || now(),
        log_file: `${sanitizeFileName(normalizedSessionId)}.log`
      });
      index.sessions.push(session);
    }

    const logPath = runtimePath.join(paths.chatLogPath, session.log_file);
    const payload = filteredRows.map((row) => JSON.stringify(row)).join('\n');
    await runtimeFs.appendFile(logPath, `${payload}\n`, 'utf8');
    filteredRows.forEach((row) => {
      session = applyEntryToSummary(session, row);
    });
    index.sessions = sortSessions(index.sessions.map((item) => item.id === session.id ? session : item));
    await writeIndex(paths, index);
    return {
      ok: true,
      session
    };
  }

  // Create a brand-new session summary and seed its log with a creation event.
  async function createSession(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const title = cleanText(input.title, 220) || 'New Chat';
    const projectId = cleanText(input.projectId || input.project_id, 120);
    const projectName = cleanText(input.projectName || input.project_name, 220);
    const sessionId = cleanText(input.sessionId || input.session_id, 120) || createId();
    const timestamp = cleanText(input.created_at || input.createdAt, 80) || now();
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
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
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
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const limit = Math.max(1, Number(input.limit) || 100);
    const { index } = await readIndex(storagePath);
    return {
      ok: true,
      items: sortSessions(index.sessions).slice(0, limit)
    };
  }

  // Load and normalize all persisted rows for a single session log file.
  async function readSessionRows(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
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
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
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
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
    const message = {
      id: cleanText(input.messageId || input.message_id, 120) || createId(),
      role: 'user',
      text: cleanText(input.text || input.message, 24000),
      createdAt: cleanText(input.createdAt || input.timestamp, 80) || now()
    };
    const row = buildMessageRow(message, sessionId);
    if (row) {
      row.project_id = cleanText(input.projectId || input.project_id, 120);
      row.project_name = cleanText(input.projectName || input.project_name, 220);
    }
    return appendRows(input.storagePath || input.storage_path, sessionId, [row]);
  }

  // Normalize and append an assistant-authored chat message into the session log.
  async function appendAssistantMessage(input = {}) {
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
    const message = input.message && typeof input.message === 'object'
      ? input.message
      : {
        id: cleanText(input.messageId || input.message_id, 120) || createId(),
        role: 'assistant',
        text: cleanText(input.text || input.message_text, 24000),
        createdAt: cleanText(input.createdAt || input.timestamp, 80) || now(),
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
