'use strict';

const CHAT_LOG_FOLDER_NAME = 'chat_log';
const CHAT_LOG_INDEX_FILE_NAME = 'index.json';
const TRANSFORMED_CHAT_LOG_FOLDER_NAME = 'transformed';
const DEFAULT_SCAN_INTERVAL_MS = 15000;
const CONTEXT_SECTION_MARKERS = Object.freeze([
  'Recent conversation:',
  'Conversation:',
  'Transcript:',
  'Feedback message:',
  'User message:',
  'First user message:',
  'Clarified request:',
  'Request:',
  'Question:',
  'Context:',
  'Source paper title:',
  'Source:',
  'Selected blocks:',
  'Exit criteria:',
  'Pre-synthesized question:',
  'Supporting basis:',
  'Reasoning type:',
  'Extracted logic:',
  'Citations:',
  'Recent tool outputs:',
  'Tool outputs:'
]);

module.exports = {
  CHAT_LOG_FOLDER_NAME,
  CHAT_LOG_INDEX_FILE_NAME,
  CONTEXT_SECTION_MARKERS,
  DEFAULT_SCAN_INTERVAL_MS,
  TRANSFORMED_CHAT_LOG_FOLDER_NAME
};
