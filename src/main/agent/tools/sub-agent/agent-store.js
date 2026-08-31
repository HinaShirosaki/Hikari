'use strict';

const { cloneJson, ensureObject } = require('../../../lib/normalize.js');
const { normalizeTaskState, safeTimestampMs } = require('./helpers.js');

// Reads and writes of the in-memory sub-agent records, plus the derived task
// payload and liveness view every caller sees.
function createSubAgentStore({
  asArray,
  cleanText,
  now,
  isProcessAlive,
  store
} = {}) {
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

  return {
    normalizeTask,
    buildTaskPayload,
    computeLiveness,
    getStoredAgent,
    saveAgent,
    buildAgentSummary,
    updateStoredAgent,
    applyTurnMetadataToAgent
  };
}

module.exports = { createSubAgentStore };
