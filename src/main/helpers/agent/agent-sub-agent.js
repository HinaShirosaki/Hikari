'use strict';

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, maxLength = 4000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
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
  const normalized = defaultCleanText(value, 40).toLowerCase();
  return Object.values(SUB_AGENT_ACTIONS).includes(normalized) ? normalized : '';
}

function normalizeMessage(role, text, timestamp) {
  return {
    role: role === 'assistant' ? 'assistant' : 'user',
    text: defaultCleanText(text, 20000),
    timestamp: defaultCleanText(timestamp, 80)
  };
}

function normalizeTurnResult(rawResult) {
  if (typeof rawResult === 'string') {
    return {
      assistant_message: defaultCleanText(rawResult, 20000),
      summary: ''
    };
  }
  const source = ensureObject(rawResult);
  return {
    assistant_message: defaultCleanText(source.assistant_message || source.reply || source.message, 20000),
    summary: defaultCleanText(source.summary, 500),
    output: cloneJson(source.output, null),
    metadata: cloneJson(ensureObject(source.metadata), {})
  };
}

function createAgentSubAgentRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const createId = typeof deps.createId === 'function' ? deps.createId : createSubAgentId;
  const runSubAgentTurn = typeof deps.runSubAgentTurn === 'function' ? deps.runSubAgentTurn : (async () => ({}));
  const store = deps.store instanceof Map ? deps.store : new Map();

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
      metadata: cloneJson(ensureObject(source.metadata), {})
    };
  }

  async function createSubAgent(input = {}) {
    const source = ensureObject(input);
    const systemPrompt = cleanText(source.system_prompt || source.systemPrompt, 40000);
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
      last_response: null
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
      agent
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
    execute
  };
}

module.exports = {
  SUB_AGENT_ACTIONS,
  createAgentSubAgentRuntime
};
