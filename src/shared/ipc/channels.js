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
  HTML_PREVIEW: 'agent:html-preview',
  CHAT_CANCEL: 'agent:chat:cancel',
  LIST_SKILLS: 'agent:list-skills',
  SUGGEST_EXPERIMENT: 'agent:suggest-experiment',
  GENERATE_PROTOCOL: 'agent:generate-protocol',
  CHAT_LOG_CREATE_SESSION: 'agent:chat-log:create-session',
  CHAT_LOG_LIST_SESSIONS: 'agent:chat-log:list-sessions',
  CHAT_LOG_GET_SESSION: 'agent:chat-log:get-session',
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
  LAST_ROOT: 'storage:last-root',
  STORE_IMPORTED_FILE: 'storage:store-imported-file',
  MOVE_STORED_FILE: 'storage:move-stored-file',
  WRITE_JSON_FILE: 'storage:write-json-file',
  DISCOVER_PAPERS: 'storage:discover-papers',
  OPEN_FILE: 'storage:open-file',
  READ_FILE_BYTES: 'storage:read-file-bytes',
  READ_FILE_BASE64: 'storage:read-file-base64',
  APPEND_NOTEBOOK_PAGE_LOG: 'storage:append-notebook-page-log',
  PROTOCOL_RECORD_SAVED: 'storage:protocol-record-saved'
});

const SYSTEM = Object.freeze({
  OPEN_EXTERNAL_URL: 'system:open-external-url',
  APP_CLOSE_REQUESTED: 'system:app-close-requested',
  APP_CLOSE_RESPONSE: 'system:app-close-response',
  REPORT_ERROR: 'system:report-error',
  OPEN_LOGS_FOLDER: 'system:open-logs-folder'
});

const PLUGINS = Object.freeze({
  INSPECT_FOLDER: 'plugins:inspect-folder',
  SERVE_FOLDER: 'plugins:serve-folder',
  READ_FILE: 'plugins:read-file',
  WRITE_FILE: 'plugins:write-file',
  EXPORT_FILE: 'plugins:export-file'
});

const PYTHON = Object.freeze({
  RUN: 'python:run'
});

const BIOINFORMATICS = Object.freeze({
  BLAST_SUBMIT: 'bioinformatics:blast-submit',
  BLAST_STATUS: 'bioinformatics:blast-status',
  BLAST_RESULTS: 'bioinformatics:blast-results',
  UNIPROT_SEARCH: 'bioinformatics:uniprot-search',
  UNIPROT_GET: 'bioinformatics:uniprot-get'
});

const INVENTORY = Object.freeze({
  PARSE_CHEMICAL_IMPORT: 'inventory:parse-chemical-import'
});

const ASSAY = Object.freeze({
  PARSE_RESULT_IMPORT: 'assay:parse-result-import'
});

const SEQUENCE_LIBRARY = Object.freeze({
  LIST: 'sequence-library:list',
  GET: 'sequence-library:get',
  AGENT_ARTIFACT: 'sequence-library:agent-artifact',
  UPSERT: 'sequence-library:upsert',
  PROMOTE: 'sequence-library:promote',
  DELETE: 'sequence-library:delete',
  UPSERT_FOLDER: 'sequence-library:upsert-folder',
  DELETE_FOLDER: 'sequence-library:delete-folder',
  MOVE_ENTRY: 'sequence-library:move-entry',
  SEARCH_FEATURES: 'sequence-library:search-features',
  LIST_BACKBONES: 'sequence-library:list-backbones',
  UPSERT_BACKBONE: 'sequence-library:upsert-backbone',
  ANNOTATE: 'sequence-library:annotate',
  RECOGNIZE_BACKBONE: 'sequence-library:recognize-backbone'
});

const GENOME = Object.freeze({
  LIST: 'genome:list',
  GET: 'genome:get',
  ADD: 'genome:add',
  REMOVE: 'genome:remove',
  READ_REGION: 'genome:read-region'
});

const SCHEDULED_TASK = Object.freeze({
  LIST: 'scheduled-task:list',
  GET: 'scheduled-task:get',
  CREATE: 'scheduled-task:create',
  UPDATE: 'scheduled-task:update',
  DELETE: 'scheduled-task:delete',
  RUN: 'scheduled-task:run'
});

const LLM = Object.freeze({
  CODEX_STATUS: 'llm:codex-status',
  CODEX_CATALOG: 'llm:codex-catalog',
  CODEX_LOGIN: 'llm:codex-login',
  CODEX_CLEAR_LOGIN: 'llm:codex-clear-login',
  CODEX_SET_MODEL: 'llm:codex-set-model',
  CODEX_SET_REASONING_EFFORT: 'llm:codex-set-reasoning-effort',
  CODEX_DESKTOP_MCP_PROMPT: 'llm:codex-desktop-mcp-prompt',
  CODEX_GENERATE: 'llm:codex-generate',
  DIRECT_MODULES: 'llm:direct-modules',
  DIRECT_GENERATE: 'llm:direct-generate'
});

module.exports = {
  AGENT,
  AGENT_PROGRESS_EVENT,
  STORAGE,
  SYSTEM,
  PLUGINS,
  PYTHON,
  BIOINFORMATICS,
  INVENTORY,
  ASSAY,
  SEQUENCE_LIBRARY,
  SCHEDULED_TASK,
  GENOME,
  LLM
};
