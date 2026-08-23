'use strict';

const { cloneJson, ensureObject } = require('../../lib/normalize.js');

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function safeTimestampMs(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function defaultIsProcessAlive(processId) {
  const pid = Number(processId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM' || error?.code === 'EACCES';
  }
}

function createSubAgentId() {
  return `subagent-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

const SUB_AGENT_ACTIONS = Object.freeze({
  CREATE: 'create',
  MESSAGE: 'message',
  DELETE: 'delete',
  GET: 'get',
  LIST: 'list'
});

function normalizeAction(value) {
  const normalized = defaultCleanText(value).toLowerCase();
  return Object.values(SUB_AGENT_ACTIONS).includes(normalized) ? normalized : '';
}

function normalizeMessage(role, text, timestamp) {
  return {
    role: role === 'assistant' ? 'assistant' : 'user',
    text: defaultCleanText(text),
    timestamp: defaultCleanText(timestamp)
  };
}

function normalizeTurnResult(rawResult) {
  if (typeof rawResult === 'string') {
    return {
      assistant_message: defaultCleanText(rawResult),
      summary: ''
    };
  }
  const source = ensureObject(rawResult);
  return {
    assistant_message: defaultCleanText(source.assistant_message || source.reply || source.message),
    summary: defaultCleanText(source.summary),
    output: cloneJson(source.output, null),
    metadata: cloneJson(ensureObject(source.metadata), {})
  };
}

function normalizeTaskState(value) {
  const normalized = defaultCleanText(value).toLowerCase();
  return ['running', 'completed', 'failed'].includes(normalized) ? normalized : '';
}

function defaultSubAgentSystemPrompt(source = {}) {
  const normalizedSource = ensureObject(source);
  const metadata = ensureObject(normalizedSource.metadata);
  const taskType = defaultCleanText(
    metadata.task_type || normalizedSource.task_type || normalizedSource.taskType).toLowerCase();
  if (taskType === 'python-sandbox') {
    return 'You are the Python sandbox supervisor sub-agent. Track one sandbox run, keep liveness accurate, and diagnose failures from the actual sandbox output.';
  }
  return '';
}

function buildCodexSubAgentPrompt(input = {}) {
  const source = ensureObject(input);
  const phase = defaultCleanText(source.phase) || 'message';
  const systemPrompt = defaultCleanText(source.system_prompt || source.systemPrompt);
  const message = defaultCleanText(source.message);
  const agent = ensureObject(source.agent);
  const agentName = defaultCleanText(agent.name) || defaultCleanText(agent.id) || 'sub-agent';
  const transcript = defaultAsArray(source.messages)
    .slice(-16)
    .map((entry) => {
      const row = ensureObject(entry);
      const role = defaultCleanText(row.role) || 'user';
      const text = defaultCleanText(row.text || row.content || row.message);
      return text ? `${role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
  return [
    'You are a real delegated Codex sub-agent running for Hikari.',
    `Sub-agent name: ${agentName}`,
    `Current phase: ${phase}`,
    systemPrompt ? `Sub-agent instructions:\n${systemPrompt}` : '',
    transcript ? `Recent sub-agent transcript:\n${transcript}` : '',
    message ? `Current delegated message:\n${message}` : '',
    'Return the sub-agent assistant response directly. Keep it scoped to this delegated task and include concrete findings or next steps when useful.'
  ].filter(Boolean).join('\n\n');
}

function createAgentSubAgentRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const createId = typeof deps.createId === 'function' ? deps.createId : createSubAgentId;
  const runSubAgentTurn = typeof deps.runSubAgentTurn === 'function' ? deps.runSubAgentTurn : (async () => ({}));
  const isProcessAlive = typeof deps.isProcessAlive === 'function' ? deps.isProcessAlive : defaultIsProcessAlive;
  const getDefaultSystemPrompt = typeof deps.getDefaultSystemPrompt === 'function'
    ? deps.getDefaultSystemPrompt
    : defaultSubAgentSystemPrompt;
  const store = deps.store instanceof Map ? deps.store : new Map();

  function normalizeTask(rawTask) {
    const source = ensureObject(rawTask);
    const processId = Number(source.process_id ?? source.processId);
    return {
      state: normalizeTaskState(source.state),
      task_type: cleanText(source.task_type || source.taskType, 120),
      summary: cleanText(source.summary, 500),
      started_at: cleanText(source.started_at || source.startedAt, 80),
      last_heartbeat_at: cleanText(source.last_heartbeat_at || source.lastHeartbeatAt, 80),
      last_progress_at: cleanText(source.last_progress_at || source.lastProgressAt, 80),
      finished_at: cleanText(source.finished_at || source.finishedAt, 80),
      process_id: Number.isFinite(processId) && processId > 0 ? processId : null,
      heartbeat_count: Number.isFinite(Number(source.heartbeat_count ?? source.heartbeatCount))
        ? Math.max(0, Number(source.heartbeat_count ?? source.heartbeatCount))
        : 0,
      progress_count: Number.isFinite(Number(source.progress_count ?? source.progressCount))
        ? Math.max(0, Number(source.progress_count ?? source.progressCount))
        : 0,
      exit_code: Number.isFinite(Number(source.exit_code ?? source.exitCode))
        ? Number(source.exit_code ?? source.exitCode)
        : null,
      signal: cleanText(source.signal, 40),
      timed_out: source.timed_out === true,
      metadata: cloneJson(ensureObject(source.metadata), {})
    };
  }

  function buildTaskPayload(task) {
    const normalized = normalizeTask(task);
    const hasValues = normalized.state
      || normalized.task_type
      || normalized.summary
      || normalized.started_at
      || normalized.last_heartbeat_at
      || normalized.last_progress_at
      || normalized.finished_at
      || normalized.process_id
      || normalized.heartbeat_count > 0
      || normalized.progress_count > 0
      || normalized.exit_code !== null
      || normalized.signal
      || normalized.timed_out === true
      || Object.keys(normalized.metadata).length > 0;
    return hasValues ? normalized : null;
  }

  function computeLiveness(agent) {
    const source = ensureObject(agent);
    const status = cleanText(source.status, 40).toLowerCase();
    const task = normalizeTask(source.task);
    if (status !== 'active') {
      return {
        live: false,
        state: 'inactive',
        reason: 'agent_inactive'
      };
    }

    if (task.state === 'running') {
      if (task.process_id) {
        const alive = isProcessAlive(task.process_id);
        return {
          live: alive,
          state: alive ? 'running' : 'dead',
          reason: alive ? 'process_alive' : 'process_exited',
          process_id: task.process_id,
          last_heartbeat_at: task.last_heartbeat_at,
          last_progress_at: task.last_progress_at
        };
      }

      if (safeTimestampMs(task.last_progress_at) || safeTimestampMs(task.last_heartbeat_at)) {
        return {
          live: true,
          state: 'running',
          reason: safeTimestampMs(task.last_progress_at) ? 'progress_observed' : 'heartbeat_observed',
          last_heartbeat_at: task.last_heartbeat_at,
          last_progress_at: task.last_progress_at
        };
      }

      return {
        live: true,
        state: 'running',
        reason: 'running_without_process_monitor'
      };
    }

    if (task.state === 'completed') {
      return {
        live: true,
        state: 'idle',
        reason: 'task_completed',
        finished_at: task.finished_at
      };
    }

    if (task.state === 'failed') {
      return {
        live: true,
        state: 'idle',
        reason: 'task_failed',
        finished_at: task.finished_at
      };
    }

    return {
      live: true,
      state: 'idle',
      reason: 'agent_ready'
    };
  }

  function getStoredAgent(agentId) {
    const key = cleanText(agentId, 160);
    if (!key || !store.has(key)) {
      return null;
    }
    return ensureObject(cloneJson(store.get(key), null));
  }

  function saveAgent(agent) {
    const source = ensureObject(agent);
    const key = cleanText(source.id, 160);
    if (!key) {
      throw new Error('Sub-agent id is required.');
    }
    const normalized = cloneJson(source, {});
    store.set(key, normalized);
    return cloneJson(normalized, {});
  }

  function buildAgentSummary(agent) {
    const source = ensureObject(agent);
    return {
      id: cleanText(source.id, 160),
      name: cleanText(source.name, 160),
      status: cleanText(source.status, 40),
      created_at: cleanText(source.created_at, 80),
      updated_at: cleanText(source.updated_at, 80),
      message_count: asArray(source.messages).length,
      metadata: cloneJson(ensureObject(source.metadata), {}),
      task: buildTaskPayload(source.task),
      liveness: computeLiveness(source)
    };
  }

  function updateStoredAgent(agentId, updater) {
    const key = cleanText(agentId, 160);
    const current = getStoredAgent(key);
    if (!current) {
      return null;
    }
    const updated = ensureObject(typeof updater === 'function' ? updater(cloneJson(current, {})) : current);
    updated.updated_at = now();
    return saveAgent(updated);
  }

  function applyTurnMetadataToAgent(agent, metadata) {
    const source = ensureObject(metadata);
    const keys = Object.keys(source);
    if (!keys.length) {
      return agent;
    }
    const current = cloneJson(ensureObject(agent.metadata), {});
    const codexSessionId = cleanText(
      source.codex_session_id || source.codexSessionId || source.session_id || source.sessionId,
      240
    );
    if (codexSessionId) {
      current.codex_session_id = codexSessionId;
    }
    const codexConversationId = cleanText(
      source.codex_conversation_id || source.codexConversationId || source.conversation_id || source.conversationId,
      240
    );
    if (codexConversationId) {
      current.codex_conversation_id = codexConversationId;
    }
    const codexThreadId = cleanText(
      source.codex_thread_id || source.codexThreadId || source.thread_id || source.threadId,
      240
    );
    if (codexThreadId) {
      current.codex_thread_id = codexThreadId;
    }
    ['provider', 'backend', 'command'].forEach((key) => {
      const value = cleanText(source[key], 160);
      if (value) {
        current[key] = value;
      }
    });
    if (source.provider_ok === true || source.provider_ok === false) {
      current.provider_ok = source.provider_ok;
    }
    if (source.real_codex_sub_agent === true || source.realCodexSubAgent === true) {
      current.real_codex_sub_agent = true;
    }
    agent.metadata = current;
    return agent;
  }

  async function createSubAgent(input = {}) {
    const source = ensureObject(input);
    const systemPrompt = cleanText(source.system_prompt || source.systemPrompt, 40000)
      || cleanText(getDefaultSystemPrompt(source), 40000);
    const firstMessage = cleanText(source.message || source.first_message || source.firstMessage, 40000);
    if (!systemPrompt) {
      return {
        ok: false,
        status: 'error',
        error: 'create requires non-empty system_prompt.'
      };
    }
    if (!firstMessage) {
      return {
        ok: false,
        status: 'error',
        error: 'create requires non-empty message.'
      };
    }

    const createdAt = now();
    const agent = {
      id: cleanText(source.agent_id || source.agentId, 160) || createId(),
      name: cleanText(source.name, 160),
      status: 'active',
      system_prompt: systemPrompt,
      metadata: cloneJson(ensureObject(source.metadata), {}),
      created_at: createdAt,
      updated_at: createdAt,
      messages: [
        normalizeMessage('user', firstMessage, createdAt)
      ],
      last_response: null,
      task: null
    };

    const turnResult = normalizeTurnResult(await runSubAgentTurn({
      phase: SUB_AGENT_ACTIONS.CREATE,
      agent: cloneJson(agent, {}),
      system_prompt: systemPrompt,
      message: firstMessage,
      messages: cloneJson(agent.messages, []),
      metadata: cloneJson(agent.metadata, {})
    }));

    if (turnResult.assistant_message) {
      agent.messages.push(normalizeMessage('assistant', turnResult.assistant_message, now()));
    }
    applyTurnMetadataToAgent(agent, turnResult.metadata);
    agent.last_response = {
      assistant_message: turnResult.assistant_message,
      summary: turnResult.summary,
      output: cloneJson(turnResult.output, null),
      metadata: cloneJson(ensureObject(turnResult.metadata), {})
    };
    agent.updated_at = now();
    saveAgent(agent);

    return {
      ok: true,
      status: 'created',
      agent: cloneJson(agent, {}),
      summary: turnResult.summary || `Created sub-agent ${agent.id}.`
    };
  }

  async function sendSubAgentMessage(input = {}) {
    const source = ensureObject(input);
    const agentId = cleanText(source.agent_id || source.agentId, 160);
    const message = cleanText(source.message, 40000);
    if (!agentId) {
      return {
        ok: false,
        status: 'error',
        error: 'message requires agent_id.'
      };
    }
    if (!message) {
      return {
        ok: false,
        status: 'error',
        error: 'message requires non-empty message.'
      };
    }

    const agent = getStoredAgent(agentId);
    if (!agent) {
      return {
        ok: false,
        status: 'missing',
        error: `Sub-agent "${agentId}" was not found.`
      };
    }
    if (cleanText(agent.status, 40) !== 'active') {
      return {
        ok: false,
        status: 'inactive',
        error: `Sub-agent "${agentId}" is not active.`
      };
    }

    const timestamp = now();
    agent.messages = asArray(agent.messages);
    agent.messages.push(normalizeMessage('user', message, timestamp));

    const turnResult = normalizeTurnResult(await runSubAgentTurn({
      phase: SUB_AGENT_ACTIONS.MESSAGE,
      agent: cloneJson(agent, {}),
      system_prompt: cleanText(agent.system_prompt, 40000),
      message,
      messages: cloneJson(agent.messages, []),
      metadata: cloneJson(ensureObject(source.metadata), {})
    }));

    if (turnResult.assistant_message) {
      agent.messages.push(normalizeMessage('assistant', turnResult.assistant_message, now()));
    }
    applyTurnMetadataToAgent(agent, turnResult.metadata);
    agent.last_response = {
      assistant_message: turnResult.assistant_message,
      summary: turnResult.summary,
      output: cloneJson(turnResult.output, null),
      metadata: cloneJson(ensureObject(turnResult.metadata), {})
    };
    agent.updated_at = now();
    saveAgent(agent);

    return {
      ok: true,
      status: 'updated',
      agent: cloneJson(agent, {}),
      summary: turnResult.summary || `Updated sub-agent ${agent.id}.`
    };
  }

  function getSubAgent(input = {}) {
    const source = ensureObject(input);
    const agentId = cleanText(source.agent_id || source.agentId, 160);
    if (!agentId) {
      return {
        ok: false,
        status: 'error',
        error: 'get requires agent_id.'
      };
    }
    const agent = getStoredAgent(agentId);
    if (!agent) {
      return {
        ok: false,
        status: 'missing',
        error: `Sub-agent "${agentId}" was not found.`
      };
    }
    return {
      ok: true,
      status: 'found',
      agent: {
        ...agent,
        task: buildTaskPayload(agent.task),
        liveness: computeLiveness(agent)
      }
    };
  }

  function listSubAgents() {
    const items = [...store.values()]
      .map((item) => buildAgentSummary(item))
      .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
    return {
      ok: true,
      status: 'listed',
      items
    };
  }

  function deleteSubAgent(input = {}) {
    const source = ensureObject(input);
    const agentId = cleanText(source.agent_id || source.agentId, 160);
    if (!agentId) {
      return {
        ok: false,
        status: 'error',
        error: 'delete requires agent_id.'
      };
    }
    const agent = getStoredAgent(agentId);
    if (!agent) {
      return {
        ok: false,
        status: 'missing',
        error: `Sub-agent "${agentId}" was not found.`
      };
    }
    store.delete(agentId);
    return {
      ok: true,
      status: 'deleted',
      agent: buildAgentSummary(agent),
      summary: cleanText(source.reason, 240) || `Deleted sub-agent ${agentId}.`
    };
  }

  function startSubAgentTask(input = {}) {
    const source = ensureObject(input);
    const agentId = cleanText(source.agent_id || source.agentId, 160);
    if (!agentId) {
      return {
        ok: false,
        status: 'error',
        error: 'startSubAgentTask requires agent_id.'
      };
    }
    const startedAt = cleanText(source.started_at || source.startedAt, 80) || now();
    const processId = Number(source.process_id ?? source.processId);
    const updated = updateStoredAgent(agentId, (agent) => {
      agent.task = {
        state: 'running',
        task_type: cleanText(source.task_type || source.taskType, 120)
          || cleanText(agent?.metadata?.task_type, 120),
        summary: cleanText(source.summary, 500),
        started_at: startedAt,
        last_heartbeat_at: startedAt,
        last_progress_at: '',
        finished_at: '',
        process_id: Number.isFinite(processId) && processId > 0 ? processId : null,
        heartbeat_count: 1,
        progress_count: 0,
        exit_code: null,
        signal: '',
        timed_out: false,
        metadata: cloneJson(ensureObject(source.metadata), {})
      };
      return agent;
    });
    if (!updated) {
      return {
        ok: false,
        status: 'missing',
        error: `Sub-agent "${agentId}" was not found.`
      };
    }
    return {
      ok: true,
      status: 'running',
      agent: {
        ...updated,
        task: buildTaskPayload(updated.task),
        liveness: computeLiveness(updated)
      },
      summary: cleanText(source.summary, 240) || `Started task for sub-agent ${agentId}.`
    };
  }

  function recordSubAgentHeartbeat(input = {}) {
    const source = ensureObject(input);
    const agentId = cleanText(source.agent_id || source.agentId, 160);
    if (!agentId) {
      return {
        ok: false,
        status: 'error',
        error: 'recordSubAgentHeartbeat requires agent_id.'
      };
    }
    const timestamp = cleanText(source.timestamp, 80) || now();
    const processId = Number(source.process_id ?? source.processId);
    const progress = source.progress === true;
    const updated = updateStoredAgent(agentId, (agent) => {
      const currentTask = normalizeTask(agent.task);
      agent.task = {
        ...currentTask,
        state: currentTask.state || 'running',
        last_heartbeat_at: timestamp,
        last_progress_at: progress
          ? timestamp
          : currentTask.last_progress_at,
        summary: cleanText(source.summary, 500) || currentTask.summary,
        process_id: Number.isFinite(processId) && processId > 0 ? processId : currentTask.process_id,
        heartbeat_count: currentTask.heartbeat_count + 1,
        progress_count: progress ? currentTask.progress_count + 1 : currentTask.progress_count,
        metadata: {
          ...cloneJson(ensureObject(currentTask.metadata), {}),
          ...cloneJson(ensureObject(source.metadata), {})
        }
      };
      return agent;
    });
    if (!updated) {
      return {
        ok: false,
        status: 'missing',
        error: `Sub-agent "${agentId}" was not found.`
      };
    }
    return {
      ok: true,
      status: 'running',
      agent: {
        ...updated,
        task: buildTaskPayload(updated.task),
        liveness: computeLiveness(updated)
      }
    };
  }

  function completeSubAgentTask(input = {}) {
    const source = ensureObject(input);
    const agentId = cleanText(source.agent_id || source.agentId, 160);
    if (!agentId) {
      return {
        ok: false,
        status: 'error',
        error: 'completeSubAgentTask requires agent_id.'
      };
    }
    const finishedAt = cleanText(source.finished_at || source.finishedAt, 80) || now();
    const updated = updateStoredAgent(agentId, (agent) => {
      const currentTask = normalizeTask(agent.task);
      agent.task = {
        ...currentTask,
        state: 'completed',
        summary: cleanText(source.summary, 500) || currentTask.summary,
        last_heartbeat_at: finishedAt,
        last_progress_at: cleanText(source.last_progress_at || source.lastProgressAt, 80) || currentTask.last_progress_at,
        finished_at: finishedAt,
        exit_code: Number.isFinite(Number(source.exit_code ?? source.exitCode))
          ? Number(source.exit_code ?? source.exitCode)
          : currentTask.exit_code,
        signal: cleanText(source.signal, 40) || currentTask.signal,
        timed_out: source.timed_out === true || currentTask.timed_out === true,
        metadata: {
          ...cloneJson(ensureObject(currentTask.metadata), {}),
          ...cloneJson(ensureObject(source.metadata), {})
        }
      };
      return agent;
    });
    if (!updated) {
      return {
        ok: false,
        status: 'missing',
        error: `Sub-agent "${agentId}" was not found.`
      };
    }
    return {
      ok: true,
      status: 'completed',
      agent: {
        ...updated,
        task: buildTaskPayload(updated.task),
        liveness: computeLiveness(updated)
      },
      summary: cleanText(source.summary, 240) || `Completed task for sub-agent ${agentId}.`
    };
  }

  function failSubAgentTask(input = {}) {
    const source = ensureObject(input);
    const agentId = cleanText(source.agent_id || source.agentId, 160);
    if (!agentId) {
      return {
        ok: false,
        status: 'error',
        error: 'failSubAgentTask requires agent_id.'
      };
    }
    const finishedAt = cleanText(source.finished_at || source.finishedAt, 80) || now();
    const updated = updateStoredAgent(agentId, (agent) => {
      const currentTask = normalizeTask(agent.task);
      agent.task = {
        ...currentTask,
        state: 'failed',
        summary: cleanText(source.summary || source.error, 500) || currentTask.summary,
        last_heartbeat_at: finishedAt,
        last_progress_at: cleanText(source.last_progress_at || source.lastProgressAt, 80) || currentTask.last_progress_at,
        finished_at: finishedAt,
        exit_code: Number.isFinite(Number(source.exit_code ?? source.exitCode))
          ? Number(source.exit_code ?? source.exitCode)
          : currentTask.exit_code,
        signal: cleanText(source.signal, 40) || currentTask.signal,
        timed_out: source.timed_out === true || currentTask.timed_out === true,
        metadata: {
          ...cloneJson(ensureObject(currentTask.metadata), {}),
          ...cloneJson(ensureObject(source.metadata), {})
        }
      };
      return agent;
    });
    if (!updated) {
      return {
        ok: false,
        status: 'missing',
        error: `Sub-agent "${agentId}" was not found.`
      };
    }
    return {
      ok: true,
      status: 'failed',
      agent: {
        ...updated,
        task: buildTaskPayload(updated.task),
        liveness: computeLiveness(updated)
      },
      summary: cleanText(source.summary || source.error, 240) || `Marked task failed for sub-agent ${agentId}.`
    };
  }

  async function execute(input = {}) {
    const source = ensureObject(input);
    const action = normalizeAction(source.action);
    if (!action) {
      return {
        ok: false,
        status: 'error',
        error: 'Sub-agent action must be one of create, message, delete, get, or list.'
      };
    }
    if (action === SUB_AGENT_ACTIONS.CREATE) {
      return createSubAgent(source);
    }
    if (action === SUB_AGENT_ACTIONS.MESSAGE) {
      return sendSubAgentMessage(source);
    }
    if (action === SUB_AGENT_ACTIONS.DELETE) {
      return deleteSubAgent(source);
    }
    if (action === SUB_AGENT_ACTIONS.GET) {
      return getSubAgent(source);
    }
    return listSubAgents();
  }

  return {
    SUB_AGENT_ACTIONS,
    createSubAgent,
    sendSubAgentMessage,
    getSubAgent,
    listSubAgents,
    deleteSubAgent,
    startSubAgentTask,
    recordSubAgentHeartbeat,
    completeSubAgentTask,
    failSubAgentTask,
    computeLiveness,
    execute
  };
}

module.exports = {
  SUB_AGENT_ACTIONS,
  buildCodexSubAgentPrompt,
  createAgentSubAgentRuntime
};
