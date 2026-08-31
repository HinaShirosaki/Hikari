'use strict';

// Storage constants shared by the index file and per-session log files.
const CHAT_LOG_FOLDER_NAME = 'chat_log';
const CHAT_LOG_INDEX_FILE_NAME = 'index.json';
const CHAT_LOG_EVENT_TYPES = Object.freeze({
  SESSION_CREATED: 'session-created',
  USER_MESSAGE: 'user-message',
  ASSISTANT_MESSAGE: 'assistant-message',
  AGENT_CHAT_REQUEST: 'agent-chat-request',
  AGENT_CHAT_RESULT: 'agent-chat-result',
  AGENT_CHAT_ERROR: 'agent-chat-error',
  AGENT_LIFECYCLE: 'agent-lifecycle',
  AGENT_LLM_TRACE: 'agent-llm-trace'
});

module.exports = {
  CHAT_LOG_FOLDER_NAME,
  CHAT_LOG_INDEX_FILE_NAME,
  CHAT_LOG_EVENT_TYPES
};
