'use strict';

const { cloneJson, ensureObject } = require('../../../lib/normalize.js');

// The task lifecycle a sub-agent reports through: start, heartbeat, complete,
// fail.
function createSubAgentTaskActions({
  cleanText,
  now,
  normalizeTask,
  buildTaskPayload,
  computeLiveness,
  updateStoredAgent
} = {}) {
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

  return {
    startSubAgentTask,
    recordSubAgentHeartbeat,
    completeSubAgentTask,
    failSubAgentTask
  };
}

module.exports = { createSubAgentTaskActions };
