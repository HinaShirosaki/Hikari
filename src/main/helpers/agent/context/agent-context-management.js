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
const { createAgentContextRegistryRuntime } = require('./agent-context-registry.js');

// Stable identifiers for the context layers that may be exposed to other modules.
const CONTEXT_LAYER_IDS = Object.freeze({
  IMMEDIATE: 'immediate',
  SESSION_MEMORY: 'session_memory',
  LONG_TERM_MEMORY: 'long_term_memory',
  VERIFICATION: 'verification'
});

// High-level session modes indicating whether a task is currently in progress.
const CONTEXT_MODES = Object.freeze({
  READY: 'ready',
  ACTIVE_TASK: 'active_task'
});

// Registry sections that capture candidate context before layer assembly.
const CONTEXT_REGISTRY_SECTIONS = Object.freeze({
  USER: 'user',
  EXECUTION: 'execution',
  MEMORY: 'memory',
  REASONING: 'reasoning',
  SYSTEM: 'system'
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

  function normalizeTaskRecord(source = null, previousTask = null) {
    const raw = ensureObject(source);
    const previous = ensureObject(previousTask);
    if (!Object.keys(raw).length && !Object.keys(previous).length) {
      return null;
    }
    return normalizeTask(raw, previous);
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

  function buildPromptTaskSummary(task) {
    const source = ensureObject(task);
    const lines = [
      cleanText(source.task_type, 120) ? `Task type: ${cleanText(source.task_type, 120)}` : '',
      cleanText(source.intent, 120) ? `Intent: ${cleanText(source.intent, 120)}` : '',
      cleanText(source.status, 80) ? `Status: ${cleanText(source.status, 80)}` : '',
      cleanText(source.project?.name, 220) ? `Project: ${cleanText(source.project.name, 220)}` : '',
      cleanText(source.selected_protocol?.name, 220) ? `Protocol: ${cleanText(source.selected_protocol.name, 220)}` : ''
    ].filter(Boolean);
    const knownValues = Object.entries(ensureObject(source.known_values))
      .slice(0, 4)
      .map(([key, value]) => {
        const normalizedKey = cleanText(key, 80);
        const normalizedValue = cleanText(
          typeof value === 'string'
            ? value
            : JSON.stringify(value),
          160
        );
        if (!normalizedKey || !normalizedValue) {
          return '';
        }
        return `${normalizedKey}=${normalizedValue}`;
      })
      .filter(Boolean);
    const missingFields = normalizeMissingFields(source.missing_fields)
      .slice(0, 4)
      .map((item) => cleanText(item.display || item.key, 120))
      .filter(Boolean);
    const followUps = uniqueStrings(source.follow_up_questions, 3);
    const hasMeaningfulDetail = Boolean(
      cleanText(source.project?.name, 220)
      || cleanText(source.selected_protocol?.name, 220)
      || knownValues.length
      || missingFields.length
      || followUps.length
    );
    if (!hasMeaningfulDetail) {
      return '';
    }
    return [
      'Task summary:',
      ...lines,
      knownValues.length ? `Known values: ${knownValues.join(' | ')}` : '',
      missingFields.length ? `Missing fields: ${missingFields.join(' | ')}` : '',
      followUps.length ? `Follow-up questions: ${followUps.join(' | ')}` : ''
    ].filter(Boolean).join('\n');
  }

  const registryRuntime = createAgentContextRegistryRuntime({
    asArray,
    cleanText,
    now,
    ensureObject,
    cloneJson,
    uniqueStrings,
    normalizeProject,
    normalizeTaskRecord,
    buildTaskSummary,
    CONTEXT_MODES,
    CONTEXT_REGISTRY_SECTIONS
  });

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
      },
      context_registry: registryRuntime.createEmptyContextRegistry(timestamp)
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
    if (!session) {
      return null;
    }
    const touched = touchSession(session);
    registryRuntime.ensureContextRegistry(touched);
    return touched;
  }

  // Persist a cloned snapshot of the session back into the store and return a detached copy.
  function saveSession(session) {
    const normalized = cloneJson(session, {});
    const registry = registryRuntime.ensureContextRegistry(normalized);
    registryRuntime.syncLegacySessionFieldsFromRegistry(normalized, registry);
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
    const normalizedTask = normalizeTask(task, session.active_task);
    session.mode = CONTEXT_MODES.ACTIVE_TASK;
    session.active_task = normalizedTask;
    session.session_memory.active_task_summary = buildTaskSummary(normalizedTask);
    if (normalizedTask.project) {
      session.session_memory.current_project_state = cloneJson(normalizedTask.project, null);
    }
    session.updated_at = now();
    registryRuntime.syncTaskIntoRegistry(session, normalizedTask);
    registryRuntime.syncSessionMemoryIntoRegistry(session);
    return normalizedTask;
  }

  // Start a new task (or overwrite the current one) and seed session memory from the request.
  function startTask(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    updateSessionFromTask(session, source);
    appendSessionMemoryList(session, 'goals', [source.goal, ...asArray(source.goals)], 10);
    appendSessionMemoryList(session, 'decisions', [source.decision, ...asArray(source.decisions)], 12);
    appendSessionMemoryList(session, 'constraints', [source.constraint, ...asArray(source.constraints)], 12);
    appendSessionMemoryList(session, 'unresolved_questions', [source.unresolved_question, ...asArray(source.unresolved_questions)], 12);
    session.latest_user_request = cleanText(source.current_user_request || source.message, 4000) || session.latest_user_request;
    registryRuntime.syncSessionMemoryIntoRegistry(session);
    registryRuntime.registerContextInputs(session, source);
    return saveSession(session);
  }

  // Merge partial task progress into the current active task while preserving prior known values.
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
    appendSessionMemoryList(session, 'goals', [source.goal, ...asArray(source.goals)], 10);
    appendSessionMemoryList(session, 'decisions', [source.decision, ...asArray(source.decisions)], 12);
    appendSessionMemoryList(session, 'constraints', [source.constraint, ...asArray(source.constraints)], 12);
    appendSessionMemoryList(session, 'unresolved_questions', [source.unresolved_question, ...asArray(source.unresolved_questions)], 12);
    registryRuntime.syncSessionMemoryIntoRegistry(session);
    registryRuntime.registerContextInputs(session, source);
    return saveSession(session);
  }

  // Record one tool execution round and expose its result in both task trace and immediate context.
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
    registryRuntime.syncSessionMemoryIntoRegistry(session);
    registryRuntime.registerContextInputs(session, {
      tool_name: toolEntry.tool_name,
      ok: toolEntry.ok,
      summary: toolEntry.summary,
      result: toolEntry.result,
      recorded_at: toolEntry.recorded_at
    });
    return saveSession(session);
  }

  // Track clarification questions in both the active task and session unresolved-question memory.
  function recordFollowUpQuestion(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    const questions = uniqueStrings([source.question, ...asArray(source.questions)], 12);
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
    registryRuntime.syncSessionMemoryIntoRegistry(session);
    registryRuntime.registerContextInputs(session, {
      question: source.question,
      questions: source.questions
    });
    return saveSession(session);
  }

  // Apply user-provided answers to known values and remove any resolved missing-field placeholders.
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
    registryRuntime.syncSessionMemoryIntoRegistry(session);
    registryRuntime.registerContextInputs(session, {
      answer: source.answer || source.message,
      provided_values: providedValues,
      resolved_fields: resolvedKeys,
      clarified_user_message: source.clarified_user_message || source.clarifiedUserMessage
    });
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
    const registry = registryRuntime.ensureContextRegistry(session);
    registry.system.active_task = null;
    registry.system.mode = CONTEXT_MODES.READY;
    registry.execution.tool_outputs = [];
    registry.user.follow_up_questions = [];
    registry.memory.active_task_summary = '';
    registry.updated_at = now();
    registryRuntime.syncLegacySessionFieldsFromRegistry(session, registry);
    return saveSession(session);
  }

  // Finalize the active task, archive a short completion summary, and reset task-scoped context.
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
    const registry = registryRuntime.ensureContextRegistry(session);
    registry.memory.recent_completed_tasks = [
      completedEntry,
      ...asArray(registry.memory.recent_completed_tasks)
    ].slice(0, 8);
    registry.memory.unresolved_questions = [];
    registry.memory.active_task_summary = '';
    registry.user.follow_up_questions = [];
    registry.system.active_task = null;
    registry.system.mode = CONTEXT_MODES.READY;
    registry.execution.tool_outputs = [];
    registry.updated_at = now();
    registryRuntime.syncLegacySessionFieldsFromRegistry(session, registry);
    return saveSession(session);
  }

  function getContextRegistry(sessionId) {
    const record = getSessionRecord(sessionId, false);
    if (!record) {
      return null;
    }
    const registry = registryRuntime.ensureContextRegistry(record);
    return cloneJson(registry, {});
  }

  function buildContextRegistry(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    registryRuntime.registerContextInputs(session, source);
    registryRuntime.syncTaskIntoRegistry(session, session.active_task);
    registryRuntime.syncSessionMemoryIntoRegistry(session);
    const saved = saveSession(session);
    return {
      session_id: saved.session_id,
      mode: saved.active_task ? CONTEXT_MODES.ACTIVE_TASK : CONTEXT_MODES.READY,
      registry: cloneJson(saved.context_registry, {})
    };
  }

  // Return a detached snapshot of one session record without creating it implicitly.
  function getSession(sessionId) {
    const record = getSessionRecord(sessionId, false);
    if (!record) {
      return null;
    }
    const registry = registryRuntime.ensureContextRegistry(record);
    registryRuntime.syncLegacySessionFieldsFromRegistry(record, registry);
    return cloneJson(record, {});
  }

  // Derive candidate facts from selected registry-backed memory that may be worth promoting.
  function deriveMemoryCandidates(selection) {
    const source = ensureObject(selection);
    const memory = ensureObject(source.memory);
    const system = ensureObject(source.system);
    const candidates = [];
    const project = normalizeProject(memory.current_project_state || system.active_task?.project);
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
    asArray(memory.constraints).slice(0, 3).forEach((constraint) => {
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
    asArray(memory.decisions).slice(0, 3).forEach((decision) => {
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
    const taskSummary = buildPromptTaskSummary(layers.immediate.current_task_state);
    const immediate = [
      'Immediate working context:',
      layers.immediate.current_user_request
        ? `User request: ${layers.immediate.current_user_request}`
        : '',
      layers.immediate.recent_conversation.length
        ? `Recent conversation:\n${layers.immediate.recent_conversation.map((entry, index) => `${index + 1}. ${entry.role}: ${entry.text}`).join('\n')}`
        : '',
      layers.immediate.latest_tool_outputs.length
        ? `Latest tool outputs:\n${layers.immediate.latest_tool_outputs.map((entry) => {
          const toolName = cleanText(entry?.tool_name, 120) || 'tool';
          const okLabel = entry?.ok === false ? 'failed' : 'ok';
          const summary = cleanText(entry?.summary, 220) || '[result available]';
          return `- ${toolName} (${okLabel}) | summary: ${summary}`;
        }).join('\n')}`
        : '',
      taskSummary
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
      layers.session_memory.recent_completed_tasks.length
        ? `Recent completed tasks: ${layers.session_memory.recent_completed_tasks.map((item) => item.summary).join(' | ')}`
        : ''
    ].filter(Boolean).join('\n\n');

    const verification = [
      'Verification feedback:',
      layers.verification?.inference_feedback?.length
        ? `Inference feedback: ${layers.verification.inference_feedback.map((item) => {
          const prefix = cleanText(item.kind, 80);
          const summary = cleanText(item.summary, 320);
          const impact = cleanText(item.impact, 320);
          return [prefix ? `${prefix}:` : '', summary, impact ? `(impact: ${impact})` : ''].filter(Boolean).join(' ');
        }).join(' | ')}`
        : '',
      layers.verification?.evaluation_feedback?.length
        ? `Evaluation feedback: ${layers.verification.evaluation_feedback.map((item) => {
          const prefix = cleanText(item.kind, 80);
          const summary = cleanText(item.summary, 320);
          const impact = cleanText(item.impact, 320);
          return [prefix ? `${prefix}:` : '', summary, impact ? `(impact: ${impact})` : ''].filter(Boolean).join(' ');
        }).join(' | ')}`
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
      verification,
      long_term_memory: longTermMemory,
      combined: [immediate, sessionMemory, verification, longTermMemory].filter(Boolean).join('\n\n')
    };
  }

  // Build the full layered context envelope returned to the agent orchestration layer.
  function buildContextEnvelope(input = {}) {
    const source = ensureObject(input);
    const session = getSessionRecord(source.session_id);
    registryRuntime.registerContextInputs(session, source);
    registryRuntime.syncTaskIntoRegistry(session, session.active_task);
    registryRuntime.syncSessionMemoryIntoRegistry(session);
    const saved = saveSession(session);
    const registry = registryRuntime.normalizeContextRegistry(saved.context_registry, saved);
    const selection = registryRuntime.buildRegistrySelection(registry);
    const layers = {
      immediate: {
        current_user_request: selection.user.current_user_request,
        recent_conversation: selection.user.recent_conversation,
        latest_tool_outputs: selection.execution.latest_tool_outputs,
        current_task_state: selection.system.active_task ? cloneJson(selection.system.active_task, null) : null
      },
      session_memory: {
        goals: selection.memory.goals,
        decisions: selection.memory.decisions,
        constraints: selection.memory.constraints,
        unresolved_questions: selection.memory.unresolved_questions,
        current_project_state: selection.memory.current_project_state,
        active_task_summary: selection.memory.active_task_summary,
        recent_completed_tasks: cloneJson(selection.memory.recent_completed_tasks, [])
      },
      verification: {
        inference_feedback: selection.reasoning.inference_feedback,
        evaluation_feedback: selection.reasoning.evaluation_feedback
      },
      long_term_memory: selection.memory.long_term_memory
    };
    return {
      session_id: saved.session_id,
      mode: selection.system.mode,
      active_task: selection.system.active_task ? cloneJson(selection.system.active_task, null) : null,
      registry: cloneJson(registry, {}),
      registry_selection: cloneJson(selection, {}),
      layers,
      prompt_blocks: buildPromptBlocks(layers),
      memory_candidates: deriveMemoryCandidates(selection)
    };
  }

  // Remove stale sessions whose last update exceeds the configured in-memory TTL.
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

  // Expose the public runtime operations used by the higher-level agent orchestrator.
  return {
    startTask,
    mergeTaskUpdate,
    recordToolRound,
    recordFollowUpQuestion,
    recordFollowUpAnswer,
    completeTask,
    resetActiveTask,
    buildContextRegistry,
    buildContextEnvelope,
    getContextRegistry,
    getSession,
    pruneExpiredSessions
  };
}

// Public module export exposing the context constants and runtime factory.
module.exports = {
  CONTEXT_LAYER_IDS,
  CONTEXT_MODES,
  CONTEXT_REGISTRY_SECTIONS,
  createAgentContextManagementRuntime
};
