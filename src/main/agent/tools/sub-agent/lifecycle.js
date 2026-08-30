'use strict';

const { cloneJson, ensureObject } = require('../../../lib/normalize.js');
const { SUB_AGENT_ACTIONS, normalizeMessage, normalizeTurnResult } = require('./helpers.js');

// Create / message / read / delete for sub-agents.
function createSubAgentLifecycle({
  asArray,
  cleanText,
  now,
  createId,
  runSubAgentTurn,
  getDefaultSystemPrompt,
  store,
  getStoredAgent,
  saveAgent,
  buildAgentSummary,
  buildTaskPayload,
  computeLiveness,
  applyTurnMetadataToAgent
} = {}) {
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

  return {
    createSubAgent,
    sendSubAgentMessage,
    getSubAgent,
    listSubAgents,
    deleteSubAgent
  };
}

module.exports = { createSubAgentLifecycle };
