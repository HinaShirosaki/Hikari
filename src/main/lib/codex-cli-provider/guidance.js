'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  releaseOfficialMcpSkills
} = require('../../agent/codex-agent/official-mcp-skills.js');
const {
  ensureHikariCodexAgentsFile,
  removeHikariCodexAgentsFileIfOnlyManaged
} = require('../../agent/codex-agent/runtime-files.js');
const {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_PROJECT_MEMORY_FILE,
  CODEX_SKILLS_FOLDER_NAME
} = require('./constants');
const {
  isFilesystemRoot,
  resolveCodexCliRuntimeHomeDirectory,
  resolveWorkingDirectory
} = require('./paths');

async function ensureCodexCliAgentsFile(cwd = '') {
  return ensureHikariCodexAgentsFile(resolveWorkingDirectory(cwd));
}

async function hasCodexProjectMemoryFile(cwd = '') {
  const safeCwd = resolveWorkingDirectory(cwd);
  try {
    const stats = await fs.stat(path.join(safeCwd, CODEX_PROJECT_MEMORY_FILE));
    return stats.isFile();
  } catch {
    return false;
  }
}

function resolveSkillRequestContext(options = {}) {
  const env = options.env && typeof options.env === 'object'
    ? options.env
    : (options.envOverrides && typeof options.envOverrides === 'object' ? options.envOverrides : {});
  const serialized = env.HIKARI_AGENT_MCP_REQUEST_CONTEXT
    || env.HIKARI_CODEX_REQUEST_CONTEXT
    || '';
  try {
    const parsed = JSON.parse(String(serialized || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function ensureCodexCliProjectSkillFolder(cwd = '', options = {}) {
  const safeCwd = resolveWorkingDirectory(cwd);
  if (!safeCwd || isFilesystemRoot(safeCwd)) {
    return '';
  }
  const skillsPath = path.join(safeCwd, CODEX_AGENTS_FOLDER_NAME, CODEX_SKILLS_FOLDER_NAME);
  await fs.mkdir(skillsPath, { recursive: true });
  await releaseOfficialMcpSkills(skillsPath, resolveSkillRequestContext(options)).catch(() => []);
  return skillsPath;
}

async function ensureCodexCliWorkingDirectoryGuidance(cwd = '', options = {}) {
  const safeCwd = resolveWorkingDirectory(cwd);
  if (await hasCodexProjectMemoryFile(safeCwd)) {
    await ensureCodexCliProjectSkillFolder(safeCwd, options).catch(() => '');
  }
  // The runtime home owns the durable contract. Remove legacy workspace copies
  // while preserving user-authored guidance and the runtime-home copy itself.
  const runtimeHome = resolveCodexCliRuntimeHomeDirectory(safeCwd);
  if (!runtimeHome || path.resolve(safeCwd) !== path.resolve(runtimeHome)) {
    await removeHikariCodexAgentsFileIfOnlyManaged(safeCwd).catch(() => false);
  }
  return '';
}

async function ensureCodexCliGlobalAgentsFile(cwd = '') {
  const runtimeHome = resolveCodexCliRuntimeHomeDirectory(cwd);
  if (!runtimeHome || isFilesystemRoot(runtimeHome)) {
    return '';
  }
  await fs.mkdir(runtimeHome, { recursive: true });
  return ensureHikariCodexAgentsFile(runtimeHome);
}

module.exports = {
  ensureCodexCliAgentsFile,
  ensureCodexCliGlobalAgentsFile,
  ensureCodexCliProjectSkillFolder,
  ensureCodexCliWorkingDirectoryGuidance,
  hasCodexProjectMemoryFile,
  resolveSkillRequestContext
};
