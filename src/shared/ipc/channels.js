'use strict';

// Single source of truth for IPC channel names shared between the main and
// preload processes. Renderer code does not import this module directly — it
// goes through the typed surface exposed by src/main/preload/api/*.
//
// Channel strings are preserved verbatim from their pre-registry form. A few
// legacy names use inconsistent prefixes (e.g. STORAGE.AUTO_SAVE keeps the
// 'data:' prefix while every other storage channel uses 'storage:'). Those
// quirks are flagged inline; renaming a channel requires a coordinated change
// across main and preload, so it should land as its own PR rather than be
// folded into this extraction.

const AGENT = Object.freeze({
  CHAT: 'agent:chat',
  CHAT_CANCEL: 'agent:chat:cancel',
  GENERATE_PROTOCOL: 'agent:generate-protocol',
  CHAT_LOG_CREATE_SESSION: 'agent:chat-log:create-session',
  CHAT_LOG_LIST_SESSIONS: 'agent:chat-log:list-sessions',
  CHAT_LOG_GET_SESSION: 'agent:chat-log:get-session',
  DEVELOPER_TEST_TOOLS: 'agent:developer:test-tools',
  LOGS_LIST_REQUESTS: 'agent:logs:list-requests',
  LOGS_REPLAY: 'agent:logs:replay'
});

// One-way broadcast (main → renderer). Hyphenated, not colon-namespaced,
// for legacy reasons — see naming note at top of file.
const AGENT_PROGRESS_EVENT = 'agent-progress';

const STORAGE = Object.freeze({
  AUTO_SAVE: 'data:auto-save', // legacy 'data:' prefix; see naming note
  SYNC_SQLITE_BUNDLE: 'storage:sync-sqlite-bundle',
  PICK_DIRECTORY: 'storage:pick-directory',
  ENSURE_DIRECTORY: 'storage:ensure-directory',
  IMPORT_ROOT: 'storage:import-root',
  STORE_IMPORTED_FILE: 'storage:store-imported-file',
  WRITE_JSON_FILE: 'storage:write-json-file',
  DISCOVER_PAPERS: 'storage:discover-papers',
  OPEN_FILE: 'storage:open-file',
  READ_FILE_BASE64: 'storage:read-file-base64',
  APPEND_NOTEBOOK_PAGE_LOG: 'storage:append-notebook-page-log'
});

const SYSTEM = Object.freeze({
  OPEN_EXTERNAL_URL: 'system:open-external-url'
});

const INVENTORY = Object.freeze({
  PARSE_CHEMICAL_IMPORT: 'inventory:parse-chemical-import'
});

const SEQUENCE_LIBRARY = Object.freeze({
  LIST: 'sequence-library:list',
  GET: 'sequence-library:get',
  UPSERT: 'sequence-library:upsert',
  PROMOTE: 'sequence-library:promote',
  DELETE: 'sequence-library:delete',
  SEARCH_FEATURES: 'sequence-library:search-features',
  LIST_BACKBONES: 'sequence-library:list-backbones',
  UPSERT_BACKBONE: 'sequence-library:upsert-backbone',
  ANNOTATE: 'sequence-library:annotate',
  RECOGNIZE_BACKBONE: 'sequence-library:recognize-backbone'
});

const TELEGRAM = Object.freeze({
  GET_CONFIG: 'telegram:get-config',
  SET_TOKEN: 'telegram:set-token',
  CLEAR_TOKEN: 'telegram:clear-token'
});

const TELEGRAM_COMMAND_EVENT = 'telegram-command';

const LLM = Object.freeze({
  CODEX_STATUS: 'llm:codex-status',
  CODEX_CATALOG: 'llm:codex-catalog',
  CODEX_LOGIN: 'llm:codex-login',
  CODEX_CLEAR_LOGIN: 'llm:codex-clear-login',
  CODEX_SET_MODEL: 'llm:codex-set-model',
  CODEX_SET_REASONING_EFFORT: 'llm:codex-set-reasoning-effort',
  CODEX_GENERATE: 'llm:codex-generate',
  DIRECT_MODULES: 'llm:direct-modules',
  DIRECT_GENERATE: 'llm:direct-generate'
});

module.exports = {
  AGENT,
  AGENT_PROGRESS_EVENT,
  STORAGE,
  SYSTEM,
  INVENTORY,
  SEQUENCE_LIBRARY,
  TELEGRAM,
  TELEGRAM_COMMAND_EVENT,
  LLM
};
