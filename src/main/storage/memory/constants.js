'use strict';

const MEMORY_FILE_NAME = 'MEMORY.md';
const CODEX_AGENTS_FOLDER_NAME = '.agents';
const CODEX_SKILLS_FOLDER_NAME = 'skills';
const PROJECT_MEMORY_AUTO_START = '<!-- hikari:auto -->';
const PROJECT_MEMORY_AUTO_END = '<!-- /hikari:auto -->';
const PROJECT_MEMORY_CACHE_FOLDER = '.hikari';
const PROJECT_MEMORY_CACHE_FILE = 'research-memory.json';
const NOTEBOOK_MEMORY_MODEL_FALLBACK = 'fallback-extract';
// Codex loads MEMORY.md as the project doc and stops at CODEX_PROJECT_DOC_MAX_BYTES
// (src/main/lib/codex-cli-provider/constants.js). Storage cannot import that
// without pointing at the agent layer, so the number lives here too and
// project-research-memory-selfcheck asserts the pair stays equal. Writing past
// the cap does not fail loudly: the tail is simply never read.
const PROJECT_MEMORY_MAX_BYTES = 65536;
const PAPER_SUMMARY_PENDING = 'Not analyzed yet — run paper intake to record a summary.';
const NOTEBOOK_SUMMARY_PENDING = 'Not summarized yet — open the page with notebook_lookup to read the recorded result.';

module.exports = {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_SKILLS_FOLDER_NAME,
  MEMORY_FILE_NAME,
  NOTEBOOK_MEMORY_MODEL_FALLBACK,
  NOTEBOOK_SUMMARY_PENDING,
  PAPER_SUMMARY_PENDING,
  PROJECT_MEMORY_AUTO_END,
  PROJECT_MEMORY_AUTO_START,
  PROJECT_MEMORY_CACHE_FILE,
  PROJECT_MEMORY_CACHE_FOLDER,
  PROJECT_MEMORY_MAX_BYTES
};
