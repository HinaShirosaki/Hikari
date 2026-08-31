'use strict';

const { ensureObject } = require('../../lib/normalize.js');
const {
  SUB_AGENT_ACTIONS,
  buildCodexSubAgentPrompt,
  createSubAgentId,
  defaultAsArray,
  defaultCleanText,
  defaultIsProcessAlive,
  defaultSubAgentSystemPrompt,
  normalizeAction
} = require('./sub-agent/helpers.js');
const { createSubAgentStore } = require('./sub-agent/agent-store.js');
const { createSubAgentLifecycle } = require('./sub-agent/lifecycle.js');
const { createSubAgentTaskActions } = require('./sub-agent/task-actions.js');

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

  const {
    normalizeTask,
    buildTaskPayload,
    computeLiveness,
    getStoredAgent,
    saveAgent,
    buildAgentSummary,
    updateStoredAgent,
    applyTurnMetadataToAgent
  } = createSubAgentStore({ asArray, cleanText, now, isProcessAlive, store });

  const {
    createSubAgent,
    sendSubAgentMessage,
    getSubAgent,
    listSubAgents,
    deleteSubAgent
  } = createSubAgentLifecycle({
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
  });

  const {
    startSubAgentTask,
    recordSubAgentHeartbeat,
    completeSubAgentTask,
    failSubAgentTask
  } = createSubAgentTaskActions({
    cleanText,
    now,
    normalizeTask,
    buildTaskPayload,
    computeLiveness,
    updateStoredAgent
  });

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
