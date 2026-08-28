'use strict';

const MEMORY_FILE_NAME = 'MEMORY.md';
const CODEX_AGENTS_FOLDER_NAME = '.agents';
const CODEX_SKILLS_FOLDER_NAME = 'skills';
const PROJECT_MEMORY_AUTO_START = '<!-- hikari:auto -->';
const PROJECT_MEMORY_AUTO_END = '<!-- /hikari:auto -->';
const PROJECT_MEMORY_CACHE_FOLDER = '.hikari';
const PROJECT_MEMORY_CACHE_FILE = 'research-memory.json';
const NOTEBOOK_MEMORY_MODEL_FALLBACK = 'fallback-extract';
const PAPER_SUMMARY_PENDING = 'Not analyzed yet — run paper intake to record a summary.';

module.exports = {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_SKILLS_FOLDER_NAME,
  MEMORY_FILE_NAME,
  NOTEBOOK_MEMORY_MODEL_FALLBACK,
  PAPER_SUMMARY_PENDING,
  PROJECT_MEMORY_AUTO_END,
  PROJECT_MEMORY_AUTO_START,
  PROJECT_MEMORY_CACHE_FILE,
  PROJECT_MEMORY_CACHE_FOLDER
};
