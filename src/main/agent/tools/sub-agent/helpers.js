'use strict';

const { asArray: defaultAsArray, cloneJson, ensureObject } = require('../../../lib/normalize.js');

// Defaults and normalizers shared by the sub-agent runtime: id/timestamp
// helpers, the action enum, message/turn shapes, and the Codex prompt.
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

module.exports = {
  defaultAsArray,
  defaultCleanText,
  safeTimestampMs,
  defaultIsProcessAlive,
  createSubAgentId,
  SUB_AGENT_ACTIONS,
  normalizeAction,
  normalizeMessage,
  normalizeTurnResult,
  normalizeTaskState,
  defaultSubAgentSystemPrompt,
  buildCodexSubAgentPrompt
};
