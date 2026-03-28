/**
 * Context-layer state management for agent sessions, including active task
 * tracking, short-lived session memory, prompt block assembly, and pruning of
 * expired in-memory session records.
 */
'use strict';

// Shared list/text normalization helpers reused across the agent runtime.
const {
  defaultAsArray,
  defaultCleanText
} = require('../shared/agent-llm-utils.js');

// Stable identifiers for the context layers that may be exposed to other modules.
const CONTEXT_LAYER_IDS = Object.freeze({
  IMMEDIATE: 'immediate',
  SESSION_MEMORY: 'session_memory',
  LONG_TERM_MEMORY: 'long_term_memory'
});

// High-level session modes indicating whether a task is currently in progress.
const CONTEXT_MODES = Object.freeze({
  READY: 'ready',
  ACTIVE_TASK: 'active_task'
});

// Keep only plain object-like values; everything else becomes an empty object.
function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Deep-clone JSON-safe values so callers do not mutate stored session state by reference.
function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

// Generate a lightweight identifier for newly created active-task records.
function createTaskId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

// Create the in-memory session runtime used to track active tasks and layered context.
function createAgentContextManagementRuntime(deps = {}) {
  // Allow core helpers, time functions, and storage to be injected for testing or customization.
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const createId = typeof deps.createId === 'function' ? deps.createId : createTaskId;
  const sessionTtlMs = Number.isFinite(Number(deps.sessionTtlMs)) ? Number(deps.sessionTtlMs) : (6 * 60 * 60 * 1000);
  const store = deps.store instanceof Map ? deps.store : new Map();

  // Deduplicate normalized strings while preserving order and enforcing a maximum list size.
  function uniqueStrings(values, max = 12) {
    const seen = new Set();
    const out = [];
    asArray(values).forEach((value) => {
      const normalized = cleanText(value, 260);
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push(normalized);
    });
    return out;
  }

  // Ensure every public session mutation operates on a valid normalized session id.
  function requireSessionId(sessionId) {
    const normalized = cleanText(sessionId, 160);
    if (!normalized) {
      throw new Error('session_id is required.');
    }
    return normalized;
  }

  // Normalize project metadata that may arrive from parser output or tool resolution.
  function normalizeProject(project) {
    const source = ensureObject(project);
    const id = cleanText(source.id, 120);
    const name = cleanText(source.name, 220);
    const resolutionSource = cleanText(source.resolution_source || source.resolutionSource, 80);
    if (!id && !name) {
      return null;
    }
    return {
      id,
      name,
      resolution_source: resolutionSource
    };
  }

  // Normalize selected protocol metadata while preserving any extra structured fields.
  function normalizeSelectedProtocol(protocol) {
    const source = ensureObject(protocol);
    const id = cleanText(source.id, 120);
    const name = cleanText(source.name, 220);
    if (!id && !name) {
      return null;
    }
    return cloneJson({
      ...source,
      id,
      name
    }, null);
  }

  // Normalize unresolved placeholders into consistent `{ key, display, reason }` objects.
  function normalizeMissingFields(values, max = 20) {
    return asArray(values).slice(0, max).map((value) => {
      if (typeof value === 'string') {
        const normalized = cleanText(value, 220);
        return normalized
          ? { key: normalized.toLowerCase(), display: normalized, reason: '' }
          : null;
      }
      const source = ensureObject(value);
      const key = cleanText(source.key || source.placeholder_key || source.id, 160)
        || cleanText(source.display, 160).toLowerCase();
      const display = cleanText(source.display || source.placeholder_key || source.key || source.id, 220);
      const reason = cleanText(source.reason, 260);
      if (!key && !display) {
        return null;
      }
      return {
        key,
        display: display || key,
        reason
      };
    }).filter(Boolean);
  }

  // Normalize one recorded tool execution so task traces stay consistent across updates.
  function normalizeToolTraceEntry(source) {
    const raw = ensureObject(source);
    const toolName = cleanText(raw.tool_name || raw.toolName, 120);
    return {
      tool_name: toolName,
      ok: raw.ok !== false,
      summary: cleanText(raw.summary, 320),
      input: cloneJson(ensureObject(raw.input), {}),
      result: cloneJson(raw.result, null),
      recorded_at: cleanText(raw.recorded_at || raw.recordedAt, 80) || now()
    };
  }

  // Merge incoming task updates with any prior task state into one normalized active-task record.
  function normalizeTask(source = {}, previousTask = null) {
    // Start from the incoming partial update plus any previous task so omitted fields can be preserved.
    const raw = ensureObject(source);
    const previous = ensureObject(previousTask);
    const taskId = cleanText(raw.task_id || raw.taskId, 160)
      || cleanText(previous.task_id, 160)
      || createId();
    // Normalize every task subfield into stable shapes used by prompt builders and follow-up logic.
    return {
      task_id: taskId,
      task_type: cleanText(raw.task_type || raw.taskType, 120) || cleanText(previous.task_type, 120),
      intent: cleanText(raw.intent, 120) || cleanText(previous.intent, 120),
      status: cleanText(raw.status, 80) || cleanText(previous.status, 80) || 'active',
      project: normalizeProject(raw.project) || normalizeProject(previous.project),
      selected_protocol: normalizeSelectedProtocol(raw.selected_protocol || raw.selectedProtocol)
        || normalizeSelectedProtocol(previous.selected_protocol),
      missing_fields: normalizeMissingFields(
        raw.missing_fields !== undefined ? raw.missing_fields : previous.missing_fields,
        24
      ),
      known_values: cloneJson(ensureObject(
        raw.known_values !== undefined ? raw.known_values : previous.known_values
      ), {}),
      follow_up_questions: uniqueStrings(
        raw.follow_up_questions !== undefined ? raw.follow_up_questions : previous.follow_up_questions,
        12
      ),
      tool_trace: asArray(
        raw.tool_trace !== undefined ? raw.tool_trace : previous.tool_trace
      ).slice(0, 20).map((entry) => normalizeToolTraceEntry(entry)),
      started_at: cleanText(raw.started_at || raw.startedAt, 80)
        || cleanText(previous.started_at, 80)
        || now(),
      updated_at: cleanText(raw.updated_at || raw.updatedAt, 80) || now()
    };
  }

  // Build a compact one-line summary of the active task for prompt/session-memory use.
  function buildTaskSummary(task) {
    const source = ensureObject(task);
    const parts = [
      cleanText(source.task_type, 120) || cleanText(source.intent, 120),
      cleanText(source.status, 80) ? `status=${cleanText(source.status, 80)}` : '',
      cleanText(source.project?.name, 220) ? `project=${cleanText(source.project?.name, 220)}` : '',
      cleanText(source.selected_protocol?.name, 220) ? `protocol=${cleanText(source.selected_protocol?.name, 220)}` : ''
    ].filter(Boolean);
    return cleanText(parts.join(' | '), 600);
  }

  // Create the default layered-memory structure for a brand-new session.
  function createEmptySession(sessionId) {
    const timestamp = now();
    return {
      session_id: sessionId,
      mode: CONTEXT_MODES.READY,
      created_at: timestamp,
      updated_at: timestamp,
      active_task: null,
      latest_user_request: '',
      recent_conversation: [],
      latest_tool_outputs: [],
      session_memory: {
        goals: [],
        decisions: [],
        constraints: [],
        unresolved_questions: [],
        current_project_state: null,
        active_task_summary: '',
        recent_completed_tasks: []
      }
    };
  }

  // Refresh the session timestamp whenever it is accessed or modified.
  function touchSession(session) {
    return {
      ...session,
      updated_at: now()
    };
  }

  // Retrieve a session from the store, optionally creating an empty one on first access.
  function getSessionRecord(sessionId, createIfMissing = true) {
    const normalizedId = requireSessionId(sessionId);
    let session = store.get(normalizedId);
    if (!session && createIfMissing) {
      session = createEmptySession(normalizedId);
      store.set(normalizedId, session);
    }
    return session ? touchSession(session) : null;
  }

  // Persist a cloned snapshot of the session back into the store and return a detached copy.
  function saveSession(session) {
    const normalized = cloneJson(session, {});
    store.set(requireSessionId(normalized.session_id), normalized);
    return cloneJson(normalized, {});
  }

  // Append normalized items into one session-memory list while deduplicating older values.
  function appendSessionMemoryList(session, field, values, max = 12) {
    session.session_memory[field] = uniqueStrings([
      ...asArray(session.session_memory[field]),
      ...asArray(values)
    ], max);
  }

  // Promote the session into active-task mode and synchronize summary/project fields from the task.
  function updateSessionFromTask(session, task) {
    // Always re-normalize task updates before storing them back on the session.
    const normalizedTask = normalizeTask(task, session.active_task);
    session.mode = CONTEXT_MODES.ACTIVE_TASK;
    session.active_task = normalizedTask;
    session.session_memory.active_task_summary = buildTaskSummary(normalizedTask);
    // Keep the latest active project visible in session memory for future requests.
    if (normalizedTask.project) {
      session.session_memory.current_project_state = cloneJson(normalizedTask.project, null);
    }
    session.updated_at = now();
    return normalizedTask;
  }

  // Start a new task (or overwrite the current one) and seed session memory from the request.
  function startTask(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    const task = updateSessionFromTask(session, source);
    appendSessionMemoryList(session, 'goals', [source.goal, ...(asArray(source.goals))], 10);
    appendSessionMemoryList(session, 'decisions', [source.decision, ...(asArray(source.decisions))], 12);
    appendSessionMemoryList(session, 'constraints', [source.constraint, ...(asArray(source.constraints))], 12);
    appendSessionMemoryList(session, 'unresolved_questions', [source.unresolved_question, ...(asArray(source.unresolved_questions))], 12);
    session.latest_user_request = cleanText(source.current_user_request || source.message, 4000) || session.latest_user_request;
    return saveSession(session);
  }

  // Merge partial task progress into the current active task while preserving prior known values.
  function mergeTaskUpdate(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    // Merge incremental fields carefully so known values, questions, and tool traces accumulate.
    const nextTask = normalizeTask({
      ...ensureObject(session.active_task),
      ...source,
      known_values: {
        ...ensureObject(session.active_task?.known_values),
        ...ensureObject(source.known_values)
      },
      follow_up_questions: uniqueStrings([
        ...asArray(session.active_task?.follow_up_questions),
        ...asArray(source.follow_up_questions)
      ], 12),
      tool_trace: [
        ...asArray(session.active_task?.tool_trace),
        ...asArray(source.tool_trace)
      ].slice(-20)
    }, session.active_task);
    updateSessionFromTask(session, nextTask);
    appendSessionMemoryList(session, 'goals', [source.goal, ...(asArray(source.goals))], 10);
    appendSessionMemoryList(session, 'decisions', [source.decision, ...(asArray(source.decisions))], 12);
    appendSessionMemoryList(session, 'constraints', [source.constraint, ...(asArray(source.constraints))], 12);
    appendSessionMemoryList(session, 'unresolved_questions', [source.unresolved_question, ...(asArray(source.unresolved_questions))], 12);
    return saveSession(session);
  }

  // Record one tool execution round and expose its result in both task trace and immediate context.
  function recordToolRound(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    // Normalize the current tool execution into the canonical trace entry shape.
    const toolEntry = normalizeToolTraceEntry({
      tool_name: source.tool_name,
      ok: source.ok,
      summary: source.summary,
      input: source.input,
      result: source.result,
      recorded_at: source.recorded_at
    });
    // Attach the tool result to the current task, or create a minimal tool-loop task if none exists yet.
    const activeTask = session.active_task
      ? normalizeTask({
        ...session.active_task,
        tool_trace: [...asArray(session.active_task.tool_trace), toolEntry].slice(-20),
        updated_at: now()
      }, session.active_task)
      : normalizeTask({
        session_id: source.session_id,
        task_type: cleanText(source.task_type, 120) || 'tool_loop',
        intent: cleanText(source.intent, 120),
        status: 'active',
        tool_trace: [toolEntry]
      });
    updateSessionFromTask(session, activeTask);
    // Mirror a shorter version of the latest tool results into the immediate context layer.
    session.latest_tool_outputs = [
      {
        tool_name: toolEntry.tool_name,
        ok: toolEntry.ok,
        summary: toolEntry.summary,
        result: cloneJson(toolEntry.result, null),
        recorded_at: toolEntry.recorded_at
      },
      ...asArray(session.latest_tool_outputs)
    ].slice(0, 6);
    return saveSession(session);
  }

  // Track clarification questions in both the active task and session unresolved-question memory.
  function recordFollowUpQuestion(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    const questions = uniqueStrings([source.question, ...(asArray(source.questions))], 12);
    const activeTask = normalizeTask({
      ...ensureObject(session.active_task),
      follow_up_questions: [
        ...asArray(session.active_task?.follow_up_questions),
        ...questions
      ],
      updated_at: now()
    }, session.active_task);
    updateSessionFromTask(session, activeTask);
    appendSessionMemoryList(session, 'unresolved_questions', questions, 12);
    return saveSession(session);
  }

  // Apply user-provided answers to known values and remove any resolved missing-field placeholders.
  function recordFollowUpAnswer(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    // Collect structured values provided by the user so they can be merged into task state.
    const providedValues = ensureObject(source.provided_values || source.known_values);
    const resolvedKeys = uniqueStrings([
      ...asArray(source.resolved_fields),
      ...Object.keys(providedValues)
    ], 24).map((item) => item.toLowerCase());
    // Remove any missing-field placeholders that were resolved by the new answer payload.
    const nextMissingFields = normalizeMissingFields(asArray(session.active_task?.missing_fields))
      .filter((item) => !resolvedKeys.includes(cleanText(item.key || item.display, 160).toLowerCase()));
    const activeTask = normalizeTask({
      ...ensureObject(session.active_task),
      missing_fields: nextMissingFields,
      known_values: {
        ...ensureObject(session.active_task?.known_values),
        ...cloneJson(providedValues, {})
      },
      updated_at: now()
    }, session.active_task);
    updateSessionFromTask(session, activeTask);
    session.latest_user_request = cleanText(source.answer || source.message, 4000) || session.latest_user_request;
    // Best-effort cleanup of session-level unresolved questions that reference the resolved keys.
    session.session_memory.unresolved_questions = uniqueStrings(
      asArray(session.session_memory.unresolved_questions).filter((question) => {
        const normalized = question.toLowerCase();
        return !resolvedKeys.some((key) => key && normalized.includes(key));
      }),
      12
    );
    return saveSession(session);
  }

  // Clear the active task and return the session to ready mode without erasing broader session memory.
  function resetActiveTask(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    session.active_task = null;
    session.mode = CONTEXT_MODES.READY;
    session.latest_tool_outputs = [];
    session.session_memory.active_task_summary = '';
    session.updated_at = now();
    return saveSession(session);
  }

  // Finalize the active task, archive a short completion summary, and reset task-scoped context.
  function completeTask(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    // Snapshot the final task state before archiving a compact completion record.
    const activeTask = normalizeTask({
      ...ensureObject(session.active_task),
      ...source,
      status: cleanText(source.status, 80) || 'completed',
      updated_at: now()
    }, session.active_task);
    // Store a short recent-history entry so future prompts can reference recently finished work.
    const completedEntry = {
      task_id: cleanText(activeTask.task_id, 160),
      task_type: cleanText(activeTask.task_type, 120),
      intent: cleanText(activeTask.intent, 120),
      status: cleanText(activeTask.status, 80),
      summary: cleanText(source.completion_summary, 320) || buildTaskSummary(activeTask),
      completed_at: now()
    };
    // Keep only the most recent completed tasks in session memory.
    session.session_memory.recent_completed_tasks = [
      completedEntry,
      ...asArray(session.session_memory.recent_completed_tasks)
    ].slice(0, 8);
    session.session_memory.unresolved_questions = [];
    session.active_task = null;
    session.mode = CONTEXT_MODES.READY;
    session.latest_tool_outputs = [];
    session.session_memory.active_task_summary = '';
    session.updated_at = now();
    return saveSession(session);
  }

  // Return a detached snapshot of one session record without creating it implicitly.
  function getSession(sessionId) {
    const record = getSessionRecord(sessionId, false);
    return record ? cloneJson(record, {}) : null;
  }

  // Normalize the recent conversation window into short role/text entries for prompt assembly.
  function normalizeConversation(conversation, max = 8) {
    return asArray(conversation)
      .slice(-max)
      .map((entry) => ({
        role: cleanText(entry?.role, 40) || 'user',
        text: cleanText(entry?.text, 4000)
      }))
      .filter((entry) => entry.text);
  }

  // Normalize recent tool outputs that should remain visible in the immediate working context.
  function normalizeImmediateToolOutputs(toolOutputs, max = 6) {
    return asArray(toolOutputs)
      .slice(-max)
      .map((entry) => ({
        tool_name: cleanText(entry?.tool_name || entry?.name, 120),
        ok: entry?.ok !== false,
        summary: cleanText(entry?.summary, 320),
        result: cloneJson(entry?.result !== undefined ? entry.result : entry?.items, null),
        recorded_at: cleanText(entry?.recorded_at || entry?.recordedAt, 80)
      }));
  }

  // Normalize recalled long-term-memory items before they are embedded into prompt context.
  function normalizeLongTermMemoryItems(items, max = 12) {
    return asArray(items).slice(0, max).map((item) => {
      const source = ensureObject(item);
      return {
        id: cleanText(source.id, 160),
        category: cleanText(source.category, 120),
        key: cleanText(source.key, 220),
        summary: cleanText(source.summary, 600),
        value: cloneJson(source.value, null),
        project_name: cleanText(source.project_name || source.projectName, 220),
        tags: uniqueStrings(source.tags, 12),
        source: cleanText(source.source, 120),
        updated_at: cleanText(source.updated_at || source.updatedAt, 80)
      };
    }).filter((item) => item.id || item.key || item.summary);
  }

  // Derive candidate facts from session memory that may be worth promoting to long-term memory.
  function deriveMemoryCandidates(session) {
    const candidates = [];
    const project = normalizeProject(session.session_memory?.current_project_state);
    if (project?.name) {
      candidates.push({
        category: 'project_name',
        key: project.name,
        summary: `Project context for ${project.name}.`,
        value: project,
        project_name: project.name,
        tags: ['project'],
        source: 'session_memory'
      });
    }
    asArray(session.session_memory?.constraints).slice(0, 3).forEach((constraint) => {
      candidates.push({
        category: 'constraint',
        key: constraint,
        summary: constraint,
        value: constraint,
        project_name: project?.name || '',
        tags: ['constraint'],
        source: 'session_memory'
      });
    });
    asArray(session.session_memory?.decisions).slice(0, 3).forEach((decision) => {
      candidates.push({
        category: 'decision',
        key: decision,
        summary: decision,
        value: decision,
        project_name: project?.name || '',
        tags: ['decision'],
        source: 'session_memory'
      });
    });
    return candidates.slice(0, 8);
  }

  // Render each context layer into human-readable prompt sections plus one combined block.
  function buildPromptBlocks(layers) {
    // Immediate context focuses on the current request, recent dialogue, and fresh tool outputs.
    const immediate = [
      'Immediate working context:',
      layers.immediate.current_user_request
        ? `User request: ${layers.immediate.current_user_request}`
        : '',
      layers.immediate.recent_conversation.length
        ? `Recent conversation:\n${layers.immediate.recent_conversation.map((entry, index) => `${index + 1}. ${entry.role}: ${entry.text}`).join('\n')}`
        : '',
      layers.immediate.latest_tool_outputs.length
        ? `Latest tool outputs:\n${layers.immediate.latest_tool_outputs.map((entry, index) => `${index + 1}. ${entry.tool_name || 'tool'}: ${entry.summary || '[result available]'}`).join('\n')}`
        : '',
      layers.immediate.current_task_state
        ? `Current task state JSON:\n${JSON.stringify(layers.immediate.current_task_state, null, 2)}`
        : ''
    ].filter(Boolean).join('\n\n');

    // Session memory captures medium-term information accumulated during this chat session.
    const sessionMemory = [
      'Session memory summary:',
      layers.session_memory.goals.length ? `Goals: ${layers.session_memory.goals.join(' | ')}` : '',
      layers.session_memory.decisions.length ? `Decisions: ${layers.session_memory.decisions.join(' | ')}` : '',
      layers.session_memory.constraints.length ? `Constraints: ${layers.session_memory.constraints.join(' | ')}` : '',
      layers.session_memory.unresolved_questions.length ? `Unresolved questions: ${layers.session_memory.unresolved_questions.join(' | ')}` : '',
      layers.session_memory.current_project_state?.name
        ? `Current project: ${layers.session_memory.current_project_state.name}`
        : '',
      layers.session_memory.active_task_summary
        ? `Active task summary: ${layers.session_memory.active_task_summary}`
        : '',
      layers.session_memory.recent_completed_tasks.length
        ? `Recent completed tasks: ${layers.session_memory.recent_completed_tasks.map((item) => item.summary).join(' | ')}`
        : ''
    ].filter(Boolean).join('\n\n');

    // Long-term memory lists recalled durable facts supplied by external memory retrieval.
    const longTermMemory = [
      'Long-term memory:',
      layers.long_term_memory.length
        ? layers.long_term_memory.map((item, index) => `${index + 1}. ${item.category || 'memory'} ${item.key || ''}: ${item.summary || '[value stored]'}`).join('\n')
        : 'No recalled long-term memory.'
    ].join('\n\n');

    return {
      immediate,
      session_memory: sessionMemory,
      long_term_memory: longTermMemory,
      combined: [immediate, sessionMemory, longTermMemory].filter(Boolean).join('\n\n')
    };
  }

  // Build the full layered context envelope returned to the agent orchestration layer.
  function buildContextEnvelope(input = {}) {
    // Combine current request data with persisted session state to assemble the layered envelope.
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    // Build the three context layers: immediate working state, session memory, and recalled memory.
    const layers = {
      immediate: {
        current_user_request: cleanText(source.current_user_request || source.message, 4000) || session.latest_user_request,
        recent_conversation: normalizeConversation(
          source.recent_conversation !== undefined
            ? source.recent_conversation
            : (source.conversation !== undefined ? source.conversation : session.recent_conversation)
        ),
        latest_tool_outputs: normalizeImmediateToolOutputs(
          source.tool_outputs !== undefined ? source.tool_outputs : session.latest_tool_outputs
        ),
        current_task_state: session.active_task ? cloneJson(session.active_task, null) : null
      },
      session_memory: {
        goals: uniqueStrings(session.session_memory.goals, 10),
        decisions: uniqueStrings(session.session_memory.decisions, 12),
        constraints: uniqueStrings(session.session_memory.constraints, 12),
        unresolved_questions: uniqueStrings(session.session_memory.unresolved_questions, 12),
        current_project_state: normalizeProject(session.session_memory.current_project_state),
        active_task_summary: cleanText(session.session_memory.active_task_summary, 600),
        recent_completed_tasks: cloneJson(asArray(session.session_memory.recent_completed_tasks).slice(0, 8), [])
      },
      long_term_memory: normalizeLongTermMemoryItems(
        source.long_term_memory !== undefined ? source.long_term_memory : source.recalled_memory
      )
    };
    // Persist the latest immediate-layer values back onto the session for subsequent turns.
    session.latest_user_request = layers.immediate.current_user_request || session.latest_user_request;
    session.recent_conversation = cloneJson(layers.immediate.recent_conversation, []);
    session.latest_tool_outputs = cloneJson(layers.immediate.latest_tool_outputs, []);
    saveSession(session);
    // Return both structured layers and ready-to-insert prompt blocks for the orchestrator.
    return {
      session_id: session.session_id,
      mode: session.active_task ? CONTEXT_MODES.ACTIVE_TASK : CONTEXT_MODES.READY,
      active_task: session.active_task ? cloneJson(session.active_task, null) : null,
      layers,
      prompt_blocks: buildPromptBlocks(layers),
      memory_candidates: deriveMemoryCandidates(session)
    };
  }

  // Remove stale sessions whose last update exceeds the configured in-memory TTL.
  function pruneExpiredSessions() {
    // Track which session ids were removed so callers can inspect cleanup behavior.
    const removed = [];
    const nowMs = Date.now();
    // Expire sessions based on their most recent timestamp, discarding malformed timestamps as well.
    store.forEach((session, key) => {
      const updatedAt = Date.parse(session?.updated_at || session?.created_at || '');
      if (!Number.isFinite(updatedAt)) {
        store.delete(key);
        removed.push(key);
        return;
      }
      if ((nowMs - updatedAt) > sessionTtlMs) {
        store.delete(key);
        removed.push(key);
      }
    });
    return removed;
  }

  // Expose the public runtime operations used by the higher-level agent orchestrator.
  return {
    startTask,
    mergeTaskUpdate,
    recordToolRound,
    recordFollowUpQuestion,
    recordFollowUpAnswer,
    completeTask,
    resetActiveTask,
    buildContextEnvelope,
    getSession,
    pruneExpiredSessions
  };
}

// Public module export exposing the context constants and runtime factory.
module.exports = {
  CONTEXT_LAYER_IDS,
  CONTEXT_MODES,
  createAgentContextManagementRuntime
};
