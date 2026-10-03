'use strict';

const DEFAULT_TIMEOUT_MS = 180000;
const LOGIN_STATUS_CACHE_TTL_MS = 30000;
const CODEX_LOGIN_LAUNCH_GRACE_MS = 1500;
const OPENAI_CODEX_LOGIN_URL = 'https://chatgpt.com/auth/login';
const CODEX_TMP_DIR_NAME = 'codex-cli';
const CODEX_PROJECT_MEMORY_FILE = 'MEMORY.md';
const CODEX_AGENTS_FOLDER_NAME = '.agents';
const CODEX_SKILLS_FOLDER_NAME = 'skills';
const CODEX_PROJECT_DOC_MAX_BYTES = 65536;
const CODEX_CONFIG_FILE = 'config.toml';
const CODEX_RUNTIME_HOME_DIR_NAME = 'codex-cli-home';
const CODEX_RUNTIME_HOME_FILES = Object.freeze([
  'auth.json',
  CODEX_CONFIG_FILE,
  '.codex-global-state.json'
]);
const CODEX_RUNTIME_HOME_DIRS = Object.freeze([
  '.tmp',
  'cache',
  'log',
  'plugins',
  'rules',
  'skills',
  'tmp'
]);

module.exports = {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_CONFIG_FILE,
  CODEX_LOGIN_LAUNCH_GRACE_MS,
  CODEX_PROJECT_DOC_MAX_BYTES,
  CODEX_PROJECT_MEMORY_FILE,
  CODEX_RUNTIME_HOME_DIR_NAME,
  CODEX_RUNTIME_HOME_DIRS,
  CODEX_RUNTIME_HOME_FILES,
  CODEX_SKILLS_FOLDER_NAME,
  CODEX_TMP_DIR_NAME,
  DEFAULT_TIMEOUT_MS,
  LOGIN_STATUS_CACHE_TTL_MS,
  OPENAI_CODEX_LOGIN_URL
};
