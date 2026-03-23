'use strict';

const {
  defaultAsArray,
  defaultCleanText
} = require('./agent-llm-utils.js');

const CONTEXT_LAYER_IDS = Object.freeze({
  IMMEDIATE: 'immediate',
  SESSION_MEMORY: 'session_memory',
  LONG_TERM_MEMORY: 'long_term_memory'
});

const CONTEXT_MODES = Object.freeze({
  READY: 'ready',
  ACTIVE_TASK: 'active_task'
});

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function createTaskId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createAgentContextManagementRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const createId = typeof deps.createId === 'function' ? deps.createId : createTaskId;
  const sessionTtlMs = Number.isFinite(Number(deps.sessionTtlMs)) ? Number(deps.sessionTtlMs) : (6 * 60 * 60 * 1000);
  const store = deps.store instanceof Map ? deps.store : new Map();

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

  function requireSessionId(sessionId) {
    const normalized = cleanText(sessionId, 160);
    if (!normalized) {
      throw new Error('session_id is required.');
    }
    return normalized;
  }

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

  function normalizeTask(source = {}, previousTask = null) {
    const raw = ensureObject(source);
    const previous = ensureObject(previousTask);
    const taskId = cleanText(raw.task_id || raw.taskId, 160)
      || cleanText(previous.task_id, 160)
      || createId();
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

  function touchSession(session) {
    return {
      ...session,
      updated_at: now()
    };
  }

  function getSessionRecord(sessionId, createIfMissing = true) {
    const normalizedId = requireSessionId(sessionId);
    let session = store.get(normalizedId);
    if (!session && createIfMissing) {
      session = createEmptySession(normalizedId);
      store.set(normalizedId, session);
    }
    return session ? touchSession(session) : null;
  }

  function saveSession(session) {
    const normalized = cloneJson(session, {});
    store.set(requireSessionId(normalized.session_id), normalized);
    return cloneJson(normalized, {});
  }

  function appendSessionMemoryList(session, field, values, max = 12) {
    session.session_memory[field] = uniqueStrings([
      ...asArray(session.session_memory[field]),
      ...asArray(values)
    ], max);
  }

  function updateSessionFromTask(session, task) {
    const normalizedTask = normalizeTask(task, session.active_task);
    session.mode = CONTEXT_MODES.ACTIVE_TASK;
    session.active_task = normalizedTask;
    session.session_memory.active_task_summary = buildTaskSummary(normalizedTask);
    if (normalizedTask.project) {
      session.session_memory.current_project_state = cloneJson(normalizedTask.project, null);
    }
    session.updated_at = now();
    return normalizedTask;
  }

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

  function mergeTaskUpdate(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
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

  function recordToolRound(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    const toolEntry = normalizeToolTraceEntry({
      tool_name: source.tool_name,
      ok: source.ok,
      summary: source.summary,
      input: source.input,
      result: source.result,
      recorded_at: source.recorded_at
    });
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

  function recordFollowUpAnswer(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    const providedValues = ensureObject(source.provided_values || source.known_values);
    const resolvedKeys = uniqueStrings([
      ...asArray(source.resolved_fields),
      ...Object.keys(providedValues)
    ], 24).map((item) => item.toLowerCase());
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
    session.session_memory.unresolved_questions = uniqueStrings(
      asArray(session.session_memory.unresolved_questions).filter((question) => {
        const normalized = question.toLowerCase();
        return !resolvedKeys.some((key) => key && normalized.includes(key));
      }),
      12
    );
    return saveSession(session);
  }

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

  function completeTask(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    const activeTask = normalizeTask({
      ...ensureObject(session.active_task),
      ...source,
      status: cleanText(source.status, 80) || 'completed',
      updated_at: now()
    }, session.active_task);
    const completedEntry = {
      task_id: cleanText(activeTask.task_id, 160),
      task_type: cleanText(activeTask.task_type, 120),
      intent: cleanText(activeTask.intent, 120),
      status: cleanText(activeTask.status, 80),
      summary: cleanText(source.completion_summary, 320) || buildTaskSummary(activeTask),
      completed_at: now()
    };
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

  function getSession(sessionId) {
    const record = getSessionRecord(sessionId, false);
    return record ? cloneJson(record, {}) : null;
  }

  function normalizeConversation(conversation, max = 8) {
    return asArray(conversation)
      .slice(-max)
      .map((entry) => ({
        role: cleanText(entry?.role, 40) || 'user',
        text: cleanText(entry?.text, 4000)
      }))
      .filter((entry) => entry.text);
  }

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

  function buildPromptBlocks(layers) {
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

  function buildContextEnvelope(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
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
    session.latest_user_request = layers.immediate.current_user_request || session.latest_user_request;
    session.recent_conversation = cloneJson(layers.immediate.recent_conversation, []);
    session.latest_tool_outputs = cloneJson(layers.immediate.latest_tool_outputs, []);
    saveSession(session);
    return {
      session_id: session.session_id,
      mode: session.active_task ? CONTEXT_MODES.ACTIVE_TASK : CONTEXT_MODES.READY,
      active_task: session.active_task ? cloneJson(session.active_task, null) : null,
      layers,
      prompt_blocks: buildPromptBlocks(layers),
      memory_candidates: deriveMemoryCandidates(session)
    };
  }

  function pruneExpiredSessions() {
    const removed = [];
    const nowMs = Date.now();
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

module.exports = {
  CONTEXT_LAYER_IDS,
  CONTEXT_MODES,
  createAgentContextManagementRuntime
};
